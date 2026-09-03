/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ActionEditor — the *Aktion* pane of the attribute-rules assistant.
 *
 * One form per action kind, mirroring RIBiTWO's field set: Datentyp, Einheit,
 * Attributname, Attributwert and the three-way Aktion (Hinzufügen /
 * Hinzufügen und überschreiben / Überschreiben). RIBiTWO opens a separate
 * "Attribut auswählen" dialog with a filter box behind each `…` button; a
 * `ComboInput` does the same job inline — it filters the model's real names as
 * you type and still accepts a name that doesn't exist yet.
 */

import { useMemo } from 'react';
import { Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { ComboInput } from '@/components/ui/combo-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DATA_TYPE_LABELS, UNITS, WRITE_MODE_LABELS, templateTokens,
  type DataType, type PropRef, type RuleAction, type WriteMode,
} from '@/lib/attribute-rules';

export type ActionKind = RuleAction['kind'];

/** Every field the five action forms need, flat so switching tabs keeps what
 *  you already typed ("Die aktuelle Festlegung der Aktion bleibt erhalten"). */
export interface ActionForm {
  psetName: string;
  propName: string;
  value: string;
  template: string;
  dataType: DataType;
  unit: string;
  mode: WriteMode;
  /** Source attribute for copy / rename (a `refKey`). */
  sourceKey: string;
  /** New name for rename — its own field, so it can't collide with `propName`. */
  newName: string;
  /** Attributes ticked for deletion (`refKey`s) and the list's filter box. */
  deleteKeys: string[];
  deleteFilter: string;
}

export const EMPTY_ACTION_FORM: ActionForm = {
  psetName: '', propName: '', value: '', template: '',
  dataType: 'text', unit: '', mode: 'addOverwrite',
  sourceKey: '', newName: '', deleteKeys: [], deleteFilter: '',
};

/** PropRef -> one Select/checkbox value. JSON-encoded rather than joined on a
 *  separator because a set or property name may contain any character. */
export const refKey = (r: PropRef) => JSON.stringify([r.psetName, r.propName]);
export const refLabel = (r: PropRef) => `${r.psetName} · ${r.propName}`;

interface Props {
  kind: ActionKind;
  form: ActionForm;
  patch: (p: Partial<ActionForm>) => void;
  propertyRefs: readonly PropRef[];
  psetNames: readonly string[];
  attributeNames: readonly string[];
}

