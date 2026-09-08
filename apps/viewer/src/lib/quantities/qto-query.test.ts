/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Every formula asserted here is quoted from a source, not invented: either
 * from the RIB manual "CPI-Modell / Mengenabfragen in RIB iTWO" (2024) or from
 * the hand-built Ausstattung table this project has to reproduce — including
 * the two rows that look like data errors in it, kept so a later check can
 * flag them rather than swallow them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseQtoQuery,
  evaluateQtoQuery,
  attributeNumber,
  roundk,
  type QtoContext,
} from './qto-query.js';

/** A tiny model: id -> attribute name -> stored text, as the readers give it. */
function ctxOf(model: Record<number, Record<string, string>>): QtoContext {
  return {
    entityIds: Object.keys(model).map(Number),
    readAttribute: (id, name) => model[id]?.[name] ?? null,
  };
}

function parsed(src: string) {
  const p = parseQtoQuery(src);
  assert.ok(p.ok, `sollte parsen: ${src}${p.ok ? '' : ' — ' + p.error}`);
  return p.expr;
}

function run(src: string, ctx: QtoContext) {
  return evaluateQtoQuery(parsed(src), ctx);
}

describe('Mengenabfrage — Formel', () => {
  it('liest eine reine Stückzahl-Abfrage', () => {
    assert.deepEqual(parsed('QTO(Typ:="Stückzahl";ME:="St")'), {
      kind: 'qto',
      measure: { kind: 'count' },
      me: 'St',
      bauteil: null,
      extras: [],
    });
  });

  it('liest eine Attributsumme in roundk', () => {
    const e = parsed('roundk(QTO(Typ:="Attribut{5D_Länge}";ME:="m");1)');
    assert.equal(e.kind, 'roundk');
    if (e.kind !== 'roundk') return;
    assert.equal(e.digits, 1);
    assert.deepEqual(e.inner, {
      kind: 'qto',
      measure: { kind: 'attribute', name: '5D_Länge' },
      me: 'm',
      bauteil: null,
      extras: [],
    });
  });

  it('erkennt einen Geometrie-Parameter als eigene Mengenart', () => {
    // Handbuch, Beispiel 1: Berechnung aus der Geometrie.
    const e = parsed('QTO(Typ:="Volumen";ME:="m3")');
    assert.deepEqual((e as { measure: unknown }).measure, { kind: 'geometry', parameter: 'Volumen' });
  });

  it('liest 40.000 als vierzig, nicht als vierzigtausend', () => {
    const e = parsed('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{5D_DN} == (40.000 [mm])")');
    if (e.kind !== 'qto' || !e.bauteil) return assert.fail('Form');
    assert.deepEqual(e.bauteil.levels[0]!.all[0]!.value, { kind: 'number', value: 40, unit: 'mm' });
  });

  it('liest auch die Komma-Schreibweise des Handbuchs', () => {
    const e = parsed('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{Depth} ==(0,3[m])")');
    if (e.kind !== 'qto' || !e.bauteil) return assert.fail('Form');
    assert.deepEqual(e.bauteil.levels[0]!.all[0]!.value, { kind: 'number', value: 0.3, unit: 'm' });
  });

  it('liest den nachgestellten Faktor mit deutschem Dezimalkomma', () => {
    const e = parsed(
      'QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{5D_DN} == (40.000 [mm])")*(1,18*0,05)',
    );
    assert.equal(e.kind, 'product');
  });

  it('parst die beiden auffälligen Zeilen der manuellen Tabelle unverändert', () => {
    for (const src of [
      'QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{5D_DN} == (90.000 [mm])")*(1,5*90)',
      'QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{5D_DN} == (150.000 [mm])")*(2,6*0,150)',
    ]) {
      assert.ok(parseQtoQuery(src).ok, src);
    }
  });

  it('meldet eine kaputte Formel, statt zu werfen', () => {
    const p = parseQtoQuery('roundk(QTO(Typ:="Attribut{5D_Länge}";ME:="m")');
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.match(p.error, /Semikolon/);
  });
});

