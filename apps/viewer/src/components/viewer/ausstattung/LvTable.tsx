/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The LV / TLK table. Deliberately a SEPARATE, FLAT table: an LV position is
 * a commercial item that exists on its own, while an Ausstattung row is a
 * measurement rule. They are joined by the TL path (`TLK: 1 - LV: 410`), and
 * one position can be fed by many Ausstattung rows — which is exactly why it
 * must not be a column inside the other table.
 *
 * The Menge column is therefore a SUM over every Ausstattung row pointing
 * here, and a position that no row feeds is shown as such rather than as a
 * quiet zero.
 */

import { useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { LvPosition } from '@/lib/ausstattung/model';
import { lvRollupKey, type LvRollup } from '@/lib/ausstattung/evaluate';

interface Props {
  positionen: readonly LvPosition[];
  rollups: ReadonlyMap<string, LvRollup>;
  onEdit: (tlk: string, lv: string, patch: Partial<LvPosition>) => void;
  onRemove: (tlk: string, lv: string) => void;
  onAdd: () => void;
}

export const lvKey = lvRollupKey;

function EditableCell({
  value, onCommit, mono = false, placeholder,
}: { value: string; onCommit: (text: string) => void; mono?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  if (!editing && draft !== value) setDraft(value);

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => { setEditing(false); if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(value);
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        'w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs',
        'hover:border-border focus:border-ring focus:bg-background focus:outline-none',
        mono && 'font-mono',
      )}
    />
  );
}

export function LvTable({ positionen, rollups, onEdit, onRemove, onAdd }: Props) {
  if (positionen.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">Noch keine LV-Positionen.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Eine Position anlegen und in der Ausstattung über TLK und LV darauf verweisen.
        </p>
        <Button variant="outline" size="sm" onClick={onAdd} className="mt-4">
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Position anlegen
        </Button>
      </div>
    );
  }

  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[5rem]">TLK</TableHead>
          <TableHead className="w-[6rem]">LV</TableHead>
          <TableHead>Bezeichnung</TableHead>
          <TableHead className="w-[4rem]">Einheit</TableHead>
          <TableHead className="w-[8rem] text-right">Menge</TableHead>
          <TableHead className="w-[9rem]">Speisende Zeilen</TableHead>
          <TableHead className="w-[3rem]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {positionen.map((p) => {
          const roll = rollups.get(lvKey(p.tlk, p.lv));
          const feeding = roll?.feedingRows ?? 0;
          return (
            <TableRow key={lvKey(p.tlk, p.lv)} className="align-top">
              <TableCell className="font-mono">
                <EditableCell mono value={p.tlk} onCommit={(v) => onEdit(p.tlk, p.lv, { tlk: v.trim() })} />
              </TableCell>
              <TableCell className="font-mono">
                <EditableCell mono value={p.lv} onCommit={(v) => onEdit(p.tlk, p.lv, { lv: v.trim() })} />
              </TableCell>
              <TableCell>
                <EditableCell value={p.bezeichnung} onCommit={(v) => onEdit(p.tlk, p.lv, { bezeichnung: v })} />
              </TableCell>
              <TableCell>
                <EditableCell value={p.einheit} onCommit={(v) => onEdit(p.tlk, p.lv, { einheit: v })} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {roll?.value === null || roll === undefined ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground underline decoration-dotted">—</span>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      {feeding === 0
                        ? 'Keine Ausstattungszeile verweist auf diese Position.'
                        : `${roll?.openRows ?? 0} von ${feeding} Zeilen liefern noch keine Menge — eine Teilsumme waere zu niedrig.`}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  roll.value.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
                )}
              </TableCell>
              <TableCell>
                {feeding === 0 ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
                    ohne Zuordnung
                  </Badge>
                ) : (
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-muted-foreground">
                      {feeding}
                      {roll && roll.openRows > 0 ? ` (${roll.openRows} offen)` : ''}
                    </span>
                    {roll && roll.overlapping > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="destructive" className="cursor-default gap-1 px-1.5 py-0 text-[10px]">
                            <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                            {roll.overlapping.toLocaleString('de-DE')} doppelt
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs">
                          {roll.overlapping.toLocaleString('de-DE')} Objekt(e) werden von mehreren
                          Zeilen in diese Position gemessen — die Summe ist um diesen Anteil zu hoch.
                          Betroffen: {roll.overlapRows.join(', ')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Position entfernen"
                        onClick={() => onRemove(p.tlk, p.lv)}
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Position entfernen</TooltipContent>
                  </Tooltip>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
