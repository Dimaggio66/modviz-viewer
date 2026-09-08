/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The overlap case is the reason this file exists. Two rules pointing at one
 * LV position is legitimate; two rules that measure the SAME element into it
 * is a position overstated by exactly that overlap, and nothing about the sum
 * looks wrong when it happens.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateProject, lvRollupKey } from './evaluate.js';
import type { AusstattungProject, AusstattungRow } from './model.js';
import type { QtoContext } from '../quantities/qto-query.js';

/** id -> attribute -> value. Ids 1..6; 1-3 are walls, 1 is load-bearing. */
const MODEL: Record<number, Record<string, string>> = {
  1: { Art: 'Wand', Tragend: 'ja', Volumen: '10' },
  2: { Art: 'Wand', Tragend: 'nein', Volumen: '20' },
  3: { Art: 'Wand', Tragend: 'nein', Volumen: '30' },
  4: { Art: 'Decke', Tragend: 'ja', Volumen: '40' },
  5: { Art: 'Decke', Tragend: 'nein', Volumen: '50' },
  6: { Art: 'Stütze', Tragend: 'ja', Volumen: '60' },
};
const UNIVERSE = [1, 2, 3, 4, 5, 6];
const makeContext = (ids: readonly number[]): QtoContext => ({
  entityIds: ids,
  readAttribute: (id, name) => MODEL[id]?.[name] ?? null,
});

function row(schluessel: string, extra: Partial<AusstattungRow> = {}): AusstattungRow {
  return {
    schluessel, auswahlgruppe: '', typ: '', bezeichnung: '',
    mengenabfrage: '', me: '', tlk: '', lv: '', ...extra,
  };
}

const SUM_VOLUMEN = 'QTO(Typ:="Attribut{Volumen}";ME:="m3")';

describe('Doppelzählung in einer LV-Position', () => {
  it('meldet keine Überschneidung, wenn zwei Zeilen verschiedene Objekte messen', () => {
    const project: AusstattungProject = {
      gruppen: [],
      positionen: [{ tlk: '1', lv: '410', bezeichnung: 'Rohbau', einheit: 'm3' }],
      rows: [
        row('10', { mengenabfrage: `QTO(Typ:="Attribut{Volumen}";ME:="m3";Bauteil:="Attribut{Art} =='Wand'")`, tlk: '1', lv: '410' }),
        row('20', { mengenabfrage: `QTO(Typ:="Attribut{Volumen}";ME:="m3";Bauteil:="Attribut{Art} =='Decke'")`, tlk: '1', lv: '410' }),
      ],
    };
    const { lv } = evaluateProject(project, UNIVERSE, makeContext);
    const roll = lv.get(lvRollupKey('1', '410'))!;
    assert.equal(roll.value, 150, '10+20+30 plus 40+50');
    assert.equal(roll.overlapping, 0);
    assert.deepEqual(roll.overlapRows, []);
  });

  it('erkennt, wenn eine Zeile eine Teilmenge der anderen misst', () => {
    // Genau der Fall aus dem Lauf gegen das echte Modell: "alle Wände" und
    // "tragende Wände" speisen dieselbe Position.
    const project: AusstattungProject = {
      gruppen: [],
      positionen: [{ tlk: '1', lv: '410', bezeichnung: 'Wandarbeiten', einheit: 'm3' }],
      rows: [
        row('10', { mengenabfrage: `QTO(Typ:="Attribut{Volumen}";ME:="m3";Bauteil:="Attribut{Art} =='Wand'")`, tlk: '1', lv: '410' }),
        row('20', { mengenabfrage: `QTO(Typ:="Attribut{Volumen}";ME:="m3";Bauteil:="Attribut{Tragend} =='ja'")`, tlk: '1', lv: '410' }),
      ],
    };
    const { lv } = evaluateProject(project, UNIVERSE, makeContext);
    const roll = lv.get(lvRollupKey('1', '410'))!;
    // 60 (Waende) + 110 (tragend: 10+40+60) — Objekt 1 steckt in beiden.
    assert.equal(roll.value, 170);
    assert.equal(roll.overlapping, 1, 'Objekt 1 wird zweimal gemessen');
    assert.deepEqual(roll.overlapRows, ['10', '20'], 'beide Zeilen werden benannt');
  });

  it('zählt jedes doppelt gemessene Objekt einmal, nicht je Paar', () => {
    const gleich = `QTO(Typ:="Attribut{Volumen}";ME:="m3";Bauteil:="Attribut{Art} =='Wand'")`;
    const project: AusstattungProject = {
      gruppen: [],
      positionen: [{ tlk: '1', lv: '410', bezeichnung: 'Dreimal', einheit: 'm3' }],
      rows: [
        row('10', { mengenabfrage: gleich, tlk: '1', lv: '410' }),
        row('20', { mengenabfrage: gleich, tlk: '1', lv: '410' }),
        row('30', { mengenabfrage: gleich, tlk: '1', lv: '410' }),
      ],
    };
    const { lv } = evaluateProject(project, UNIVERSE, makeContext);
    const roll = lv.get(lvRollupKey('1', '410'))!;
    assert.equal(roll.overlapping, 3, 'drei Objekte, nicht neun Paare');
    assert.deepEqual(roll.overlapRows, ['10', '20', '30']);
  });

  it('trennt Positionen voneinander', () => {
    const gleich = `QTO(Typ:="Attribut{Volumen}";ME:="m3";Bauteil:="Attribut{Art} =='Wand'")`;
    const project: AusstattungProject = {
      gruppen: [],
      positionen: [
        { tlk: '1', lv: '410', bezeichnung: 'A', einheit: 'm3' },
        { tlk: '1', lv: '420', bezeichnung: 'B', einheit: 'm3' },
      ],
      rows: [
        row('10', { mengenabfrage: gleich, tlk: '1', lv: '410' }),
        row('20', { mengenabfrage: gleich, tlk: '1', lv: '420' }),
      ],
    };
    const { lv } = evaluateProject(project, UNIVERSE, makeContext);
    assert.equal(lv.get(lvRollupKey('1', '410'))!.overlapping, 0, 'dieselben Objekte, aber andere Position');
    assert.equal(lv.get(lvRollupKey('1', '420'))!.overlapping, 0);
  });
});