describe('Bauteil — Bedingungen aus dem Handbuch', () => {
  it('liest den Textvergleich mit einfachen Anführungszeichen', () => {
    const e = parsed('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{RevitCategoryName} ==\'Walls\' ")');
    if (e.kind !== 'qto' || !e.bauteil) return assert.fail('Form');
    assert.deepEqual(e.bauteil.levels[0]!.all[0], {
      subject: { kind: 'attribute', name: 'RevitCategoryName' },
      op: '==',
      value: { kind: 'text', text: 'Walls', wildcard: false },
    });
  });

  it('verknüpft mehrere Bedingungen einer Ebene mit "und"', () => {
    const e = parsed(
      'QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{RevitCategoryName} ==\'Columns\' und Attribut{Depth} ==(0,3[m]) und HöheOptOBB== (4,5[m])")',
    );
    if (e.kind !== 'qto' || !e.bauteil) return assert.fail('Form');
    assert.equal(e.bauteil.levels.length, 1, 'eine Ebene');
    assert.equal(e.bauteil.levels[0]!.all.length, 3, 'drei Bedingungen');
    assert.deepEqual(e.bauteil.levels[0]!.all[2]!.subject, { kind: 'parameter', name: 'HöheOptOBB' });
  });

  it('behandelt das Semikolon als Hierarchie-Stufe, NICHT als ODER', () => {
    // Handbuch Beispiel 13: "Öffnungen nur in Wänden" — Ergebnis 8, nicht 10.
    const e = parsed('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Wall\';Bauteiltyp==\'Opening\'")');
    if (e.kind !== 'qto' || !e.bauteil) return assert.fail('Form');
    assert.equal(e.bauteil.levels.length, 2);
    assert.equal(e.bauteil.depthSearch, false);
    assert.deepEqual(e.bauteil.levels[0]!.all[0]!.value, { kind: 'text', text: 'Wall', wildcard: false });
    assert.deepEqual(e.bauteil.levels[1]!.all[0]!.value, { kind: 'text', text: 'Opening', wildcard: false });
  });

  it('erkennt das abschließende Semikolon als Tiefensuche', () => {
    const e = parsed('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Opening\';")');
    if (e.kind !== 'qto' || !e.bauteil) return assert.fail('Form');
    assert.equal(e.bauteil.levels.length, 1);
    assert.equal(e.bauteil.depthSearch, true);
  });

  it('liest Systemparameter mit $ und Platzhalter im Text', () => {
    const e = parsed('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="$MaterialName==\'*\';")');
    if (e.kind !== 'qto' || !e.bauteil) return assert.fail('Form');
    assert.deepEqual(e.bauteil.levels[0]!.all[0]!.subject, { kind: 'system', name: 'MaterialName' });
    assert.equal(e.bauteil.levels[0]!.all[0]!.value.kind === 'text' && e.bauteil.levels[0]!.all[0]!.value.wildcard, true);
  });

  it('liest die Vergleichsoperatoren mit und ohne Einheit', () => {
    for (const [src, op] of [
      ['Bodenversatz>(0,0[m])', '>'],
      ['Bodenversatz>0', '>'],
      ['Bodenversatz==(0.00[m])', '=='],
    ] as const) {
      const e = parsed(`QTO(Typ:="Stückzahl";ME:="St";Bauteil:="${src}")`);
      if (e.kind !== 'qto' || !e.bauteil) return assert.fail('Form');
      assert.equal(e.bauteil.levels[0]!.all[0]!.op, op, src);
    }
  });
});

