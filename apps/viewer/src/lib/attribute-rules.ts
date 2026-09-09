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
import { compileValueMatch } from './value-query.js';
import { COMPONENT_TYPE_ATTRIBUTE } from './quantities/component-types.js';

/**
 * The property set a new attribute goes into unless the user says otherwise.
 * `5D` is what this project's own mapping XML writes into — every attribute
 * it produces is a `5D_*` one — so anything else would be a default nobody
 * wants.
 */
export const DEFAULT_TARGET_PSET = '5D';

/** The attribute "Bauteiltyp festlegen" writes. The Mengenabfrage's
 *  `Bauteiltyp` condition reads exactly this name, so the two must not drift:
 *  it is defined once, next to the reader. */
export const COMPONENT_TYPE_PROPERTY = COMPONENT_TYPE_ATTRIBUTE;

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
  overwrite: 'Overwrite — always',
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

/**
 * The assistant's actions, matching RIB's five tabs: Bauteiltyp festlegen,
 * Attribut hinzufügen, kopieren, umbenennen, entfernen.
 *
 * `compose` has no counterpart in RIB and is no longer offered when building a
 * rule. It stays in the union — and keeps being evaluated — because rules
 * stored before it was retired must go on working; dropping the case would
 * turn a saved project into silent no-ops.
 */
export type RuleAction =
  | { kind: 'add'; target: PropRef; value: string; dataType: DataType; unit: string; mode: WriteMode }
  | { kind: 'compose'; target: PropRef; template: string; dataType: DataType; unit: string; mode: WriteMode }
  | { kind: 'copy'; source: PropRef; target: PropRef; mode: WriteMode }
  | { kind: 'rename'; source: PropRef; propName: string }
  | { kind: 'delete'; targets: PropRef[] }
  /** RIB's "Bauteiltyp festlegen": writes `cpiComponentType`, which decides
   *  what a Mengenabfrage's `Bauteiltyp=='…'` condition sees. */
  | { kind: 'componentType'; value: string; mode: WriteMode };

/**
 * A condition the rule evaluates ITSELF, at apply time — how an imported
 * RIBiTWO `<map><in …></map>` works. Unlike the filter snapshot, this can name
 * an attribute that an earlier rule creates, which is what the mapping files
 * are built on: `5D_Typ` is written by one rule and matched by 56 later ones.
 */
export interface RuleMatch {
  /** `Pset\Property`, a bare property name resolved across sets, or an ifc*
   *  parameter the caller's reader understands. */
  attribute: string;
  /** A value query (`*`, `&`, `||`) or `<Not Existing>` for "must be absent". */
  value: string;
}

/** RIBiTWO's marker for "this attribute must not be present". The object
 *  filter writes the same intent as `<Not set>`, so both are accepted. */
export const NOT_EXISTING = '<Not Existing>';
const ABSENT_MARKERS = new Set(['<not existing>', '<not set>']);
export const meansAbsent = (value: string) => ABSENT_MARKERS.has(value.trim().toLowerCase());

/** A one-line reading of a rule's conditions, mirroring RIBiTWO's
 *  "Enthält ein Objekt folgende Attribute: …" hint under the condition pane. */
export function describeConditions(match: readonly RuleMatch[]): string {
  if (match.length === 0) return 'Every object in scope.';
  return match.map((c) => `${c.attribute} = ${c.value}`).join('  and  ');
}

export interface AttributeRule {
  id: string;
  /** What the filter said when this rule was collected (display only). */
  conditions: RuleConditionSnapshot[];
  /**
   * Conditions the rule resolves on its own. When present, the rule matches
   * objects by evaluating these instead of relying on `entityIds`, so it keeps
   * working after a reload and can react to what earlier rules wrote.
   */
  match?: RuleMatch[];
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
  /** The rule that produced it — so a single chained plan can still report
   *  per-rule counts. Planning rules one at a time to count them would break
   *  the chain, since a rule must see what the earlier ones wrote. */
  ruleId: string;
  entityId: number;
  op: 'set' | 'delete';
  psetName: string;
  propName: string;
  value?: string | number | boolean;
  valueType?: PropertyValueType;
}

