/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The one-entry memo over an entity's BASE property sets.
 *
 * `setProperty` asks for them twice on its own — once through
 * `getPropertyValue`, once to classify the write as CREATE or UPDATE — and the
 * extractor reads them out of the (block-compressed) source every time. A rule
 * apply writes about nine properties per object, so an object was being
 * re-extracted roughly eighteen times; sorting the writes by entity and keeping
 * the last one is what turns that back into once.
 *
 * What must hold: the memo answers for the SAME entity and never for a
 * different one, and it does not outlive a reset.
 */

import { describe, expect, it } from 'vitest';
import { PropertyValueType } from '@ifc-lite/data';
import { MutablePropertyView } from '../src/index.js';

function viewWithCounter() {
  const calls: number[] = [];
  const view = new MutablePropertyView(null, 'm');
  view.setOnDemandExtractor((entityId: number) => {
    calls.push(entityId);
    return [{
      name: 'Pset_A',
      globalId: `g${entityId}`,
      properties: [{ name: 'Status', type: PropertyValueType.Label, value: `alt-${entityId}` }],
    }];
  });
  return { view, calls };
}

describe('Basis-Psets, gemerkt', () => {
  it('liest dasselbe Objekt nur einmal aus der Quelle', () => {
    const { view, calls } = viewWithCounter();
    view.setProperty(7, 'Pset_A', 'Status', 'neu', PropertyValueType.Label);
    view.setProperty(7, 'Pset_A', 'Zweitens', 'neu', PropertyValueType.Label);
    view.setProperty(7, 'Pset_A', 'Drittens', 'neu', PropertyValueType.Label);
    expect(calls).toEqual([7]);
  });

  it('antwortet nie mit den Sets eines anderen Objekts', () => {
    // Der eigentliche Fehler, den ein Cache machen kann.
    const { view, calls } = viewWithCounter();
    expect(view.getPropertyValue(1, 'Pset_A', 'Status')).toBe('alt-1');
    expect(view.getPropertyValue(2, 'Pset_A', 'Status')).toBe('alt-2');
    expect(view.getPropertyValue(1, 'Pset_A', 'Status')).toBe('alt-1');
    expect(calls).toEqual([1, 2, 1]);
  });

  it('haelt die Schreibvorgaenge auseinander, wenn sie sich abwechseln', () => {
    const { view } = viewWithCounter();
    view.setProperty(1, 'Pset_A', 'Status', 'eins', PropertyValueType.Label);
    view.setProperty(2, 'Pset_A', 'Status', 'zwei', PropertyValueType.Label);
    view.setProperty(1, 'Pset_A', 'Status', 'eins-b', PropertyValueType.Label);
    expect(view.getPropertyValue(1, 'Pset_A', 'Status')).toBe('eins-b');
    expect(view.getPropertyValue(2, 'Pset_A', 'Status')).toBe('zwei');
  });

  it('ueberlebt ein clear() nicht', () => {
    const { view, calls } = viewWithCounter();
    view.getPropertyValue(5, 'Pset_A', 'Status');
    view.clear();
    view.getPropertyValue(5, 'Pset_A', 'Status');
    expect(calls).toEqual([5, 5]);
  });

  it('behaelt die Basis, waehrend die Ueberlagerung sich aendert', () => {
    // Der Cache haelt die BASIS. Was der View obendrauf schreibt, darf er
    // nicht verdecken — sonst laese ein zweiter Schreibvorgang den alten Wert.
    const { view } = viewWithCounter();
    view.setProperty(3, 'Pset_A', 'Status', 'neu', PropertyValueType.Label);
    expect(view.getPropertyValue(3, 'Pset_A', 'Status')).toBe('neu');
    view.deleteProperty(3, 'Pset_A', 'Status');
    expect(view.getPropertyValue(3, 'Pset_A', 'Status')).toBe(null);
  });
});
