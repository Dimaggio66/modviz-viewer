/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { valueText } from './value-text.js';

describe('Zahlenwert als Text', () => {
  it('glaettet das Rauschen aus der Einheitenumrechnung', () => {
    // Genau die Werte, die in der Werteliste neben 125 und 250 auftauchten.
    assert.equal(valueText(125.00000000000001), '125');
    assert.equal(valueText(250.00000000000003), '250');
  });

  it('laesst eine echte Winzigkeit stehen — das ist die andere Sorte Rauschen', () => {
    // Eine Hoehenlage speichert die 0 als -1.8e-15. Das ist ein absoluter
    // Fehler nahe null, kein relativer, und `toPrecision` kann ihn nicht
    // sehen. Der Objektfilter faengt ihn dort ab, wo er auftritt, mit
    // toFixed(4) auf der Hoehe selbst — hier waere jede Schwelle geraten und
    // wuerde echte kleine Mengen mitnehmen.
    assert.equal(valueText(-1.8e-15), '-1.8e-15');
  });

  it('laesst echte Nachkommastellen stehen', () => {
    assert.equal(valueText(42.4), '42.4');
    assert.equal(valueText(21.3), '21.3');
    assert.equal(valueText(33.7), '33.7');
  });

  it('rettet kleine Mengen, an denen toFixed scheitern wuerde', () => {
    // 0,005598 m3 waere mit toFixed(4) zu 0,0056 geworden.
    assert.equal(valueText(0.005598), '0.005598');
    assert.equal(valueText(0.000041), '0.000041');
  });

  it('fasst Zeichenketten nicht an', () => {
    // Eine Artikelnummer sieht numerisch aus und ist es nicht — als Zahl
    // gelesen wuerde daraus 8436.
    assert.equal(valueText('0008436'), '0008436');
    assert.equal(valueText('DN100-DN100'), 'DN100-DN100');
    assert.equal(valueText('125.00000000000001'), '125.00000000000001');
  });

  it('macht aus fehlenden Werten den leeren String', () => {
    assert.equal(valueText(null), '');
    assert.equal(valueText(undefined), '');
  });

  it('vertraegt die Sonderwerte', () => {
    assert.equal(valueText(true), 'true');
    assert.equal(valueText(Number.NaN), 'NaN');
    assert.equal(valueText(Number.POSITIVE_INFINITY), 'Infinity');
  });
});
