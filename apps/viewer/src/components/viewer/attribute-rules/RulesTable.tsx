/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * RulesTable — the "Tabelle Regeln" tab: RIBiTWO's *Attributregeln* grid.
 *
 * Each rule is a numbered group followed by its condition rows (*Ein*) and its
 * output rows (*Aus*) — the shape of RIBiTWO's `<map>/<in>/<out>` XML. Group
 * rows carry the per-rule controls: enable/disable, reorder, delete.
 */

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  ACTION_LABELS, DATA_TYPE_LABELS, MODE_SHORT, ruleTableRows,
  type AttributeRule, type RuleEditField, type RuleTableRow,
} from '@/lib/attribute-rules';

/** The words the Type and Mode cells accept, in the table's own wording. */
const DATA_TYPE_CHOICES = Object.values(DATA_TYPE_LABELS);
const MODE_CHOICES = Object.values(MODE_SHORT);

interface Props {
  rules: AttributeRule[];
  onToggle: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  /** Commit an in-place cell edit. */
  onEdit: (row: RuleTableRow, field: RuleEditField, text: string) => void;
}

/**
 * A cell you can type in. Kept uncontrolled between focus and blur so typing
 * never re-plans the whole rule set on every keystroke — the value is committed
 * on blur or Enter, and Escape restores what was there.
 */
function EditableCell({
  value, onCommit, mono = true, placeholder,
}: { value: string; onCommit: (text: string) => void; mono?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => { setEditing(false); if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setEditing(false); e.currentTarget.blur(); }
      }}
      className={cn(
        'w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs',
        'hover:border-border focus:border-ring focus:bg-background focus:outline-none',
        mono && 'font-mono',
      )}
    />
  );
}

/** Same, but for the fields that only accept a fixed set of words. */
function EditableChoice({
  value, options, onCommit,
}: { value: string; options: readonly string[]; onCommit: (text: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      className="w-full min-w-0 cursor-pointer rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-ring focus:outline-none"
    >
      {!options.includes(value) && <option value={value}>{value}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function RulesTable({ rules, onToggle, onMove, onRemove, onEdit }: Props) {
  if (rules.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">No rules yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Build one on the <em>Rules</em> tab and press <em>Add to table</em>.
        </p>
      </div>
    );
  }

  const rows = ruleTableRows(rules);
  const byId = new Map(rules.map((r, i) => [r.id, { rule: r, index: i }]));

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead className="w-20">In/Out</TableHead>
          <TableHead>Attribute / query</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="w-24">Type</TableHead>
          <TableHead>Value</TableHead>
          <TableHead className="w-16">Unit</TableHead>
          <TableHead className="w-32">Mode</TableHead>
          <TableHead className="w-28 text-right">Rule</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => {
          const entry = byId.get(row.ruleId);
          if (row.kind === 'group') {
            const disabled = entry?.rule.enabled === false;
            const idx = entry?.index ?? 0;
            return (
              <TableRow key={`g-${row.ruleId}`} className="bg-muted/40 hover:bg-muted/40">
                <TableCell className="font-semibold">{row.number}</TableCell>
                <TableCell colSpan={6}>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={!disabled}
                      onCheckedChange={() => onToggle(row.ruleId)}
                      aria-label={`Rule ${row.number} enabled`}
                    />
                    <Badge variant="secondary">{entry ? ACTION_LABELS[entry.rule.action.kind] : ''}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {/* An imported mapping has no id snapshot: it selects its
                          objects from its own conditions when it runs. */}
                      {entry && entry.rule.entityIds.length === 0 && entry.rule.match
                        ? (entry.rule.match.length > 0 ? 'by condition' : 'all objects')
                        : `${entry?.rule.entityIds.length.toLocaleString()} objects`}
                    </span>
                    {disabled && <span className="text-xs text-muted-foreground">· off</span>}
                    {entry?.rule.appliedAt !== undefined && (
                      <span className="flex items-center gap-1 text-xs text-primary" title={new Date(entry.rule.appliedAt).toLocaleString()}>
                        <Check className="h-3 w-3" />
                        applied · {(entry.rule.appliedWrites ?? 0).toLocaleString()} writes
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.source}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => onMove(row.ruleId, -1)} disabled={idx === 0} aria-label="Move rule up">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => onMove(row.ruleId, 1)} disabled={idx === rules.length - 1} aria-label="Move rule down">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => onRemove(row.ruleId)} aria-label="Delete rule" className="text-red-500 hover:bg-red-500/10 hover:text-red-400">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          }
          const off = entry?.rule.enabled === false;
          const can = (f: RuleEditField) => row.editable?.includes(f) ?? false;
          /** An editable cell, or plain text when the field does not apply. */
          const cell = (f: RuleEditField, text: string, opts?: { mono?: boolean; muted?: boolean; placeholder?: string }) => (
            <TableCell className={cn('text-xs', opts?.mono !== false && 'font-mono', opts?.muted && 'text-muted-foreground')}>
              {can(f)
                ? <EditableCell value={text} mono={opts?.mono !== false} placeholder={opts?.placeholder} onCommit={(v) => onEdit(row, f, v)} />
                : text}
            </TableCell>
          );
          const choice = (f: RuleEditField, text: string, options: readonly string[]) => (
            <TableCell className="text-xs text-muted-foreground">
              {can(f) ? <EditableChoice value={text} options={options} onCommit={(v) => onEdit(row, f, v)} /> : text}
            </TableCell>
          );

          return (
            <TableRow key={`${row.kind}-${row.ruleId}-${i}`} className={cn(off && 'opacity-45')}>
              <TableCell />
              <TableCell>
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium',
                  row.direction === 'Ein' ? 'bg-primary/10 text-primary' : 'bg-accent text-accent-foreground',
                )}>
                  {row.direction === 'Ein' ? 'In' : 'Out'}
                </span>
              </TableCell>
              {cell('attribute', row.attribute ?? '', { placeholder: 'Pset\\Property' })}
              {cell('name', row.name ?? '')}
              {choice('type', row.type ?? '', DATA_TYPE_CHOICES)}
              {cell('value', row.value ?? '')}
              {cell('unit', row.unit ?? '', { mono: false, muted: true, placeholder: '—' })}
              {choice('mode', row.mode ?? '', MODE_CHOICES)}
              <TableCell />
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
