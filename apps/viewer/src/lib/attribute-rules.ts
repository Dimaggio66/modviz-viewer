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
 * touching the store, so the assistant can preview "N Regeln / M Schreibvorgänge"
 * before anything is mutated and the whole mapping stays unit-testable.
 * The caller performs the writes through `mutationSlice`.
 */

import { PropertyValueType } from '@ifc-lite/data';

/**
 * How an action treats an attribute that already has a value — RIBiTWO's
 * *Aktion* list on the "Attribut hinzufügen" tab:
 *   `add`         — Hinzufügen: only where the attribute is absent
 *   `overwrite`   — Überschreiben: only where it already has a value
 *   `addOverwrite`— Hinzufügen und überschreiben: always
 */
export type WriteMode = 'add' | 'overwrite' | 'addOverwrite';

export const WRITE_MODE_LABELS: Record<WriteMode, string> = {
  add: 'Add — only where empty',
  addOverwrite: 'Add and overwrite — always',
  overwrite: 'Overwrite — only where set',
};

/** RIBiTWO's *Datentyp* list, mapped onto the store's PropertyValueType. */
export type DataType = 'text' | 'integer' | 'decimal' | 'date' | 'boolean';

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  text: 'Text',
  integer: 'Integer',
  decimal: 'Decimal',
  date: 'Date',
  boolean: 'True/False',
};

/** IFC has no dedicated date property type, so a date is stored as a label
 *  (ISO text) — the same compromise RIBiTWO's "Datum" makes. */
export function propertyValueTypeOf(dataType: DataType): PropertyValueType {
  switch (dataType) {
    case 'integer': return PropertyValueType.Integer;
    case 'decimal': return PropertyValueType.Real;
    case 'boolean': return PropertyValueType.Boolean;
    case 'text':
    case 'date':    return PropertyValueType.Label;
  }
}

/** Coerce the typed-in value to what the chosen data type expects. Returns
 *  null when the text cannot be represented, so the write is skipped rather
 *  than storing "abc" as a number. */
