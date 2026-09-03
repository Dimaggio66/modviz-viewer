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
import { PropertyValueType } from '@ifc-lite/data';
import { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { configureMutationView } from '@/utils/configureMutationView';
import { useViewerStore } from '@/store';
import {
  ACTION_LABELS, applyRuleEdit, planWrites, staleTargets,
  type AttributeRule, type PropRef, type RuleAction, type RuleConditionSnapshot,
  type RuleEditField, type RuleTableRow,
} from '@/lib/attribute-rules';
import { loadApplied, loadRules, saveApplied, saveRules } from '@/lib/attribute-rules-store';
import { importMappingXml } from '@/lib/attribute-rules-xml';
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
}

/** Writes per yield to the event loop while applying. Large enough that the
 *  run stays fast, small enough that the bar moves smoothly. */
const PROGRESS_CHUNK = 400;

const KINDS: ActionKind[] = ['add', 'compose', 'copy', 'rename', 'delete'];

export function AttributeRulesDialog({
  open, onOpenChange, conditions, entityIds, modelId, store, propertyRefs, projectKey,
  universe, readIfcParam, onProgress,
}: AttributeRulesDialogProps) {
  const { setProperty, deleteProperty, getMutationView, registerMutationView } = useViewerStore(
    useShallow((s) => ({
      setProperty: s.setProperty,
      deleteProperty: s.deleteProperty,
      getMutationView: s.getMutationView,
      registerMutationView: s.registerMutationView,
    })),
  );

  const [tab, setTab] = useState<'rules' | 'table'>('rules');
  const [kind, setKind] = useState<ActionKind>('add');
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
    }
  }, [kind, form, refByKey]);

  const collect = () => {
    if (!draft) return;
    commit([
      ...rules,
      { id: `${Date.now()}-${rules.length}`, conditions, entityIds, action: draft, enabled: true },
    ]);
    // Empty the fields that identify THIS rule, so the draft stops being a
    // valid action — otherwise the rule just collected would also still be
    // pending and every write would be planned twice. Property set, type,
    // unit and mode stay, since the next rule usually shares them.
    patch({ propName: '', value: '', template: '', sourceKey: '', newName: '', deleteKeys: [] });
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
    () => (draft ? [...rules, { id: 'draft', conditions, entityIds, action: draft, enabled: true }] : rules),
    [rules, draft, conditions, entityIds],
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
  const readers = useMemo(() => {
    type Sets = Array<{ name: string; properties?: Array<{ name: string; value: unknown }> }>;
    const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));

    /** Build a (pset, prop) and a by-name reader over a source of sets. */
    const readersOver = (setsOf: (id: number) => Sets) => {
      const read = (entityId: number, pset: string, prop: string): string | null => {
        for (const set of setsOf(entityId)) {
          if (set.name !== pset) continue;
          for (const p of set.properties ?? []) if (p.name === prop) return str(p.value);
        }
        return null;
      };
      const readByName = (entityId: number, prop: string): string | null => {
        for (const set of setsOf(entityId)) {
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
    const baseSets = (entityId: number) => {
      let sets = baseCache.get(entityId);
      if (!sets) {
        const table = store?.properties;
        sets = (table && table.count !== 0 ? table.getForEntity?.(entityId) : undefined)
          ?? store?.getProperties?.(entityId)
          ?? [];
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
      if (!sets) { sets = (view.getForEntity(entityId) as Sets) ?? baseSets(entityId); effCache.set(entityId, sets); }
      return sets;
    };

    const base = readersOver(baseSets);
    const effective = readersOver(effSets);
    return { read: base.read, readByName: base.readByName, effective };
    // `open` is a dependency so each time the dialog opens it starts from
    // fresh values rather than a cache filled before the last apply.
  }, [store, open, readIfcParam, modelId, getMutationView]);

  const writes = useMemo(
    () => (store && pending.length > 0 ? planWrites(pending, readers.effective.read, readers.effective.readByName, universe) : []),
    [store, pending, readers, universe],
  );

  const activeRuleCount = pending.filter((r) => r.enabled).length;

  /** Addresses the last apply left behind that no rule wants any more — the
   *  work an apply has to undo. Deleting every rule leaves no writes at all,
   *  so Apply must stay reachable on this count alone. */
  const rollbackCount = useMemo(
    () => (open && projectKey ? staleTargets(loadApplied(projectKey), pending).length : 0),
    [open, projectKey, pending],
  );

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
      const stale = staleTargets(loadApplied(projectKey), pending);
      const total = stale.length + writes.length;
      let done = 0;
      // Yield to the browser every so often, otherwise a 20k-write run blocks
      // the main thread and the progress bar never paints a single frame.
      const tick = async (label: string) => {
        onProgress?.({ done, total, label });
        await new Promise((r) => setTimeout(r, 0));
      };
      await tick('Rolling back removed rules…');

      for (const t of stale) {
        // `readers.read` goes through the parsed store, never the overlay, so
        // it answers with the pre-rule value even after the rule wrote.
        const base = readers.read(t.entityId, t.psetName, t.propName);
        const now = readers.effective.read(t.entityId, t.psetName, t.propName);
        done += 1;
        if (done % PROGRESS_CHUNK === 0) await tick('Rolling back removed rules…');
        // Already back at its base state — nothing to undo here.
        if (now === base) continue;
        const result = base === null
          ? deleteProperty(modelId, t.entityId, t.psetName, t.propName)
          : setProperty(modelId, t.entityId, t.psetName, t.propName, base, PropertyValueType.Label);
        if (result) reverted += 1;
      }
      // ONE plan for all rules: a rule must see what the earlier ones wrote
      // (`5D_Typ` is produced by one rule and matched by dozens after it), so
      // planning per rule to count them would silently break every chain.
      // Each write carries its rule id instead.
      for (const r of pending) if (r.enabled) counts.set(r.id, 0);
      await tick('Applying rules…');
      for (const w of writes) {
        const result = w.op === 'set'
          ? setProperty(modelId, w.entityId, w.psetName, w.propName, w.value ?? '', w.valueType ?? PropertyValueType.Label)
          : deleteProperty(modelId, w.entityId, w.psetName, w.propName);
        done += 1;
        if (done % PROGRESS_CHUNK === 0) await tick('Applying rules…');
        if (!result) continue;
        counts.set(w.ruleId, (counts.get(w.ruleId) ?? 0) + 1);
        ok += 1;
      }
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
      if (draftRule) patch({ propName: '', value: '', template: '', sourceKey: '', newName: '', deleteKeys: [] });
      const undone = reverted > 0 ? `, ${reverted.toLocaleString()} rolled back` : '';
      toast.success(`Applied ${activeRuleCount} rule(s): ${ok.toLocaleString()} attribute write(s)${undone}.`);
    } finally {
      setApplying(false);
      onProgress?.(null);
    }
  }, [modelId, store, writes, rollbackCount, projectKey, pending, rules, readers, activeRuleCount, getMutationView, registerMutationView, setProperty, deleteProperty, commit, patch, onOpenChange, onProgress]);

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

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] overflow-hidden">
              {/* Bedingung */}
              <section className="flex min-h-0 flex-col border-r">
                <header className="flex items-center justify-between border-b px-4 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Condition</span>
                  <Badge variant={conditions.length > 0 ? 'default' : 'secondary'}>
                    {entityIds.length.toLocaleString()} objects
                  </Badge>
                </header>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {conditions.length === 0 ? (
                    <div className="rounded-md border border-dashed px-3 py-4">
                      <p className="text-xs text-muted-foreground">
                        No filter is active — a rule would hit all {entityIds.length.toLocaleString()} objects.
                        Set a value in the object filter to narrow it down.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {conditions.map((c) => (
                        <div key={c.label} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                          <span className="truncate text-xs font-medium">{c.label}</span>
                          <span className="truncate font-mono text-[11px] text-muted-foreground">{c.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Taken from the object filter. Adjust it there to change which objects a rule hits.
                  </p>
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
              <RulesTable rules={rules} onToggle={toggleRule} onMove={moveRule} onRemove={removeRule} onEdit={editRule} />
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
                  <span className="text-red-500">Rules could not be saved (browser storage unavailable)</span>
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
