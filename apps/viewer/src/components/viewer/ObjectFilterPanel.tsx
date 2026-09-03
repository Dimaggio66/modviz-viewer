/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ObjectFilterPanel — RIBiTWO-style "Objektfilter" docked in the left slot
 * (replaces the object tree there, ViewerLayout).
 *
 * A flat, searchable, virtualized list of every attribute of the active model
 * — the IFC-level parameters (ifc*) and every property (occurrence +
 * type-inherited). EVERY value cell is a typeable `ComboInput`: pick a value
 * or type freely; a `*` anywhere means a substring match (RIBiTWO's `*AW*` →
 * "contains"), no `*` matches exactly.
 *
 * Two match paths, intersected (AND) and debounced:
 *  - set dimensions (ifcType / ifcBuildingStoreyName / ifcPredefinedType) and
 *    properties run through the filter engine (`evaluateFilterRulesFederated`);
 *  - the other ifc parameters (ifcName / ifcGuid / ifcObjectType / ifcTag /
 *    ifcID) match client-side via the store's cached column getters — no
 *    per-entity source re-parse (AGENTS.md §Models).
 * The matched objects isolate in 3D via the shared `isolateEntities` channel.
 *
 * ifcType values render without the "Ifc" prefix (canonical value kept for
 * matching). A few ifc parameters (elevations, overall size, ref lat/long,
 * fillings, layer assignment, long/type-object name) have no cheap accessor
 * yet — their fields are present and typeable but inert until wired (a small
 * per-parameter follow-up). Attribute names render verbatim (German from the
 * model); the UI chrome stays English.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { IfcDataStore } from '@ifc-lite/parser';
import { EntityExtractor, getAttributeNames, getInheritanceChainAcrossSchemas } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import { Input } from '@/components/ui/input';
import { ComboInput } from '@/components/ui/combo-input';
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

/** A `*` anywhere → substring ("contains"); otherwise an exact match. */
function parsePattern(input: string): { wildcard: boolean; term: string } {
  const raw = input.trim();
  const wildcard = raw.includes('*');
  return { wildcard, term: wildcard ? raw.replace(/\*/g, '') : raw };
}

function matches(value: string, wildcard: boolean, term: string): boolean {
  const v = value.toLowerCase();
  const t = term.toLowerCase();
  return wildcard ? v.includes(t) : v === t;
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

/** Round a numeric value string for DISPLAY (max 6 decimals, trailing zeros
 *  dropped) while the raw string stays the match value; non-numeric strings
 *  pass through unchanged. Drops float noise like 0.211563391… → 0.211563. */
function roundLabel(raw: string): string {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) ? String(Number(n.toFixed(6))) : raw;
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
  const { wildcard, term } = parsePattern(input);
  if (!term) return [];
  const t = term.toLowerCase();
  const pred = wildcard
    ? (o: Option) => o.label.toLowerCase().includes(t)
    : (o: Option) => o.label.toLowerCase() === t || o.value.toLowerCase() === t;
  return row.options.filter(pred).map((o) => o.value);
}