export function ActionEditor({ kind, form, patch, propertyRefs, psetNames, attributeNames }: Props) {
  const filteredRefs = useMemo(() => {
    const q = form.deleteFilter.trim().toLowerCase();
    if (!q) return propertyRefs;
    return propertyRefs.filter((r) => refLabel(r).toLowerCase().includes(q));
  }, [propertyRefs, form.deleteFilter]);

  const field = (label: string, node: React.ReactNode, hint?: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {node}
      {hint}
    </div>
  );

  const targetFields = (
    <div className="grid grid-cols-2 gap-3">
      {field('Property set', (
        <ComboInput
          value={form.psetName}
          onChange={(v) => patch({ psetName: v })}
          options={psetNames as string[]}
          placeholder="Pset_Custom"
          className="h-8 text-xs"
          maxRendered={500}
          aria-label="Property set"
        />
      ))}
      {field('Attribute name', (
        <ComboInput
          value={form.propName}
          onChange={(v) => patch({ propName: v })}
          options={attributeNames as string[]}
          placeholder="Status"
          className="h-8 text-xs"
          maxRendered={500}
          aria-label="Attribute name"
        />
      ))}
    </div>
  );

  const typeAndUnit = (
    <div className="grid grid-cols-2 gap-3">
      {field('Data type', (
        <Select value={form.dataType} onValueChange={(v) => patch({ dataType: v as DataType })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(DATA_TYPE_LABELS) as DataType[]).map((d) => (
              <SelectItem key={d} value={d}>{DATA_TYPE_LABELS[d]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {field('Unit', (
        <Select value={form.unit || '-'} onValueChange={(v) => patch({ unit: v === '-' ? '' : v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {UNITS.map((u) => <SelectItem key={u || '-'} value={u || '-'}>{u || '—'}</SelectItem>)}
          </SelectContent>
        </Select>
      ))}
    </div>
  );

  const modeField = field('Action', (
    <Select value={form.mode} onValueChange={(v) => patch({ mode: v as WriteMode })}>
      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        {(Object.keys(WRITE_MODE_LABELS) as WriteMode[]).map((m) => (
          <SelectItem key={m} value={m}>{WRITE_MODE_LABELS[m]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  ));

  const sourceField = (label: string) => field(label, (
    <Select value={form.sourceKey} onValueChange={(v) => patch({ sourceKey: v })}>
      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select an attribute…" /></SelectTrigger>
      <SelectContent className="max-h-72">
        {propertyRefs.map((r) => <SelectItem key={refKey(r)} value={refKey(r)}>{refLabel(r)}</SelectItem>)}
      </SelectContent>
    </Select>
  ));

  switch (kind) {
    case 'add':
      return (
        <div className="flex flex-col gap-3">
          {targetFields}
          {typeAndUnit}
          {field('Value', (
            <Input value={form.value} onChange={(e) => patch({ value: e.target.value })} placeholder="Final" className="h-8 text-xs" />
          ))}
          {modeField}
        </div>
      );

    case 'compose': {
      const tokens = templateTokens(form.template);
      return (
        <div className="flex flex-col gap-3">
          {targetFields}
          {typeAndUnit}
          {field('Value from existing attributes', (
            <Input
              value={form.template}
              onChange={(e) => patch({ template: e.target.value })}
              placeholder="PrjId@Attr{MyProjectId}"
              className="h-8 font-mono text-xs"
            />
          ), (
            <>
              <p className="text-[11px] text-muted-foreground">
                <code>@Attr{'{Name}'}</code> inserts that attribute&rsquo;s value; text outside the tokens is kept.
                Example: <code>PrjId@Attr{'{MyProjectId}'}</code> → <code>PrjId123</code>
              </p>
              {tokens.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {tokens.map((t) => (
                    <Badge key={t} variant={attributeNames.includes(t) ? 'secondary' : 'destructive'}>{t}</Badge>
                  ))}
                </div>
              )}
            </>
          ))}
          {modeField}
        </div>
      );
    }

    case 'copy':
      return (
        <div className="flex flex-col gap-3">
          {sourceField('Attribute to copy')}
          {targetFields}
          {modeField}
        </div>
      );

    case 'rename':
      return (
        <div className="flex flex-col gap-3">
          {sourceField('Existing attribute')}
          {field('New attribute name', (
            <ComboInput
              value={form.newName}
              onChange={(v) => patch({ newName: v })}
              options={attributeNames as string[]}
              placeholder="State"
              className="h-8 text-xs"
              maxRendered={500}
              aria-label="New attribute name"
            />
          ), (
            <p className="text-[11px] text-muted-foreground">
              Stays in the same property set: the value moves to the new name and the old one is removed.
            </p>
          ))}
        </div>
      );

    case 'delete': {
      const selected = new Set(form.deleteKeys);
      const toggle = (key: string) => patch({
        deleteKeys: selected.has(key) ? form.deleteKeys.filter((k) => k !== key) : [...form.deleteKeys, key],
      });
      return (
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Attributes to delete</Label>
            {selected.size > 0 && <Badge variant="secondary">{selected.size} selected</Badge>}
          </div>
          <Input
            value={form.deleteFilter}
            onChange={(e) => patch({ deleteFilter: e.target.value })}
            placeholder="Filter"
            leftIcon={<Search className="h-3.5 w-3.5" />}
            className="h-8 text-xs"
            aria-label="Filter attributes"
          />
          <div className="scrollbar-thin max-h-64 min-h-0 flex-1 overflow-y-auto rounded-md border">
            {filteredRefs.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">No attribute matches.</p>
            ) : filteredRefs.map((r) => {
              const key = refKey(r);
              const on = selected.has(key);
              return (
                <label
                  key={key}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0',
                    on ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                  )}
                >
                  <Checkbox checked={on} onCheckedChange={() => toggle(key)} aria-label={refLabel(r)} />
                  <span className="truncate">{refLabel(r)}</span>
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">Removed from every matched object that carries it.</p>
        </div>
      );
    }
  }
}
