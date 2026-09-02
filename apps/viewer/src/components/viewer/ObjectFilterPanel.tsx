/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ObjectFilterPanel — RIBiTWO-style "Objektfilter" docked in the left slot
 * (replaces the object tree there, ViewerLayout).
 *
 * A flat, searchable list of every filterable attribute of the active model:
 *  - the IFC-level parameters (ifc*), visible among the attributes like
 *    RIBiTWO, and
 *  - every property (occurrence + type-inherited) discovered from the model.
 *
 * Each value cell is a typeable dropdown (`ComboInput`): pick a real value or
 * type a pattern. A `*` anywhere makes it a substring match (RIBiTWO's `*AW*`
 * → "contains AW"); no `*` matches exactly. Selections AND-combine into filter
 * rules and isolate the matching objects in 3D through the same
 * `isolateEntities` channel the Filter tab / hierarchy use; the isolate is
 * debounced so typing doesn't thrash the evaluator.
 *
 * ifcType / ifcBuildingStoreyName / ifcPredefinedType filter live; ifcType
 * values render without the "Ifc" prefix (canonical value kept for matching).
 * The remaining ifc parameters (Name / Guid / Tag / ObjectType …) are listed
 * but not yet filterable — they need a filter-engine attribute rule that does
 * not exist yet, a separate follow-up. Attribute names render verbatim (German
 * from the model); the UI chrome stays English.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ComboInput } from '@/components/ui/combo-input';
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

/** ComboInput option for "property is absent" → maps to the isNotSet rule. */
const NONE_LABEL = '<Not set>';
/** Debounce for the isolate run — long enough that typing a value doesn't fire
 *  a filter per keystroke, short enough to feel immediate on pick. */
const ISOLATE_DEBOUNCE_MS = 250;

/** Parse a value-cell entry. A `*` anywhere → substring match ("contains");
 *  otherwise an exact match. (ValueOp has no startsWith/endsWith, so every
 *  wildcard collapses to contains — enough for RIBiTWO's `*AW*`.) */
function parsePattern(input: string): { wildcard: boolean; term: string } {
  const raw = input.trim();
  const wildcard = raw.includes('*');
  return { wildcard, term: wildcard ? raw.replace(/\*/g, '') : raw };
}

interface Option {
  /** Value the filter rule matches against (canonical). */
  value: string;
  /** What the dropdown shows (e.g. ifcType: "WALL" for value "IfcWall"). */
  label: string;
}

type Row =
  | { id: string; kind: 'ifcType' | 'storey' | 'predefinedType'; label: string; options: readonly Option[] }
  | { id: string; kind: 'property'; label: string; setName: string; propName: string; options: readonly Option[] }
  | { id: string; kind: 'unsupported'; label: string };

const asOptions = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: v }));

/** ifc parameters that don't yet map to a filter-engine rule — listed like
 *  RIBiTWO, but not filterable until an attribute rule exists (follow-up). */
const UNSUPPORTED_IFC_PARAMS: readonly string[] = [
  'ifcElevation', 'ifcGuid', 'ifcHasFilling', 'ifcID', 'ifcIsFilling', 'ifcIsGeometry',
  'ifcLongName', 'ifcName', 'ifcObjectType', 'ifcOverallHeight', 'ifcOverallWidth',
  'ifcPresentationLayerAssignment', 'ifcRefLatitude', 'ifcRefLongitude',
  'ifcStoreyElevation', 'ifcTag', 'ifcTypeObjectName',
];

/** Set-dimension values (ifcType / storey / predefinedType) selected by an
 *  entry: exact matches one option label; a wildcard matches every option
 *  whose label contains the term, so `*WA*` on ifcType picks WALL + … at once. */
