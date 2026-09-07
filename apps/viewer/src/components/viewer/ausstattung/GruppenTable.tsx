/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Auswahlgruppen catalogue — named object queries the Ausstattung rows
 * narrow themselves by, RIB's `Object(@5D_Kategorie == 'Rohre')` panel.
 *
 * The hit count is shown while the condition is being typed, because a
 * condition that selects nothing and a condition that selects everything look
 * identical in the formula and completely different in the price. A group
 * whose condition cannot be read says so here rather than only failing later
 * on every row that uses it.
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
import type { Auswahlgruppe } from '@/lib/ausstattung/model';
import type { GroupResult } from '@/lib/ausstattung/evaluate';

interface Props {
  gruppen: readonly Auswahlgruppe[];
  results: ReadonlyMap<string, GroupResult>;
  /** How many rows reference each group, so an unused one is visible. */
  usage: ReadonlyMap<string, number>;
  onEdit: (name: string, patch: Partial<Auswahlgruppe>) => void;
  onRemove: (name: string) => void;
  onAdd: () => void;
}

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

export function GruppenTable({ gruppen, results, usage, onEdit, onRemove, onAdd }: Props) {
  if (gruppen.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">Noch keine Auswahlgruppen.</p>
        <p className="mt-1 max-w-md mx-auto mt-2 text-xs text-muted-foreground">
          Eine Gruppe ist eine benannte Objektabfrage, z.&nbsp;B.{' '}
          <code className="font-mono">Attribut&#123;5D_Kategorie&#125; == &apos;Rohre&apos;</code>.
          Ausstattungszeilen schränken sich darüber ein — auch alle Unterzeilen (Schnittmenge).
        </p>
        <Button variant="outline" size="sm" onClick={onAdd} className="mt-4">
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Gruppe anlegen
        </Button>
      </div>
    );
  }

  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[12rem]">Name</TableHead>
          <TableHead>Bedingung</TableHead>
          <TableHead className="w-[7rem] text-right">Treffer</TableHead>
          <TableHead className="w-[8rem]">Verwendet in</TableHead>
          <TableHead className="w-[3rem]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {gruppen.map((g) => {
          const res = results.get(g.name);
          const used = usage.get(g.name) ?? 0;
          return (
            <TableRow key={g.name} className="align-top">
              <TableCell>
                <EditableCell value={g.name} onCommit={(v) => onEdit(g.name, { name: v.trim() })} />
              </TableCell>
              <TableCell>
                <EditableCell
                  mono
                  value={g.bedingung}
                  placeholder="Attribut{5D_Kategorie} == 'Rohre'"
                  onCommit={(v) => onEdit(g.name, { bedingung: v })}
                />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {res?.matched === null || res === undefined ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <TriangleAlert className="h-3 w-3" aria-hidden="true" />—
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left">{res?.problem ?? 'nicht ausgewertet'}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className={cn(res.matched === 0 && 'text-amber-500')}>
                    {res.matched.toLocaleString('de-DE')}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {used === 0 ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
                    keiner Zeile
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">{used} Zeile(n)</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Gruppe entfernen"
                        onClick={() => onRemove(g.name)}
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {used > 0 ? `${used} Zeile(n) verweisen darauf` : 'Gruppe entfernen'}
                    </TooltipContent>
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