describe('Mengenabfrage — Auswertung', () => {
  const model = {
    1: { '5D_DN': '40', '5D_Länge': '2.5', '5D_Durchmesser': '40', Material: 'Guss' },
    2: { '5D_DN': '40', '5D_Länge': '1.25', '5D_Durchmesser': '40', Material: 'Guss' },
    3: { '5D_DN': '50', '5D_Länge': '10', '5D_Durchmesser': '50', Material: 'PE' },
    4: { '5D_DN': '40', Material: 'Guss' }, // passt, hat aber keine Länge
  };

  it('zählt alle Elemente im Geltungsbereich ohne Bauteil', () => {
    const r = run('QTO(Typ:="Stückzahl";ME:="St")', ctxOf(model));
    assert.equal(r.value, 4);
    assert.equal(r.unit, 'St');
    assert.deepEqual(r.matchedIds, [1, 2, 3, 4]);
  });

  it('zählt nur, was die Bauteil-Bedingung auswählt', () => {
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{5D_DN} == (40.000 [mm])")', ctxOf(model));
    assert.equal(r.value, 3);
    assert.deepEqual(r.matchedIds, [1, 2, 4]);
  });

  it('filtert über einen Textvergleich mit Platzhalter', () => {
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{Material} ==\'Gu*\'")', ctxOf(model));
    assert.equal(r.value, 3);
  });

  it('summiert das benannte Attribut und rundet kaufmännisch', () => {
    const r = run('roundk(QTO(Typ:="Attribut{5D_Länge}";ME:="m");1)', ctxOf(model));
    assert.equal(r.value, 13.8); // 2.5 + 1.25 + 10
    assert.equal(r.unit, 'm');
  });

  it('merkt sich ein Element, das passte, aber keine lesbare Zahl trug', () => {
    const r = run(
      'QTO(Typ:="Attribut{5D_Länge}";ME:="m";Bauteil:="Attribut{5D_DN} == (40.000 [mm])")',
      ctxOf(model),
    );
    assert.equal(r.value, 3.75);
    assert.deepEqual(r.matchedIds, [1, 2]);
    assert.deepEqual(r.skipped, [4], 'Element 4 fehlt die Länge und muss auffallen');
  });

  it('wendet den nachgestellten Faktor auf eine Stückzahl an', () => {
    const r = run(
      'QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{5D_DN} == (40.000 [mm])")*(1,18*0,05)',
      ctxOf(model),
    );
    assert.ok(r.value !== null && Math.abs(r.value - 0.177) < 1e-12, `war ${r.value}`);
    assert.equal(r.unit, 'St', 'die ME der QTO, nicht die der Zeile');
  });

  it('hält den Prüfpfad — matchedIds sind die Elemente hinter der Zahl', () => {
    const r = run(
      'roundk(QTO(Typ:="Attribut{5D_Länge}";ME:="m";Bauteil:="Attribut{5D_Durchmesser} ==(50[mm]) ");1)',
      ctxOf(model),
    );
    assert.equal(r.value, 10);
    assert.deepEqual(r.matchedIds, [3]);
  });
});

describe('Bauteiltyp', () => {
  it('nimmt das geschriebene cpiComponentType, wie die Mapping-Regeln es setzen', () => {
    // Die XML des Projekts schreibt cpiComponentType=Default fuer DUCTFITTING.
    const ctx = ctxOf({
      1: { cpiComponentType: 'Default' },
      2: { cpiComponentType: 'Attribute' },
      3: { cpiComponentType: 'Default' },
    });
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Default\'")', ctx);
    assert.equal(r.value, 2);
    assert.deepEqual(r.matchedIds, [1, 3]);
  });

  it('fällt auf die IFC-Klasse zurück, wenn nichts geschrieben wurde', () => {
    const klassen: Record<number, string> = { 1: 'IfcWallStandardCase', 2: 'IfcColumn', 3: 'IfcWall' };
    const ctx: QtoContext = {
      entityIds: [1, 2, 3],
      readAttribute: () => null,
      ifcClassOf: (id) => klassen[id] ?? null,
    };
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Wall\'")', ctx);
    assert.equal(r.value, 2, 'IfcWall und IfcWallStandardCase sind beide Wall');
  });

  it('rät nicht, wenn weder Attribut noch bekannte Klasse da ist', () => {
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Wall\'")', ctxOf({ 1: {} }));
    assert.equal(r.value, 0, 'das Element passt nicht — das ist kein Fehler');
    assert.deepEqual(r.unresolved, [1]);
    assert.deepEqual(r.unsupported, []);
  });

  it('ein unentscheidbares Element vernichtet die Menge der anderen NICHT', () => {
    // Genau der Fehler, den der Lauf gegen das echte Modell aufgedeckt hat:
    // ein gemischtes Modell hat immer Elemente ohne Bauteiltyp.
    const klassen: Record<number, string> = { 1: 'IfcWall', 2: 'IfcWall', 3: 'IfcFlowSegment' };
    const ctx: QtoContext = {
      entityIds: [1, 2, 3],
      readAttribute: () => null,
      ifcClassOf: (id) => klassen[id] ?? null,
    };
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Wall\'")', ctx);
    assert.equal(r.value, 2, 'die beiden Wände zählen weiterhin');
    assert.deepEqual(r.unresolved, [3], 'das dritte Element gehört auf die Prüfliste');
  });
});

