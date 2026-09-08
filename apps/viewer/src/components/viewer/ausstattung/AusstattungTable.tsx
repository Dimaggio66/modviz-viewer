/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Ausstattung table: the key hierarchy, each row's Mengenabfrage, and the
 * quantity it produces.
 *
 * The source table in iTWO separates its three row kinds by loud fills
 * (orange groups, yellow overviews, teal positions). Here the same three kinds
 * read from a tinted left edge and a badge, so the colour survives the dark
 * theme and does not fight the rest of the surface — the meaning is what
 * matters, not the exact hue.
 *
 * A quantity that could not be computed shows `—`, never `0`: the reason sits
 * in the tooltip. A zero here would be indistinguishable from a real measured
 * zero, and this table is meant to be priced.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  buildTree, formatTlPfad, rowKind,
  type AusstattungRow, type Auswahlgruppe, type RowKind,
} from '@/lib/ausstattung/model';
import type { RowResult } from '@/lib/ausstattung/evaluate';
import { referenceNumber } from '@/lib/ausstattung/import';

interface Props {
  rows: readonly AusstattungRow[];
  gruppen: readonly Auswahlgruppe[];
  results: ReadonlyMap<string, RowResult>;
  onEdit: (schluessel: string, patch: Partial<AusstattungRow>) => void;
  onRemove: (schluessel: string) => void;
  onAddChild: (parentKey: string) => void;
}

const KIND_LABEL: Record<RowKind, string> = {
  gruppe: 'Gruppe',
  uebersicht: 'Übersicht',
  position: 'Position',
};

/** Tinted left edge per kind — the quiet stand-in for the source's fills. */
const KIND_EDGE: Record<RowKind, string> = {
  gruppe: 'border-l-2 border-l-amber-500/70',
  uebersicht: 'border-l-2 border-l-yellow-400/50',
  position: 'border-l-2 border-l-teal-500/70',
};

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

