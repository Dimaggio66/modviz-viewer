/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Importing an Ausstattung table exported from iTWO (CSV or Excel).
 *
 * The export carries iTWO's OWN computed quantity in the Menge column, and
 * that number is the most valuable thing in the file: kept as
 * `referenzMenge`, it turns every imported row into a test case for our own
 * evaluation. A hundred rows that agree are worth more than any unit test;
 * the ones that disagree are exactly where to look.
 *
 * Columns are matched by HEADER NAME, not by position, because the export's
 * column order is a user setting. A header that cannot be matched is reported
 * rather than guessed at — an Ausstattung read into the wrong columns would
 * produce quantities that look plausible.
 *
 * The export does NOT carry the Auswahlgruppen definitions, only their names.
 * They are created empty, which means "narrows nothing" and shows up in the
 * catalogue as a group with no condition, waiting to be filled in. Inventing
 * a condition for them would silently change every quantity beneath.
 */

import {
  compareKeys, type AusstattungProject, type AusstattungRow, type Auswahlgruppe, type LvPosition,
} from './model.js';

/** A sheet as the importers hand it over: one header row, then data. */
export interface Sheet {
  header: string[];
  rows: string[][];
}

export interface ImportResult {
  project: AusstattungProject;
  /** Everything the caller must be told before trusting the import. */
  warnings: string[];
  /** Which source column each field was taken from, for the summary. */
  mapping: Record<string, string>;
  /** How many rows carry iTWO's own quantity for comparison. */
  withReference: number;
}

/** Header aliases per field. Matched case- and punctuation-insensitively. */
const HEADERS: Record<keyof ColumnMap, readonly string[]> = {
  schluessel: ['schlussel', 'schluessel', 'key', 'nummer', 'pos'],
  auswahlgruppe: ['auswahlgruppe', 'gruppe', 'selectiongroup'],
  typ: ['typ', 'type', 'art'],
  bezeichnung: ['bezeichnung', 'text', 'description'],
  mengenabfrage: ['mengenabfragesyntax', 'mengenabfrage', 'qto', 'formel', 'syntax'],
  me: ['me', 'einheit', 'unit'],
  menge: ['menge', 'quantity', 'wert'],
  tlPfad: ['tlpfad', 'tlpfad', 'tlkpfad', 'tlpath', 'lvzuordnung'],
};

interface ColumnMap {
  schluessel: number;
  auswahlgruppe: number;
  typ: number;
  bezeichnung: number;
  mengenabfrage: number;
  me: number;
  menge: number;
  tlPfad: number;
}

const normalise = (s: string): string =>
  s.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

/** Matches each field to a column index; -1 when the export has no such column. */
export function mapColumns(header: readonly string[]): ColumnMap {
  const norm = header.map(normalise);
  const find = (aliases: readonly string[]): number => {
    for (const alias of aliases) {
      const exact = norm.indexOf(alias);
      if (exact >= 0) return exact;
    }
    // A header like "Menge [m3]" still counts as Menge.
    for (const alias of aliases) {
      const partial = norm.findIndex((h) => h.startsWith(alias));
      if (partial >= 0) return partial;
    }
    return -1;
  };
  return {
    schluessel: find(HEADERS.schluessel),
    auswahlgruppe: find(HEADERS.auswahlgruppe),
    typ: find(HEADERS.typ),
    bezeichnung: find(HEADERS.bezeichnung),
    mengenabfrage: find(HEADERS.mengenabfrage),
    me: find(HEADERS.me),
    menge: find(HEADERS.menge),
    tlPfad: find(HEADERS.tlPfad),
  };
}

/** `TLK: 1 - LV: 410` back into its two parts; both empty when absent. */
export function parseTlPfad(text: string): { tlk: string; lv: string } {
  const tlk = /TLK\s*:\s*([^\s-]+)/i.exec(text)?.[1] ?? '';
  const lv = /LV\s*:\s*([^\s-]+)/i.exec(text)?.[1] ?? '';
  return { tlk: tlk.trim(), lv: lv.trim() };
}

/**
 * Splits CSV text. Handles quoted fields with embedded separators, doubled
 * quotes and CRLF, and detects the separator from the header — a German Excel
 * writes `;` and reading it as `,` would put the whole row in one cell.
 */