describe('Tiefensuche — die Zahlen aus Beispiel 13 des Handbuchs', () => {
  // Zwei Wände und eine Decke; 8 Öffnungen in den Wänden, 2 in der Decke.
  const typ: Record<number, string> = { 1: 'Wall', 2: 'Wall', 3: 'Slab' };
  const kinder: Record<number, number[]> = { 1: [10, 11, 12, 13], 2: [14, 15, 16, 17], 3: [18, 19] };
  for (let id = 10; id <= 19; id++) typ[id] = 'Opening';

  const ctx: QtoContext = {
    entityIds: [1, 2, 3],
    readAttribute: (id, name) => (name === 'cpiComponentType' ? typ[id] ?? null : null),
    childrenOf: (id) => kinder[id] ?? [],
  };

  it('zählt mit abschließendem Semikolon ALLE Öffnungen — 10', () => {
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Opening\';")', ctx);
    assert.equal(r.value, 10);
  });

  it('zählt über die Kette Wand-dann-Öffnung nur 8', () => {
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Wall\';Bauteiltyp==\'Opening\'")', ctx);
    assert.equal(r.value, 8, 'Öffnungen in der Decke zählen hier nicht mit');
  });

  it('zählt mit einer zusätzlichen "und"-Bedingung auf der ersten Ebene 2', () => {
    // Handbuch: nur Öffnungen in Mauerwerkswänden.
    const mit: QtoContext = {
      ...ctx,
      readAttribute: (id, name) =>
        name === 'cpiComponentType' ? typ[id] ?? null : id === 1 ? 'Mauerwerk - Sichtmauerwerk' : null,
    };
    const r = run(
      'QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Wall\' und Attribut{MaterialName}==\'Mauerwerk - Sichtmauerwerk\';Bauteiltyp==\'Opening\'")',
      mit,
    );
    assert.equal(r.value, 4, 'nur die Öffnungen der einen Mauerwerkswand');
  });

  it('verweigert die Kette, wenn keine Hierarchie übergeben wurde', () => {
    const ohne = ctxOf({ 1: { cpiComponentType: 'Wall' } });
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp==\'Wall\';Bauteiltyp==\'Opening\'")', ohne);
    assert.equal(r.value, null);
    assert.match(r.unsupported[0]!, /keine Hierarchie/);
  });
});

describe('Mengenabfrage — was NICHT gerechnet wird, gibt keine Zahl zurück', () => {
  const ctx = ctxOf({ 1: { Material: 'Guss' }, 2: { Material: 'PE' } });

  it('liefert für einen Geometrie-Parameter null statt 0', () => {
    const r = run('QTO(Typ:="Mantelfläche";ME:="m2")', ctx);
    assert.equal(r.value, null, '0 saehe aus wie eine gerechnete Menge');
    assert.deepEqual(r.unsupported, ['Geometrie-Parameter Mantelfläche']);
    assert.deepEqual(r.matchedIds, []);
  });

  it('rechnet einen Geometrie-Parameter, sobald ein Provider da ist', () => {
    const mitGeometrie: QtoContext = {
      entityIds: [1, 2],
      readAttribute: () => null,
      readGeometryParameter: (id, p) => (p === 'Mantelfläche' ? id * 1.5 : null),
    };
    const r = run('QTO(Typ:="Mantelfläche";ME:="m2")', mitGeometrie);
    assert.equal(r.value, 4.5);
  });

  it('nennt einen Systemparameter, den es nicht auflösen kann', () => {
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Bauteil:="$MaterialName==\'Beton\'")', ctx);
    assert.equal(r.value, null);
    assert.deepEqual(r.unsupported, ['Systemparameter $MaterialName']);
  });
});

