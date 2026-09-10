/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * AttributeRulesDialog — the RIBiTWO-style "Attributregeln" assistant
 * (RIB BIM Qualifier §6.8.1), opened from the object filter.
 *
 * Two tabs, laid out like the viewer's Search/Filter modal:
 *   • **Rules** — build one rule: pick the action, see the *Bedingung* the
 *     object filter supplies, fill in the *Aktion*.
 *   • **Rules table** — RIBiTWO's *Attributregeln* grid of everything
 *     collected, with enable/disable, reorder and delete per rule.
 *
 * The Bedingung is always the object filter's current state — RIBiTWO's
 * `Alle Objekte | Aus Filter` path — so it is shown read-only together with
 * the object count it matched. Each collected rule keeps its own snapshot, so
 * you can re-filter between rules and apply them all at once.
 *
 * Writes go through `mutationSlice` (`setProperty` / `deleteProperty`), which
 * records them on the undo stack and includes them in the IFC export.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ListPlus, Sparkles, Table2, Upload, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { PropertyValueType, RelationshipType } from '@ifc-lite/data';
import { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { extractTypeEntityOwnProperties } from '@ifc-lite/parser';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ComboInput } from '@/components/ui/combo-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { configureMutationView } from '@/utils/configureMutationView';
import { useViewerStore } from '@/store';
import type { PropertyEdit } from '@/store/slices/mutationSlice';
import {
  ACTION_LABELS, applyRuleEdit, describeConditions, planWrites, planWritesStepwise, refKeyOf, staleTargetRefs,
  DEFAULT_TARGET_PSET,
  type AttributeRule, type PropRef, type RuleAction, type RuleConditionSnapshot,
  type RuleEditField, type RuleMatch, type RulePlanStat, type RuleTableRow, type RuleWrite,
} from '@/lib/attribute-rules';
import { loadApplied, loadRules, saveApplied, saveRules } from '@/lib/attribute-rules-store';
import { importMappingXml } from '@/lib/attribute-rules-xml';
import { valueText } from '@/lib/value-text';
import { ifcClassOf, isTypeEntityName } from '@/lib/ifc-type-entity';
import {
  ActionEditor, EMPTY_ACTION_FORM, refKey,
  type ActionForm, type ActionKind,
} from './attribute-rules/ActionEditor';
import { RulesTable } from './attribute-rules/RulesTable';

export interface AttributeRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The filter's active conditions, shown as the rule's Bedingung. */
  conditions: RuleConditionSnapshot[];
  /** The objects those conditions matched (local express ids). */
  entityIds: number[];
  modelId: string | null;
  store: IfcDataStore | null;
  /** Every (pset, property) the model carries — the source/target pickers. */
  propertyRefs: readonly PropRef[];
  /** Identifies the loaded file, so saved rules are restored per project. */
  projectKey: string;
  /** Every object in the model — the candidate set for imported mappings,
   *  whose conditions select objects themselves rather than via the filter. */
  universe: readonly number[];
  /** Resolves an ifc-level parameter (ifcType, ifcTypeObjectName, …). Mapping
   *  files use these as copy sources and conditions, and they are not
   *  properties, so the property readers alone cannot answer them. */
  readIfcParam?: (entityId: number, name: string) => string | null;
  /** Reports how far an apply has got, so the progress can be shown outside
   *  this dialog — it closes as soon as the run starts. `null` = finished. */
  onProgress?: (state: { done: number; total: number; label: string } | null) => void;
  /** Objects currently selected in 3D (local express ids). */
  selectedIds: readonly number[];
}

/** Writes per yield to the event loop while applying. Large enough that the
 *  run stays fast, small enough that the bar moves smoothly. */
const PROGRESS_CHUNK = 400;

/** Delay before the write preview is recomputed while you type. */
const PREVIEW_DEBOUNCE_MS = 350;
/** How long one preview slice may hold the frame. Half of a 60 Hz budget, so
 *  the dialog keeps painting while the plan is still being computed. */
const PREVIEW_FRAME_BUDGET_MS = 8;

// RIB's five tabs, in RIB's order. "Add from values" (`compose`) is no longer
// offered: it has no counterpart in RIB, and the XML import never produced one,
// so only a hand-built rule could use it. Rules already saved with it keep
// working — the action is still evaluated, just not creatable.
const KINDS: ActionKind[] = ['componentType', 'add', 'copy', 'rename', 'delete'];

/** Where a new rule takes its objects from — RIBiTWO's "Alle Objekte" menu. */
export type RuleScope = 'all' | 'filter' | 'selection';