export function parseCsv(text: string): Sheet {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.search(/\r?\n/) < 0 ? clean.length : clean.search(/\r?\n/));
  const counts = [
    { sep: ';', n: (firstLine.match(/;/g) ?? []).length },
    { sep: '\t', n: (firstLine.match(/\t/g) ?? []).length },
    { sep: ',', n: (firstLine.match(/,/g) ?? []).length },
  ];
  const sep = counts.sort((a, b) => b.n - a.n)[0]!.n > 0 ? counts[0]!.sep : ';';

  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === sep) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); out.push(row); }

  const header = out.shift() ?? [];
  return { header: header.map((h) => h.trim()), rows: out.filter((r) => r.some((c) => c.trim() !== '')) };
}

/** Reads the first worksheet of an xlsx buffer. exceljs is loaded lazily,
 *  the same way the export side does, so it stays out of the bundle. */
export async function parseXlsx(buffer: ArrayBuffer): Promise<Sheet> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { header: [], rows: [] };
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cell.text ?? '';
    });
    for (let i = 0; i < values.length; i++) values[i] ??= '';
    rows.push(values);
  });
  const header = rows.shift() ?? [];
  return { header: header.map((h) => h.trim()), rows: rows.filter((r) => r.some((c) => c.trim() !== '')) };
}

/** Turns a mapped sheet into a project, reporting what it had to leave out. */
export function sheetToProject(sheet: Sheet): ImportResult {
  const map = mapColumns(sheet.header);
  const warnings: string[] = [];
  const mapping: Record<string, string> = {};
  for (const [field, index] of Object.entries(map)) {
    mapping[field] = index >= 0 ? sheet.header[index] ?? `Spalte ${index + 1}` : '—';
  }
  if (map.schluessel < 0) {
    warnings.push('Keine Schlüssel-Spalte gefunden — ohne sie gibt es keine Hierarchie.');
    return { project: { rows: [], gruppen: [], positionen: [] }, warnings, mapping, withReference: 0 };
  }
  if (map.mengenabfrage < 0) {
    warnings.push('Keine Spalte mit der Mengenabfragesyntax gefunden — alle Zeilen werden Gruppen.');
  }

  const cell = (r: readonly string[], i: number): string => (i >= 0 ? (r[i] ?? '').trim() : '');
  const rows: AusstattungRow[] = [];
  const seen = new Set<string>();
  const gruppenNamen = new Set<string>();
  const positionen = new Map<string, LvPosition>();
  let withReference = 0;
  let duplicates = 0;

  for (const raw of sheet.rows) {
    const schluessel = cell(raw, map.schluessel);
    if (!schluessel) continue;
    if (seen.has(schluessel)) { duplicates += 1; continue; }
    seen.add(schluessel);

    const tlPfad = cell(raw, map.tlPfad);
    const { tlk, lv } = parseTlPfad(tlPfad);
    const auswahlgruppe = cell(raw, map.auswahlgruppe);
    if (auswahlgruppe) gruppenNamen.add(auswahlgruppe);
    const me = cell(raw, map.me);
    if (tlk || lv) {
      const key = `${tlk}${lv}`;
      if (!positionen.has(key)) {
        positionen.set(key, { tlk, lv, bezeichnung: '', einheit: me });
      }
    }
    const referenz = cell(raw, map.menge);
    if (referenz) withReference += 1;

    rows.push({
      schluessel,
      auswahlgruppe,
      typ: cell(raw, map.typ),
      bezeichnung: cell(raw, map.bezeichnung),
      mengenabfrage: cell(raw, map.mengenabfrage),
      me,
      tlk,
      lv,
      ...(referenz ? { referenzMenge: referenz } : {}),
    });
  }

  if (duplicates > 0) {
    warnings.push(`${duplicates} Zeile(n) mit doppeltem Schlüssel übersprungen — der Schlüssel ist eindeutig.`);
  }
  if (gruppenNamen.size > 0) {
    warnings.push(
      `${gruppenNamen.size} Auswahlgruppe(n) ohne Bedingung angelegt — der Export enthält nur die Namen. `
      + 'Bis die Bedingungen ergänzt sind, schränken sie nichts ein.',
    );
  }

  const gruppen: Auswahlgruppe[] = [...gruppenNamen].sort().map((name) => ({ name, bedingung: '' }));
  rows.sort((a, b) => compareKeys(a.schluessel, b.schluessel));
  return { project: { rows, gruppen, positionen: [...positionen.values()] }, warnings, mapping, withReference };
}

/** iTWO writes German numbers; `1.234,567` is one thousand two hundred. */
export function referenceNumber(text: string | undefined): number | null {
  if (!text) return null;
  const t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}