describe('Zahlen', () => {
  it('rundet kaufmännisch, inklusive der Double-Falle', () => {
    assert.equal(roundk(2.675, 2), 2.68);
    assert.equal(roundk(-2.675, 2), -2.68);
    assert.equal(roundk(13.75, 1), 13.8);
    assert.equal(roundk(0.5, 0), 1);
    assert.equal(roundk(-0.5, 0), -1);
  });

  it('liest gespeicherte Attributwerte, Punkt oder Komma', () => {
    assert.equal(attributeNumber('2.5'), 2.5);
    assert.equal(attributeNumber('2,5'), 2.5);
    assert.equal(attributeNumber(''), null);
    assert.equal(attributeNumber(null), null);
    assert.equal(attributeNumber('DN40'), null);
  });
});

describe('Handbuch-Grammatik — was der Parser vorher abgelehnt hat', () => {
  it('liest die englische Schreibweise aus dem Handbuch', () => {
    // Wörtlich aus RIB iTWO 2026 – Ausstattung, Kapitel 4.3.3.
    const e = parsed('QTO (Type:="Flaeche";UoM:="m";Norm:="VOB\\013";CondComp:="Gewerk==012")');
    if (e.kind !== 'qto') return assert.fail('Form');
    assert.deepEqual(e.measure, { kind: 'geometry', parameter: 'Flaeche' });
    assert.equal(e.me, 'm', 'UoM ist ME');
    assert.ok(e.bauteil, 'CondComp ist Bauteil');
    assert.deepEqual(e.extras, [{ key: 'Norm', value: 'VOB\\013' }]);
  });

  it('verträgt das Leerzeichen vor der Klammer, das RIB selbst schreibt', () => {
    assert.ok(parseQtoQuery('QTO (Typ:="Stückzahl";ME:="St")').ok);
  });

  it('liest optionale Parameterschlüssel, statt die ganze Formel abzulehnen', () => {
    const e = parsed(
      'QTO(Typ:="Mantelfläche";ME:="m²";Norm:="VOB\\018";Bauteil:="Bauteiltyp==\'Wall\'")',
    );
    if (e.kind !== 'qto') return assert.fail('Form');
    assert.deepEqual(e.extras, [{ key: 'Norm', value: 'VOB\\018' }]);
  });

  it('gibt für einen nicht berücksichtigten Schlüssel KEINE Zahl zurück', () => {
    const ctx = ctxOf({ 1: {}, 2: {} });
    const r = run('QTO(Typ:="Stückzahl";ME:="St";Norm:="VOB\\018")', ctx);
    assert.equal(r.value, null, 'eine Abzugsnorm zu ignorieren waere eine falsche Menge');
    assert.deepEqual(r.unsupported, ['Parameter Norm']);
  });

  it('liest conv() aus dem Umrechnungsbeispiel des Handbuchs', () => {
    // 4.3.2: dieselbe Formel liefert 4.686,600 bzw. 4,687 — je nach conv.
    const p = parseQtoQuery('QTO(Typ:="Volumen";ME:="m3")*conv("kg")');
    assert.ok(p.ok, p.ok ? '' : p.error);
    if (!p.ok || p.expr.kind !== 'product') return assert.fail('Form');
    const call = p.expr.factors[1]!;
    assert.equal(call.kind, 'call');
    if (call.kind !== 'call') return;
    assert.equal(call.name, 'conv');
    assert.deepEqual(call.args, [{ kind: 'text', value: 'kg' }]);
  });

  it('rechnet eine unbekannte Funktion nicht heimlich weg', () => {
    const ctx = ctxOf({ 1: {}, 2: {} });
    const r = run('QTO(Typ:="Stückzahl";ME:="St")*conv("kg")', ctx);
    assert.equal(r.value, null);
    assert.deepEqual(r.unsupported, ['Funktion conv']);
  });

  it('liest auch wenn() und sin(), ohne sie zu rechnen', () => {
    for (const src of ['sin(1,5)', 'wenn(1;2;3)']) {
      const p = parseQtoQuery(src);
      assert.ok(p.ok, `${src}: ${p.ok ? '' : p.error}`);
    }
  });
});
