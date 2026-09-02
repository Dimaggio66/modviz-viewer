/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ObjectFilterPanel — RIBiTWO-style "Objektfilter" docked in the left slot
 * (replaces the object tree there, ViewerLayout).
 *
 * A flat, searchable list of every filterable attribute of the active model:
 *  - the IFC-level parameters (ifc*), so they are visible among the
 *    attributes exactly like RIBiTWO, and
 *  - every property (occurrence + type-inherited) discovered from the model.
 * Each row has a value dropdown of the distinct values that attribute
 * carries; picking values AND-combines into filter rules and isolates the
 * matching objects in 3D through the same `isolateEntities` channel the
 * Filter tab / hierarchy use.
 *
 * Step 1 scope (functional + minimal): the layout, all attributes incl. the
 * ifc parameters, the object count, and the red cancel-X. The ifc dimensions
 * that map to the filter engine — ifcType / ifcBuildingStoreyName /
 * ifcPredefinedType — filter live; the remaining ifc parameters are listed
 * but their value pickers turn functional in Step 2 together with the
 * typeable / wildcard (`*AW*`) dropdowns. Attribute names render verbatim
 * (German from the model); the UI chrome stays English.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import {
  discoverFilterSchema,
  discoverFilterValues,
  discoverPropertyAndQuantitySchema,
  propValueKey,
} from '@/lib/search/filter-schema';
import { Rule, type FilterRule } from '@/lib/search/filter-rules';
import { evaluateFilterRulesFederated } from '@/lib/search/filter-evaluate';

/** Select value for the "property is absent" choice (Radix forbids ''; a real
 *  value can't contain a NUL, so this can't collide with a discovered one). */
const ABSENT = ' absent';

/** ifc parameters that don't yet map to a filter-engine rule. Listed (like
 *  RIBiTWO) but their value pickers become functional in Step 2 (free-text /
 *  wildcard). Kept in one place so the list is easy to shrink as each gains a
 *  rule. */
const UNSUPPORTED_IFC_PARAMS: readonly string[] = [
  'ifcElevation',
  'ifcGuid',
  'ifcHasFilling',
  'ifcID',
  'ifcIsFilling',
  'ifcIsGeometry',
  'ifcLongName',
  'ifcName',
  'ifcObjectType',
  'ifcOverallHeight',
  'ifcOverallWidth',
  'ifcPresentationLayerAssignment',
  'ifcRefLatitude',
  'ifcRefLongitude',
  'ifcStoreyElevation',
  'ifcTag',
  'ifcTypeObjectName',
];

interface Option {
  /** The value the filter rule matches against (canonical). */
  value: string;
  /** What the dropdown shows (e.g. ifcType: "WALL" for value "IfcWall"). */
  label: string;
}

type Row =
  | { id: string; kind: 'ifcType' | 'storey' | 'predefinedType'; label: string; options: readonly Option[] }
  | { id: string; kind: 'property'; label: string; setName: string; propName: string; options: readonly Option[] }
  | { id: string; kind: 'unsupported'; label: string };

