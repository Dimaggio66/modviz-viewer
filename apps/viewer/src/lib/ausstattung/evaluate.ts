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
  /**
   * Elements counted by MORE THAN ONE feeding row, i.e. measured twice into
   * the same position. Two rules can legitimately point at one LV, but only
   * while they select different elements: the moment one row's objects are a
   * subset of another's, the position is overstated by exactly that overlap.
   * Nothing about the sum looks wrong when it happens, which is why it is
   * counted rather than left to be noticed.
   */
  overlapping: number;
  /** The rows involved in that overlap, so it can be resolved. */
  overlapRows: string[];
}

/** What one Auswahlgruppe currently selects. */
export interface GroupResult {
  /** Objects the condition matches, or `null` when it cannot be read. */
  matched: number | null;
  /** Why it cannot be read, or why it cannot be evaluated here. */
  problem: string | null;
}

export interface ProjectResults {
  /** Keyed by Schlüssel. */
  rows: Map<string, RowResult>;
  /** Keyed by {@link lvRollupKey}. */
  lv: Map<string, LvRollup>;
  /** Keyed by group name — every group, whether a row uses it or not. */
  gruppen: Map<string, GroupResult>;
}

export const lvRollupKey = (tlk: string, lv: string): string => `${tlk.trim()}${lv.trim()}`;

/**
 * RIB's own "Aus Filter" writes a group definition as `Object(@X=='Y')`, and
 * that is what gets copied out of its Objekt-Auswahlgruppen panel. The wrapper
 * carries no meaning we need — it says "this is an object query" — so it is
 * peeled off rather than made a parse error, and a condition typed without it
 * works just the same.
 */
export function stripObjectWrapper(bedingung: string): string {
  const t = bedingung.trim();
  const m = /^Object\s*\(([\s\S]*)\)$/i.exec(t);
  return m ? m[1]!.trim() : t;
}

/** Wraps a bare Bauteil condition in a counting query, so one grammar serves. */
const groupQuery = (bedingung: string): string =>
  `QTO(Typ:="Stückzahl";ME:="St";Bauteil:="${stripObjectWrapper(bedingung)}")`;

export function evaluateProject(
  project: AusstattungProject,
  universe: readonly number[],
  makeContext: (ids: readonly number[]) => QtoContext,
): ProjectResults {
  const rows = new Map<string, RowResult>();
  const gruppen = new Map<string, GroupResult>();
  const contributed = new Map<string, number[]>();
  const byKey = new Map(project.rows.map((r) => [r.schluessel, r]));
  const groupIds = new Map<string, number[] | null>();

  /** The ids an Auswahlgruppe selects, or null when its condition is broken. */
  const idsOfGroup = (name: string): number[] | null => {
    if (groupIds.has(name)) return groupIds.get(name)!;
    const gruppe = project.gruppen.find((g) => g.name === name);
    let ids: number[] | null;
    let problem: string | null = null;
    if (!gruppe) {
      // A row naming a group that is not in the catalogue selects nothing
      // rather than everything: widening a scope by accident overstates.
      ids = null;
      problem = 'Gruppe existiert nicht';
    } else if (!gruppe.bedingung.trim()) {
      // A group without a condition narrows nothing rather than selecting
      // nothing — an empty entry in the catalogue must not zero a quantity.
      ids = [...universe];
    } else {
      const parsed = parseQtoQuery(groupQuery(gruppe.bedingung.trim()));
      if (!parsed.ok) {
        ids = null;
        problem = parsed.error;
      } else {
        const r = evaluateQtoQuery(parsed.expr, makeContext(universe));
        if (r.value === null) {
          ids = null;
          problem = r.unsupported.join('; ');
        } else {
          ids = r.matchedIds;
        }
      }
    }
    groupIds.set(name, ids);
    gruppen.set(name, { matched: ids?.length ?? null, problem });
    return ids;
  };

  // Every group is resolved, not only the referenced ones, so the catalogue
  // can show a hit count while it is being written.
  for (const g of project.gruppen) idsOfGroup(g.name);

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
      const why = gruppen.get(brokenGroup)?.problem;
      rows.set(row.schluessel, {
        value: null,
        unit: null,
        unsupported: [`Auswahlgruppe "${brokenGroup}": ${why ?? 'nicht auswertbar'}`],
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
    // Kept only for the overlap check below, never handed out: a few hundred
    // rows over a few thousand objects each would be a lot to carry around.
    contributed.set(row.schluessel, r.matchedIds);
  }

  const lv = new Map<string, LvRollup>();
  /** Which rows measured a given element into a given position. */
  const seenPerLv = new Map<string, Map<number, string[]>>();

  for (const row of project.rows) {
    if (rowKind(row) !== 'position') continue;
    const key = lvRollupKey(row.tlk, row.lv);
    const current = lv.get(key)
      ?? { value: 0, feedingRows: 0, openRows: 0, overlapping: 0, overlapRows: [] };
    const res = rows.get(row.schluessel);
    current.feedingRows += 1;
    if (!res || res.value === null) {
      current.openRows += 1;
      current.value = null;
    } else if (current.value !== null) {
      current.value += res.value;
    }

    const seen = seenPerLv.get(key) ?? new Map<number, string[]>();
    for (const id of contributed.get(row.schluessel) ?? []) {
      const by = seen.get(id);
      if (by) by.push(row.schluessel);
      else seen.set(id, [row.schluessel]);
    }
    seenPerLv.set(key, seen);
    lv.set(key, current);
  }

  for (const [key, seen] of seenPerLv) {
    const roll = lv.get(key);
    if (!roll) continue;
    const culprits = new Set<string>();
    let doubled = 0;
    for (const by of seen.values()) {
      if (by.length < 2) continue;
      doubled += 1;
      for (const k of by) culprits.add(k);
    }
    roll.overlapping = doubled;
    roll.overlapRows = [...culprits].sort();
  }

  // A position nothing points at is listed too, so it is visibly unassigned
  // rather than quietly absent.
  for (const p of project.positionen) {
    const key = lvRollupKey(p.tlk, p.lv);
    if (!lv.has(key)) {
      lv.set(key, { value: null, feedingRows: 0, openRows: 0, overlapping: 0, overlapRows: [] });
    }
  }

  return { rows, lv, gruppen };
}