export function coerceValue(value: string, dataType: DataType): string | number | boolean | null {
  const t = value.trim();
  if (t === '') return null;
  switch (dataType) {
    case 'integer': {
      const n = Number(t.replace(',', '.'));
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'decimal': {
      const n = Number(t.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': {
      const s = t.toLowerCase();
      if (['true', 'wahr', 'ja', 'yes', '1'].includes(s)) return true;
      if (['false', 'falsch', 'nein', 'no', '0'].includes(s)) return false;
      return null;
    }
    case 'text':
    case 'date':
      return t;
  }
}

/** RIBiTWO's *Einheit* list. '' is its "-" (no unit). */
export const UNITS: readonly string[] = [
  '', 'mm', 'cm', 'm', 'km', 'inch', 'foot', 'yard', 'mile',
  'mm2', 'cm2', 'm2', 'km2', 'inch2', 'foot2', 'yard2', 'mile2',
  'mm3', 'cm3', 'm3', 'km3', 'inch3', 'foot3', 'yard3',
  'kg', 't', 'lb', 's', 'min', 'h', 'd', '%', 'Stk',
];

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
  | { kind: 'add'; target: PropRef; value: string; dataType: DataType; unit: string; mode: WriteMode }
  | { kind: 'compose'; target: PropRef; template: string; dataType: DataType; unit: string; mode: WriteMode }
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
  /** Rules can be switched off in the table without being deleted. */
  enabled: boolean;
  /** Wall-clock ms of the last apply, and how many writes it made. Set once a
   *  rule has actually run, so a saved rule shows what it already did. */
  appliedAt?: number;
  appliedWrites?: number;
}

/** One resolved property write. `value` is set for `op: 'set'`. */
export interface RuleWrite {
  entityId: number;
  op: 'set' | 'delete';
  psetName: string;
  propName: string;
  value?: string | number | boolean;
  valueType?: PropertyValueType;
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

/** Whether a write may proceed given the mode and the value already there. */
function allowedByMode(mode: WriteMode, current: string | null): boolean {
  const isSet = current !== null && current !== '';
  switch (mode) {
    case 'add':          return !isSet;
    case 'overwrite':    return isSet;
    case 'addOverwrite': return true;
  }
}

/**
 * Turn the collected rules into the concrete writes they imply, in rule order.
 * Nothing is mutated — the caller applies the result. Disabled rules are skipped.
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
    if (!rule.enabled) continue;
    const a = rule.action;
    for (const entityId of rule.entityIds) {
      switch (a.kind) {
        case 'add': {
          if (!allowedByMode(a.mode, read(entityId, a.target.psetName, a.target.propName))) break;
          const value = coerceValue(a.value, a.dataType);
          if (value === null) break;
          writes.push({ entityId, op: 'set', ...a.target, value, valueType: propertyValueTypeOf(a.dataType) });
          break;
        }
        case 'compose': {
          if (!allowedByMode(a.mode, read(entityId, a.target.psetName, a.target.propName))) break;
          const resolved = resolveTemplate(a.template, (name) => readByName(entityId, name));
          // An all-empty result means none of the referenced attributes exist
          // on this object — writing "" would just add noise.
          const value = coerceValue(resolved, a.dataType);
          if (value === null) break;
          writes.push({ entityId, op: 'set', ...a.target, value, valueType: propertyValueTypeOf(a.dataType) });
          break;
        }
        case 'copy': {
          const value = read(entityId, a.source.psetName, a.source.propName);
          if (value === null || value === '') break;
          if (!allowedByMode(a.mode, read(entityId, a.target.psetName, a.target.propName))) break;
          writes.push({ entityId, op: 'set', ...a.target, value, valueType: PropertyValueType.Label });
          break;
        }
        case 'rename': {
          const value = read(entityId, a.source.psetName, a.source.propName);
          if (value === null) break;
          // Rename inside the same set: write the new name, drop the old one.
          writes.push({ entityId, op: 'set', psetName: a.source.psetName, propName: a.propName, value, valueType: PropertyValueType.Label });
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

/** One-line description of an action, for compact summaries. */
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

// ── Rules table (RIBiTWO's "Attributregeln" grid) ────────────────────────────

/**
 * A row of the rules table. RIBiTWO lists each rule as a numbered group with
 * its condition rows (*Ein*) and its output rows (*Aus*) beneath — the shape
 * its XML `<map>/<in>/<out>` serialisation has.
 */
export interface RuleTableRow {
  ruleId: string;
  /** Group header carries the number; `in`/`out` rows sit under it. */
  kind: 'group' | 'in' | 'out';
  number?: number;
  source?: string;
  direction?: 'Ein' | 'Aus';
  /** Attribut/Abfrage — the condition's attribute, or the action's input. */
  attribute?: string;
  /** Target attribute name of an output row. */
  name?: string;
  type?: string;
  value?: string;
  unit?: string;
  mode?: string;
  enabled?: boolean;
}

const MODE_SHORT: Record<WriteMode, string> = {
  add: 'Add',
  addOverwrite: 'Add + overwrite',
  overwrite: 'Overwrite',
};

/** Flatten rules into the grid rows described above. */
export function ruleTableRows(rules: readonly AttributeRule[]): RuleTableRow[] {
  const rows: RuleTableRow[] = [];
  rules.forEach((rule, i) => {
    rows.push({ ruleId: rule.id, kind: 'group', number: i + 1, source: 'Model', enabled: rule.enabled });
    for (const c of rule.conditions) {
      rows.push({ ruleId: rule.id, kind: 'in', direction: 'Ein', attribute: c.label, value: c.value });
    }
    const a = rule.action;
    const out = (r: Partial<RuleTableRow>) => rows.push({ ruleId: rule.id, kind: 'out', direction: 'Aus', ...r });
    switch (a.kind) {
      case 'add':
        out({ attribute: a.target.psetName, name: a.target.propName, type: DATA_TYPE_LABELS[a.dataType], value: a.value, unit: a.unit, mode: MODE_SHORT[a.mode] });
        break;
      case 'compose':
        out({ attribute: a.target.psetName, name: a.target.propName, type: DATA_TYPE_LABELS[a.dataType], value: a.template, unit: a.unit, mode: MODE_SHORT[a.mode] });
        break;
      case 'copy':
        out({ attribute: `${a.source.psetName}.${a.source.propName}`, name: `${a.target.psetName}.${a.target.propName}`, mode: MODE_SHORT[a.mode] });
        break;
      case 'rename':
        out({ attribute: `${a.source.psetName}.${a.source.propName}`, name: a.propName, mode: 'Rename' });
        break;
      case 'delete':
        for (const t of a.targets) out({ attribute: `${t.psetName}.${t.propName}`, mode: 'Delete' });
        break;
    }
  });
  return rows;
}
