/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ObjectFilterPanel — RIBiTWO-style "Objektfilter" docked in the left slot
 * (replaces the object tree there, ViewerLayout).
 *
 * A searchable list of every attribute of the active model — the IFC-level
 * parameters (ifc*), every property (occurrence + type-inherited) and every
 * quantity — grouped into sticky sections (IFC-Parameter / Properties /
 * Quantities). EVERY value cell is a typeable `ComboInput`: pick a value or
 * type a query. The value query language (RIBiTWO-style):
 *   `*`  wildcard — `A*` starts-with, `*A` ends-with, `*A*` contains, bare = exact
 *   `&`  AND (the SAME value must satisfy every term)  — "*Wasser* & *150*"
 *   `||` OR  (any term may match; binds looser than &) — "*Beton* || *Mauerwerk*"
 * Active fields surface as removable chips; an "only active" toggle and a
 * per-row clear (✕) keep a long list manageable.
 *
 * Two match paths, intersected (AND) and debounced:
 *  - set dimensions (ifcType / ifcBuildingStoreyName / ifcPredefinedType) and
 *    properties run through the filter engine (`evaluateFilterRulesFederated`);
 *  - the other ifc parameters (ifcName / ifcGuid / ifcObjectType / ifcTag /
 *    ifcID) match client-side via the store's cached column getters — no
 *    per-entity source re-parse (AGENTS.md §Models).
 * The matched objects isolate in 3D via the shared `isolateEntities` channel
 * AND are highlighted (`setSelectedEntityIds`, the renderer's highlight/selection
 * channel) so the hits light up, report a count, and stay actionable.
 *
 * ifcType values render without the "Ifc" prefix (canonical value kept for
 * matching). A few ifc parameters (elevations, overall size, ref lat/long,
 * fillings, layer assignment, long/type-object name) have no cheap accessor
 * yet — their fields are present and typeable but inert until wired (a small
 * per-parameter follow-up). Attribute names render verbatim (German from the
 * model); the UI chrome stays English.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListFilter, Search, Table2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { IfcDataStore } from '@ifc-lite/parser';
import { EntityExtractor, getAttributeNames, getInheritanceChainAcrossSchemas } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import { Input } from '@/components/ui/input';
import { ComboInput } from '@/components/ui/combo-input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import {
  discoverFilterSchema,
  discoverFilterValues,
  discoverPropertyAndQuantitySchema,
  propValueKey,
} from '@/lib/search/filter-schema';
import { Rule, type FilterRule, type NumericOp } from '@/lib/search/filter-rules';
import { evaluateFilterRulesFederated } from '@/lib/search/filter-evaluate';
import { compileQuery, isQueryExpr } from '@/lib/value-query';
import { toGlobalIdFromModels } from '@/store/globalId';
import { AttributeRulesDialog } from './AttributeRulesDialog';
import { projectKeyFor } from '@/lib/attribute-rules-store';
import type { PropRef } from '@/lib/attribute-rules';

/** class name -> is it an IfcObjectDefinition, i.e. a product, a type object
 *  (IfcWallType, IfcDoorType, …), a group/system, or the project — the broad
 *  "object" population RIBiTWO's total counts, not just the geometric products.
 *  Cached per type name (byType has O(100) distinct names). */
const objectDefinitionCache = new Map<string, boolean>();
function isObjectDefinitionClass(typeName: string): boolean {
  const upper = typeName.toUpperCase();
  const cached = objectDefinitionCache.get(upper);
  if (cached !== undefined) return cached;
  const result = getInheritanceChainAcrossSchemas(upper).some((a) => a.toUpperCase() === 'IFCOBJECTDEFINITION');
  objectDefinitionCache.set(upper, result);
  return result;
}

/** ComboInput option for "property is absent" → maps to the isNotSet rule. */
const NONE_LABEL = '<Not set>';
const ISOLATE_DEBOUNCE_MS = 250;

/** Concrete option values a field selects via a query — matched against each
 *  option's raw value OR its display label (rounded numbers, prefix-stripped
 *  ifcType), so both what's stored and what's shown are searchable. */
function resolveOptionValues(options: readonly Option[], test: (v: string) => boolean): string[] {
  return options.filter((o) => test(o.value) || test(o.label)).map((o) => o.value);
}

/** Parse a numeric-quantity entry: an optional comparator (>=, >, <=, <) then
 *  a number (German comma tolerated). Plain input is an exact (eq) match. */
function parseNumeric(input: string): { op: NumericOp; value: number } | null {
  let t = input.trim();
  let op: NumericOp = 'eq';
  if (t.startsWith('>=')) { op = 'gte'; t = t.slice(2); }
  else if (t.startsWith('<=')) { op = 'lte'; t = t.slice(2); }
  else if (t.startsWith('>')) { op = 'gt'; t = t.slice(1); }
  else if (t.startsWith('<')) { op = 'lt'; t = t.slice(1); }
  const value = Number(t.trim().replace(',', '.'));
  return Number.isFinite(value) ? { op, value } : null;
}

