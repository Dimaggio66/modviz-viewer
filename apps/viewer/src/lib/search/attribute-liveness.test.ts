/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { judgeOverlay } from './attribute-liveness.js';

/** A scan that answers `answer` and counts how often it was asked. */
function scan(answer: boolean) {
  const fn = () => { fn.calls += 1; return answer; };
  fn.calls = 0;
  return fn;
}

describe('Attribut lebt noch?', () => {
  it('nimmt den umbenannten Namen aus der Liste', () => {
    // Nenndurchmesser -> 5D_FormteilDN auf ALLEN Objekten: die Datei fuehrt
    // den alten Namen noch, kein Objekt traegt ihn mehr.
    const leer = scan(false);
    const v = judgeOverlay(true, [null, null, null], leer);
    assert.equal(v.live, false, 'der alte Name muss verschwinden');
    assert.equal(leer.calls, 1);
  });

  it('behaelt ihn, wenn nur ein Teil umbenannt wurde', () => {
    // Genau der Fall, den die alte Fassung richtig hatte und der nicht
    // kaputtgehen darf: die uebrigen Objekte waeren sonst unfilterbar.
    const rest = scan(true);
    assert.equal(judgeOverlay(true, [null, null], rest).live, true);
    assert.equal(rest.calls, 1);
  });

  it('fragt das Modell nicht, wenn die Antwort nichts aendert', () => {
    // Ohne Loeschung kann die Datei allein entscheiden. Der Scan laeuft ueber
    // alle Objekte, also darf er hier nicht anlaufen.
    const nie = scan(false);
    assert.equal(judgeOverlay(true, [], nie).live, true, 'Datei hat Werte');
    assert.equal(judgeOverlay(true, ['DN100'], nie).live, true, 'Regel hat geschrieben');
    assert.equal(nie.calls, 0);
  });

  it('zeigt ein Attribut, das es nur als Regelausgabe gibt', () => {
    const nie = scan(false);
    const v = judgeOverlay(false, ['DN100', 'DN150'], nie);
    assert.equal(v.live, true);
    assert.deepEqual(v.written, ['DN100', 'DN150'], 'die neuen Werte kommen in die Zeile');
    assert.equal(nie.calls, 0);
  });

  it('laesst keine Zeile zurueck, wenn die erzeugende Regel weg ist', () => {
    // Die Datei kannte das Attribut nie, die Regel ist zurueckgerollt.
    const nie = scan(false);
    assert.equal(judgeOverlay(false, [null, null], nie).live, false);
    assert.equal(nie.calls, 0, 'dafuer muss nichts gescannt werden');
  });

  it('behandelt den leeren String wie eine Loeschung', () => {
    // deleteProperty schreibt null, ein geleertes Feld einen leeren String \u2014
    // beides heisst: dieses Objekt traegt das Attribut nicht mehr.
    const leer = scan(false);
    const v = judgeOverlay(true, ['', null], leer);
    assert.equal(v.live, false);
    assert.deepEqual(v.written, [], 'ein leerer Wert ist kein Filterwert');
  });
});
