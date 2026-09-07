/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The keys are taken from the hand-built Ausstattung table, not invented. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildTree, compareKeys, isAncestorKey, rowKind, formatTlPfad, scopeChain,
  type AusstattungRow,
} from './model.js';

function row(schluessel: string, extra: Partial<AusstattungRow> = {}): AusstattungRow {
  return {
    schluessel, auswahlgruppe: '', typ: '', bezeichnung: '',
    mengenabfrage: '', me: '', tlk: '', lv: '', ...extra,
  };
}

describe('Ausstattung — der Schlüssel ist der Baum', () => {
  it('erkennt Vorfahren nur auf Segmentgrenzen', () => {
    assert.equal(isAncestorKey('60.70.60.10.40', '60.70.60.10.40.10'), true);
    assert.equal(isAncestorKey('60.70.60.10.40.10', '60.70.60.10.40.10'), false, 'nicht sich selbst');
    assert.equal(isAncestorKey('60.70.6', '60.70.60.10'), false, 'kein Text-Präfix');
  });

  it('sortiert Segmente numerisch, nicht alphabetisch', () => {
    const keys = ['60.70.60.10.40.10.100', '60.70.60.10.40.10.15', '60.70.60.10.40.10.20'];
    assert.deepEqual(
      [...keys].sort(compareKeys),
      ['60.70.60.10.40.10.15', '60.70.60.10.40.10.20', '60.70.60.10.40.10.100'],
      '100 gehoert hinter 20',
    );
  });

  it('zählt die Tiefe nach vorhandenen Vorfahren, nicht nach Punkten', () => {
    const tree = buildTree([
      row('60.70.60'),
      row('60.70.60.10'),
      row('60.70.60.10.40'),
      row('60.70.60.10.40.10'),
      row('60.70.60.10.40.10.15'),
    ]);
    assert.deepEqual(tree.map((t) => t.depth), [0, 1, 2, 3, 4]);
    assert.equal(tree[0]!.hasChildren, true);
    assert.equal(tree[4]!.hasChildren, false);
  });

  it('startet bei 0, auch wenn die Wurzel schon drei Segmente hat', () => {
    const tree = buildTree([row('60.70.60'), row('60.70.60.10')]);
    assert.equal(tree[0]!.depth, 0, 'nicht drei Ebenen eingerueckt');
  });

  it('behält Geschwister nebeneinander, wenn ein Zweig endet', () => {
    const tree = buildTree([
      row('60.70.60.10.40.10'),
      row('60.70.60.10.40.10.15'),
      row('60.70.60.10.40.30'),
    ]);
    assert.deepEqual(tree.map((t) => [t.row.schluessel, t.depth]), [
      ['60.70.60.10.40.10', 0],
      ['60.70.60.10.40.10.15', 1],
      ['60.70.60.10.40.30', 0],
    ]);
  });
});

describe('Ausstattung — Zeilenart und LV-Bezug', () => {
  it('leitet die Art aus dem Inhalt ab', () => {
    assert.equal(rowKind(row('1', { mengenabfrage: '' })), 'gruppe');
    assert.equal(rowKind(row('1', { mengenabfrage: 'QTO(Typ:="Stückzahl";ME:="St")' })), 'uebersicht');
    assert.equal(
      rowKind(row('1', { mengenabfrage: 'QTO(Typ:="Stückzahl";ME:="St")', tlk: '1', lv: '410' })),
      'position',
    );
  });

  it('formatiert den TL-Pfad wie die Quelltabelle', () => {
    assert.equal(formatTlPfad(row('1', { tlk: '1', lv: '410' })), 'TLK: 1 - LV: 410');
    assert.equal(formatTlPfad(row('1')), '');
  });
});

describe('Ausstattung — Schnittmenge', () => {
  it('sammelt die Auswahlgruppen von aussen nach innen', () => {
    const rows = [
      row('60.70.60.10.40', { auswahlgruppe: 'SML_Gusseisen' }),
      row('60.70.60.10.40.10', { auswahlgruppe: 'Rohre' }),
      row('60.70.60.10.40.10.15'),
    ];
    const tree = buildTree(rows);
    const byKey = new Map(rows.map((r) => [r.schluessel, r]));
    assert.deepEqual(scopeChain(tree[2]!, byKey), ['SML_Gusseisen', 'Rohre']);
  });

  it('nimmt eine Gruppe nur einmal, auch wenn sie sich wiederholt', () => {
    const rows = [
      row('10', { auswahlgruppe: 'Rohre' }),
      row('10.20', { auswahlgruppe: 'Rohre' }),
    ];
    const tree = buildTree(rows);
    const byKey = new Map(rows.map((r) => [r.schluessel, r]));
    assert.deepEqual(scopeChain(tree[1]!, byKey), ['Rohre']);
  });
});