/** Accessor for a per-object ifc attribute. Cached-column reads are free; the
 *  source-buffer readers below are gated to the few types that declare the
 *  attribute so the per-entity re-parse stays bounded (AGENTS.md §Models). */
type Accessor = (store: IfcDataStore, id: number) => string;

/** Read a positional entity attribute by its schema name from the STEP source
 *  (e.g. IfcDoor.OverallHeight) — the same getAttributeNames/attributes pattern
 *  the georef extractor uses. Re-parses the entity, so callers must gate by
 *  type. Returns '' when unavailable or the type doesn't declare it. */
function readSourceAttribute(store: IfcDataStore, id: number, attributeName: string): string {
  const src = store.source;
  if (!src || src.length === 0) return '';
  const ref = store.entityIndex?.byId?.get(id);
  if (!ref) return '';
  const entity = new EntityExtractor(src).extractEntity(ref);
  if (!entity) return '';
  const i = getAttributeNames(entity.type).indexOf(attributeName);
  if (i < 0) return '';
  const raw = entity.attributes?.[i];
  if (raw === undefined || raw === null || raw === '') return '';
  return typeof raw === 'number' ? String(Number(raw.toFixed(4))) : String(raw);
}

/** ifc parameters matched client-side via cheap cached getters. */
const ATTRIBUTE_PARAMS: ReadonlyArray<{ label: string; accessor: Accessor }> = [
  { label: 'ifcName', accessor: (s, id) => s.entities.getName(id) ?? '' },
  { label: 'ifcGuid', accessor: (s, id) => s.entities.getGlobalId(id) ?? '' },
  { label: 'ifcObjectType', accessor: (s, id) => s.entities.getObjectType?.(id) ?? '' },
  { label: 'ifcTag', accessor: (s, id) => s.entities.getTag?.(id) ?? '' },
  { label: 'ifcID', accessor: (_s, id) => String(id) },
  {
    label: 'ifcTypeObjectName',
    accessor: (s, id) => {
      const typeIds = s.relationships?.getRelated(id, RelationshipType.DefinesByType, 'inverse');
      const typeId = typeIds && typeIds.length > 0 ? typeIds[0] : undefined;
      return typeId !== undefined ? s.entities.getName(typeId) ?? '' : '';
    },
  },
  {
    label: 'ifcStoreyElevation',
    accessor: (s, id) => {
      const sh = s.spatialHierarchy;
      const storeyId = sh?.elementToStorey.get(id);
      if (storeyId === undefined) return '';
      const elev = sh?.storeyElevations.get(storeyId);
      // Round away float noise (a level at 0 stores as -1.8e-15).
      return elev === undefined ? '' : String(Number(elev.toFixed(4)));
    },
  },
  {
    // IfcRelFillsElement is (opening -> filler); an opening that HAS a filling
    // reaches its filler forward (EntityNode.filledBy()).
    label: 'ifcHasFilling',
    accessor: (s, id) =>
      (s.relationships?.getRelated(id, RelationshipType.FillsElement, 'forward')?.length ?? 0) > 0 ? 'true' : 'false',
  },
  {
    // …and a door/window that IS a filling reaches its opening inversely.
    label: 'ifcIsFilling',
    accessor: (s, id) =>
      (s.relationships?.getRelated(id, RelationshipType.FillsElement, 'inverse')?.length ?? 0) > 0 ? 'true' : 'false',
  },
  {
    // Positional attribute — only IfcDoor/IfcWindow declare it, so gate the
    // source re-parse to those types.
    label: 'ifcOverallHeight',
    accessor: (s, id) => {
      const t = s.entities.getTypeName(id);
      return t === 'IfcDoor' || t === 'IfcWindow' ? readSourceAttribute(s, id, 'OverallHeight') : '';
    },
  },
  {
    label: 'ifcOverallWidth',
    accessor: (s, id) => {
      const t = s.entities.getTypeName(id);
      return t === 'IfcDoor' || t === 'IfcWindow' ? readSourceAttribute(s, id, 'OverallWidth') : '';
    },
  },
];

/** ifc parameters listed for completeness but not yet filterable (need a
 *  bespoke accessor). Typeable, but contribute no match — a small follow-up. */
const INERT_IFC_PARAMS: readonly string[] = [
  'ifcElevation', 'ifcIsGeometry', 'ifcLongName',
  'ifcPresentationLayerAssignment', 'ifcRefLatitude', 'ifcRefLongitude',
];

interface Option { value: string; label: string }