function GroupPicker({
  value, gruppen, onCommit,
}: { value: string; gruppen: readonly Auswahlgruppe[]; onCommit: (name: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      className="w-full min-w-0 cursor-pointer rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-ring focus:outline-none"
    >
      <option value="">—</option>
      {value && !gruppen.some((g) => g.name === value) && <option value={value}>{value} (unbekannt)</option>}
      {gruppen.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
    </select>
  );
}

/**
 * Does our number agree with the one iTWO exported? Tolerant to the last
 * digit the export wrote, so a rounding difference is not reported as a
 * discrepancy — but anything larger is, because that is the point of having
 * imported the reference at all.
 */
function agrees(ours: number, reference: number): boolean {
  return Math.abs(ours - reference) <= Math.max(0.001, Math.abs(reference) * 1e-4);
}

/** The Menge cell: a number, or `—` with the reason behind it. */
function QuantityCell({ result, reference }: { result: RowResult | undefined; reference?: string }) {
  const ref = referenceNumber(reference);
  if (!result) return <span className="text-muted-foreground">—</span>;

  if (result.parseError) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-destructive">
            <TriangleAlert className="h-3 w-3" aria-hidden="true" />
            <span className="tabular-nums">—</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">Formel nicht lesbar: {result.parseError}</TooltipContent>
      </Tooltip>
    );
  }

  if (result.value === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="tabular-nums text-muted-foreground underline decoration-dotted">—</span>
        </TooltipTrigger>
        <TooltipContent side="left">
          Nicht gerechnet: {result.unsupported.join('; ') || 'keine Formel'}
        </TooltipContent>
      </Tooltip>
    );
  }

  const abweichung = ref !== null && !agrees(result.value, ref);
  const notes = [
    `${result.matched.toLocaleString('de-DE')} Objekte`,
    result.skipped > 0 ? `${result.skipped.toLocaleString('de-DE')} ohne Wert` : null,
    result.unresolved > 0 ? `${result.unresolved.toLocaleString('de-DE')} ohne Bauteiltyp` : null,
    ref !== null && !abweichung ? `stimmt mit iTWO überein (${reference})` : null,
    abweichung ? `iTWO: ${reference} — Abweichung ${(result.value - ref).toLocaleString('de-DE', { maximumFractionDigits: 3 })}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 tabular-nums',
            (result.skipped > 0 || result.unresolved > 0) && 'underline decoration-dotted',
            abweichung && 'text-destructive',
          )}
        >
          {abweichung && <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />}
          {result.value.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">{notes}</TooltipContent>
    </Tooltip>
  );
}

export function AusstattungTable({ rows, gruppen, results, onEdit, onRemove, onAddChild }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const tree = useMemo(() => buildTree(rows), [rows]);

  const visible = useMemo(
    () => tree.filter((t) => !t.ancestors.some((a) => collapsed.has(a))),
    [tree, collapsed],
  );

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (rows.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">Noch keine Ausstattung.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Mit <em>Zeile hinzufügen</em> anfangen — der Schlüssel (z.&nbsp;B. <code>60.70.60.10</code>)
          bildet die Hierarchie.
        </p>
      </div>
    );
  }

  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[15rem]">Schlüssel</TableHead>
          <TableHead className="w-[9rem]">Auswahlgruppe</TableHead>
          <TableHead className="w-[7rem]">Typ</TableHead>
          <TableHead className="w-[14rem]">Bezeichnung</TableHead>
          <TableHead>Mengenabfragesyntax</TableHead>
          <TableHead className="w-[3.5rem]">ME</TableHead>
          <TableHead className="w-[7rem] text-right">Menge</TableHead>
          <TableHead className="w-[8rem]">TL-Pfad</TableHead>
          <TableHead className="w-[5rem]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((t) => {
          const row = t.row;
          const kind = rowKind(row);
          const isCollapsed = collapsed.has(row.schluessel);
          return (
            <TableRow key={row.schluessel} className={cn(KIND_EDGE[kind], 'align-top')}>
              <TableCell className="font-mono">
                <div className="flex items-center gap-1" style={{ paddingLeft: `${t.depth * 0.85}rem` }}>
                  {t.hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggle(row.schluessel)}
                      aria-label={isCollapsed ? 'Zweig aufklappen' : 'Zweig zuklappen'}
                      aria-expanded={!isCollapsed}
                      className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <EditableCell
                    mono
                    value={row.schluessel}
                    onCommit={(v) => onEdit(row.schluessel, { schluessel: v.trim() })}
                  />
                </div>
              </TableCell>
              <TableCell>
                <GroupPicker
                  value={row.auswahlgruppe}
                  gruppen={gruppen}
                  onCommit={(v) => onEdit(row.schluessel, { auswahlgruppe: v })}
                />
              </TableCell>
              <TableCell>
                <EditableCell
                  value={row.typ}
                  placeholder="Schnittmenge"
                  onCommit={(v) => onEdit(row.schluessel, { typ: v })}
                />
              </TableCell>
              <TableCell>
                <EditableCell
                  value={row.bezeichnung}
                  onCommit={(v) => onEdit(row.schluessel, { bezeichnung: v })}
                />
              </TableCell>
              <TableCell>
                <EditableCell
                  mono
                  value={row.mengenabfrage}
                  placeholder='QTO(Typ:="Stückzahl";ME:="St")'
                  onCommit={(v) => onEdit(row.schluessel, { mengenabfrage: v })}
                />
              </TableCell>
              <TableCell>
                <EditableCell value={row.me} onCommit={(v) => onEdit(row.schluessel, { me: v })} />
              </TableCell>
              <TableCell className="text-right">
                <QuantityCell result={results.get(row.schluessel)} reference={row.referenzMenge} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatTlPfad(row) || <Badge variant="ghost" className="px-1 py-0 text-[10px]">{KIND_LABEL[kind]}</Badge>}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Unterzeile hinzufügen"
                        onClick={() => onAddChild(row.schluessel)}
                        className="h-6 w-6"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Unterzeile hinzufügen</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Zeile entfernen"
                        onClick={() => onRemove(row.schluessel)}
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Zeile entfernen</TooltipContent>
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
