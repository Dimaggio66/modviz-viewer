/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning an Ausstattung project into quantities.
 *
 * A PURE MODULE ON PURPOSE. This is the part that decides what a tender is
 * priced on, so it must be checkable against a real model without a browser
 * and without WebGPU. Living inside a component's `useMemo` it could only ever
 * be typechecked, which for a calculation is barely a check at all.
 *
 * SCHNITTMENGE is applied here, not in the formulas: a row is evaluated
 * against the intersection of its own Auswahlgruppe and every ancestor's,
 * which is why the formulas in the source table can be as short as they are.
 * Each group resolves once per pass and is cached — the same group appears on
 * dozens of rows.
 *
 * An Auswahlgruppe is resolved by asking the QTO evaluator for the ids its
 * condition matches, rather than by a second condition engine: one grammar,
 * one implementation, one place for a bug to live.
 */

import { evaluateQtoQuery, parseQtoQuery, type QtoContext } from '../quantities/qto-query.js';
import { buildTree, rowKind, scopeChain, type AusstattungProject } from './model.js';

/** What one Ausstattung row produced. */
export interface RowResult {
  value: number | null;
  unit: string | null;
  /** Set when the formula itself could not be read. */
  parseError?: string;
  /** Named reasons the formula could not be evaluated. */
  unsupported: string[];
  matched: number;
  skipped: number;
  unresolved: number;
}

/** What one LV position sums up to. */
export interface LvRollup {
  /** `null` when at least one feeding row produced no number — a partial sum
   *  would understate the position, and understating it is worse than saying
   *  nothing. */
  value: number | null;
  feedingRows: number;
  openRows: number;
}

export interface ProjectResults {
  /** Keyed by Schlüssel. */
  rows: Map<string, RowResult>;
  /** Keyed by {@link lvRollupKey}. */
  lv: Map<string, LvRollup>;
}

export const lvRollupKey = (tlk: string, lv: string): string => `${tlk.trim()}${lv.trim()}`;

/** Wraps a bare Bauteil condition in a counting query, so one grammar serves. */
const groupQuery = (bedingung: string): string =>
  `QTO(Typ:="Stückzahl";ME:="St";Bauteil:="${bedingung}")`;

export function evaluateProject(
  project: AusstattungProject,
  universe: readonly number[],
  makeContext: (ids: readonly number[]) => QtoContext,
): ProjectResults {
  const rows = new Map<string, RowResult>();
  const byKey = new Map(project.rows.map((r) => [r.schluessel, r]));
  const groupIds = new Map<string, number[] | null>();

  /** The ids an Auswahlgruppe selects, or null when its condition is broken. */
  const idsOfGroup = (name: string): number[] | null => {
    if (groupIds.has(name)) return groupIds.get(name)!;
    const gruppe = project.gruppen.find((g) => g.name === name);
    let ids: number[] | null;
    if (!gruppe || !gruppe.bedingung.trim()) {
      // A group without a condition narrows nothing rather than selecting
      // nothing — an empty row in the catalogue must not zero a quantity.
      ids = [...universe];
    } else {
      const parsed = parseQtoQuery(groupQuery(gruppe.bedingung.trim()));
      ids = parsed.ok ? evaluateQtoQuery(parsed.expr, makeContext(universe)).matchedIds : null;
    }
    groupIds.set(name, ids);
    return ids;
  };

  for (const tree of buildTree(project.rows)) {
    const row = tree.row;
    if (!row.mengenabfrage.trim()) continue;

    let scope: readonly number[] = universe;
    let brokenGroup: string | null = null;
    for (const name of scopeChain(tree, byKey)) {
      const allowed = idsOfGroup(name);
      if (allowed === null) { brokenGroup = name; break; }
      const set = new Set(allowed);
      scope = scope.filter((id) => set.has(id));
    }

    if (brokenGroup !== null) {
      rows.set(row.schluessel, {
        value: null, unit: null, unsupported: [`Auswahlgruppe "${brokenGroup}" ist nicht lesbar`],
        matched: 0, skipped: 0, unresolved: 0,
      });
      continue;
    }

    const parsed = parseQtoQuery(row.mengenabfrage);
    if (!parsed.ok) {
      rows.set(row.schluessel, {
        value: null, unit: null, parseError: parsed.error,
        unsupported: [], matched: 0, skipped: 0, unresolved: 0,
      });
      continue;
    }

    const r = evaluateQtoQuery(parsed.expr, makeContext(scope));
    rows.set(row.schluessel, {
      value: r.value,
      unit: r.unit,
      unsupported: r.unsupported,
      matched: r.matchedIds.length,
      skipped: r.skipped.length,
      unresolved: r.unresolved.length,
    });
  }

  const lv = new Map<string, LvRollup>();
  for (const row of project.rows) {
    if (rowKind(row) !== 'position') continue;
    const key = lvRollupKey(row.tlk, row.lv);
    const current = lv.get(key) ?? { value: 0, feedingRows: 0, openRows: 0 };
    const res = rows.get(row.schluessel);
    current.feedingRows += 1;
    if (!res || res.value === null) {
      current.openRows += 1;
      current.value = null;
    } else if (current.value !== null) {
      current.value += res.value;
    }
    lv.set(key, current);
  }
  // A position nothing points at is listed too, so it is visibly unassigned
  // rather than quietly absent.
  for (const p of project.positionen) {
    const key = lvRollupKey(p.tlk, p.lv);
    if (!lv.has(key)) lv.set(key, { value: null, feedingRows: 0, openRows: 0 });
  }

  return { rows, lv };
}