/**
 * Per-rule counters, filled only when `planWrites` is handed a map.
 *
 * `matched` is how many objects the rule's CONDITION selected, `wrote` how
 * many writes its ACTION then produced. The gap between the two is where a
 * rule that "does nothing" actually stops: no match at all means the condition
 * is wrong, matched-but-nothing-written means the source was empty or the
 * write mode stepped aside.
 */
export interface RulePlanStat {
  matched: number;
  wrote: number;
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
    case 'add': return !isSet;
    // RIBiTWO's "Überschreiben" CREATES the attribute — it does not require an
    // existing value. Read the other way round ("only where already set"), an
    // attribute that no `Add` ever writes could never come into being, and the
    // Heizung mapping has exactly such a case: `5D_Systemklassifizierung` is
    // written by two Overwrite outputs and nothing else, yet iTWO shows it
    // filled on the same model with the same rules, while we showed nothing.
    // That makes `overwrite` and `addOverwrite` behave alike; the redundancy
    // is RIBiTWO's, whose exporter writes "always" as an Add/Overwrite PAIR —
    // two checkboxes, not three choices.
    case 'overwrite':
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
/**
 * Names a RIBiTWO mapping file uses for things this viewer calls something
 * else, lower-cased on the left.
 *
 * `cpiID` is the id RIB's CPI import gives every object, and for an IFC import
 * that is the GlobalId — the same value our `ifcGuid` answers. Nothing here
 * knew the name, so a rule keyed on it matched no object at all. Mapping files
 * mostly write `cpiID="*"` ("every object"), which the importer already drops,
 * so this is about the rules that name a concrete id.
 */
const MAPPING_ALIASES: Record<string, string> = {
  cpiid: 'ifcGuid',
};

/** Attributes whose value is an IFC class name, and which therefore have the
 *  two spellings `IfcPipeFitting` (ours) and `PIPEFITTING` (RIBiTWO's). */
function isIfcClassCondition(attribute: string): boolean {
  const a = attribute.toLowerCase();
  return a === 'ifctype' || a === 'ifcclass';
}

export function planWrites(
  rules: readonly AttributeRule[],
  baseRead: PropReader,
  baseReadByName: (entityId: number, propName: string) => string | null,
  /** Candidate objects for rules that resolve their own `match` conditions. */
  universe: readonly number[] = [],
  /**
   * What the FILE said, before any rule ever ran — used ONLY to decide the
   * write mode. Without it, `add` ("only where empty") reads the model as it
   * stands, which after a first apply contains the rule's OWN output, so
   * editing an applied rule plans nothing at all and Apply goes dead.
   *
   * `add` is meant to protect data that came with the model, not to freeze a
   * rule after its first run. Judging it against the file makes a re-apply
   * depend on the current rule set alone rather than on apply history.
   *
   * Chaining is unaffected: within one pass the `live` layer still wins, so a
   * rule that writes `5D_Typ` is still seen by the dozens of rules after it,
   * and a later `add` still steps aside for an earlier rule's value.
   *
   * Defaults to `baseRead`, which is the previous behaviour.
   */
  fileRead?: PropReader,
  /** Filled per rule id when given — see {@link RulePlanStat}. */
  stats?: Map<string, RulePlanStat>,
): RuleWrite[] {
  const writes: RuleWrite[] = [];

  // Values written so far in THIS plan, so a rule sees what earlier rules
  // produced — the mapping files depend on it (`5D_Typ` is created by one rule
  // and matched by dozens after it). Keyed by address and, separately, by bare
  // name, since conditions address attributes both ways.
  //
  // Nested by entity rather than keyed on a `${id}|${prop}` string: a full
  // apply asks 33 million times, and building and hashing that many keys cost
  // more than the lookups they serve.
  const live = new Map<number, Map<string, string | null>>();
  const liveByName = new Map<number, Map<string, string | null>>();
  const addrKey = (pset: string, prop: string) => `${pset}\u0000${prop}`;
  const putLive = (id: number, key: string, value: string | null, into: typeof live) => {
    let m = into.get(id);
    if (!m) { m = new Map(); into.set(id, m); }
    m.set(key, value);
  };

  const read: PropReader = (id, pset, prop) => {
    const m = live.get(id);
    if (m !== undefined) {
      const k = addrKey(pset, prop);
      if (m.has(k)) return m.get(k)!;
    }
    return baseRead(id, pset, prop);
  };
  const readByName = (id: number, prop: string) => {
    const m = liveByName.get(id);
    if (m !== undefined && m.has(prop)) return m.get(prop)!;
    const direct = baseReadByName(id, prop);
    if (direct !== null) return direct;
    // The model itself wins; only when it has nothing under RIBiTWO's own name
    // do we answer with what that name means here.
    const alias = MAPPING_ALIASES[prop.toLowerCase()];
    return alias ? baseReadByName(id, alias) : null;
  };
  /** The value the write MODE is judged against — see `fileRead`. */
  const readForMode: PropReader = (id, pset, prop) => {
    const m = live.get(id);
    if (m !== undefined) {
      const k = addrKey(pset, prop);
      if (m.has(k)) return m.get(k)!;
    }
    return (fileRead ?? baseRead)(id, pset, prop);
  };
  let currentRuleId = '';
  let currentStat: RulePlanStat | null = null;
  const record = (w: Omit<RuleWrite, 'ruleId'>) => {
    // Only plan what actually CHANGES. Re-applying a rule set whose result is
    // already in the model must be a no-op, not 23k identical writes: each one
    // would cost a store update and an undo entry for nothing.
    const current = read(w.entityId, w.psetName, w.propName);
    if (w.op === 'set' && current === String(w.value ?? '')) return;
    if (w.op === 'delete' && current === null) return;
    const v = w.op === 'delete' ? null : String(w.value ?? '');
    putLive(w.entityId, addrKey(w.psetName, w.propName), v, live);
    putLive(w.entityId, w.propName, v, liveByName);
    writes.push({ ...w, ruleId: currentRuleId });
    if (currentStat) currentStat.wrote += 1;
  };

  /**
   * A condition with everything that depends only on the RULE worked out:
   * the split address, whether it asks for absence, the compiled matcher, and
   * whether it names an IFC class.
   *
   * All of that used to be redone for every object. `compileValueMatch` builds
   * regexes for a `*` or `||` value, and a mapping file is mostly those — with
   * 417 conditions over 79,493 objects that is 27 million compilations for 417
   * distinct answers.
   */
  interface Compiled {
    /** null for a bare name, which is looked up across sets. */
    psetName: string | null;
    propName: string;
    absent: boolean;
    test: (value: string) => boolean;
    ifcClass: boolean;
  }

  const compileConditions = (rule: AttributeRule): Compiled[] | null => {
    if (!rule.match || rule.match.length === 0) return null;
    return rule.match.map((c) => {
      const sep = c.attribute.indexOf('\\');
      return {
        psetName: sep >= 0 ? c.attribute.slice(0, sep) : null,
        propName: sep >= 0 ? c.attribute.slice(sep + 1) : c.attribute,
        absent: meansAbsent(c.value),
        test: compileValueMatch(c.value),
        ifcClass: isIfcClassCondition(c.attribute),
      };
    });
  };

  const matches = (conds: Compiled[] | null, id: number): boolean => {
    if (conds === null) return true;
    return conds.every((c) => {
      const value = c.psetName === null
        ? readByName(id, c.propName)
        : read(id, c.psetName, c.propName);
      if (c.absent) return value === null || value === '';
      if (value === null) return false;
      const test = c.test;
      if (test(value)) return true;
      // RIBiTWO names the IFC class WITHOUT the `Ifc` prefix — its mapping
      // files say `ifcType="PIPEFITTING"` where we answer `IfcPipeFitting`.
      // The comparison ignores case but not that prefix, and a condition
      // without wildcards is exact, so every such rule silently matched
      // nothing: 16 of 16 in the Heizung mapping, among them the 11,294
      // IfcPipeFitting that should become `5D_Kategorie = Rohrformteile`.
      // Both spellings are accepted, so a rule collected from the object
      // filter (which stores `IfcCovering`) keeps working too.
      return c.ifcClass && /^ifc/i.test(value) && test(value.slice(3));
    });
  };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    currentRuleId = rule.id;
    currentStat = null;
    if (stats) {
      currentStat = { matched: 0, wrote: 0 };
      stats.set(rule.id, currentStat);
    }
    const a = rule.action;
    const conds = compileConditions(rule);
    // A rule that carries its own conditions resolves them against the whole
    // model (or a narrower snapshot when it also has one). The discriminator is
    // whether `match` EXISTS, not whether it has entries: a rule collected
    // from the object filter with no condition at all still means "every
    // object in scope".
    const candidates = rule.match !== undefined
      ? (rule.entityIds.length > 0 ? rule.entityIds : universe)
      : rule.entityIds;
    for (const entityId of candidates) {
      if (!matches(conds, entityId)) continue;
      if (currentStat) currentStat.matched += 1;
      switch (a.kind) {
        case 'add': {
          if (!allowedByMode(a.mode, readForMode(entityId, a.target.psetName, a.target.propName))) break;
          const value = coerceValue(a.value, a.dataType);
          if (value === null) break;
          record({ entityId, op: 'set', ...a.target, value, valueType: propertyValueTypeOf(a.dataType) });
          break;
        }
        case 'compose': {
          if (!allowedByMode(a.mode, readForMode(entityId, a.target.psetName, a.target.propName))) break;
          const resolved = resolveTemplate(a.template, (name) => readByName(entityId, name));
          // An all-empty result means none of the referenced attributes exist
          // on this object — writing "" would just add noise.
          const value = coerceValue(resolved, a.dataType);
          if (value === null) break;
          record({ entityId, op: 'set', ...a.target, value, valueType: propertyValueTypeOf(a.dataType) });
          break;
        }
        case 'componentType': {
          // The component type is one attribute with a fixed name, written
          // into the same set as everything else so there is one place to
          // look. The Mengenabfrage reads it by bare name, so the set does
          // not matter to it — only that the name is exactly this one.
          const target = { psetName: DEFAULT_TARGET_PSET, propName: COMPONENT_TYPE_PROPERTY };
          if (!allowedByMode(a.mode, readForMode(entityId, target.psetName, target.propName))) break;
          if (!a.value) break;
          record({ entityId, op: 'set', ...target, value: a.value, valueType: PropertyValueType.Label });
          break;
        }
        case 'copy': {
          // An imported mapping addresses its source by bare name ("take
          // ifcTypeObjectName"), so an empty set means "whichever set has it".
          const value = a.source.psetName === ''
            ? readByName(entityId, a.source.propName)
            : read(entityId, a.source.psetName, a.source.propName);
          if (value === null || value === '') break;
          if (!allowedByMode(a.mode, readForMode(entityId, a.target.psetName, a.target.propName))) break;
          record({ entityId, op: 'set', ...a.target, value, valueType: PropertyValueType.Label });
          break;
        }
        case 'rename': {
          const value = read(entityId, a.source.psetName, a.source.propName);
          if (value === null) break;
          // Rename inside the same set: write the new name, drop the old one.
          record({ entityId, op: 'set', psetName: a.source.psetName, propName: a.propName, value, valueType: PropertyValueType.Label });
          record({ entityId, op: 'delete', psetName: a.source.psetName, propName: a.source.propName });
          break;
        }
        case 'delete': {
          for (const t of a.targets) {
            if (read(entityId, t.psetName, t.propName) === null) continue;
            record({ entityId, op: 'delete', ...t });
          }
          break;
        }
      }
    }
  }