export function ObjectFilterPanel() {
  const { models, activeModelId, isolateEntities, clearIsolation } = useViewerStore(
    useShallow((s) => ({
      models: s.models,
      activeModelId: s.activeModelId,
      isolateEntities: s.isolateEntities,
      clearIsolation: s.clearIsolation,
    })),
  );

  const activeModel = activeModelId ? models.get(activeModelId) : undefined;
  const activeStore = activeModel?.ifcDataStore ?? null;

  const [query, setQuery] = useState('');
  const [selections, setSelections] = useState<Map<string, string>>(new Map());
  const [matched, setMatched] = useState<number | null>(null);

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
      result.set(label, [...seen].sort());
    }
    return result;
  }, [activeStore, modelSummary.objectIds]);

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
    for (const [propName, g] of group(psets, values.propertyValues)) {
      out.push({ id: `prop:${propName}`, kind: 'property', label: propName, setNames: g.sets, propName, options: asOptions([...g.values].sort()) });
    }
    for (const [quantityName, g] of group(qtos.map(([s, q]) => [s, q.map(([n]) => n)]), values.quantityValues)) {
      out.push({ id: `qty:${quantityName}`, kind: 'quantity', label: quantityName, setNames: g.sets, quantityName, options: asOptions([...g.values].sort()) });
    }

    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [activeStore, modelSummary.ifcTypes, attributeValues]);

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
    const attrFilters: Array<{ accessor: Accessor; wildcard: boolean; term: string; absent: boolean }> = [];
    const addGroup = (group: FilterRule[]) => {
      if (group.length === 1) andRules.push(group[0]);
      else if (group.length > 1) orGroups.push(group);
    };

    for (const [id, text] of selections) {
      const row = byId.get(id);
      if (!row) continue;
      const t = text.trim();
      if (!t) continue;
      if (row.kind === 'property') {
        if (t === NONE_LABEL) {
          // Absent = not set in ANY of its psets → AND of isNotSet.
          for (const s of row.setNames) andRules.push(Rule.property(s, row.propName, 'isNotSet', ''));
          continue;
        }
        const { wildcard, term } = parsePattern(rawValueOf(row, t));
        if (!term) continue;
        const op = wildcard ? 'contains' : 'eq';
        addGroup(row.setNames.map((s) => Rule.property(s, row.propName, op, term)));
      } else if (row.kind === 'quantity') {
        const parsed = parseNumeric(rawValueOf(row, t));
        if (!parsed) continue;
        addGroup(row.setNames.map((s) => Rule.quantity(s, row.quantityName, parsed.op, parsed.value)));
      } else if (row.kind === 'attribute') {
        if (t === NONE_LABEL) {
          attrFilters.push({ accessor: row.accessor, wildcard: false, term: '', absent: true });
        } else {
          const { wildcard, term } = parsePattern(rawValueOf(row, t));
          if (term) attrFilters.push({ accessor: row.accessor, wildcard, term, absent: false });
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
      setMatched(null);
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
          ids = universe.filter((id) =>
            attrFilters.every((f) => {
              const v = f.accessor(activeStore, id);
              return f.absent ? v === '' : matches(v, f.wildcard, f.term);
            }),
          );
        }
        if (cancelled) return;
        const finalIds = ids ?? [];
        isolateEntities(finalIds);
        setMatched(finalIds.length);
      })();
    }, ISOLATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeStore, activeModelId, selections, rows, modelSummary.objectIds, isolateEntities, clearIsolation]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(q) || ((r.kind === 'property' || r.kind === 'quantity') && r.setNames.some((s) => s.toLowerCase().includes(q))));
  }, [rows, query]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    // Fixed row height (no dynamic measurement) — every row is a single value
    // cell with an optional set-name subline, both truncated to one line, so a
    // constant height keeps the total size exact and the list fully scrollable.
    estimateSize: () => 46,
    overscan: 12,
  });

  const comboOptions = (r: Row): string[] => {
    if (r.kind === 'inert') return [];
    if (r.kind === 'property' || r.kind === 'attribute') return [NONE_LABEL, ...r.options.map((o) => o.label)];
    return r.options.map((o) => o.label);
  };

  const setValue = (id: string, value: string) => setSelections((prev) => new Map(prev).set(id, value));

  const cancelFilter = () => {
    setSelections(new Map());
    setMatched(null);
    setQuery('');
    clearIsolation();
  };

  const activeCount = [...selections.values()].filter((v) => v.trim() !== '').length;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header: search (renamed from "Search model") + red cancel-X. */}
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
          onClick={cancelFilter}
          disabled={activeCount === 0 && query === ''}
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

      {/* Column headers */}
      <div className="grid grid-cols-2 gap-2 border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span>Attribute</span>
        <span>Value</span>
      </div>

      {/* Attribute rows (virtualized) */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {activeStore ? 'No attributes found.' : 'No model loaded.'}
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const r = filtered[vi.index];
              return (
                <div
                  key={r.id}
                  className="absolute left-0 top-0 flex w-full items-center border-b border-border/50"
                  style={{ height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }}
                >
                  <div className="grid w-full grid-cols-2 items-center gap-2 px-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-foreground">{r.label}</div>
                      {(r.kind === 'property' || r.kind === 'quantity') && r.setNames.length > 0 && (
                        <div className="truncate text-[10px] text-muted-foreground">{r.setNames.join(', ')}</div>
                      )}
                    </div>
                    <ComboInput
                      value={selections.get(r.id) ?? ''}
                      onChange={(v) => setValue(r.id, v)}
                      options={comboOptions(r)}
                      placeholder={r.kind === 'inert' ? '— (soon)' : '—'}
                      className="h-7 text-xs"
                      maxRendered={2000}
                      aria-label={`Value for ${r.label}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Object count */}
      <div className="border-t px-3 py-1.5 text-right text-xs text-muted-foreground">
        {(matched ?? totalObjects).toLocaleString()}{' '}
        {(matched ?? totalObjects) === 1 ? 'Object' : 'Objects'}
      </div>
    </div>
  );
}