export function AttributeRulesDialog({
  open, onOpenChange, conditions, entityIds, modelId, store, propertyRefs, projectKey,
  universe, readIfcParam, onProgress, selectedIds,
}: AttributeRulesDialogProps) {
  const { applyPropertyEdits, getMutationView, registerMutationView } = useViewerStore(
    useShallow((s) => ({
      applyPropertyEdits: s.applyPropertyEdits,
      getMutationView: s.getMutationView,
      registerMutationView: s.registerMutationView,
    })),
  );

  const [tab, setTab] = useState<'rules' | 'table'>('rules');
  const [kind, setKind] = useState<ActionKind>('add');
  /** RIBiTWO's "Alle Objekte" split button — where a new rule starts from. */
  const [scope, setScope] = useState<RuleScope>('filter');
  /** Which condition attributes are ticked, and the value each one uses. */
  const [uncheckedConditions, setUnchecked] = useState<Set<string>>(new Set());
  const [conditionValues, setConditionValues] = useState<Record<string, string>>({});
  const [form, setForm] = useState<ActionForm>(EMPTY_ACTION_FORM);
  const [rules, setRules] = useState<AttributeRule[]>([]);
  const [applying, setApplying] = useState(false);
  const [persisted, setPersisted] = useState(true);

  const patch = useCallback((p: Partial<ActionForm>) => setForm((f) => ({ ...f, ...p })), []);

  /**
   * Rules are saved per project (§6.8.1.1), so they survive closing the dialog
   * and reloading the page and keep the object ids they were built for.
   * `loadedKey` guards the load-then-save cycle: without it the empty initial
   * state would be written back over the saved catalog before the load lands.
   */
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !projectKey) return;
    if (loadedKey.current === projectKey) return;
    loadedKey.current = projectKey;
    setRules(loadRules(projectKey));
  }, [open, projectKey]);

  /** Persist on every change to the rule list, once this project is loaded. */
  const commit = useCallback((next: AttributeRule[]) => {
    setRules(next);
    if (loadedKey.current === projectKey && projectKey) setPersisted(saveRules(projectKey, next));
  }, [projectKey]);

  const refByKey = useMemo(() => new Map(propertyRefs.map((r) => [refKey(r), r])), [propertyRefs]);
  const psetNames = useMemo(
    () => [...new Set(propertyRefs.map((r) => r.psetName))].sort((a, b) => a.localeCompare(b)),
    [propertyRefs],
  );
  const attributeNames = useMemo(
    () => [...new Set(propertyRefs.map((r) => r.propName))].sort((a, b) => a.localeCompare(b)),
    [propertyRefs],
  );

  /**
   * Pick the scope that fits when the assistant OPENS: the filter if one is
   * active, else the 3D selection, else the whole model. Deciding on every
   * render instead would strand the choice — once it fell back to "all
   * objects" because no filter existed yet, it never returned to the filter.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setScope(conditions.length > 0 ? 'filter' : selectedIds.length > 0 ? 'selection' : 'all');
      setUnchecked(new Set());
      setConditionValues({});
    }
    wasOpen.current = open;
  }, [open, conditions.length, selectedIds.length]);

  /** …but never sit on a scope that has nothing behind it any more. */
  useEffect(() => {
    if (scope === 'filter' && conditions.length === 0) setScope('all');
    if (scope === 'selection' && selectedIds.length === 0) setScope(conditions.length > 0 ? 'filter' : 'all');
  }, [scope, conditions.length, selectedIds.length]);

  /**
   * The attributes offered as conditions. From the filter that is what it
   * matched on; from a selection it is what the first selected object carries,
   * so any of them can be promoted to a condition (RIB BIM Qualifier §6.8.1.2.1
   * — "durch Aktivieren des Attributs die Bedingung festlegen").
   */
  const candidateConditions = useMemo<RuleConditionSnapshot[]>(() => {
    if (scope === 'filter') return conditions;
    if (scope === 'selection' && selectedIds.length > 0 && store) {
      const first = selectedIds[0];
      const out: RuleConditionSnapshot[] = [];
      for (const set of store.getProperties?.(first) ?? []) {
        for (const p of set.properties ?? []) {
          if (p.value === undefined || p.value === null || p.value === '') continue;
          out.push({ label: p.name, value: valueText(p.value) });
        }
      }
      return out.sort((a, b) => a.label.localeCompare(b.label));
    }
    return [];
  }, [scope, conditions, selectedIds, store]);

  /** Conditions start ticked when they come from the filter (they already
   *  describe the selection) and unticked for a selected object's attributes. */
  const checkedConditions = useMemo(() => {
    const on = new Set<string>();
    if (scope === 'filter') for (const c of candidateConditions) if (!uncheckedConditions.has(c.label)) on.add(c.label);
    else for (const c of candidateConditions) if (uncheckedConditions.has(`+${c.label}`)) on.add(c.label);
    return on;
  }, [scope, candidateConditions, uncheckedConditions]);

  const toggleCondition = (label: string) => setUnchecked((prev) => {
    const next = new Set(prev);
    // Filter conditions are opt-OUT, a selected object's attributes opt-IN.
    const key = scope === 'filter' ? label : `+${label}`;
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const setConditionValue = (label: string, value: string) =>
    setConditionValues((prev) => ({ ...prev, [label]: value }));

  /** Distinct values of one attribute, for its condition dropdown. `*` is
   *  offered first: it stands for every value the attribute has. Reads go
   *  through a ref because the readers are defined further down. */
  const readersRef = useRef<{ effective: { readByName: (id: number, prop: string) => string | null } } | null>(null);
  const valuesFor = useCallback((label: string) => {
    const seen = new Set<string>();
    const ids = scope === 'selection' ? selectedIds : entityIds.slice(0, 4000);
    for (const id of ids) {
      const v = readersRef.current?.effective.readByName(id, label);
      if (v) seen.add(v);
      if (seen.size >= 300) break;
    }
    return ['*', ...[...seen].sort((a, b) => a.localeCompare(b))];
  }, [scope, selectedIds, entityIds]);

  /** The conditions a new rule will carry. */
  const activeMatch = useMemo<RuleMatch[]>(
    () => candidateConditions
      .filter((c) => checkedConditions.has(c.label))
      .map((c) => ({ attribute: c.label, value: (conditionValues[c.label] ?? c.value).trim() || '*' })),
    [candidateConditions, checkedConditions, conditionValues],
  );

  /** Objects a new rule starts from, before its own conditions narrow it. */
  const scopeIds = useMemo<number[]>(
    () => (scope === 'selection' ? [...selectedIds] : scope === 'filter' ? entityIds : []),
    [scope, selectedIds, entityIds],
  );
  const scopeCount = scope === 'all' ? universe.length : scopeIds.length;

  /** The action the form currently describes, or null when incomplete. */
  const draft = useMemo<RuleAction | null>(() => {
    const target = { psetName: form.psetName.trim(), propName: form.propName.trim() };
    const hasTarget = target.psetName !== '' && target.propName !== '';
    const source = form.sourceKey ? refByKey.get(form.sourceKey) : undefined;
    const { dataType, unit, mode } = form;
    switch (kind) {
      case 'add':     return hasTarget && form.value.trim() !== '' ? { kind, target, value: form.value.trim(), dataType, unit, mode } : null;
      case 'compose': return hasTarget && form.template.trim() !== '' ? { kind, target, template: form.template.trim(), dataType, unit, mode } : null;
      case 'copy':    return hasTarget && source ? { kind, source, target, mode } : null;
      case 'rename':  return source && form.newName.trim() !== '' ? { kind, source, propName: form.newName.trim() } : null;
      case 'delete': {
        const targets = form.deleteKeys.map((k) => refByKey.get(k)).filter((r): r is PropRef => !!r);
        return targets.length > 0 ? { kind, targets } : null;
      }
      case 'componentType':
        // Address and data type are fixed for this action, so the form only
        // has to have picked a type.
        return form.componentType ? { kind, value: form.componentType, mode } : null;
    }
  }, [kind, form, refByKey]);

  const collect = () => {
    if (!draft) return;
    commit([
      ...rules,
      {
        id: `${Date.now()}-${rules.length}`,
        conditions: activeMatch.map((m) => ({ label: m.attribute, value: m.value })),
        // The rule resolves its own conditions, so it keeps working after a
        // reload and narrows the scope the same way every time it runs.
        match: activeMatch,
        entityIds: scope === 'all' ? [] : [...scopeIds],
        action: draft,
        enabled: true,
      },
    ]);
    // Empty the fields that identify THIS rule, so the draft stops being a
    // valid action — otherwise the rule just collected would also still be
    // pending and every write would be planned twice. Property set, type,
    // unit and mode stay, since the next rule usually shares them.
    patch({ propName: '', value: '', template: '', sourceKey: '', sourceFilter: '', newName: '', deleteKeys: [] });
    setTab('table');
  };

  /** Load a RIBiTWO `<transform>` mapping file and append its maps as rules.
   *  Appending (not replacing) keeps anything already built by hand, and the
   *  imported maps stay in file order — they read each other's output. */
  const fileRef = useRef<HTMLInputElement>(null);
  const importXml = async (file: File) => {
    try {
      const { rules: imported, skipped, name } = importMappingXml(await file.text());
      if (imported.length === 0) {
        toast.error(`No mappings found in ${file.name}.`);
        return;
      }
      const stamp = Date.now();
      commit([...rules, ...imported.map((r, i) => ({ ...r, id: `${stamp}-${r.id}-${i}` }))]);
      setTab('table');
      const note = skipped.length > 0 ? ` ${skipped.length} entr(y/ies) skipped.` : '';
      toast.success(`Imported ${imported.length} rule(s)${name ? ` from "${name}"` : ''}.${note}`);
      if (skipped.length > 0) console.warn('[ifc-lite] attribute-rule import skipped:', skipped);
    } catch (err) {
      toast.error(`Could not read ${file.name}.`);
      console.warn('[ifc-lite] attribute-rule import failed', err);
    }
  };

  /** Commit an in-place edit from the rules table back onto its rule. */
  const editRule = (row: RuleTableRow, field: RuleEditField, text: string) =>
    commit(rules.map((r) => (r.id === row.ruleId ? applyRuleEdit(r, row, field, text) : r)));

  const toggleRule = (id: string) => commit(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const removeRule = (id: string) => commit(rules.filter((r) => r.id !== id));
  /** Same path as a single removal, so the rollback of what those rules wrote
   *  is worked out exactly the same way. */
  const removeRules = (ids: readonly string[]) => {
    const drop = new Set(ids);
    commit(rules.filter((r) => !drop.has(r.id)));
  };
  const moveRule = (id: string, delta: number) => {
    const i = rules.findIndex((r) => r.id === id);
    const to = i + delta;
    if (i < 0 || to < 0 || to >= rules.length) return;
    const next = [...rules];
    [next[i], next[to]] = [next[to], next[i]];
    commit(next);
  };

  /** Rules to run: whatever is in the table, plus the unsaved draft — so a
   *  single rule can be applied without the extra "add to table" click. */
  const pending = useMemo<AttributeRule[]>(
    () => (draft
      ? [...rules, {
          id: 'draft',
          conditions: activeMatch.map((m) => ({ label: m.attribute, value: m.value })),
          match: activeMatch,
          entityIds: scope === 'all' ? [] : [...scopeIds],
          action: draft,
          enabled: true,
        }]
      : rules),
    [rules, draft, activeMatch, scope, scopeIds],
  );

  /**
   * Read property values for one entity, as strings.
   *
   * Reads through `IfcStoreBase.getProperties`, NOT the columnar `properties`
   * table: a STEP parse leaves that table empty on purpose and answers through
   * `getProperties` instead (issue #577, see `packages/data/src/data-store.ts`).
   * The table is still preferred when it actually holds rows (cache-restored
   * stores). Sets are cached per entity for one dialog session, since planning
   * re-reads the same entities for every rule.
   */
  /**
   * The property sets the rules themselves write into.
   *
   * RIBiTWO resolves a bare attribute name against its own set-less CPI
   * attributes and the ifc-level parameters — NOT against the model's property
   * sets. Measured on TGA Content Sanitär: searching the model's sets gave
   * `5D_Durchmesser` on 126 objects with the values 0 / 21.3 / 33.7 / 100,
   * because a bare `Dämmungsstärke außen` found `Isolierung\Dämmungsstärke
   * außen = 0` and blocked the later, qualified rule. Not searching them gives
   * 122 objects and 15, 20, 25, 42.4, 50, 70, 80, 90, 100, 125, 150, 200, 250
   * — iTWO's count and iTWO's values, exactly.
   *
   * Our `5D_*` have to live in a set because IFC has no set-less property, so
   * those sets stay readable by bare name; only the model's own do not.
   */
  const outputPsets = useMemo(() => {
    const out = new Set<string>([DEFAULT_TARGET_PSET]);
    for (const r of rules) {
      const a = r.action;
      if (a.kind === 'add' || a.kind === 'compose' || a.kind === 'copy') out.add(a.target.psetName);
      else if (a.kind === 'rename') out.add(a.source.psetName);
      else if (a.kind === 'delete') for (const t of a.targets) out.add(t.psetName);
    }
    return out;
  }, [rules]);
  const outputPsetsRef = useRef(outputPsets);
  outputPsetsRef.current = outputPsets;

  const readers = useMemo(() => {
    type Sets = Array<{ name: string; properties?: Array<{ name: string; value: unknown }> }>;
    const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : valueText(v));

    /**
     * Property sets a property may be inherited from: the ones the object
     * itself carries, plus the ones on its defining type. The object filter
     * folds type psets in (it labels them "Daten(Typ)"), so a condition or a
     * copy source naming such an attribute has to see them too — otherwise a
     * rule built from a perfectly good filter matches nothing at all.
     */
    const typeIdOf = (entityId: number): number | undefined => {
      const ids = store?.relationships?.getRelated(entityId, RelationshipType.DefinesByType, 'inverse');
      return ids && ids.length > 0 ? ids[0] : undefined;
    };

    /** Build a (pset, prop) and a by-name reader over a source of sets. */
    const readersOver = (setsOf: (id: number) => Sets) => {
      const read = (entityId: number, pset: string, prop: string): string | null => {
        // The filter suffixes an inherited set with "(Typ)"; the set itself
        // carries the bare name, so accept either spelling.
        const bare = pset.endsWith('(Typ)') ? pset.slice(0, -5) : pset;
        for (const set of setsOf(entityId)) {
          if (set.name !== pset && set.name !== bare) continue;
          for (const p of set.properties ?? []) if (p.name === prop) return str(p.value);
        }
        return null;
      };
      const readByName = (entityId: number, prop: string): string | null => {
        for (const set of setsOf(entityId)) {
          // Only what the rules themselves wrote — see `outputPsets`. Read
          // through the ref: as a DEPENDENCY it rebuilt this whole memo, and
          // with it the caches below, on every rule edit — 490,317 property
          // sets re-read from the file, 7.1 s on the hospital model, for a
          // Set whose CONTENTS almost never change.
          if (!outputPsetsRef.current.has(set.name)) continue;
          for (const p of set.properties ?? []) if (p.name === prop) return str(p.value);
        }
        // Not a property: mapping files also name ifc-level parameters here.
        return readIfcParam?.(entityId, prop) ?? null;
      };
      return { read, readByName };
    };

    // BASE — the parsed file, never the overlay. Rolling a rule back restores
    // this. Reads through `getProperties`, since a STEP parse leaves the
    // columnar table empty by design (issue #577).
    const baseCache = new Map<number, Sets>();
    const ownSets = (entityId: number): Sets => {
      // A TYPE entity's own HasPropertySets are not exposed through the
      // occurrence extractor, so ask the type extractor FIRST. Asking it last
      // — only once the occurrence paths came back empty — made the answer
      // depend on what those paths happen to return for a type entity, and
      // whatever that is, it is not the type's property sets. In
      // `TGA Content Sanitär` the whole `Text` set of every fitting type
      // hangs there, `CAx Typ = "2er Bogen"` among it, and losing it turned
      // `5D_Typ` into the raw `Familie:Typ` string for most of the model.
      if (store && isTypeEntityName(ifcClassOf(store, entityId))) {
        const ofType = extractTypeEntityOwnProperties(store, entityId) as Sets;
        if (ofType.length > 0) return ofType;
      }
      const table = store?.properties;
      const fromTable = table && table.count !== 0 ? table.getForEntity?.(entityId) : undefined;
      if (fromTable && fromTable.length > 0) return fromTable;
      return store?.getProperties?.(entityId) ?? [];
    };
    const typeSetCache = new Map<number, Sets>();
    const baseSets = (entityId: number) => {
      let sets = baseCache.get(entityId);
      if (!sets) {
        const own = ownSets(entityId);
        const typeId = typeIdOf(entityId);
        let inherited: Sets = [];
        if (typeId !== undefined) {
          inherited = typeSetCache.get(typeId) ?? ownSets(typeId);
          typeSetCache.set(typeId, inherited);
        }
        // Own sets first: an occurrence value overrides the type's.
        sets = inherited.length > 0 ? [...own, ...inherited] : own;
        baseCache.set(entityId, sets);
      }
      return sets;
    };

    // EFFECTIVE — what the model actually shows right now, base plus every
    // write this session already made. Planning reads this so re-applying an
    // unchanged rule set produces nothing, and so "add where empty" judges the
    // live model rather than the file it was loaded from.
    const view = modelId ? getMutationView(modelId) : null;
    const effCache = new Map<number, Sets>();
    const effSets = (entityId: number) => {
      if (!view) return baseSets(entityId);
      let sets = effCache.get(entityId);
      if (!sets) {
        const merged = (view.getForEntity(entityId) as Sets) ?? [];
        const typeId = typeIdOf(entityId);
        const inherited = typeId !== undefined ? (typeSetCache.get(typeId) ?? ownSets(typeId)) : [];
        if (typeId !== undefined) typeSetCache.set(typeId, inherited);
        sets = inherited.length > 0 ? [...merged, ...inherited] : merged;
        effCache.set(entityId, sets);
      }
      return sets;
    };

    const base = readersOver(baseSets);
    const effective = readersOver(effSets);
    return { read: base.read, readByName: base.readByName, effective };
    // `open` is a dependency so each time the dialog opens it starts from
    // fresh values rather than a cache filled before the last apply.
  }, [store, open, readIfcParam, modelId, getMutationView]);
  readersRef.current = readers;

  /**
   * Planning walks every candidate object, so doing it on each keystroke made
   * the action form stutter. The PREVIEW runs on a debounced copy of the
   * rules; the apply re-plans from the live state, so the delay can never
   * cause it to write something stale.
   */
  const [previewRules, setPreviewRules] = useState<AttributeRule[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setPreviewRules(pending), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [pending]);

  /**
   * Two readers, deliberately different ones.
   *
   * EFFECTIVE decides whether a write would change anything, so re-applying an
   * unchanged rule set stays a no-op instead of rewriting 23k identical values.
   *
   * BASE — the parsed file — decides the write MODE. Judged against the
   * effective state, `add` ("only where empty") sees the rule's own earlier
   * output and refuses, so editing an applied rule planned nothing at all and
   * Apply went dead. `add` protects what came with the model; it must not
   * freeze a rule after its first run.
   */
  const plan = useCallback(
    (rules: readonly AttributeRule[], stats?: Map<string, RulePlanStat>) =>
      (store && rules.length > 0
        ? planWrites(rules, readers.effective.read, readers.effective.readByName, universe, readers.read, stats)
        : []),
    [store, readers, universe],
  );

  /**
   * The preview, computed a rule at a time between frames.
   *
   * It used to be a memo around `planWrites`. With the 339 rules imported from
   * RIBiTWO over 84,298 objects that is 10.2 s in one synchronous piece, and
   * Chrome put up "this page is not responding" — with the dialog open and
   * nothing to click.
   *
   * `requestAnimationFrame` rather than `requestIdleCallback`: the dialog is
   * open and being used, so this must not wait for a thread that never goes
   * idle. A budget per frame keeps it from becoming the same block in slow
   * motion, and the whole run is abandoned the moment the rules change.
   */
  const [writes, setWrites] = useState<RuleWrite[]>([]);
  useEffect(() => {
    // `open` because this component stays mounted when the dialog is closed —
    // without it the preview would keep running in the background, for a
    // number nobody is looking at.
    if (!open || !store || previewRules.length === 0) { setWrites([]); return; }
    const steps = planWritesStepwise(
      previewRules,
      readers.effective.read,
      readers.effective.readByName,
      universe,
      readers.read,
    );
    let handle = 0;
    let cancelled = false;
    const pump = () => {
      if (cancelled) return;
      const until = performance.now() + PREVIEW_FRAME_BUDGET_MS;
      let step = steps.next();
      while (!step.done && performance.now() < until) step = steps.next();
      if (step.done) { setWrites(step.value); return; }
      handle = requestAnimationFrame(pump);
    };
    handle = requestAnimationFrame(pump);
    return () => { cancelled = true; cancelAnimationFrame(handle); };
  }, [open, store, previewRules, readers, universe]);

  const activeRuleCount = pending.filter((r) => r.enabled).length;

  /**
   * Objects this session actually wrote at each attribute address. Rolling a
   * rule back means putting these back, and the mutation history is the only
   * exact record of them — a rule that resolves its own objects carries no id
   * list to consult.
   */
  const writtenAt = useMemo(() => {
    const idx = new Map<string, number[]>();
    const view = modelId ? getMutationView(modelId) : null;
    if (!view) return idx;
    for (const m of view.getMutations()) {
      if (!m.psetName || !m.propName) continue;
      const key = refKeyOf({ psetName: m.psetName, propName: m.propName });
      let ids = idx.get(key);
      if (!ids) { ids = []; idx.set(key, ids); }
      if (!ids.includes(m.entityId)) ids.push(m.entityId);
    }
    return idx;
  }, [modelId, getMutationView, open, rules]);

  /** The objects a rollback would touch. Deleting every rule leaves no writes
   *  at all, so Apply must stay reachable on this count alone. */
  const rollbackTargets = useMemo(() => {
    if (!open || !projectKey) return [] as Array<{ entityId: number; psetName: string; propName: string }>;
    const out: Array<{ entityId: number; psetName: string; propName: string }> = [];
    for (const ref of staleTargetRefs(loadApplied(projectKey), pending)) {
      for (const entityId of writtenAt.get(refKeyOf(ref)) ?? []) out.push({ entityId, ...ref });
    }
    return out;
  }, [open, projectKey, pending, writtenAt]);
  const rollbackCount = rollbackTargets.length;

  /**
   * Write every enabled rule and KEEP the rules: they stay in the table,
   * marked with what they just wrote, and are saved for the project. The
   * writes take effect immediately — `setProperty` goes through the model's
   * mutation view, so the Properties panel and the IFC export see them at
   * once, and each one lands on the undo stack.
   *
   * Rules are planned one at a time so each can report its own write count.
   */
  const apply = useCallback(async () => {
    if (!modelId || !store || (writes.length === 0 && rollbackCount === 0)) return;
    setApplying(true);
    // Close the assistant right away: the run reports its own progress, and
    // watching a frozen dialog says nothing about how far it has got.
    onOpenChange(false);
    try {
      // `setProperty` needs a mutation view registered for the model; create
      // one lazily the same way the zone write-back does.
      if (!getMutationView(modelId)) {
        const view = new MutablePropertyView(store.properties || null, modelId);
        configureMutationView(view, store);
        registerMutationView(modelId, view);
      }
      const now = Date.now();
      const counts = new Map<string, number>();
      let ok = 0;

      // Roll back first: anything the previous apply wrote that no rule asks
      // for any more (its rule was deleted or switched off) is restored to the
      // model's base state — the value the parsed file carries, or removed
      // entirely when the file never had it. Without this a rule's attribute
      // would survive its own rule and stay in the property panel and the
      // object filter forever.
      let reverted = 0;
      const stale = rollbackTargets;
      // Per-rule counters for the run, printed once when it is done. A rule
      // that writes nothing is the hard thing to diagnose from the table
      // alone: the count there is only the writes, so "0" reads the same
      // whether the condition matched nobody or matched everybody and the
      // source was empty. `matched` separates the two.
      const stats = new Map<string, RulePlanStat>();
      const liveWrites = plan(pending, stats);
      const total = stale.length + liveWrites.length;
      let done = 0;
      // Yield to the browser every so often, otherwise a 20k-write run blocks
      // the main thread and the progress bar never paints a single frame.
      const tick = async (label: string) => {
        onProgress?.({ done, total, label });
        await new Promise((r) => setTimeout(r, 0));
      };
      await tick('Rolling back removed rules…');

      /** Send one bundle to the store and count what landed. */
      const flush = async (batch: PropertyEdit[], label: string) => {
        if (batch.length === 0) return [];
        const results = applyPropertyEdits(modelId, batch);
        batch.length = 0;
        await tick(label);
        return results;
      };

      const rollbackBatch: PropertyEdit[] = [];
      for (const t of stale) {
        // `readers.read` goes through the parsed store, never the overlay, so
        // it answers with the pre-rule value even after the rule wrote.
        const base = readers.read(t.entityId, t.psetName, t.propName);
        const now = readers.effective.read(t.entityId, t.psetName, t.propName);
        done += 1;
        // Already back at its base state — nothing to undo here.
        if (now !== base) {
          rollbackBatch.push(base === null
            ? { op: 'delete', entityId: t.entityId, psetName: t.psetName, propName: t.propName }
            : { op: 'set', entityId: t.entityId, psetName: t.psetName, propName: t.propName, value: base, valueType: PropertyValueType.Label });
        }
        if (rollbackBatch.length >= PROGRESS_CHUNK) {
          for (const r of await flush(rollbackBatch, 'Rolling back removed rules…')) if (r) reverted += 1;
        }
      }
      for (const r of await flush(rollbackBatch, 'Rolling back removed rules…')) if (r) reverted += 1;
      // ONE plan for all rules: a rule must see what the earlier ones wrote
      // (`5D_Typ` is produced by one rule and matched by dozens after it), so
      // planning per rule to count them would silently break every chain.
      // Each write carries its rule id instead.
      for (const r of pending) if (r.enabled) counts.set(r.id, 0);
      await tick('Applying rules…');
      /**
       * Written object by object, not rule by rule.
       *
       * The plan is built rule-major because rules chain, but APPLYING it in
       * that order means the ~9 writes an object receives arrive spread across
       * the whole run, and `MutablePropertyView` re-reads that object's base
       * property sets out of the source for every one of them — twice per
       * write. Grouped by entity, its one-entry cache answers all of them.
       *
       * The sort must stay stable, and `Array.prototype.sort` is: two writes to
       * the SAME attribute keep the order the rules gave them, so a later rule
       * still wins over an earlier one.
       */
      const ordered = [...liveWrites].sort((a, b) => a.entityId - b.entityId);
      // Bundled, and the rule ids kept alongside so each write is still
      // attributed to the rule that produced it.
      const batch: PropertyEdit[] = [];
      const batchRules: string[] = [];
      const settle = async () => {
        if (batch.length === 0) return;
        const results = applyPropertyEdits(modelId, batch);
        for (let i = 0; i < results.length; i++) {
          if (!results[i]) continue;
          counts.set(batchRules[i], (counts.get(batchRules[i]) ?? 0) + 1);
          ok += 1;
        }
        batch.length = 0;
        batchRules.length = 0;
        await tick('Applying rules…');
      };
      for (const w of ordered) {
        batch.push(w.op === 'set'
          ? { op: 'set', entityId: w.entityId, psetName: w.psetName, propName: w.propName, value: w.value ?? '', valueType: w.valueType ?? PropertyValueType.Label }
          : { op: 'delete', entityId: w.entityId, psetName: w.psetName, propName: w.propName });
        batchRules.push(w.ruleId);
        done += 1;
        if (batch.length >= PROGRESS_CHUNK) await settle();
      }
      await settle();
      onProgress?.({ done: total, total, label: 'Applying rules…' });
      if (ok === 0 && reverted === 0) {
        toast.error('No attribute could be written (the model may be read-only in this session).');
        return;
      }
      // Stamp each rule with what it just wrote. The unsaved draft, if it ran,
      // joins the table under a real id so nothing applied is left unrecorded.
      const stamp = (r: AttributeRule, countKey: string, id = r.id): AttributeRule =>
        counts.has(countKey) ? { ...r, id, appliedAt: now, appliedWrites: counts.get(countKey)! } : r;
      const draftRule = pending.find((r) => r.id === 'draft');
      const next = [
        ...rules.map((r) => stamp(r, r.id)),
        ...(draftRule ? [stamp(draftRule, 'draft', `${now}-applied`)] : []),
      ];
      commit(next);
      // Remember what is now in the model, so the NEXT apply can roll back
      // whatever gets deleted or switched off in the meantime.
      saveApplied(projectKey, next.filter((r) => r.enabled));
      if (draftRule) patch({ propName: '', value: '', template: '', sourceKey: '', sourceFilter: '', newName: '', deleteKeys: [] });
      console.table(pending.map((r, i) => {
        const st = stats.get(r.id) ?? { matched: 0, wrote: 0, sourceMissing: 0, unchanged: 0 };
        return {
          '#': i + 1,
          Aktion: ACTION_LABELS[r.action.kind],
          Bedingung: r.match ? describeConditions(r.match) : `${r.entityIds.length} objects from the filter`,
          getroffen: st.matched,
          ohneQuelle: st.sourceMissing,
          unveraendert: st.unchanged,
          geschrieben: st.wrote,
        };
      }));
      const undone = reverted > 0 ? `, ${reverted.toLocaleString()} rolled back` : '';
      toast.success(`Applied ${activeRuleCount} rule(s): ${ok.toLocaleString()} attribute write(s)${undone}.`);
    } finally {
      setApplying(false);
      onProgress?.(null);
    }
  }, [modelId, store, writes, rollbackCount, projectKey, pending, rules, readers, activeRuleCount, getMutationView, registerMutationView, applyPropertyEdits, commit, patch, onOpenChange, onProgress, rollbackTargets, plan]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideCloseButton className="flex h-[86vh] max-w-5xl flex-col gap-0 p-0">
        <DialogTitle className="sr-only">Attribute rules</DialogTitle>
        <DialogDescription className="sr-only">
          Write attributes onto the objects the object filter matched.
        </DialogDescription>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex min-h-0 flex-1 flex-col">
          {/* Header: pill tabs left, close right — same shape as Search/Filter. */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <TabsList>
              <TabsTrigger value="rules">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Rules
              </TabsTrigger>
              <TabsTrigger value="table">
                <Table2 className="mr-1.5 h-3.5 w-3.5" />
                Rules table
                {rules.length > 0 && <Badge variant="secondary" className="ml-1.5">{rules.length}</Badge>}
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void importXml(f);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                title="Import a RIBiTWO mapping file (<transform>/<map>)"
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import XML
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onOpenChange(false)}
                aria-label="Close attribute rules"
                className="text-muted-foreground hover:text-foreground"
              >
                <X />
              </Button>
            </div>
          </div>

          {/* ── Tab 1: build a rule ── */}
          <TabsContent value="rules" className="mt-0 flex min-h-0 flex-1 flex-col">
            {/* Action picker */}
            <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    kind === k
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {ACTION_LABELS[k]}
                </button>
              ))}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] overflow-hidden">
              {/* Bedingung — scope + the attributes that make up the condition */}
              <section className="flex min-h-0 flex-col border-r">
                <header className="flex items-center justify-between border-b px-4 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Condition</span>
                  <Badge variant={scopeCount > 0 ? 'default' : 'secondary'}>
                    {scopeCount.toLocaleString()} objects
                  </Badge>
                </header>

                {/* RIBiTWO's "Alle Objekte" split button: which objects a rule starts from. */}
                <div className="border-b px-4 py-2">
                  <Select value={scope} onValueChange={(v) => setScope(v as RuleScope)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All objects</SelectItem>
                      <SelectItem value="filter" disabled={conditions.length === 0}>From the current filter</SelectItem>
                      <SelectItem value="selection" disabled={selectedIds.length === 0}>Selected objects</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {scope === 'all' && (
                    <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                      No condition — the rule writes to every object in the model.
                    </p>
                  )}

                  {scope === 'selection' && (
                    <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                      The rule writes to the {selectedIds.length.toLocaleString()} object(s) selected in 3D.
                      Tick an attribute below to narrow it further.
                    </p>
                  )}

                  {scope === 'filter' && conditions.length === 0 && (
                    <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                      No filter is active. Set a value in the object filter first.
                    </p>
                  )}

                  {candidateConditions.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {candidateConditions.map((c) => {
                        const on = checkedConditions.has(c.label);
                        return (
                          <div key={c.label} className={cn(
                            'flex items-center gap-2 rounded-md border px-2 py-1.5',
                            on ? 'border-primary/40 bg-accent/40' : 'border-border',
                          )}>
                            <Checkbox
                              checked={on}
                              onCheckedChange={() => toggleCondition(c.label)}
                              aria-label={`Use ${c.label} as a condition`}
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={c.label}>{c.label}</span>
                            <div className="w-[45%] shrink-0">
                              <ComboInput
                                value={conditionValues[c.label] ?? c.value}
                                onChange={(v) => setConditionValue(c.label, v)}
                                options={valuesFor(c.label)}
                                placeholder="*"
                                className="h-7 text-[11px]"
                                maxRendered={500}
                                aria-label={`Value for ${c.label}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* RIBiTWO's hint under the pane: what an object must carry. */}
                  <p className="mt-3 rounded-md bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
                    <span className="font-medium">An object matches when:</span>{' '}
                    <span className="font-mono">{describeConditions(activeMatch)}</span>
                  </p>
                  {scope === 'filter' && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Values come from the object filter — edit them here to refine the rule, or use <code>*</code> for every value of that attribute.
                    </p>
                  )}
                </div>
              </section>

              {/* Aktion */}
              <section className="flex min-h-0 flex-col">
                <header className="border-b px-4 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Action — {ACTION_LABELS[kind]}
                  </span>
                </header>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  <ActionEditor
                    kind={kind}
                    form={form}
                    patch={patch}
                    propertyRefs={propertyRefs}
                    psetNames={psetNames}
                    attributeNames={attributeNames}
                  />
                </div>
                <div className="border-t px-4 py-2.5">
                  <Button type="button" variant="secondary" size="sm" onClick={collect} disabled={!draft} className="w-full">
                    <ListPlus className="mr-1.5 h-3.5 w-3.5" />
                    Add to table
                  </Button>
                </div>
              </section>
            </div>
          </TabsContent>

          {/* ── Tab 2: the collected rules ── */}
          <TabsContent value="table" className="mt-0 flex min-h-0 flex-1 flex-col">
            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
              <RulesTable rules={rules} onToggle={toggleRule} onMove={moveRule} onRemove={removeRule} onRemoveMany={removeRules} onEdit={editRule} />
            </div>
          </TabsContent>
        </Tabs>

        {/* Footer — shared by both tabs */}
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              {writes.length > 0 || rollbackCount > 0
                ? [
                    writes.length > 0 ? `${activeRuleCount} rule(s) · ${writes.length.toLocaleString()} attribute write(s)` : null,
                    rollbackCount > 0 ? `${rollbackCount.toLocaleString()} to roll back` : null,
                  ].filter(Boolean).join(' · ')
                : 'Nothing to apply yet'}
            </span>
            {rules.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {persisted ? (
                  <><Check className="h-3 w-3 text-primary" /> Saved with the project</>
                ) : (
                  <span className="text-red-500">Rules could not be saved in full — see the console</span>
                )}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button type="button" onClick={() => { void apply(); }} disabled={(writes.length === 0 && rollbackCount === 0) || applying}>
              {applying ? 'Applying…' : 'Apply now'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
