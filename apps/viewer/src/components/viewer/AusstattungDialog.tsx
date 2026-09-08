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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Layers, Plus, Table2, TriangleAlert, Upload, Workflow, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  compareKeys, emptyProject,
  type AusstattungProject, type AusstattungRow, type Auswahlgruppe, type LvPosition,
} from '@/lib/ausstattung/model';
import { evaluateProject, lvRollupKey } from '@/lib/ausstattung/evaluate';
import { parseCsv, parseXlsx, sheetToProject, type ImportResult } from '@/lib/ausstattung/import';
import { loadAusstattung, saveAusstattung } from '@/lib/ausstattung/store';
import type { QtoContext } from '@/lib/quantities/qto-query';
import { AusstattungTable } from './ausstattung/AusstattungTable';
import { GruppenTable } from './ausstattung/GruppenTable';
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
  const [summary, setSummary] = useState<(ImportResult & { file: string }) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
  const { rows: results, lv: rollups, gruppen: groupResults } = useMemo(
    () => evaluateProject(project, universe, ctxFor),
    [project, universe, ctxFor],
  );

  /** How many rows name each group — an unused group is worth seeing. */
  const groupUsage = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of project.rows) {
      const n = r.auswahlgruppe.trim();
      if (n) out.set(n, (out.get(n) ?? 0) + 1);
    }
    return out;
  }, [project.rows]);

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

  /**
   * Reads an exported table and REPLACES the project with it. Replacing
   * rather than merging is deliberate: the key is the identity, so a merge
   * would silently overwrite hand-edited rows wherever the keys happen to
   * line up, and there would be no way to tell afterwards which is which.
   */
  const handleImport = useCallback(async (file: File) => {
    try {
      const sheet = file.name.toLowerCase().endsWith('.xlsx')
        ? await parseXlsx(await file.arrayBuffer())
        : parseCsv(await file.text());
      const result = sheetToProject(sheet);
      // Groups the sheet named are kept; conditions already written for a
      // group of the same name survive the import.
      const merged = result.project.gruppen.map((g) => {
        const existing = project.gruppen.find((old) => old.name === g.name);
        return existing?.bedingung ? existing : g;
      });
      patch({ ...result.project, gruppen: merged });
      setSummary({ ...result, file: file.name });
    } catch (err) {
      setSummary({
        project: emptyProject(),
        warnings: [`Datei konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}`],
        mapping: {},
        withReference: 0,
        file: file.name,
      });
    }
  }, [patch, project.gruppen]);

  const addGruppe = useCallback(() => {
    const taken = new Set(project.gruppen.map((g) => g.name));
    let n = 1;
    while (taken.has(`Gruppe ${n}`)) n += 1;
    const gruppe: Auswahlgruppe = { name: `Gruppe ${n}`, bedingung: '' };
    patch({ ...project, gruppen: [...project.gruppen, gruppe] });
  }, [patch, project]);

  /** Renaming a group carries every row that names it along, otherwise the
   *  rename silently turns those rows into references to nothing. */
  const editGruppe = useCallback((name: string, delta: Partial<Auswahlgruppe>) => {
    const renamed = delta.name !== undefined && delta.name !== name ? delta.name : null;
    if (renamed !== null && (renamed === '' || project.gruppen.some((g) => g.name === renamed))) {
      return; // an empty or duplicate name would orphan or merge rows
    }
    patch({
      ...project,
      gruppen: project.gruppen.map((g) => (g.name === name ? { ...g, ...delta } : g)),
      rows: renamed === null
        ? project.rows
        : project.rows.map((r) => (r.auswahlgruppe === name ? { ...r, auswahlgruppe: renamed } : r)),
    });
  }, [patch, project]);

  const removeGruppe = useCallback((name: string) => {
    patch({
      ...project,
      gruppen: project.gruppen.filter((g) => g.name !== name),
      // The rows keep the name so the loss is visible as "Gruppe existiert
      // nicht" rather than silently widening their scope to the whole model.
      rows: project.rows,
    });
  }, [patch, project]);

  const offen = useMemo(
    () => [...results.values()].filter((r) => r.value === null).length,
    [results],
  );

  /** Positions whose sum counts at least one element twice. */
  const doppelt = useMemo(
    () => [...rollups.values()].filter((r) => r.overlapping > 0).length,
    [rollups],
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
              <TabsTrigger value="gruppen" className="gap-1.5 text-xs">
                <Layers className="h-3.5 w-3.5" /> Auswahlgruppen
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                  {project.gruppen.length}
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
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Zeile
              </Button>
              <Button variant="outline" size="sm" onClick={addGruppe} className="text-xs">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Gruppe
              </Button>
              <Button variant="outline" size="sm" onClick={addPosition} className="text-xs">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> LV-Position
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleImport(file);
                }}
              />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="text-xs">
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Import (CSV / Excel)
              </Button>
            </div>
          </div>

          {summary && (
            <div className="flex items-start gap-3 border-b bg-muted/40 px-4 py-2.5 text-xs">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">
                  {summary.file}: {summary.project.rows.length.toLocaleString('de-DE')} Zeile(n),{' '}
                  {summary.project.gruppen.length} Gruppe(n),{' '}
                  {summary.project.positionen.length} LV-Position(en)
                  {summary.withReference > 0
                    && ` · ${summary.withReference.toLocaleString('de-DE')} mit iTWO-Menge zum Abgleich`}
                </p>
                {Object.keys(summary.mapping).length > 0 && (
                  <p className="text-muted-foreground">
                    Spalten:{' '}
                    {Object.entries(summary.mapping)
                      .map(([field, col]) => `${field} → ${col}`)
                      .join(' · ')}
                  </p>
                )}
                {summary.warnings.map((w) => (
                  <p key={w} className="flex items-start gap-1 text-amber-600 dark:text-amber-500">
                    <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Import-Meldung schließen"
                onClick={() => setSummary(null)}
                className="h-6 w-6 shrink-0"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

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

          <TabsContent value="gruppen" className="mt-0 min-h-0 flex-1 overflow-auto">
            <GruppenTable
              gruppen={project.gruppen}
              results={groupResults}
              usage={groupUsage}
              onEdit={editGruppe}
              onRemove={removeGruppe}
              onAdd={addGruppe}
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
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {universe.length.toLocaleString('de-DE')} Objekte im Modell
                {offen > 0 && ` · ${offen} Zeile(n) ohne Menge`}
              </span>
              {doppelt > 0 && (
                <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[10px]">
                  <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                  {doppelt} Position(en) mit Doppelzählung
                </Badge>
              )}
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