function resolveSetValues(row: Extract<Row, { kind: 'ifcType' | 'storey' | 'predefinedType' }>, input: string): string[] {
  const { wildcard, term } = parsePattern(input);
  if (!term) return [];
  const t = term.toLowerCase();
  const match = wildcard
    ? (o: Option) => o.label.toLowerCase().includes(t)
    : (o: Option) => o.label.toLowerCase() === t || o.value.toLowerCase() === t;
  return row.options.filter(match).map((o) => o.value);
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

  // One pass over the active model's geometry: the object total ("N Objects")
  // and the geometry-bearing IFC classes — the "Bauteile" the ifcType picker
  // offers (deriving from meshes excludes schema infrastructure the way
  // RIBiTWO's list does). Computed once per model.
  const modelSummary = useMemo(() => {
    const meshes = activeModel?.geometryResult?.meshes;
    if (!meshes) return { totalObjects: activeStore?.entityCount ?? 0, ifcTypes: [] as string[] };
    const ids = new Set<number>();
    const types = new Set<string>();
    for (const m of meshes) {
      ids.add(m.expressId);
      if (m.ifcType) types.add(m.ifcType);
    }
    return { totalObjects: ids.size, ifcTypes: [...types].sort() };
  }, [activeModel?.geometryResult, activeStore]);

  const rows = useMemo<Row[]>(() => {
    if (!activeStore) return [];
    const schema = discoverFilterSchema(activeStore);
    const values = discoverFilterValues(activeStore);
    const out: Row[] = [];

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
      out.push({ id: 'ifc:storey', kind: 'storey', label: 'ifcBuildingStoreyName', options: asOptions(schema.storeys.map(([name]) => name)) });
    }
    if (values.predefinedTypes.length > 0) {
      out.push({ id: 'ifc:predefinedType', kind: 'predefinedType', label: 'ifcPredefinedType', options: asOptions(values.predefinedTypes) });
    }
    for (const label of UNSUPPORTED_IFC_PARAMS) {
      out.push({ id: `ifc:${label}`, kind: 'unsupported', label });
    }

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

  // Build rules from the current entries and isolate — debounced so typing a
  // value doesn't fire a run per keystroke. Stale runs are discarded.
  useEffect(() => {
    if (!activeStore) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const rules: FilterRule[] = [];
    for (const [id, text] of selections) {
      const row = byId.get(id);
      if (!row || row.kind === 'unsupported') continue;
      const t = text.trim();
      if (!t) continue;
      if (row.kind === 'property') {
        if (t === NONE_LABEL) { rules.push(Rule.property(row.setName, row.propName, 'isNotSet', '')); continue; }
        const { wildcard, term } = parsePattern(t);
        if (!term) continue;
        rules.push(Rule.property(row.setName, row.propName, wildcard ? 'contains' : 'eq', term));
      } else {
        const vals = resolveSetValues(row, t);
        if (vals.length === 0) continue;
        if (row.kind === 'ifcType') rules.push(Rule.ifcType(vals, 'in'));
        else if (row.kind === 'storey') rules.push(Rule.storey(vals, 'in'));
        else rules.push(Rule.predefinedType(vals, 'in'));
      }
    }

    if (rules.length === 0) {
      clearIsolation();
      setMatched(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
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
    }, ISOLATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeStore, activeModelId, selections, rows, isolateEntities, clearIsolation]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.label.toLowerCase().includes(q) || (r.kind === 'property' && r.setName.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const comboOptions = (r: Extract<Row, { kind: 'ifcType' | 'storey' | 'predefinedType' | 'property' }>): string[] =>
    r.kind === 'property'
      ? [NONE_LABEL, ...r.options.map((o) => o.label)]
      : r.options.map((o) => o.label);

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

      {/* Attribute rows */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-border/50">
          {filtered.map((r) => (
            <div key={r.id} className="grid grid-cols-2 items-center gap-2 px-3 py-1">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground" title={r.label}>{r.label}</div>
                {r.kind === 'property' && (
                  <div className="truncate text-[10px] text-muted-foreground">{r.setName}</div>
                )}
              </div>
              {r.kind === 'unsupported' ? (
                <button
                  type="button"
                  disabled
                  title="Free-text / wildcard filter — needs an attribute rule (follow-up)"
                  className="flex h-7 w-full items-center rounded-lg border border-input bg-transparent px-3 text-xs text-muted-foreground opacity-50"
                >
                  —
                </button>
              ) : (
                <ComboInput
                  value={selections.get(r.id) ?? ''}
                  onChange={(v) => setValue(r.id, v)}
                  options={comboOptions(r)}
                  placeholder="—"
                  className="h-7 text-xs"
                  aria-label={`Value for ${r.label}`}
                />
              )}
            </div>
          ))}
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
