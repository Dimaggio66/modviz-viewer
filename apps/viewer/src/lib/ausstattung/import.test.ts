/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The sample rows are shaped like the hand-built Ausstattung export. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mapColumns, parseCsv, parseTlPfad, referenceNumber, sheetToProject } from './import.js';

const CSV = [
  'Schlüssel;Auswahlgruppe;Typ;Bezeichnung;Mengenabfragesyntax;ME;Menge;TL-Pfad',
  '60.70.60.10.40;SML_Gusseisen;Schnittmenge;SML ( Gusseisen );;;0,000;',
  '60.70.60.10.40.10;Rohre;Schnittmenge;Rohre;;;0,000;',
  '60.70.60.10.40.10.10;;;Übersicht - SML - Rohre - St;"QTO(Typ:=""Stückzahl"";ME:=""St"")";St.;12,000;',
  '60.70.60.10.40.10.15;;;Abwasserltg Guss DN40;"roundk(QTO(Typ:=""Attribut{5D_Länge}"";ME:=""m"");1)";m;1.234,500;TLK: 1 - LV: 410',
].join('\r\n');

describe('Import — CSV', () => {
  it('erkennt das Semikolon deutscher Excel-Exporte', () => {
    const sheet = parseCsv(CSV);
    assert.equal(sheet.header.length, 8);
    assert.equal(sheet.header[0], 'Schlüssel');
    assert.equal(sheet.rows.length, 4);
  });

  it('liest ein Feld mit Anführungszeichen und Semikolons darin', () => {
    const sheet = parseCsv(CSV);
    assert.equal(
      sheet.rows[2]![4],
      'QTO(Typ:="Stückzahl";ME:="St")',
      'die Formel enthaelt selbst Semikolons und doppelte Anfuehrungszeichen',
    );
  });

  it('kommt mit einer BOM und CRLF zurecht', () => {
    const sheet = parseCsv('﻿Schlüssel;Menge\r\n10;5\r\n');
    assert.deepEqual(sheet.header, ['Schlüssel', 'Menge']);
    assert.deepEqual(sheet.rows, [['10', '5']]);
  });
});

describe('Import — Spaltenzuordnung', () => {
  it('findet die Spalten über den Namen, nicht über die Position', () => {
    const map = mapColumns(['TL-Pfad', 'Menge', 'ME', 'Mengenabfragesyntax', 'Bezeichnung', 'Typ', 'Auswahlgruppe', 'Schlüssel']);
    assert.equal(map.schluessel, 7);
    assert.equal(map.tlPfad, 0);
    assert.equal(map.mengenabfrage, 3);
  });

  it('erkennt eine Spalte mit angehängter Einheit', () => {
    assert.equal(mapColumns(['Schlüssel', 'Menge [m3]']).menge, 1);
  });

  it('meldet -1 statt zu raten, wenn eine Spalte fehlt', () => {
    assert.equal(mapColumns(['Schlüssel', 'Bezeichnung']).mengenabfrage, -1);
  });
});

describe('Import — TL-Pfad', () => {
  it('zerlegt den Pfad in TLK und LV', () => {
    assert.deepEqual(parseTlPfad('TLK: 1 - LV: 410'), { tlk: '1', lv: '410' });
    assert.deepEqual(parseTlPfad(''), { tlk: '', lv: '' });
  });
});

describe('Import — Projekt', () => {
  it('baut Zeilen, Gruppen und Positionen aus einem Blatt', () => {
    const { project, withReference, warnings } = sheetToProject(parseCsv(CSV));
    assert.equal(project.rows.length, 4);
    assert.deepEqual(project.gruppen.map((g) => g.name), ['Rohre', 'SML_Gusseisen']);
    assert.deepEqual(project.positionen, [{ tlk: '1', lv: '410', bezeichnung: '', einheit: 'm' }]);
    assert.equal(withReference, 4, 'alle vier Zeilen tragen eine iTWO-Menge');
    assert.match(warnings.join(' '), /ohne Bedingung angelegt/);
  });

  it('behält die Formel unverändert und übernimmt die iTWO-Menge als Sollwert', () => {
    const { project } = sheetToProject(parseCsv(CSV));
    const row = project.rows.find((r) => r.schluessel === '60.70.60.10.40.10.15')!;
    assert.equal(row.mengenabfrage, 'roundk(QTO(Typ:="Attribut{5D_Länge}";ME:="m");1)');
    assert.equal(row.referenzMenge, '1.234,500');
    assert.deepEqual({ tlk: row.tlk, lv: row.lv }, { tlk: '1', lv: '410' });
  });

  it('bricht verständlich ab, wenn die Schlüsselspalte fehlt', () => {
    const { project, warnings } = sheetToProject({ header: ['Bezeichnung'], rows: [['x']] });
    assert.equal(project.rows.length, 0);
    assert.match(warnings[0]!, /Keine Schlüssel-Spalte/);
  });

  it('überspringt doppelte Schlüssel und sagt es', () => {
    const sheet = parseCsv('Schlüssel;Bezeichnung\n10;A\n10;B\n20;C');
    const { project, warnings } = sheetToProject(sheet);
    assert.deepEqual(project.rows.map((r) => r.schluessel), ['10', '20']);
    assert.match(warnings.join(' '), /doppeltem Schlüssel/);
  });
});

describe('Import — deutsche Zahlen', () => {
  it('liest 1.234,500 als tausendzweihundertvierunddreissig', () => {
    assert.equal(referenceNumber('1.234,500'), 1234.5);
    assert.equal(referenceNumber('0,000'), 0);
    assert.equal(referenceNumber('12'), 12);
    assert.equal(referenceNumber(''), null);
    assert.equal(referenceNumber(undefined), null);
  });
});
