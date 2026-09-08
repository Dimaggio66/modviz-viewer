/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RelationshipType } from '@ifc-lite/data';
import { buildHierarchy, type RelationshipSource } from './hierarchy.js';

/**
 * A storey (1) contains two walls (2, 3); wall 2 has an opening (4) cut into
 * it and is aggregated from two parts (5, 6). Each edge uses a different IFC
 * relationship, which is the point: a Mengenabfrage means all three.
 */
function model(): RelationshipSource {
  const forward = new Map<string, number[]>([
    [`1|${RelationshipType.ContainsElements}`, [2, 3]],
    [`2|${RelationshipType.VoidsElement}`, [4]],
    [`2|${RelationshipType.Aggregates}`, [5, 6]],
  ]);
  const inverse = new Map<string, number[]>([
    [`2|${RelationshipType.ContainsElements}`, [1]],
    [`3|${RelationshipType.ContainsElements}`, [1]],
    [`4|${RelationshipType.VoidsElement}`, [2]],
    [`5|${RelationshipType.Aggregates}`, [2]],
    [`6|${RelationshipType.Aggregates}`, [2]],
  ]);
  return {
    getRelated: (id, type, direction) =>
      (direction === 'forward' ? forward : inverse).get(`${id}|${type}`) ?? [],
  };
}

describe('Objekthierarchie', () => {
  it('fasst alle drei Beziehungen zu einem Kindbegriff zusammen', () => {
    const h = buildHierarchy(model())!;
    assert.deepEqual([...h.childrenOf(1)], [2, 3], 'Geschoss enthaelt Waende');
    assert.deepEqual([...h.childrenOf(2)].sort(), [4, 5, 6], 'Oeffnung UND Teile');
    assert.deepEqual([...h.childrenOf(4)], []);
  });

  it('findet die Eltern in Gegenrichtung', () => {
    const h = buildHierarchy(model())!;
    assert.deepEqual([...h.parentsOf(4)], [2]);
    assert.deepEqual([...h.parentsOf(2)], [1]);
    assert.deepEqual([...h.parentsOf(1)], []);
  });

  it('liefert die Vorfahren von innen nach außen', () => {
    const h = buildHierarchy(model())!;
    assert.deepEqual([...h.ancestorsOf(4)], [2, 1], 'erst die Wand, dann das Geschoss');
    assert.deepEqual([...h.ancestorsOf(1)], []);
  });

  it('hängt sich nicht auf, wenn ein Modell einen Zyklus enthält', () => {
    // 1 ist Kind von 2 und 2 ist Kind von 1 — ohne Abbruch liefe das ewig.
    const zyklisch: RelationshipSource = {
      getRelated: (id, _t, direction) => (direction === 'inverse' ? [id === 1 ? 2 : 1] : []),
    };
    const h = buildHierarchy(zyklisch)!;
    assert.deepEqual([...h.ancestorsOf(1)], [2], 'jeder Vorfahr genau einmal, das Objekt selbst nie');
  });

  it('gibt null zurück, wenn der Store keine Beziehungen kennt', () => {
    assert.equal(buildHierarchy(null), null);
    assert.equal(buildHierarchy(undefined), null);
  });

  it('überlebt eine Beziehung, die der Store nicht führt', () => {
    const wirft: RelationshipSource = {
      getRelated: (_id, type) => {
        if (type === RelationshipType.VoidsElement) throw new Error('nicht geladen');
        return [9];
      },
    };
    const h = buildHierarchy(wirft)!;
    assert.deepEqual([...h.childrenOf(1)], [9], 'die anderen beiden zaehlen weiter');
  });
});