  return writes;
}

/** One (entity, pset, property) address a rule writes to. */
export interface RuleTarget {
  entityId: number;
  psetName: string;
  propName: string;
}

/** Stable key for a target, for set arithmetic between applies. */
export const targetKey = (t: RuleTarget) => `${t.entityId}|${t.psetName}|${t.propName}`;
/** Stable key for an address, independent of which objects carry it. */
export const refKeyOf = (r: PropRef) => `${r.psetName}|${r.propName}`;

/**
 * The attribute ADDRESSES a rule writes to — not the objects.
 *
 * Rolling back used to enumerate `rule.entityIds`, which is empty for every
 * rule that resolves its own objects (an imported mapping, or anything scoped
 * to "all objects"). Those rules therefore rolled back nothing at all, and the
 * attributes they created outlived their own deletion. Addresses are stable
 * either way; which objects actually carry one is answered by the session's
 * mutation record at rollback time.
 *
 * `rename` reports both the name it creates and the one it removes, and
 * `delete` reports what it removed — restoring those puts the original back.
 */
export function ruleTargetRefs(rule: AttributeRule): PropRef[] {
  const a = rule.action;
  if (a.kind === 'componentType') return [{ psetName: DEFAULT_TARGET_PSET, propName: COMPONENT_TYPE_PROPERTY }];
  return a.kind === 'add' || a.kind === 'compose' || a.kind === 'copy' ? [a.target]
    : a.kind === 'rename' ? [{ psetName: a.source.psetName, propName: a.propName }, a.source]
    : a.targets;
}

