/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ausstattung and LV in two tabs, over one model.
 *
 * The two tables are deliberately different shapes and are joined only by the
 * TL path: an Ausstattung row is a measurement rule, an LV position is a
 * commercial item, and many rules can feed one item.
 *
 * SCHNITTMENGE is applied here, not in the formula: a row is evaluated
 * against the intersection of its own Auswahlgruppe and every ancestor's, so
 * the formulas stay as short as they are in the source table. Each group's
 * condition is resolved once per pass and cached — the same group appears on
 * dozens of rows.
 *
 * An Auswahlgruppe is resolved by asking the QTO evaluator for the ids its
 * condition matches, rather than by a second condition engine. One grammar,
 * one implementation, one place for a bug to be.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Plus, Table2, Workflow } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  compareKeys, emptyProject,
  type AusstattungProject, type AusstattungRow, type LvPosition,
} from '@/lib/ausstattung/model';
import { evaluateProject, lvRollupKey } from '@/lib/ausstattung/evaluate';
import { loadAusstattung, saveAusstattung } from '@/lib/ausstattung/store';
import type { QtoContext } from '@/lib/quantities/qto-query';
import { AusstattungTable } from './ausstattung/AusstattungTable';
import { LvTable } from './ausstattung/LvTable';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Identifies the loaded file, so the table is restored per project. */
  projectKey: string;
  /** Every object in the model — the outermost scope. */
  universe: readonly number[];
  /** Reads a mapped attribute by bare name, e.g. "5D_Länge". */
  readAttribute: (entityId: number, name: string) => string | null;
  /** The element's IFC class, the fallback for Bauteiltyp. */
  ifcClassOf?: (entityId: number) => string | null;
}

export function AusstattungDialog({
  open, onOpenChange, projectKey, universe, readAttribute, ifcClassOf,
}: Props) {
  const [project, setProject] = useState<AusstattungProject>(emptyProject);
  const [persisted, setPersisted] = useState(true);

  useEffect(() => {
    if (open) setProject(loadAusstattung(projectKey));
  }, [open, projectKey]);

  const patch = useCallback((next: AusstattungProject) => {
    setProject(next);
    setPersisted(saveAusstattung(projectKey, next));
  }, [projectKey]);

  const ctxFor = useCallback(
    (ids: readonly number[]): QtoContext => ({ entityIds: ids, readAttribute, ifcClassOf }),
    [readAttribute, ifcClassOf],
  );

  /** Row quantities and the LV roll-ups, from the pure module so the same
   *  calculation can be checked against a real model without a browser. */
  const { rows: results, lv: rollups } = useMemo(
    () => evaluateProject(project, universe, ctxFor),
    [project, universe, ctxFor],
  );

  const editRow = useCallback((schluessel: string, delta: Partial<AusstattungRow>) => {
    patch({
      ...project,
      rows: project.rows.map((r) => (r.schluessel === schluessel ? { ...r, ...delta } : r)),
    });
  }, [patch, project]);

  const removeRow = useCallback((schluessel: string) => {
    patch({ ...project, rows: project.rows.filter((r) => r.schluessel !== schluessel) });
  }, [patch, project]);

  /** A free child key under `parentKey`, or a free root key when it is empty. */
  const freeKey = useCallback((parentKey: string): string => {
    const taken = new Set(project.rows.map((r) => r.schluessel));
    const prefix = parentKey ? `${parentKey}.` : '';
    for (let n = 10; n < 100_000; n += 10) {
      const candidate = `${prefix}${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${prefix}${Date.now()}`;
  }, [project.rows]);

  const addRow = useCallback((parentKey: string) => {
    const row: AusstattungRow = {
      schluessel: freeKey(parentKey),
      auswahlgruppe: '', typ: parentKey ? 'Schnittmenge' : '',
      bezeichnung: '', mengenabfrage: '', me: '', tlk: '', lv: '',
    };
    patch({ ...project, rows: [...project.rows, row].sort((a, b) => compareKeys(a.schluessel, b.schluessel)) });
  }, [freeKey, patch, project]);

  const addPosition = useCallback(() => {
    const taken = new Set(project.positionen.map((p) => lvRollupKey(p.tlk, p.lv)));
    let lv = 100;
    while (taken.has(lvRollupKey('1', String(lv)))) lv += 10;
    const pos: LvPosition = { tlk: '1', lv: String(lv), bezeichnung: '', einheit: '' };
    patch({ ...project, positionen: [...project.positionen, pos] });
  }, [patch, project]);

  const editPosition = useCallback((tlk: string, lv: string, delta: Partial<LvPosition>) => {
    patch({
      ...project,
      positionen: project.positionen.map((p) => (p.tlk === tlk && p.lv === lv ? { ...p, ...delta } : p)),
    });
  }, [patch, project]);

  const removePosition = useCallback((tlk: string, lv: string) => {
    patch({ ...project, positionen: project.positionen.filter((p) => !(p.tlk === tlk && p.lv === lv)) });
  }, [patch, project]);

  const offen = useMemo(
    () => [...results.values()].filter((r) => r.value === null).length,
    [results],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-[95vw] flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-base">Ausstattung</DialogTitle>
          <DialogDescription className="text-xs">
            Mengenabfragen je Zeile, LV-Positionen getrennt davon, verbunden über den TL-Pfad.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="ausstattung" className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
            <TabsList>
              <TabsTrigger value="ausstattung" className="gap-1.5 text-xs">
                <Workflow className="h-3.5 w-3.5" /> Ausstattung
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                  {project.rows.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="lv" className="gap-1.5 text-xs">
                <Table2 className="h-3.5 w-3.5" /> LV / TLK
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                  {project.positionen.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => addRow('')} className="text-xs">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Zeile hinzufügen
              </Button>
              <Button variant="outline" size="sm" onClick={addPosition} className="text-xs">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> LV-Position
              </Button>
            </div>
          </div>

          <TabsContent value="ausstattung" className="mt-0 min-h-0 flex-1 overflow-auto">
            <AusstattungTable
              rows={project.rows}
              gruppen={project.gruppen}
              results={results}
              onEdit={editRow}
              onRemove={removeRow}
              onAddChild={addRow}
            />
          </TabsContent>

          <TabsContent value="lv" className="mt-0 min-h-0 flex-1 overflow-auto">
            <LvTable
              positionen={project.positionen}
              rollups={rollups}
              onEdit={editPosition}
              onRemove={removePosition}
              onAdd={addPosition}
            />
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              {universe.length.toLocaleString('de-DE')} Objekte im Modell
              {offen > 0 && ` · ${offen} Zeile(n) ohne Menge`}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {persisted ? (
                <><Check className="h-3 w-3 text-primary" /> Mit dem Projekt gespeichert</>
              ) : (
                <span className="text-red-500">
                  Nicht gespeichert — der Browser-Speicher ist nicht verfügbar
                </span>
              )}
            </span>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Schließen</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