type Row =
  | { id: string; kind: 'ifcType' | 'storey' | 'predefinedType'; label: string; options: readonly Option[] }
  | { id: string; kind: 'property'; label: string; setNames: readonly string[]; propName: string; options: readonly Option[] }
  | { id: string; kind: 'quantity'; label: string; setNames: readonly string[]; quantityName: string; options: readonly Option[] }
  | { id: string; kind: 'attribute'; label: string; accessor: Accessor; options: readonly Option[] }
  | { id: string; kind: 'inert'; label: string };

/** Which sticky section a row belongs to (RIBiTWO groups the list this way). */
type SectionKey = 'ifc' | 'property' | 'quantity';
function sectionOf(kind: Row['kind']): SectionKey {
  return kind === 'property' ? 'property' : kind === 'quantity' ? 'quantity' : 'ifc';
}

/** Round a numeric value string for DISPLAY (max 6 decimals, trailing zeros
 *  dropped) while the raw string stays the match value; non-numeric strings
 *  pass through unchanged. Drops float noise like 0.211563391… → 0.211563. */
function roundLabel(raw: string): string {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? String(Number(n.toFixed(6))) : raw;
}

/** Order value strings for the dropdown: numeric values (areas, volumes,
 *  elevations, ids) compare as numbers so the list runs low→high and the
 *  largest isn't lexicographically stranded (a plain `.sort()` puts "982"
 *  after "2318" because it compares "9" vs "2"). Non-numeric values fall back
 *  to locale order and sort after the numbers. */
function compareValues(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = a.trim() !== '' && Number.isFinite(na);
  const bNum = b.trim() !== '' && Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a.localeCompare(b);
}

const asOptions = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: roundLabel(v) }));

/** The raw (unrounded) value behind a selected/typed label — for numeric cells
 *  the dropdown shows a rounded label but the filter rule must match the raw
 *  stored value. Falls back to the text itself (free-typed input / wildcards). */
function rawValueOf(row: Row, text: string): string {
  const opts = 'options' in row ? row.options : undefined;
  return opts?.find((o) => o.label === text)?.value ?? text;
}

function resolveSetValues(row: Extract<Row, { kind: 'ifcType' | 'storey' | 'predefinedType' }>, input: string): string[] {
  const t = input.trim();
  if (!t) return [];
  if (isQueryExpr(t)) return resolveOptionValues(row.options, compileQuery(t));
  const term = t.toLowerCase();
  return row.options.filter((o) => o.label.toLowerCase() === term || o.value.toLowerCase() === term).map((o) => o.value);
}

/** One attribute row. Memoized and fed stable callbacks so that typing in a
 *  single value field re-renders only that row — the property list can run to
 *  hundreds of rows, and this keeps per-keystroke work O(1) instead of O(rows). */