/**
 * Addresses the previous apply wrote that no enabled rule writes any more.
 * The caller restores every object that carries one to its base state.
 */
export function staleTargetRefs(
  previous: readonly AttributeRule[],
  current: readonly AttributeRule[],
): PropRef[] {
  const wanted = new Set<string>();
  for (const r of current) {
    if (!r.enabled) continue;
    for (const ref of ruleTargetRefs(r)) wanted.add(refKeyOf(ref));
  }
  const seen = new Set<string>();
  const out: PropRef[] = [];
  for (const r of previous) {
    for (const ref of ruleTargetRefs(r)) {
      const k = refKeyOf(ref);
      if (wanted.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(ref);
    }
  }
  return out;
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
    case 'componentType': return `Bauteiltyp = "${a.value}"`;
  }
}

/** Short label per action kind, shared by the tabs and the rules table. */
export const ACTION_LABELS: Record<RuleAction['kind'], string> = {
  add: 'Add attribute',
  compose: 'Add from values',
  copy: 'Copy attribute',
  rename: 'Rename attribute',
  delete: 'Delete attribute',
  componentType: 'Bauteiltyp festlegen',
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
  /** Index of the condition this row shows, for `in` rows. */
  matchIndex?: number;
  /** Index of the delete target this row shows, for a delete action's rows. */
  targetIndex?: number;
  /** Which of this row's cells can be edited in place. */
  editable?: RuleEditField[];
}

