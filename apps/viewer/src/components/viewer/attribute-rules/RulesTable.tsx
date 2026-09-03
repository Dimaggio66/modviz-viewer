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

import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ACTION_LABELS, ruleTableRows, type AttributeRule } from '@/lib/attribute-rules';

interface Props {
  rules: AttributeRule[];
  onToggle: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
}

export function RulesTable({ rules, onToggle, onMove, onRemove }: Props) {
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
                      {entry?.rule.entityIds.length.toLocaleString()} objects
                    </span>
                    {disabled && <span className="text-xs text-muted-foreground">· off</span>}
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
              <TableCell className="font-mono text-xs">{row.attribute ?? ''}</TableCell>
              <TableCell className="font-mono text-xs">{row.name ?? ''}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{row.type ?? ''}</TableCell>
              <TableCell className="font-mono text-xs">{row.value ?? ''}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{row.unit || ''}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{row.mode ?? ''}</TableCell>
              <TableCell />
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
