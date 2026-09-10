/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { __internal, buildPropertyIndex } from './property-index.js';
import { Rule } from './filter-rules.js';
import type { IfcDataStore } from '@ifc-lite/parser';

const { key, indexFrom } = __internal;

/** Buckets as the walk would have collected them: (pset, property) → carriers. */
function index(entries: Array<[string, string, number[]]>) {
  const carriers = new Map<string, number[]>();
  for (const [setName, propertyName, ids] of entries) carriers.set(key(setName, propertyName), [...ids]);
  return indexFrom(carriers);
}

describe('Eigenschafts-Index — Kandidatenauswahl', () => {
  it('nennt die Traeger einer Eigenschaft', () => {
    const i = index([['Pset_A', 'DN', [1, 2]], ['Pset_A', 'Andere', [3]]]);
    assert.deepEqual(i.narrow([Rule.property('Pset_A', 'DN', 'eq', '100')], 'AND'), [1, 2]);
  });

  it('vergleicht Namen ohne Ruecksicht auf Gross- und Kleinschreibung', () => {
    // `matchPropertyRule` tut das auch. Ein Index, der es nicht taete, wuerde
    // genau die Treffer verlieren, die die Regel findet.
    const i = index([['Pset_A', 'DN', [7]]]);
    assert.deepEqual(i.narrow([Rule.property('PSET_a', 'dn', 'eq', '100')], 'AND'), [7]);
  });

  it('antwortet auf eine unbekannte Eigenschaft mit der leeren Menge, nicht mit null', () => {
    // Niemand traegt sie, also kann sie niemand erfuellen — das ist die
    // schnellste richtige Antwort, kein Grund das Modell zu scannen.
    const i = index([['Pset_A', 'DN', [1]]]);
    assert.deepEqual(i.narrow([Rule.property('Pset_A', 'Fehlt', 'eq', 'x')], 'AND'), []);
  });

  it('schraenkt bei isNotSet NICHT ein', () => {
    // Die einzige Op, die ein Objekt OHNE die Eigenschaft erfuellt
    // (`matchPropertyRule` antwortet dort `!present`). Ein Eimer waere hier
    // genau die falsche Menge.
    const i = index([['Pset_A', 'DN', [1]]]);
    assert.equal(i.narrow([Rule.property('Pset_A', 'DN', 'isNotSet', '')], 'AND'), null);
  });

  it('schraenkt bei ne und notContains sehr wohl ein', () => {
    // Beide laufen ueber `rows.some(...)` und brauchen eine vorhandene Zeile —
    // ein Objekt ohne die Eigenschaft trifft auch damit nicht zu.
    const i = index([['P', 'a', [1, 2]]]);
    assert.deepEqual(i.narrow([Rule.property('P', 'a', 'ne', 'x')], 'AND'), [1, 2]);
    assert.deepEqual(i.narrow([Rule.property('P', 'a', 'notContains', 'x')], 'AND'), [1, 2]);
  });

  it('faellt zurueck, wenn keine Regel indiziert ist', () => {
    const i = index([['P', 'a', [1]]]);
    assert.equal(i.narrow([Rule.ifcType(['IfcWall'])], 'AND'), null);
    assert.equal(i.narrow([], 'AND'), null);
  });

  it('schneidet unter AND und vereinigt unter OR', () => {
    const i = index([['P', 'a', [1, 2]], ['P', 'b', [1, 3]]]);
    const a = Rule.property('P', 'a', 'isSet', '');
    const b = Rule.property('P', 'b', 'isSet', '');
    assert.deepEqual(i.narrow([a, b], 'AND'), [1]);
    assert.deepEqual(i.narrow([a, b], 'OR'), [1, 2, 3]);
  });

  it('nimmt unter AND die nicht indizierten Regeln einfach mit', () => {
    // Jede indizierte Regel begrenzt die ganze UND-Abfrage fuer sich allein.
    const i = index([['P', 'a', [1, 2]]]);
    const gemischt = [Rule.property('P', 'a', 'eq', 'x'), Rule.ifcType(['IfcWall'])];
    assert.deepEqual(i.narrow(gemischt, 'AND'), [1, 2]);
  });

  it('verweigert die OR-Vereinigung, sobald ein Glied unbeschraenkt ist', () => {
    // Unter ODER genuegt ein Glied ohne Eimer, damit noch jedes Objekt
    // zutreffen kann — dann darf die Gruppe gar nicht eingeschraenkt werden.
    const i = index([['P', 'a', [1]]]);
    assert.equal(i.narrow([Rule.property('P', 'a', 'eq', 'x'), Rule.ifcType(['IfcWall'])], 'OR'), null);
    assert.equal(i.narrow([Rule.property('P', 'a', 'eq', 'x'), Rule.property('P', 'a', 'isNotSet', '')], 'OR'), null);
  });

  it('gibt jede Id nur einmal aus', () => {
    // Ein Objekt, das die Eigenschaft selbst traegt UND vom Typ erbt, wurde
    // zweimal eingetragen. Eine doppelte Id in der Kandidatenliste laesst den
    // Evaluator dasselbe Element zweimal ausgeben.
    const i = index([['P', 'x', [5, 1, 5, 3, 1]]]);
    assert.deepEqual(i.narrow([Rule.property('P', 'x', 'isSet', '')], 'AND'), [1, 3, 5]);
    assert.equal(i.entries, 3);
  });

  it('indiziert nichts ohne Quellbytes', () => {
    // Der Server-Pfad liest eine vorgefertigte Tabelle, deren Erhebung
    // gedeckelt ist — ein Index daraus waere unvollstaendig, und ein
    // unvollstaendiger Index verliert stillschweigend Treffer.
    const ohneQuelle = { source: null, onDemandPropertyMap: new Map() } as unknown as IfcDataStore;
    assert.equal(buildPropertyIndex(ohneQuelle), null);
  });

  it('indiziert nichts ohne Beziehungsgraph', () => {
    // Ohne ihn bleiben die vom Typ geerbten Eigenschaften unsichtbar.
    const ohneGraph = {
      source: { length: 1 },
      onDemandPropertyMap: new Map(),
      relationships: null,
    } as unknown as IfcDataStore;
    assert.equal(buildPropertyIndex(ohneGraph), null);
  });
});

describe('Eigenschafts-Index — wer traegt es in der Datei', () => {
  it('nennt die Traeger, sortiert', () => {
    const i = index([['P', 'a', [5, 1, 3]]]);
    assert.deepEqual([...i.carriers('P', 'a')], [1, 3, 5]);
  });

  it('antwortet auf ein Attribut, das die Datei nicht kennt, mit leer', () => {
    // Das ist eine Auskunft, keine Ratlosigkeit: die Eimer sind vollstaendig,
    // also traegt es wirklich niemand. Der Objektfilter spart sich damit den
    // Griff in die Datei fuer jedes einzelne Objekt.
    const i = index([['5D', 'DN', [1]]]);
    assert.equal(i.carriers('Pset_ModViz', '5D_Kategorie').length, 0);
  });

  it('faltet auch hier die Gross- und Kleinschreibung', () => {
    const i = index([['Pset_A', 'DN', [9]]]);
    assert.deepEqual([...i.carriers('pset_a', 'dn')], [9]);
  });
});
