/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Ausstattung table — the hierarchy of keys that carries the
 * Mengenabfragen, and the LV/TLK catalogue it points at.
 *
 * THE KEY IS THE TREE. `60.70.60.10.40.10.15` sits under `60.70.60.10.40.10`
 * because of its own text, exactly as in iTWO. There is no second parent
 * field to keep in sync, and renumbering a branch is a text edit rather than a
 * restructuring.
 *
 * A row's KIND is likewise derived, not stored — it is what the row has:
 *   Gruppe      no formula                      (the orange rows)
 *   Übersicht   a formula, no LV                (the yellow rows)
 *   Position    a formula AND an LV reference   (the teal rows)
 * Storing it as a fourth field would let it disagree with the row's content.
 *
 * SCHNITTMENGE: a row is evaluated against the intersection of its own
 * Auswahlgruppe and those of every ancestor. That is what the Typ column says
 * in the source table, and it is why the formulas can be as short as they are:
 * `Bauteil:="Attribut{5D_DN}==(40[mm])"` under Rohre/SML means DN40 pipes of
 * cast iron, not every DN40 object in the model.
 */

/** A named object query, referenced by rows and shared between them. */
export interface Auswahlgruppe {
  name: string;
  /** A `Bauteil` expression — the same grammar the Mengenabfrage uses. */
  bedingung: string;
}

/** One LV position; the Ausstattung rows reference it by tlk + lv. */
export interface LvPosition {
  tlk: string;
  lv: string;
  bezeichnung: string;
  einheit: string;
}

export interface AusstattungRow {
  /** `60.70.60.10.40.10.15` — primary key AND tree path. */
  schluessel: string;
  /** Name of an {@link Auswahlgruppe}, or empty. */
  auswahlgruppe: string;
  /** Free text from the source table; "Schnittmenge" marks the inheritance. */
  typ: string;
  bezeichnung: string;
  /** The QTO formula, verbatim. Empty on a pure group row. */
  mengenabfrage: string;
  /** The row's own unit, which may differ from the QTO's own ME when a factor
   *  converts (a count in St multiplied into metres). */
  me: string;
  /** LV reference, both empty when the row is not a position. */
  tlk: string;
  lv: string;
}

export interface AusstattungProject {
  rows: AusstattungRow[];
  gruppen: Auswahlgruppe[];
  positionen: LvPosition[];
}

export type RowKind = 'gruppe' | 'uebersicht' | 'position';

export function rowKind(row: AusstattungRow): RowKind {
  if (!row.mengenabfrage.trim()) return 'gruppe';
  return row.tlk.trim() || row.lv.trim() ? 'position' : 'uebersicht';
}

/** `TLK: 1 - LV: 410`, or an empty string when the row references nothing. */
export function formatTlPfad(row: AusstattungRow): string {
  const tlk = row.tlk.trim();
  const lv = row.lv.trim();
  if (!tlk && !lv) return '';
  return [tlk && `TLK: ${tlk}`, lv && `LV: ${lv}`].filter(Boolean).join(' - ');
}

const segments = (key: string): string[] => key.split('.').filter(Boolean);

/** Is `parent` a proper key-prefix of `child`, on segment boundaries? */
export function isAncestorKey(parent: string, child: string): boolean {
  const p = segments(parent);
  const c = segments(child);
  if (p.length === 0 || p.length >= c.length) return false;
  return p.every((s, i) => s === c[i]);
}

/** Sorts keys the way the table reads: segment by segment, numerically. */
export function compareKeys(a: string, b: string): number {
  const sa = segments(a);
  const sb = segments(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i];
    const y = sb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    const d = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (d !== 0) return d;
  }
  return 0;
}

export interface TreeRow {
  row: AusstattungRow;
  /** Nesting level for the indent — 0 for the shallowest keys present. */
  depth: number;
  /** Keys of this row's ancestors, outermost first. */
  ancestors: string[];
  hasChildren: boolean;
}

/**
 * Orders the rows and works out each one's depth from the keys alone. Depth
 * counts ANCESTORS PRESENT IN THE TABLE, not key segments, so a table that
 * starts at `60.70.60` does not begin indented three levels deep.
 */
export function buildTree(rows: readonly AusstattungRow[]): TreeRow[] {
  const sorted = [...rows].sort((a, b) => compareKeys(a.schluessel, b.schluessel));
  const out: TreeRow[] = [];
  const stack: string[] = [];
  for (const row of sorted) {
    while (stack.length > 0 && !isAncestorKey(stack[stack.length - 1]!, row.schluessel)) stack.pop();
    out.push({ row, depth: stack.length, ancestors: [...stack], hasChildren: false });
    stack.push(row.schluessel);
  }
  const withChildren = new Set(out.flatMap((t) => t.ancestors));
  return out.map((t) => (withChildren.has(t.row.schluessel) ? { ...t, hasChildren: true } : t));
}

/**
 * The Auswahlgruppen that narrow a row: its ancestors' from the outside in,
 * then its own. Their conditions are ANDed — that is the Schnittmenge.
 */
export function scopeChain(tree: TreeRow, byKey: ReadonlyMap<string, AusstattungRow>): string[] {
  const names: string[] = [];
  for (const key of [...tree.ancestors, tree.row.schluessel]) {
    const name = byKey.get(key)?.auswahlgruppe.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function emptyProject(): AusstattungProject {
  return { rows: [], gruppen: [], positionen: [] };
}
