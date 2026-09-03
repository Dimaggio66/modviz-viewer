/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Attribute rules — the model behind the RIBiTWO-style "Attributregeln"
 * assistant (RIB BIM Qualifier §6.8.1).
 *
 * A rule is a *Bedingung* (which objects) plus an *Aktion* (what to write).
 * Here the Bedingung is always taken from the object filter — RIBiTWO's
 * "Objektfilter übernehmen" / `Alle Objekte | Aus Filter` path — so a rule
 * carries a SNAPSHOT of the filter conditions and of the object ids they
 * matched. That keeps a collected rule stable while you re-filter to build the
 * next one, and it means the condition is evaluated exactly once, by the
 * filter, instead of being re-implemented here.
 *
 * `planWrites` turns rules into a flat list of property writes without
 * touching the store, so the assistant can show "N Objekte / M Schreibvorgänge"
 * before anything is mutated and the whole mapping stays unit-testable.
 * The caller performs the writes through `mutationSlice`.
 */

/** How an action treats an attribute that already has a value.
 *  Mirrors RIBiTWO's `mode="Add"` / `mode="Overwrite"`. */
export type WriteMode = 'add' | 'overwrite';

/** One (property set, property) address. */
export interface PropRef {
  psetName: string;
  propName: string;
}

/** A condition line as shown in the assistant — the filter's attribute and the
 *  value expression the user entered for it (wildcards/`&`/`||` included). */
export interface RuleConditionSnapshot {
  label: string;
  value: string;
}

/** The five attribute actions of the assistant (§6.8.1.2). "Bauteiltyp
 *  festlegen" is RIB-internal (cpiComponentType) and deliberately omitted. */
export type RuleAction =
  | { kind: 'add'; target: PropRef; value: string; mode: WriteMode }
  | { kind: 'compose'; target: PropRef; template: string; mode: WriteMode }
  | { kind: 'copy'; source: PropRef; target: PropRef; mode: WriteMode }
  | { kind: 'rename'; source: PropRef; propName: string }
  | { kind: 'delete'; targets: PropRef[] };

export interface AttributeRule {
  id: string;
  /** What the filter said when this rule was collected (display only). */
  conditions: RuleConditionSnapshot[];
  /** The objects the filter matched at that moment. */
  entityIds: number[];
  action: RuleAction;
}

/** One resolved property write. `value` is set for `op: 'set'`. */
export interface RuleWrite {
  entityId: number;
  op: 'set' | 'delete';
  psetName: string;
  propName: string;
  value?: string;
}

/** Reads the current value of one (pset, prop) for an entity, or null. */
export type PropReader = (entityId: number, psetName: string, propName: string) => string | null;

const TEMPLATE_TOKEN = /@Attr\{([^}]*)\}/g;

/**
 * Resolve a RIBiTWO attribute-value template: `@Attr{ProjectID}@Attr{LevelNo}`
 * with ProjectID=007, LevelNo=1, TradeNo=5 yields "0071" (…@Attr{TradeNo} →
 * "00715"). A token whose attribute is absent resolves to an empty string, so
 * a partially-filled object still produces the rest of the value rather than
 * failing the whole write. Text outside the tokens is kept verbatim.
 */
export function resolveTemplate(template: string, lookup: (name: string) => string | null): string {
  return template.replace(TEMPLATE_TOKEN, (_m, name: string) => lookup(name.trim()) ?? '');
}

/** The attribute names a template references — used to preview a template and
 *  to warn about tokens that name nothing in the model. */
export function templateTokens(template: string): string[] {
  return [...template.matchAll(TEMPLATE_TOKEN)].map((m) => m[1].trim()).filter(Boolean);
}

/** `add` mode only writes where there is no value yet; `overwrite` always writes. */
function allowedByMode(mode: WriteMode, current: string | null): boolean {
  return mode === 'overwrite' || current === null || current === '';
}

/**
 * Turn the collected rules into the concrete writes they imply, in rule order.
 * Nothing is mutated — the caller applies the result.
 *
 * `read` resolves a value for one (pset, prop); `readByName` resolves a
 * property by NAME across whatever set carries it, which is what the
 * `@Attr{…}` templates address (they name an attribute, not a set).
 */
export function planWrites(
  rules: readonly AttributeRule[],
  read: PropReader,
  readByName: (entityId: number, propName: string) => string | null,
): RuleWrite[] {
  const writes: RuleWrite[] = [];

  for (const rule of rules) {
    const a = rule.action;
    for (const entityId of rule.entityIds) {
      switch (a.kind) {
        case 'add': {
          if (!allowedByMode(a.mode, read(entityId, a.target.psetName, a.target.propName))) break;
          writes.push({ entityId, op: 'set', ...a.target, value: a.value });
          break;
        }
        case 'compose': {
          if (!allowedByMode(a.mode, read(entityId, a.target.psetName, a.target.propName))) break;
          const value = resolveTemplate(a.template, (name) => readByName(entityId, name));
          // An all-empty result means none of the referenced attributes exist
          // on this object — writing "" would just add noise.
          if (value === '') break;
          writes.push({ entityId, op: 'set', ...a.target, value });
          break;
        }
        case 'copy': {
          const value = read(entityId, a.source.psetName, a.source.propName);
          if (value === null || value === '') break;
          if (!allowedByMode(a.mode, read(entityId, a.target.psetName, a.target.propName))) break;
          writes.push({ entityId, op: 'set', ...a.target, value });
          break;
        }
        case 'rename': {
          const value = read(entityId, a.source.psetName, a.source.propName);
          if (value === null) break;
          // Rename inside the same set: write the new name, drop the old one.
          writes.push({ entityId, op: 'set', psetName: a.source.psetName, propName: a.propName, value });
          writes.push({ entityId, op: 'delete', psetName: a.source.psetName, propName: a.source.propName });
          break;
        }
        case 'delete': {
          for (const t of a.targets) {
            if (read(entityId, t.psetName, t.propName) === null) continue;
            writes.push({ entityId, op: 'delete', ...t });
          }
          break;
        }
      }
    }
  }

  return writes;
}

/** One-line description of an action for the collected-rules table. */
export function describeAction(a: RuleAction): string {
  const at = (r: PropRef) => `${r.psetName}.${r.propName}`;
  switch (a.kind) {
    case 'add':     return `${at(a.target)} = "${a.value}"`;
    case 'compose': return `${at(a.target)} = ${a.template}`;
    case 'copy':    return `${at(a.target)} ← ${at(a.source)}`;
    case 'rename':  return `${at(a.source)} → ${a.propName}`;
    case 'delete':  return a.targets.map(at).join(', ');
  }
}

/** Short label per action kind, shared by the tabs and the rules table. */
export const ACTION_LABELS: Record<RuleAction['kind'], string> = {
  add: 'Add attribute',
  compose: 'Add from values',
  copy: 'Copy attribute',
  rename: 'Rename attribute',
  delete: 'Delete attribute',
};