/** A cell of the rules table that maps back onto a rule field. */
export type RuleEditField = 'attribute' | 'name' | 'type' | 'value' | 'unit' | 'mode';

/** `Pset\Prop`, or the bare name when no set is fixed — the same notation the
 *  mapping files use, so an edited cell parses straight back. */
export function formatRef(r: PropRef): string {
  return r.psetName ? `${r.psetName}\\${r.propName}` : r.propName;
}

/** Inverse of {@link formatRef}. */
export function parseRef(text: string): PropRef {
  const i = text.indexOf('\\');
  return i >= 0
    ? { psetName: text.slice(0, i).trim(), propName: text.slice(i + 1).trim() }
    : { psetName: '', propName: text.trim() };
}

const DATA_TYPE_BY_LABEL = new Map(
  (Object.keys(DATA_TYPE_LABELS) as DataType[]).map((d) => [DATA_TYPE_LABELS[d].toLowerCase(), d]),
);
const MODE_BY_SHORT = new Map<string, WriteMode>();

/**
 * Apply one in-place table edit and return the updated rule. Pure, so the
 * mapping from "which cell" to "which field" is testable without a DOM.
 * An edit that does not apply to the row's action is returned unchanged.
 */
export function applyRuleEdit(rule: AttributeRule, row: RuleTableRow, field: RuleEditField, text: string): AttributeRule {
  const t = text.trim();

  if (row.kind === 'in') {
    const i = row.matchIndex ?? -1;
    if (!rule.match || i < 0 || i >= rule.match.length) return rule;
    const match = rule.match.map((c, k) => (k === i ? { ...c, [field === 'attribute' ? 'attribute' : 'value']: t } : c));
    return { ...rule, match, conditions: match.map((c) => ({ label: c.attribute, value: c.value })) };
  }

  const a = rule.action;
  switch (a.kind) {
    case 'add':
    case 'compose': {
      switch (field) {
        case 'attribute': return { ...rule, action: { ...a, target: { ...a.target, psetName: t } } };
        case 'name':      return { ...rule, action: { ...a, target: { ...a.target, propName: t } } };
        case 'unit':      return { ...rule, action: { ...a, unit: t } };
        case 'type': {
          const dt = DATA_TYPE_BY_LABEL.get(t.toLowerCase());
          return dt ? { ...rule, action: { ...a, dataType: dt } } : rule;
        }
        case 'mode': {
          const m = MODE_BY_SHORT.get(t);
          return m ? { ...rule, action: { ...a, mode: m } } : rule;
        }
        case 'value':
          return a.kind === 'add'
            ? { ...rule, action: { ...a, value: text } }
            : { ...rule, action: { ...a, template: text } };
      }
      return rule;
    }
    case 'copy': {
      switch (field) {
        case 'attribute': return { ...rule, action: { ...a, source: parseRef(t) } };
        case 'name':      return { ...rule, action: { ...a, target: parseRef(t) } };
        case 'mode': {
          const m = MODE_BY_SHORT.get(t);
          return m ? { ...rule, action: { ...a, mode: m } } : rule;
        }
      }
      return rule;
    }
    case 'rename': {
      if (field === 'attribute') return { ...rule, action: { ...a, source: parseRef(t) } };
      if (field === 'name') return { ...rule, action: { ...a, propName: t } };
      return rule;
    }
    case 'delete': {
      const i = row.targetIndex ?? -1;
      if (field !== 'attribute' || i < 0 || i >= a.targets.length) return rule;
      return { ...rule, action: { ...a, targets: a.targets.map((x, k) => (k === i ? parseRef(t) : x)) } };
    }
    case 'componentType': {
      // Address and data type are fixed; only what is written and how.
      if (field === 'value') return { ...rule, action: { ...a, value: t } };
      if (field === 'mode') {
        const mode = MODE_BY_SHORT.get(t);
        return mode ? { ...rule, action: { ...a, mode } } : rule;
      }
      return rule;
    }
  }
}