describe('Auswahlgruppen', () => {
  it('meldet die Trefferzahl jeder Gruppe, auch der unbenutzten', () => {
    const project: AusstattungProject = {
      gruppen: [
        { name: 'Wände', bedingung: "Attribut{Art} =='Wand'" },
        { name: 'Unbenutzt', bedingung: "Attribut{Art} =='Stütze'" },
      ],
      positionen: [],
      rows: [row('10', { auswahlgruppe: 'Wände', mengenabfrage: 'QTO(Typ:="Stückzahl";ME:="St")' })],
    };
    const { rows, gruppen } = evaluateProject(project, UNIVERSE, makeContext);
    assert.equal(gruppen.get('Wände')?.matched, 3);
    assert.equal(gruppen.get('Unbenutzt')?.matched, 1, 'auch ohne Zeile ausgewertet');
    assert.equal(rows.get('10')?.value, 3, 'die Gruppe schneidet den Geltungsbereich');
  });

  it('nennt eine unlesbare Bedingung an der Gruppe UND an der Zeile', () => {
    const project: AusstattungProject = {
      gruppen: [{ name: 'Kaputt', bedingung: 'das ist keine Bedingung' }],
      positionen: [],
      rows: [row('10', { auswahlgruppe: 'Kaputt', mengenabfrage: 'QTO(Typ:="Stückzahl";ME:="St")' })],
    };
    const { rows, gruppen } = evaluateProject(project, UNIVERSE, makeContext);
    assert.equal(gruppen.get('Kaputt')?.matched, null);
    assert.match(gruppen.get('Kaputt')!.problem!, /nicht verstanden/);
    assert.equal(rows.get('10')?.value, null);
    assert.match(rows.get('10')!.unsupported[0]!, /Auswahlgruppe "Kaputt"/);
  });

  it('eine Gruppe ohne Bedingung schränkt nicht ein, statt alles zu nullen', () => {
    const project: AusstattungProject = {
      gruppen: [{ name: 'Leer', bedingung: '' }],
      positionen: [],
      rows: [row('10', { auswahlgruppe: 'Leer', mengenabfrage: 'QTO(Typ:="Stückzahl";ME:="St")' })],
    };
    const { rows } = evaluateProject(project, UNIVERSE, makeContext);
    assert.equal(rows.get('10')?.value, 6);
  });

  it('eine Zeile, die eine unbekannte Gruppe nennt, liefert keine Menge', () => {
    const project: AusstattungProject = {
      gruppen: [],
      positionen: [],
      rows: [row('10', { auswahlgruppe: 'Gibtsnicht', mengenabfrage: 'QTO(Typ:="Stückzahl";ME:="St")' })],
    };
    const { rows } = evaluateProject(project, UNIVERSE, makeContext);
    assert.equal(rows.get('10')?.value, null, 'lieber keine Zahl als versehentlich das ganze Modell');
    assert.match(rows.get('10')!.unsupported[0]!, /existiert nicht/);
  });
});

describe('Auswahlgruppe aus RIB einfügen', () => {
  it('akzeptiert die Object(...)-Hülle, die RIBs "Aus Filter" erzeugt', () => {
    const project: AusstattungProject = {
      // Genau die Form aus Kapitel 6.7.1 bzw. dem Auswahlgruppen-Panel.
      gruppen: [{ name: 'Wände', bedingung: "Object(@Art == 'Wand')" }],
      positionen: [],
      rows: [row('10', { auswahlgruppe: 'Wände', mengenabfrage: 'QTO(Typ:="Stückzahl";ME:="St")' })],
    };
    const { rows, gruppen } = evaluateProject(project, UNIVERSE, makeContext);
    assert.equal(gruppen.get('Wände')?.matched, 3, 'die Huelle wird abgestreift');
    assert.equal(rows.get('10')?.value, 3);
  });

  it('nimmt dieselbe Bedingung auch ohne Hülle', () => {
    const project: AusstattungProject = {
      gruppen: [{ name: 'Wände', bedingung: "@Art == 'Wand'" }],
      positionen: [],
      rows: [row('10', { auswahlgruppe: 'Wände', mengenabfrage: 'QTO(Typ:="Stückzahl";ME:="St")' })],
    };
    assert.equal(evaluateProject(project, UNIVERSE, makeContext).gruppen.get('Wände')?.matched, 3);
  });
});
