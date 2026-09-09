/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ifcClassOf, isTypeEntityName } from './ifc-type-entity.js';

describe('Typ-Entitaet erkennen', () => {
  it('nimmt die gewoehnlichen *Type-Klassen', () => {
    for (const n of ['IfcWallType', 'IfcPipeFittingType', 'IfcSanitaryTerminalType']) {
      assert.equal(isTypeEntityName(n), true, n);
    }
  });

  it('nimmt IfcDoorStyle und IfcWindowStyle', () => {
    // IFC2X3 fuehrt Tueren und Fenster ueber eine *Style-Entitaet.
    assert.equal(isTypeEntityName('IfcDoorStyle'), true);
    assert.equal(isTypeEntityName('IfcWindowStyle'), true);
  });

  it('ist unabhaengig von der Schreibweise', () => {
    // getTypeName antwortet in der Schreibweise der Datei, wenn es die Klasse
    // nicht kennt — genau so kam "IFCDOORSTYLE" aus DHL_Leer_R2026.
    assert.equal(isTypeEntityName('IFCDOORSTYLE'), true);
    assert.equal(isTypeEntityName('IFCWALLTYPE'), true);
  });

  it('haelt die uebrigen *Style-Klassen heraus', () => {
    // Praesentation, keine Typobjekte — die duerfen nicht mitgezogen werden.
    for (const n of ['IfcSurfaceStyle', 'IfcCurveStyle', 'IfcTextStyle', 'IfcPresentationStyle']) {
      assert.equal(isTypeEntityName(n), false, n);
    }
  });

  it('nimmt keine gewoehnlichen Bauteile', () => {
    for (const n of ['IfcWall', 'IfcDoor', 'IfcWindow', 'IfcPipeFitting']) {
      assert.equal(isTypeEntityName(n), false, n);
    }
  });

  it('vertraegt leer und Unknown', () => {
    assert.equal(isTypeEntityName(''), false);
    assert.equal(isTypeEntityName(null), false);
    assert.equal(isTypeEntityName(undefined), false);
    assert.equal(isTypeEntityName('Unknown'), false);
  });
});

describe('IFC-Klasse eines Objekts', () => {
  const store = (indexKlasse: string | undefined, schemaKlasse: string | undefined) => ({
    entityIndex: { byId: { get: () => (indexKlasse === undefined ? undefined : { type: indexKlasse }) } },
    entities: { getTypeName: () => schemaKlasse },
  });

  it('nimmt den Index, wenn das Schema "Unknown" sagt', () => {
    // Genau der gemessene Fall: im Browser antwortet getTypeName fuer die
    // Typobjekte "Unknown", der Index kennt sie als IFCPIPEFITTINGTYPE.
    assert.equal(ifcClassOf(store('IFCPIPEFITTINGTYPE', 'Unknown'), 410663), 'IFCPIPEFITTINGTYPE');
    assert.equal(isTypeEntityName(ifcClassOf(store('IFCPIPEFITTINGTYPE', 'Unknown'), 410663)), true);
  });

  it('faellt auf das Schema zurueck, wenn der Index nichts hat', () => {
    assert.equal(ifcClassOf(store(undefined, 'IfcWallType'), 1), 'IfcWallType');
  });

  it('vertraegt einen Store ohne Index und ohne Schema', () => {
    assert.equal(ifcClassOf(store(undefined, undefined), 1), '');
    assert.equal(ifcClassOf(null, 1), '');
    assert.equal(ifcClassOf(undefined, 1), '');
  });
});