export const MODE_SHORT: Record<WriteMode, string> = {
  add: 'Add',
  addOverwrite: 'Add + overwrite',
  overwrite: 'Overwrite',
};
for (const [m, label] of Object.entries(MODE_SHORT)) MODE_BY_SHORT.set(label, m as WriteMode);

/** Flatten rules into the grid rows described above. */
export function ruleTableRows(rules: readonly AttributeRule[]): RuleTableRow[] {
  const rows: RuleTableRow[] = [];
  rules.forEach((rule, i) => {
    rows.push({ ruleId: rule.id, kind: 'group', number: i + 1, source: 'Model', enabled: rule.enabled });
    // Only a rule that owns evaluable conditions can have them edited; a
    // filter-built rule's condition is a read-only snapshot of the filter.
    const editableIn: RuleEditField[] = rule.match ? ['attribute', 'value'] : [];
    rule.conditions.forEach((c, mi) => {
      rows.push({ ruleId: rule.id, kind: 'in', direction: 'Ein', attribute: c.label, value: c.value, matchIndex: mi, editable: editableIn });
    });
    const a = rule.action;
    const out = (r: Partial<RuleTableRow>) => rows.push({ ruleId: rule.id, kind: 'out', direction: 'Aus', ...r });
    switch (a.kind) {
      case 'add':
        out({ attribute: a.target.psetName, name: a.target.propName, type: DATA_TYPE_LABELS[a.dataType], value: a.value, unit: a.unit, mode: MODE_SHORT[a.mode],
          editable: ['attribute', 'name', 'type', 'value', 'unit', 'mode'] });
        break;
      case 'compose':
        out({ attribute: a.target.psetName, name: a.target.propName, type: DATA_TYPE_LABELS[a.dataType], value: a.template, unit: a.unit, mode: MODE_SHORT[a.mode],
          editable: ['attribute', 'name', 'type', 'value', 'unit', 'mode'] });
        break;
      case 'copy':
        out({ attribute: formatRef(a.source), name: formatRef(a.target), mode: MODE_SHORT[a.mode],
          editable: ['attribute', 'name', 'mode'] });
        break;
      case 'rename':
        out({ attribute: formatRef(a.source), name: a.propName, mode: 'Rename', editable: ['attribute', 'name'] });
        break;
      case 'delete':
        a.targets.forEach((t, ti) => out({ attribute: formatRef(t), mode: 'Delete', targetIndex: ti, editable: ['attribute'] }));
        break;
      case 'componentType':
        // The address is fixed, so only the value and the mode are editable —
        // showing them as text keeps the grid readable next to the others.
        out({ attribute: DEFAULT_TARGET_PSET, name: COMPONENT_TYPE_PROPERTY, type: DATA_TYPE_LABELS.text,
          value: a.value, mode: MODE_SHORT[a.mode], editable: ['value', 'mode'] });
        break;
    }
  });
  return rows;
}