const FilterRow = memo(function FilterRow({
  row,
  value,
  active,
  onChange,
  onClear,
}: {
  row: Row;
  value: string;
  active: boolean;
  onChange: (id: string, value: string) => void;
  onClear: (id: string) => void;
}) {
  const options = useMemo<string[]>(() => {
    if (row.kind === 'inert') return [];
    if (row.kind === 'property' || row.kind === 'attribute') return [NONE_LABEL, ...row.options.map((o) => o.label)];
    return row.options.map((o) => o.label);
  }, [row]);

  return (
    <div className="flex w-full items-center border-b border-border/50" style={{ minHeight: 46 }}>
      <div className="grid w-full grid-cols-2 items-center gap-2 px-3">
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">{row.label}</div>
          {(row.kind === 'property' || row.kind === 'quantity') && row.setNames.length > 0 && (
            <div className="truncate text-[10px] text-muted-foreground">{row.setNames.join(', ')}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ComboInput
            value={value}
            onChange={(v) => onChange(row.id, v)}
            options={options}
            placeholder={row.kind === 'inert' ? 'soon' : ''}
            className="h-7 min-w-0 flex-1 text-xs"
            maxRendered={2000}
            aria-label={`Value for ${row.label}`}
          />
          {active && (
            <button
              type="button"
              onClick={() => onClear(row.id)}
              aria-label={`Clear ${row.label}`}
              title="Clear"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export function ObjectFilterPanel() {
  const { models, activeModelId, isolateEntities, clearIsolation, setSelectedEntityIds, clearSelection, getMutationView, mutationCount, selectedEntityIds } = useViewerStore(
    useShallow((s) => ({
      models: s.models,
      activeModelId: s.activeModelId,
      isolateEntities: s.isolateEntities,
      clearIsolation: s.clearIsolation,
      setSelectedEntityIds: s.setSelectedEntityIds,
      clearSelection: s.clearSelection,
      selectedEntityIds: s.selectedEntityIds,
      getMutationView: s.getMutationView,
      // Cheap version signal: every property write pushes onto the undo stack,
      // so its depth changing means the overlay below must be rebuilt.
      mutationCount: s.activeModelId ? (s.undoStacks.get(s.activeModelId)?.length ?? 0) : 0,
    })),
  );

  const activeModel = activeModelId ? models.get(activeModelId) : undefined;
  const activeStore = activeModel?.ifcDataStore ?? null;

  const [query, setQuery] = useState('');
  const [selections, setSelections] = useState<Map<string, string>>(new Map());
  const [matched, setMatched] = useState<number | null>(null);
  const [onlyActive, setOnlyActive] = useState(false);
  /** Ids behind `matched` — handed to the attribute-rules assistant. */
  const [matchedIds, setMatchedIds] = useState<number[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** Progress of a running rule apply. The assistant closes when it starts, so
   *  the bar lives here, where it stays visible over the model. */
  const [ruleProgress, setRuleProgress] = useState<{ done: number; total: number; label: string } | null>(null);

  // Object universe: every IfcObjectDefinition instance (products + type
  // objects + groups + spatial objects like rooms/spaces) from the type index
  // — NOT only the geometry-bearing ones, so the value dropdowns list every
  // object's attributes (rooms, spaces, …) the way RIBiTWO does, and the total
  // matches. ifcType options stay the geometry-bearing classes ("Bauteile").
  const modelSummary = useMemo(() => {
    const byType = activeStore?.entityIndex?.byType;
    const objectIds: number[] = [];
    if (byType) {
      for (const [typeName, ids] of byType) {
        if (isObjectDefinitionClass(typeName)) for (const id of ids) objectIds.push(id);
      }
    }
    const meshes = activeModel?.geometryResult?.meshes;
    const types = new Set<string>();
    if (meshes) for (const m of meshes) if (m.ifcType) types.add(m.ifcType);
    return { objectIds, ifcTypes: [...types].sort() };
  }, [activeStore, activeModel?.geometryResult]);

  const totalObjects = modelSummary.objectIds.length;

  // Distinct values per client-side attribute (sampled + capped) so those
  // cells are dropdowns too, not just free-text — every value cell offers both.
  const attributeValues = useMemo(() => {
    const result = new Map<string, string[]>();
    if (!activeStore) return result;
    // Scan the whole object universe (bounded for pathological models) and
    // keep a generous distinct set, so dropdowns aren't truncated like before.
    const sample = modelSummary.objectIds.length > 50_000 ? modelSummary.objectIds.slice(0, 50_000) : modelSummary.objectIds;
    for (const { label, accessor } of ATTRIBUTE_PARAMS) {
      const seen = new Set<string>();
      for (const id of sample) {
        const v = accessor(activeStore, id);
        if (v) seen.add(v);
        if (seen.size >= 5000) break;
      }
      result.set(label, [...seen].sort(compareValues));
    }
    return result;
  }, [activeStore, modelSummary.objectIds]);

  /**
   * Live overlay of every property the session has written — what the
   * attribute-rules assistant just applied, plus any manual property edit.
   *
   * Those writes live in the model's `MutablePropertyView`, an overlay on top
   * of the parsed store; the filter schema and the filter engine both read the
   * store, so without this an attribute a rule just created would be invisible
   * here. Keyed like `propertyValues` so the two fold together:
   *   propValueKey(pset, prop) -> entityId -> value  (null = deleted)
   * The mutation history is append-only, so a later entry for the same
   * (entity, pset, prop) simply overwrites the earlier one. Each entry keeps
   * its `ref` so the (set, property) pair never has to be parsed back out of
   * the composite key.
   */
  interface OverlayEntry {
    ref: { setName: string; propName: string };
    /** entityId -> new value, or null when the rule deleted the property. */
    values: Map<number, string | null>;
  }
  const mutationOverlay = useMemo(() => {
    const idx = new Map<string, OverlayEntry>();
    const view = activeModelId ? getMutationView(activeModelId) : null;
    if (!view) return idx;
    for (const m of view.getMutations()) {
      if (!m.psetName || !m.propName) continue;
      const isSet = m.type === 'CREATE_PROPERTY' || m.type === 'UPDATE_PROPERTY';
      const isDelete = m.type === 'DELETE_PROPERTY';
      if (!isSet && !isDelete) continue;
      const key = propValueKey(m.psetName, m.propName);
      let entry = idx.get(key);
      if (!entry) {
        entry = { ref: { setName: m.psetName, propName: m.propName }, values: new Map() };
        idx.set(key, entry);
      }
      entry.values.set(m.entityId, isDelete ? null : String(m.newValue ?? ''));
    }
    return idx;
    // `mutationCount` is the version signal — the view itself is mutated in
    // place, so its identity never changes when a rule writes.
  }, [activeModelId, getMutationView, mutationCount]);

  const rows = useMemo<Row[]>(() => {
    if (!activeStore) return [];
    const schema = discoverFilterSchema(activeStore);
    const values = discoverFilterValues(activeStore);
    const out: Row[] = [];

    const ifcTypeSource = modelSummary.ifcTypes.length > 0 ? modelSummary.ifcTypes : schema.ifcTypes;
    if (ifcTypeSource.length > 0) {
      out.push({ id: 'ifc:type', kind: 'ifcType', label: 'ifcType', options: ifcTypeSource.map((v) => ({ value: v, label: v.replace(/^ifc/i, '').toUpperCase() })) });
    }
    if (schema.storeys.length > 0) {
      out.push({ id: 'ifc:storey', kind: 'storey', label: 'ifcBuildingStoreyName', options: asOptions(schema.storeys.map(([name]) => name)) });
    }
    if (values.predefinedTypes.length > 0) {
      out.push({ id: 'ifc:predefinedType', kind: 'predefinedType', label: 'ifcPredefinedType', options: asOptions(values.predefinedTypes) });
    }
    for (const { label, accessor } of ATTRIBUTE_PARAMS) {
      out.push({ id: `ifc:${label}`, kind: 'attribute', label, accessor, options: asOptions(attributeValues.get(label) ?? []) });
    }
    for (const label of INERT_IFC_PARAMS) {
      out.push({ id: `ifc:${label}`, kind: 'inert', label });
    }

    // Group properties/quantities by NAME across their psets — ONE row per
    // attribute with the UNION of every value the model carries (RIBiTWO-style),
    // instead of a separate row per (set, name).
    const { psets, qtos } = discoverPropertyAndQuantitySchema(activeStore);
    const group = (
      entries: Iterable<[string, Iterable<string>]>,
      valueMap: Map<string, string[]>,
    ): Map<string, { sets: string[]; values: Set<string> }> => {
      const groups = new Map<string, { sets: string[]; values: Set<string> }>();
      for (const [setName, names] of entries) {
        for (const name of names) {
          let g = groups.get(name);
          if (!g) { g = { sets: [], values: new Set() }; groups.set(name, g); }
          if (!g.sets.includes(setName)) g.sets.push(setName);
          for (const v of valueMap?.get(propValueKey(setName, name)) ?? []) g.values.add(v);
        }
      }
      return groups;
    };
    // Fold the live overlay in BEFORE building the rows, so an attribute a rule
    // just created appears in this list like any other (RIBiTWO shows the new
    // 5D_* attributes in the Objektfilter as soon as the rules are applied),
    // and an existing attribute gains the values the rules wrote.
    const overlaySets = new Map<string, Set<string>>(); // propName -> set names
    for (const [key, entry] of mutationOverlay) {
      const { setName, propName: name } = entry.ref;
      const merged = new Set(values.propertyValues.get(key) ?? []);
      // The base model already carrying values keeps the attribute alive even
      // if a rule removed it from some objects.
      let live = merged.size > 0;
      for (const v of entry.values.values()) if (v !== null && v !== '') { merged.add(v); live = true; }
      values.propertyValues.set(key, [...merged]);
      // Every entry is a deletion and the file never had the attribute: the
      // rule that created it has been rolled back, so it must NOT leave a row
      // behind — that is what made a deleted rule's attribute stay forever.
      if (!live) continue;
      let sets = overlaySets.get(name);
      if (!sets) { sets = new Set(); overlaySets.set(name, sets); }
      sets.add(setName);
    }

    const grouped = group(psets, values.propertyValues);
    // Attributes that exist ONLY as a mutation have no schema entry yet.
    for (const [name, sets] of overlaySets) {
      let g = grouped.get(name);
      if (!g) { g = { sets: [], values: new Set() }; grouped.set(name, g); }
      for (const setName of sets) {
        if (!g.sets.includes(setName)) g.sets.push(setName);
        for (const v of values.propertyValues.get(propValueKey(setName, name)) ?? []) g.values.add(v);
      }
    }

    for (const [propName, g] of grouped) {
      out.push({ id: `prop:${propName}`, kind: 'property', label: propName, setNames: g.sets, propName, options: asOptions([...g.values].sort(compareValues)) });
    }
    for (const [quantityName, g] of group(qtos.map(([s, q]) => [s, q.map(([n]) => n)]), values.quantityValues)) {
      out.push({ id: `qty:${quantityName}`, kind: 'quantity', label: quantityName, setNames: g.sets, quantityName, options: asOptions([...g.values].sort(compareValues)) });
    }

    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [activeStore, modelSummary.ifcTypes, attributeValues, mutationOverlay]);

  // Build match sources from the entries and isolate the intersection —
  // debounced so typing doesn't thrash. Stale runs are discarded.
  useEffect(() => {
    if (!activeStore) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Single-rule conditions are AND-combined in one pass; a name-grouped
    // property/quantity spanning several psets becomes an OR group evaluated
    // on its own, then intersected — giving "(value in ANY of its sets) AND …".
    const andRules: FilterRule[] = [];
    const orGroups: FilterRule[][] = [];
    const attrFilters: Array<{ accessor: Accessor; test: (v: string) => boolean }> = [];
    const addGroup = (group: FilterRule[]) => {
      if (group.length === 1) andRules.push(group[0]);
      else if (group.length > 1) orGroups.push(group);
    };

    for (const [id, text] of selections) {
      const row = byId.get(id);
      if (!row) continue;
      const t = text.trim();
      if (!t) continue;
      // A query (`*`/`&`/`||`) resolves to the concrete option values it
      // matches, then the object is matched exactly against those — so `&`/`||`
      // and every `*` position work uniformly through the engine's eq/in ops
      // (which have no startsWith/endsWith), and client-side for attributes.
      const test = isQueryExpr(t) ? compileQuery(t) : null;
      if (row.kind === 'property') {
        // A property the session has written to can't be matched by the filter
        // engine — the engine reads the parsed store, and the write lives in
        // the mutation overlay. Match those client-side against the EFFECTIVE
        // value (overlay first, base second) so an attribute a rule just
        // created filters like any other, and an overwritten one matches its
        // new value rather than the stale parsed one.
        const overlaid = row.setNames.some((s) => mutationOverlay.has(propValueKey(s, row.propName)));
        if (overlaid) {
          const propRow = row;
          const accessor: Accessor = (s, id) => {
            for (const setName of propRow.setNames) {
              const entry = mutationOverlay.get(propValueKey(setName, propRow.propName));
              const v = entry?.values.get(id);
              // `undefined` = untouched here, `null` = deleted by a rule (a
              // sibling set may still carry it), otherwise the written value.
              if (v !== undefined && v !== null && v !== '') return v;
            }
            for (const set of s.getProperties?.(id) ?? []) {
              if (!propRow.setNames.includes(set.name)) continue;
              for (const p of set.properties ?? []) {
                if (p.name === propRow.propName) return p.value === undefined || p.value === null ? '' : String(p.value);
              }
            }
            return '';
          };
          if (t === NONE_LABEL) attrFilters.push({ accessor, test: (v) => v === '' });
          else if (test) attrFilters.push({ accessor, test });
          else {
            const raw = rawValueOf(row, t).toLowerCase();
            attrFilters.push({ accessor, test: (v) => v.toLowerCase() === raw });
          }
          continue;
        }
        if (t === NONE_LABEL) {
          // Absent = not set in ANY of its psets → AND of isNotSet.
          for (const s of row.setNames) andRules.push(Rule.property(s, row.propName, 'isNotSet', ''));
          continue;
        }
        const vals = test ? resolveOptionValues(row.options, test) : [rawValueOf(row, t)];
        if (vals.length === 0) continue;
        const group: FilterRule[] = [];
        for (const s of row.setNames) for (const v of vals) group.push(Rule.property(s, row.propName, 'eq', v));
        addGroup(group);
      } else if (row.kind === 'quantity') {
        if (test) {
          const group: FilterRule[] = [];
          for (const s of row.setNames) for (const v of resolveOptionValues(row.options, test)) {
            const n = Number(v);
            if (Number.isFinite(n)) group.push(Rule.quantity(s, row.quantityName, 'eq', n));
          }
          if (group.length === 0) continue;
          addGroup(group);
        } else {
          const parsed = parseNumeric(rawValueOf(row, t));
          if (!parsed) continue;
          addGroup(row.setNames.map((s) => Rule.quantity(s, row.quantityName, parsed.op, parsed.value)));
        }
      } else if (row.kind === 'attribute') {
        if (t === NONE_LABEL) {
          attrFilters.push({ accessor: row.accessor, test: (v) => v === '' });
        } else if (test) {
          attrFilters.push({ accessor: row.accessor, test });
        } else {
          const raw = rawValueOf(row, t).toLowerCase();
          attrFilters.push({ accessor: row.accessor, test: (v) => v.toLowerCase() === raw });
        }
      } else if (row.kind === 'ifcType' || row.kind === 'storey' || row.kind === 'predefinedType') {
        const vals = resolveSetValues(row, t);
        if (vals.length === 0) continue;
        if (row.kind === 'ifcType') andRules.push(Rule.ifcType(vals, 'in'));
        else if (row.kind === 'storey') andRules.push(Rule.storey(vals, 'in'));
        else andRules.push(Rule.predefinedType(vals, 'in'));
      }
      // 'inert' rows contribute nothing yet.
    }

    if (andRules.length === 0 && orGroups.length === 0 && attrFilters.length === 0) {
      clearIsolation();
      clearSelection();
      setMatched(null);
      setMatchedIds([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const modelArg = [{ id: activeModelId ?? 'default', store: activeStore }];
        let ids: number[] | null = null;
        const intersect = (next: number[]) => {
          if (ids === null) { ids = next; return; }
          const set = new Set(next);
          ids = ids.filter((x) => set.has(x));
        };
        if (andRules.length > 0) {
          const res = await evaluateFilterRulesFederated(modelArg, andRules, 'AND', { limit: 200_000 });
          if (cancelled) return;
          intersect(res.map((m) => m.expressId));
        }
        for (const grp of orGroups) {
          const res = await evaluateFilterRulesFederated(modelArg, grp, 'OR', { limit: 200_000 });
          if (cancelled) return;
          intersect(res.map((m) => m.expressId));
        }
        if (attrFilters.length > 0) {
          const universe = ids ?? modelSummary.objectIds;
          ids = universe.filter((id) => attrFilters.every((f) => f.test(f.accessor(activeStore, id))));
        }
        if (cancelled) return;
        const finalIds = ids ?? [];
        isolateEntities(finalIds);
        // Highlight the matches too, not just isolate them: `selectedEntityIds`
        // is the renderer's highlight channel (Viewport.tsx) and drives the
        // selection count chip, so the hits light up and stay actionable
        // (hide / properties / export) instead of only surviving the isolate.
        // It holds GLOBAL ids, so map through the active model's offset.
        setSelectedEntityIds(finalIds.map((id) => toGlobalIdFromModels(models, activeModelId ?? 'default', id)));
        setMatched(finalIds.length);
        setMatchedIds(finalIds);
      })();
    }, ISOLATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeStore, activeModelId, models, selections, rows, modelSummary.objectIds, mutationOverlay, isolateEntities, clearIsolation, setSelectedEntityIds, clearSelection]);

  const isActive = (id: string) => (selections.get(id) ?? '').trim() !== '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = rows;
    if (q) base = base.filter((r) => r.label.toLowerCase().includes(q) || ((r.kind === 'property' || r.kind === 'quantity') && r.setNames.some((s) => s.toLowerCase().includes(q))));
    if (onlyActive) base = base.filter((r) => (selections.get(r.id) ?? '').trim() !== '');
    return base;
  }, [rows, query, onlyActive, selections]);

  // Group the visible rows into the three RIBiTWO sections, each preceded by a
  // sticky header — a flat render list of headers + rows in section order.
  const sectioned = useMemo(() => {
    const order: Array<[SectionKey, string]> = [
      ['ifc', 'IFC-Parameter'],
      ['property', 'Properties'],
      ['quantity', 'Quantities'],
    ];
    const out: Array<{ kind: 'header'; key: string; label: string; count: number } | { kind: 'row'; row: Row }> = [];
    for (const [key, label] of order) {
      const secRows = filtered.filter((r) => sectionOf(r.kind) === key);
      if (secRows.length === 0) continue;
      out.push({ kind: 'header', key, label, count: secRows.length });
      for (const r of secRows) out.push({ kind: 'row', row: r });
    }
    return out;
  }, [filtered]);

  // Active fields as removable chips (label + entered value).
  const chips = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const out: Array<{ id: string; label: string; value: string }> = [];
    for (const [id, v] of selections) {
      const value = v.trim();
      if (value) out.push({ id, label: byId.get(id)?.label ?? id, value });
    }
    return out;
  }, [selections, rows]);

  /** Every (property set, property) the model carries — the source and target
   *  pickers of the attribute-rules assistant. */
  const propertyRefs = useMemo<PropRef[]>(() => {
    const out: PropRef[] = [];
    for (const r of rows) {
      if (r.kind !== 'property') continue;
      for (const psetName of r.setNames) out.push({ psetName, propName: r.propName });
    }
    return out.sort((a, b) => a.psetName.localeCompare(b.psetName) || a.propName.localeCompare(b.propName));
  }, [rows]);

  /** The 3D selection as LOCAL express ids — the renderer's highlight channel
   *  holds global ids, and the rules assistant addresses the model locally. */
  const selectedLocalIds = useMemo(() => {
    if (!activeModelId) return [];
    const offset = models.get(activeModelId)?.idOffset ?? 0;
    return [...selectedEntityIds].map((g) => g - offset).filter((id) => id > 0);
  }, [selectedEntityIds, activeModelId, models]);

  /** Resolve an ifc-level parameter by name for the attribute-rules assistant.
   *  Mapping files use these both as copy sources and as conditions
   *  (`ifcTypeObjectName` feeds 5D_Typ, which 56 later maps key off), and they
   *  are not properties, so the property readers cannot answer them. */
  const readIfcParam = useCallback((entityId: number, name: string): string | null => {
    if (!activeStore) return null;
    const lower = name.toLowerCase();
    // The set dimensions are rows of this panel but not ATTRIBUTE_PARAMS, and
    // conditions name them constantly (`ifcType = WALL`).
    if (lower === 'ifctype') return activeStore.entities.getTypeName(entityId) || null;
    if (lower === 'ifcbuildingstoreyname') {
      const storeyId = activeStore.spatialHierarchy?.elementToStorey.get(entityId);
      return storeyId === undefined ? null : activeStore.entities.getName(storeyId) || null;
    }
    const param = ATTRIBUTE_PARAMS.find((p) => p.label.toLowerCase() === lower);
    return param ? param.accessor(activeStore, entityId) || null : null;
  }, [activeStore]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const setValue = useCallback((id: string, value: string) => {
    setSelections((prev) => new Map(prev).set(id, value));
  }, []);

  const clearRow = useCallback((id: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const cancelFilter = () => {
    setSelections(new Map());
    setMatched(null);
    setMatchedIds([]);
    setQuery('');
    setOnlyActive(false);
    clearIsolation();
    clearSelection();
  };

  const activeCount = chips.length;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header: search + only-active toggle + red clear-all. */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            leftIcon={<Search className="h-4 w-4" />}
            className="h-8"
            aria-label="Search attributes"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyActive((v) => !v)}
          disabled={activeCount === 0 && !onlyActive}
          aria-pressed={onlyActive}
          aria-label="Show only active filters"
          title="Only active filters"
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
            onlyActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            'disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
          )}
        >
          <ListFilter className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setRulesOpen(true)}
          disabled={!activeStore}
          aria-label="Attribute rules"
          title="Attribute rules — write attributes onto the filtered objects"
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            'disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
          )}
        >
          <Table2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={cancelFilter}
          disabled={activeCount === 0 && query === '' && !onlyActive}
          aria-label="Clear filter"
          title="Clear filter"
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-500 transition-colors',
            'hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 disabled:hover:bg-transparent',
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Active-filter chips */}
      {chips.length > 0 && (
        <div className="scrollbar-thin flex max-h-24 flex-wrap gap-1 overflow-y-auto border-b px-3 py-2">
          {chips.map((c) => (
            <span
              key={c.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent py-0.5 pl-2 pr-1 text-[11px] text-accent-foreground"
            >
              <span className="font-medium">{c.label}</span>
              <span className="max-w-[8rem] truncate opacity-70">{c.value}</span>
              <button
                type="button"
                onClick={() => clearRow(c.id)}
                aria-label={`Clear ${c.label}`}
                className="rounded-sm p-0.5 hover:bg-black/10 hover:text-red-500 dark:hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Column headers */}
      <div className="grid grid-cols-2 gap-2 border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span>Attribute</span>
        <span>Value</span>
      </div>

      {/* Attribute rows, grouped into sticky sections */}
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {sectioned.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {!activeStore ? 'No model loaded.' : onlyActive ? 'No active filters.' : 'No attributes found.'}
          </div>
        ) : (
          sectioned.map((item) =>
            item.kind === 'header' ? (
              <div
                key={`h:${item.key}`}
                className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                <span>{item.label}</span>
                <span className="opacity-60">{item.count}</span>
              </div>
            ) : (
              <FilterRow
                key={item.row.id}
                row={item.row}
                value={selections.get(item.row.id) ?? ''}
                active={isActive(item.row.id)}
                onChange={setValue}
                onClear={clearRow}
              />
            ),
          )
        )}
      </div>

      {/* Object count */}
      <div className="border-t px-3 py-1.5 text-right text-xs text-muted-foreground">
        {(matched ?? totalObjects).toLocaleString()}{' '}
        {(matched ?? totalObjects) === 1 ? 'Object' : 'Objects'}
      </div>

      {/* Apply progress — label left, percentage right, bar beneath. */}
      {ruleProgress && (
        <div className="border-t px-3 py-2">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-foreground">{ruleProgress.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {ruleProgress.total > 0 ? Math.round((ruleProgress.done / ruleProgress.total) * 100) : 0} %
            </span>
          </div>
          <Progress value={ruleProgress.total > 0 ? (ruleProgress.done / ruleProgress.total) * 100 : 0} />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {ruleProgress.done.toLocaleString()} / {ruleProgress.total.toLocaleString()} attributes
          </p>
        </div>
      )}

      <AttributeRulesDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        onProgress={setRuleProgress}
        conditions={chips.map((c) => ({ label: c.label, value: c.value }))}
        // With no filter set, the rules would target the whole model — pass the
        // full object universe so the dialog can say so honestly.
        entityIds={matched === null ? modelSummary.objectIds : matchedIds}
        modelId={activeModelId ?? null}
        store={activeStore}
        propertyRefs={propertyRefs}
        projectKey={projectKeyFor(activeModel?.name, totalObjects)}
        universe={modelSummary.objectIds}
        selectedIds={selectedLocalIds}
        readIfcParam={readIfcParam}
      />
    </div>
  );
}