const asOptions = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: v }));

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

  // One pass over the active model's geometry: the object total ("N Objects")
  // and the geometry-bearing IFC classes — the "Bauteile" the ifcType picker
  // offers. Deriving from meshes (not the raw type index) excludes schema
  // infrastructure (IfcClassification, IfcGeometricRepresentationContext, …)
  // the way RIBiTWO's list does. Computed once per model.
  const modelSummary = useMemo(() => {
    const meshes = activeModel?.geometryResult?.meshes;
    if (!meshes) {
      return { totalObjects: activeStore?.entityCount ?? 0, ifcTypes: [] as string[] };
    }
    const ids = new Set<number>();
    const types = new Set<string>();
    for (const m of meshes) {
      ids.add(m.expressId);
      if (m.ifcType) types.add(m.ifcType);
    }
    return { totalObjects: ids.size, ifcTypes: [...types].sort() };
  }, [activeModel?.geometryResult, activeStore]);

  // Rows: ifc parameters + every discovered property, merged and sorted by
  // name (so ifc* group under "i", like RIBiTWO).
  const rows = useMemo<Row[]>(() => {
    if (!activeStore) return [];
    const schema = discoverFilterSchema(activeStore);
    const values = discoverFilterValues(activeStore);
    const out: Row[] = [];

    // ifcType — canonical value, RIBiTWO-style display (no "Ifc" prefix, upper).
    const ifcTypeSource = modelSummary.ifcTypes.length > 0 ? modelSummary.ifcTypes : schema.ifcTypes;
    if (ifcTypeSource.length > 0) {
      out.push({
        id: 'ifc:type',
        kind: 'ifcType',
        label: 'ifcType',
        options: ifcTypeSource.map((v) => ({ value: v, label: v.replace(/^ifc/i, '').toUpperCase() })),
      });
    }
    if (schema.storeys.length > 0) {
      out.push({
        id: 'ifc:storey',
        kind: 'storey',
        label: 'ifcBuildingStoreyName',
        options: asOptions(schema.storeys.map(([name]) => name)),
      });
    }
    if (values.predefinedTypes.length > 0) {
      out.push({
        id: 'ifc:predefinedType',
        kind: 'predefinedType',
        label: 'ifcPredefinedType',
        options: asOptions(values.predefinedTypes),
      });
    }
    // Remaining ifc parameters — visible now, filterable in Step 2.
    for (const label of UNSUPPORTED_IFC_PARAMS) {
      out.push({ id: `ifc:${label}`, kind: 'unsupported', label });
    }

    // Every property (occurrence + type-inherited).
    const { psets } = discoverPropertyAndQuantitySchema(activeStore);
    for (const [setName, props] of psets) {
      for (const propName of props) {
        const key = propValueKey(setName, propName);
        out.push({
          id: `prop:${key}`,
          kind: 'property',
          label: propName,
          setName,
          propName,
          options: asOptions(values.propertyValues.get(key) ?? []),
        });
      }
    }

    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [activeStore, modelSummary.ifcTypes]);

  // Isolate on selection change (async + chunked; stale runs discarded).
  useEffect(() => {
    if (!activeStore) return;
    if (selections.size === 0) {
      clearIsolation();
      setMatched(null);
      return;
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const rules: FilterRule[] = [];
    for (const [id, value] of selections) {
      const row = byId.get(id);
      if (!row) continue;
      switch (row.kind) {
        case 'ifcType': rules.push(Rule.ifcType([value], 'in')); break;
        case 'storey': rules.push(Rule.storey([value], 'in')); break;
        case 'predefinedType': rules.push(Rule.predefinedType([value], 'in')); break;
        case 'property':
          rules.push(
            value === ABSENT
              ? Rule.property(row.setName, row.propName, 'isNotSet', '')
              : Rule.property(row.setName, row.propName, 'eq', value),
          );
          break;
        case 'unsupported': break; // not selectable
      }
    }
    if (rules.length === 0) {
      clearIsolation();
      setMatched(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await evaluateFilterRulesFederated(
        [{ id: activeModelId ?? 'default', store: activeStore }],
        rules,
        'and',
        { limit: 200_000 },
      );
      if (cancelled) return;
      isolateEntities(result.map((m) => m.expressId));
      setMatched(result.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeStore, activeModelId, selections, rows, isolateEntities, clearIsolation]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        (r.kind === 'property' && r.setName.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const setValue = (id: string, value: string) => {
    setSelections((prev) => new Map(prev).set(id, value));
  };

  const cancelFilter = () => {
    setSelections(new Map());
    setMatched(null);
    setQuery('');
    clearIsolation();
  };

  const activeCount = selections.size;

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

      {/* Attribute rows */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-border/50">
          {filtered.map((r) => {
            const selected = selections.get(r.id) ?? '';
            return (
              <div key={r.id} className="grid grid-cols-2 items-center gap-2 px-3 py-1">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground" title={r.label}>
                    {r.label}
                  </div>
                  {r.kind === 'property' && (
                    <div className="truncate text-[10px] text-muted-foreground">{r.setName}</div>
                  )}
                </div>
                {r.kind === 'unsupported' ? (
                  <button
                    type="button"
                    disabled
                    title="Free-text / wildcard filter — coming in step 2"
                    className="flex h-7 w-full items-center rounded-lg border border-input bg-transparent px-3 text-xs text-muted-foreground opacity-50"
                  >
                    —
                  </button>
                ) : (
                  <Select value={selected} onValueChange={(v) => setValue(r.id, v)}>
                    <SelectTrigger className="h-7 text-xs" aria-label={`Value for ${r.label}`}>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {r.kind === 'property' && (
                        <SelectItem value={ABSENT}>&lt;Not set&gt;</SelectItem>
                      )}
                      {r.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {activeStore ? 'No attributes found.' : 'No model loaded.'}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Object count */}
      <div className="border-t px-3 py-1.5 text-right text-xs text-muted-foreground">
        {(matched ?? modelSummary.totalObjects).toLocaleString()}{' '}
        {(matched ?? modelSummary.totalObjects) === 1 ? 'Object' : 'Objects'}
      </div>
    </div>
  );
}
