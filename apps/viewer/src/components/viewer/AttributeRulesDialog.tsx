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
import { Check, ListPlus, Sparkles, Table2, X } from 'lucide-react';
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
  ACTION_LABELS, planWrites, staleTargets,
  type AttributeRule, type PropRef, type RuleAction, type RuleConditionSnapshot,
} from '@/lib/attribute-rules';
import { loadApplied, loadRules, saveApplied, saveRules } from '@/lib/attribute-rules-store';
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
}

const KINDS: ActionKind[] = ['add', 'compose', 'copy', 'rename', 'delete'];

export function AttributeRulesDialog({
  open, onOpenChange, conditions, entityIds, modelId, store, propertyRefs, projectKey,
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
    const cache = new Map<number, Array<{ name: string; properties?: Array<{ name: string; value: unknown }> }>>();
    const setsOf = (entityId: number) => {
      let sets = cache.get(entityId);
      if (!sets) {
        const table = store?.properties;
        sets = (table && table.count !== 0 ? table.getForEntity?.(entityId) : undefined)
          ?? store?.getProperties?.(entityId)
          ?? [];
        cache.set(entityId, sets);
      }
      return sets;
    };
    const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
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
      return null;
    };
    return { read, readByName };
    // `open` is a dependency so each time the dialog opens it starts from
    // fresh values rather than a cache filled before the last apply.
  }, [store, open]);

  const writes = useMemo(
    () => (store && pending.length > 0 ? planWrites(pending, readers.read, readers.readByName) : []),
    [store, pending, readers],
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
  const apply = useCallback(() => {
    if (!modelId || !store || (writes.length === 0 && rollbackCount === 0)) return;
    setApplying(true);
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
      for (const t of staleTargets(loadApplied(projectKey), pending)) {
        // `readers.read` goes through the parsed store, never the overlay, so
        // it answers with the pre-rule value even after the rule wrote.
        const base = readers.read(t.entityId, t.psetName, t.propName);
        const result = base === null
          ? deleteProperty(modelId, t.entityId, t.psetName, t.propName)
          : setProperty(modelId, t.entityId, t.psetName, t.propName, base, PropertyValueType.Label);
        if (result) reverted += 1;
      }
      for (const rule of pending) {
        if (!rule.enabled) continue;
        let ruleOk = 0;
        for (const w of planWrites([rule], readers.read, readers.readByName)) {
          const result = w.op === 'set'
            ? setProperty(modelId, w.entityId, w.psetName, w.propName, w.value ?? '', w.valueType ?? PropertyValueType.Label)
            : deleteProperty(modelId, w.entityId, w.psetName, w.propName);
          if (result) ruleOk += 1;
        }
        counts.set(rule.id, ruleOk);
        ok += ruleOk;
      }
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
    }
  }, [modelId, store, writes, pending, rules, readers, activeRuleCount, getMutationView, registerMutationView, setProperty, deleteProperty, commit, patch]);

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
              <RulesTable rules={rules} onToggle={toggleRule} onMove={moveRule} onRemove={removeRule} />
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
            <Button type="button" onClick={apply} disabled={(writes.length === 0 && rollbackCount === 0) || applying}>
              {applying ? 'Applying…' : 'Apply now'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
