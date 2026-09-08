/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PropertyValueType } from '@ifc-lite/data';
import {
  planWrites,
  resolveTemplate,
  templateTokens,
  describeAction,
  ruleTableRows,
  coerceValue,
  propertyValueTypeOf,
  staleTargetRefs,
  refKeyOf,
  type AttributeRule,
  type PropReader,
  COMPONENT_TYPE_PROPERTY,
  DEFAULT_TARGET_PSET,
} from './attribute-rules.js';

/** Two objects: 1 already carries Pset_A.Status, 2 does not. */
const VALUES = new Map<string, string>([
  ['1|Pset_A|Status', 'Draft'],
  ['1|Pset_A|ProjectID', '007'],
  ['1|Pset_A|LevelNo', '1'],
  ['1|Pset_A|TradeNo', '5'],
  ['2|Pset_A|ProjectID', '008'],
]);

const read: PropReader = (id, pset, prop) => VALUES.get(`${id}|${pset}|${prop}`) ?? null;
const readByName = (id: number, prop: string) =>
  [...VALUES].find(([k]) => k.startsWith(`${id}|`) && k.endsWith(`|${prop}`))?.[1] ?? null;

function rule(action: AttributeRule['action'], entityIds = [1, 2]): AttributeRule {
  return { id: 'r1', conditions: [{ label: 'ifcType', value: '*wall*' }], entityIds, action, enabled: true };
}

const TEXT = { dataType: 'text', unit: '' } as const;

describe('resolveTemplate', () => {
  it('composes a value from existing attributes (RIB §6.8.1.2.3 example)', () => {
    // ProjectID=007, LevelNo=1, TradeNo=5 -> SN = 00715
    const out = resolveTemplate('@Attr{ProjectID}@Attr{LevelNo}@Attr{TradeNo}', (n) => readByName(1, n));
    assert.strictEqual(out, '00715');
  });

  it('treats an absent attribute as empty and keeps literal text', () => {
    assert.strictEqual(resolveTemplate('X-@Attr{Nope}-Y', () => null), 'X--Y');
  });

  it('lists the referenced attribute names', () => {
    assert.deepStrictEqual(templateTokens('@Attr{A}/@Attr{ B }'), ['A', 'B']);
  });
});

describe('coerceValue', () => {
  it('parses integers and decimals, German comma included', () => {
    assert.strictEqual(coerceValue('12,5', 'decimal'), 12.5);
    assert.strictEqual(coerceValue('12,9', 'integer'), 12);
  });

  it('rejects text that is not the chosen type, so the write is skipped', () => {
    assert.strictEqual(coerceValue('abc', 'decimal'), null);
    assert.strictEqual(coerceValue('vielleicht', 'boolean'), null);
  });

  it('accepts German and English booleans', () => {
    assert.strictEqual(coerceValue('wahr', 'boolean'), true);
    assert.strictEqual(coerceValue('No', 'boolean'), false);
  });

  it('maps data types onto the store property types', () => {
    assert.strictEqual(propertyValueTypeOf('integer'), PropertyValueType.Integer);
    assert.strictEqual(propertyValueTypeOf('decimal'), PropertyValueType.Real);
    assert.strictEqual(propertyValueTypeOf('boolean'), PropertyValueType.Boolean);
    assert.strictEqual(propertyValueTypeOf('date'), PropertyValueType.Label);
  });
});

describe('planWrites — write modes', () => {
  const target = { psetName: 'Pset_A', propName: 'Status' };

  it('add: only objects without a value', () => {
    const w = planWrites([rule({ kind: 'add', target, value: 'Final', ...TEXT, mode: 'add' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => x.entityId), [2]);
  });

  it('overwrite: only objects that already have one', () => {
    const w = planWrites([rule({ kind: 'add', target, value: 'Final', ...TEXT, mode: 'overwrite' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => x.entityId), [1]);
  });

  it('addOverwrite: every object', () => {
    const w = planWrites([rule({ kind: 'add', target, value: 'Final', ...TEXT, mode: 'addOverwrite' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => x.entityId), [1, 2]);
  });

  it('carries the typed value and its property type', () => {
    const w = planWrites([rule({ kind: 'add', target: { psetName: 'P', propName: 'N' }, value: '42', dataType: 'integer', unit: 'mm', mode: 'addOverwrite' }, [1])], read, readByName);
    assert.strictEqual(w[0].value, 42);
    assert.strictEqual(w[0].valueType, PropertyValueType.Integer);
  });

  it('skips a value that cannot be the chosen type', () => {
    const w = planWrites([rule({ kind: 'add', target: { psetName: 'P', propName: 'N' }, value: 'abc', dataType: 'decimal', unit: '', mode: 'addOverwrite' })], read, readByName);
    assert.deepStrictEqual(w, []);
  });

  it('skips disabled rules', () => {
    const r = { ...rule({ kind: 'add', target, value: 'x', ...TEXT, mode: 'addOverwrite' }), enabled: false };
    assert.deepStrictEqual(planWrites([r], read, readByName), []);
  });
});

describe('planWrites — actions', () => {
  it('compose: skips an object whose referenced attributes are all absent', () => {
    const w = planWrites([rule({ kind: 'compose', target: { psetName: 'Pset_A', propName: 'SN' }, template: '@Attr{LevelNo}@Attr{TradeNo}', ...TEXT, mode: 'addOverwrite' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => [x.entityId, x.value]), [[1, '15']]);
  });

  it('copy: only where the source has a value', () => {
    const w = planWrites([rule({ kind: 'copy', source: { psetName: 'Pset_A', propName: 'Status' }, target: { psetName: 'Pset_B', propName: 'Status2' }, mode: 'addOverwrite' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => [x.entityId, x.propName, x.value]), [[1, 'Status2', 'Draft']]);
  });

  it('rename: writes the new name and deletes the old one', () => {
    const w = planWrites([rule({ kind: 'rename', source: { psetName: 'Pset_A', propName: 'Status' }, propName: 'State' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => [x.op, x.propName]), [['set', 'State'], ['delete', 'Status']]);
  });

  it('delete: several attributes at once, skipping absent ones', () => {
    const w = planWrites([rule({ kind: 'delete', targets: [{ psetName: 'Pset_A', propName: 'Status' }, { psetName: 'Pset_A', propName: 'ProjectID' }] })], read, readByName);
    assert.deepStrictEqual(w.map((x) => [x.entityId, x.propName]), [[1, 'Status'], [1, 'ProjectID'], [2, 'ProjectID']]);
  });

  it('applies collected rules in order', () => {
    const w = planWrites(
      [
        rule({ kind: 'add', target: { psetName: 'P', propName: 'A' }, value: '1', ...TEXT, mode: 'addOverwrite' }, [1]),
        rule({ kind: 'add', target: { psetName: 'P', propName: 'B' }, value: '2', ...TEXT, mode: 'addOverwrite' }, [1]),
      ],
      read,
      readByName,
    );
    assert.deepStrictEqual(w.map((x) => x.propName), ['A', 'B']);
  });
});

describe('ruleTableRows', () => {
  it('lists a rule as a numbered group with its Ein and Aus rows', () => {
    const rows = ruleTableRows([rule({ kind: 'add', target: { psetName: 'P', propName: 'N' }, value: 'v', dataType: 'text', unit: 'm', mode: 'add' }, [1])]);
    assert.deepStrictEqual(rows.map((r) => r.kind), ['group', 'in', 'out']);
    assert.strictEqual(rows[0].number, 1);
    assert.deepStrictEqual([rows[1].direction, rows[1].attribute, rows[1].value], ['Ein', 'ifcType', '*wall*']);
    assert.deepStrictEqual([rows[2].direction, rows[2].name, rows[2].unit, rows[2].mode], ['Aus', 'N', 'm', 'Add']);
  });

  it('emits one Aus row per deleted attribute', () => {
    const rows = ruleTableRows([rule({ kind: 'delete', targets: [{ psetName: 'P', propName: 'A' }, { psetName: 'P', propName: 'B' }] }, [1])]);
    assert.strictEqual(rows.filter((r) => r.kind === 'out').length, 2);
  });
});

describe('planWrites — only the changes', () => {
  it('plans nothing when the value is already what the rule would write', () => {
    const r = rule({ kind: 'add', target: { psetName: 'Pset_A', propName: 'Status' }, value: 'Draft', ...TEXT, mode: 'addOverwrite' }, [1]);
    // Entity 1 already carries Status='Draft'.
    assert.deepStrictEqual(planWrites([r], read, readByName), []);
  });

  it('still plans the objects that differ', () => {
    const r = rule({ kind: 'add', target: { psetName: 'Pset_A', propName: 'Status' }, value: 'Draft', ...TEXT, mode: 'addOverwrite' }, [1, 2]);
    assert.deepStrictEqual(planWrites([r], read, readByName).map((w) => w.entityId), [2]);
  });

  it('does not plan a delete for an attribute that is not there', () => {
    const r = rule({ kind: 'delete', targets: [{ psetName: 'Pset_A', propName: 'Nope' }] }, [1, 2]);
    assert.deepStrictEqual(planWrites([r], read, readByName), []);
  });

  it('re-running a plan against its own result is a no-op', () => {
    // Simulate the model after the first apply by folding the writes back in.
    const r = rule({ kind: 'add', target: { psetName: 'P', propName: 'N' }, value: 'v', ...TEXT, mode: 'addOverwrite' }, [1, 2]);
    const first = planWrites([r], read, readByName);
    assert.strictEqual(first.length, 2);
    const after = new Map(first.map((w) => [`${w.entityId}|${w.psetName}|${w.propName}`, String(w.value)]));
    const read2: PropReader = (id, pset, prop) => after.get(`${id}|${pset}|${prop}`) ?? read(id, pset, prop);
    assert.deepStrictEqual(planWrites([r], read2, readByName), [], 'a second apply must write nothing');
  });
});

describe('staleTargetRefs — what an apply must roll back', () => {
  const add = (prop: string, ids: number[] = [1, 2]) =>
    rule({ kind: 'add', target: { psetName: 'P', propName: prop }, value: 'v', ...TEXT, mode: 'addOverwrite' }, ids);

  it('reports nothing while the rule set is unchanged', () => {
    const r = { ...add('A'), id: 'a' };
    assert.deepStrictEqual(staleTargetRefs([r], [r]), []);
  });

  it('reports the address of a rule that was deleted', () => {
    const r = { ...add('A'), id: 'a' };
    assert.deepStrictEqual(staleTargetRefs([r], []).map(refKeyOf), ['P|A']);
  });

  it('reports a rule that was switched off', () => {
    const r = { ...add('A'), id: 'a' };
    assert.strictEqual(staleTargetRefs([r], [{ ...r, enabled: false }]).length, 1);
  });

  it('keeps an address another rule still writes', () => {
    const a = { ...add('A'), id: 'a' };
    const b = { ...add('A', [1]), id: 'b' };
    assert.deepStrictEqual(staleTargetRefs([a], [b]), []);
  });

  it('reports an address only once', () => {
    const a = { ...add('A', [1]), id: 'a' };
    assert.strictEqual(staleTargetRefs([a, { ...a, id: 'b' }], []).length, 1);
  });

  it('rolls back a rule that resolves its OWN objects and carries no id list', () => {
    // An imported mapping (or an "all objects" rule) has entityIds: [] — the
    // old entity-based rollback produced nothing for these, so the attributes
    // they created survived deleting the rule.
    const imported: AttributeRule = {
      id: 'xml-1', conditions: [], match: [{ attribute: '5D_Typ', value: '*IST*' }], entityIds: [],
      action: { kind: 'add', target: { psetName: '5D', propName: '5D_Rohbauhöhe' }, value: 'x', ...TEXT, mode: 'add' },
      enabled: true,
    };
    assert.deepStrictEqual(staleTargetRefs([imported], []).map(refKeyOf), ['5D|5D_Rohbauhöhe']);
  });

  it('rename reports both the created and the removed name', () => {
    const r: AttributeRule = {
      ...rule({ kind: 'rename', source: { psetName: 'P', propName: 'Old' }, propName: 'New' }, [1]),
      id: 'r',
    };
    assert.deepStrictEqual(staleTargetRefs([r], []).map(refKeyOf), ['P|New', 'P|Old']);
  });

  it('delete reports what it removed, so rolling back restores it', () => {
    const r: AttributeRule = {
      ...rule({ kind: 'delete', targets: [{ psetName: 'P', propName: 'A' }] }, [1]),
      id: 'r',
    };
    assert.deepStrictEqual(staleTargetRefs([r], []).map(refKeyOf), ['P|A']);
  });
});

describe('describeAction', () => {
  it('renders each kind', () => {
    assert.strictEqual(describeAction({ kind: 'add', target: { psetName: 'P', propName: 'A' }, value: 'v', ...TEXT, mode: 'add' }), 'P.A = "v"');
    assert.strictEqual(describeAction({ kind: 'rename', source: { psetName: 'P', propName: 'A' }, propName: 'B' }), 'P.A → B');
    assert.strictEqual(describeAction({ kind: 'delete', targets: [{ psetName: 'P', propName: 'A' }] }), 'P.A');
  });
});

describe('Bauteiltyp festlegen', () => {
  it('schreibt cpiComponentType in das Standard-Set', () => {
    const w = planWrites(
      [rule({ kind: 'componentType', value: 'Wall', mode: 'addOverwrite' })],
      read, readByName,
    );
    assert.strictEqual(w.length, 2, 'beide Objekte');
    assert.deepStrictEqual(
      { pset: w[0]!.psetName, prop: w[0]!.propName, value: w[0]!.value },
      { pset: DEFAULT_TARGET_PSET, prop: COMPONENT_TYPE_PROPERTY, value: 'Wall' },
    );
    assert.strictEqual(w[0]!.valueType, PropertyValueType.Label);
  });

  it('ohne gewählten Typ wird nichts geschrieben', () => {
    const w = planWrites(
      [rule({ kind: 'componentType', value: '', mode: 'addOverwrite' })],
      read, readByName,
    );
    assert.strictEqual(w.length, 0, 'lieber nichts als ein leerer Bauteiltyp');
  });

  it('achtet auf den Schreibmodus wie jede andere Aktion', () => {
    const vorhanden: PropReader = (id, pset, prop) =>
      pset === DEFAULT_TARGET_PSET && prop === COMPONENT_TYPE_PROPERTY ? 'Default' : read(id, pset, prop);
    const nurLeere = planWrites(
      [rule({ kind: 'componentType', value: 'Wall', mode: 'add' })],
      vorhanden, readByName,
    );
    assert.strictEqual(nurLeere.length, 0, 'Add schreibt nur, wo noch nichts steht');
  });

  it('nennt seine Zieladresse, damit ein Rücknehmen sie findet', () => {
    const r = rule({ kind: 'componentType', value: 'Slab', mode: 'addOverwrite' });
    const stale = staleTargetRefs([r], []);
    assert.deepStrictEqual(
      stale.map(refKeyOf),
      [refKeyOf({ psetName: DEFAULT_TARGET_PSET, propName: COMPONENT_TYPE_PROPERTY })],
    );
  });

  it('erscheint als eigene Zeile in der Regeltabelle', () => {
    const rows = ruleTableRows([rule({ kind: 'componentType', value: 'Column', mode: 'add' })]);
    const out = rows.find((r) => r.kind === 'out')!;
    assert.strictEqual(out.name, COMPONENT_TYPE_PROPERTY);
    assert.strictEqual(out.value, 'Column');
    assert.deepStrictEqual(out.editable, ['value', 'mode']);
  });
});

describe('Regel nach dem Anwenden korrigieren', () => {
  const target = { psetName: '5D', propName: '5D_Kategorie' };
  /** Die Datei kennt das Attribut nicht — es entstand erst durch die Regel. */
  const datei: PropReader = () => null;
  /** Der Stand nach dem ersten Anwenden: die Regel hat ihren Wert geschrieben. */
  const nachAnwenden: PropReader = (_id, pset, prop) =>
    (pset === target.psetName && prop === target.propName ? 'Rohrzubehoer' : null);
  const leerByName = () => null;

  it('plant erneut, wenn der Wert geändert wurde — der Fehler aus dem Screenshot', () => {
    const geaendert = rule({ kind: 'add', target, value: 'Rohrzubehör', ...TEXT, mode: 'add' });
    const ohneDatei = planWrites([geaendert], nachAnwenden, leerByName);
    assert.strictEqual(ohneDatei.length, 0, 'so war es: Add sah den eigenen alten Wert');

    const mitDatei = planWrites([geaendert], nachAnwenden, leerByName, [], datei);
    assert.strictEqual(mitDatei.length, 2, 'gegen die Datei geprueft schreibt Add wieder');
    assert.strictEqual(mitDatei[0]!.value, 'Rohrzubehör');
  });

  it('plant weiterhin nichts, wenn sich am Regelsatz nichts geändert hat', () => {
    const unveraendert = rule({ kind: 'add', target, value: 'Rohrzubehoer', ...TEXT, mode: 'add' });
    const w = planWrites([unveraendert], nachAnwenden, leerByName, [], datei);
    assert.strictEqual(w.length, 0, 'der Wert steht schon so da — kein Schreibvorgang');
  });

  it('lässt Add weiterhin stehen, wo die DATEI schon einen Wert hatte', () => {
    const ausDerDatei: PropReader = (_id, pset, prop) =>
      (pset === target.psetName && prop === target.propName ? 'Vorbelegt' : null);
    const r = rule({ kind: 'add', target, value: 'Neu', ...TEXT, mode: 'add' });
    const w = planWrites([r], ausDerDatei, leerByName, [], ausDerDatei);
    assert.strictEqual(w.length, 0, 'Add schuetzt Daten, die mit dem Modell kamen');
  });

  it('VERKETTUNG: eine spätere Add-Regel weicht der früheren weiterhin aus', () => {
    // Genau die Semantik, an der die 95 importierten Regeln haengen.
    const zuerst = { ...rule({ kind: 'add', target, value: 'Rohre', ...TEXT, mode: 'add' }), id: 'a' };
    const danach = { ...rule({ kind: 'add', target, value: 'Rohrformteile', ...TEXT, mode: 'add' }), id: 'b' };
    const w = planWrites([zuerst, danach], datei, leerByName, [], datei);
    assert.strictEqual(w.length, 2, 'nur die erste Regel schreibt');
    assert.deepStrictEqual(w.map((x) => x.ruleId), ['a', 'a']);
    assert.deepStrictEqual(w.map((x) => x.value), ['Rohre', 'Rohre']);
  });

  it('VERKETTUNG: Overwrite greift innerhalb eines Durchlaufs weiterhin', () => {
    const zuerst = { ...rule({ kind: 'add', target, value: 'Rohre', ...TEXT, mode: 'add' }), id: 'a' };
    const danach = { ...rule({ kind: 'add', target, value: 'Endgueltig', ...TEXT, mode: 'overwrite' }), id: 'b' };
    const w = planWrites([zuerst, danach], datei, leerByName, [], datei);
    assert.deepStrictEqual(w.map((x) => x.value), ['Rohre', 'Rohre', 'Endgueltig', 'Endgueltig']);
  });
});

describe('IFC-Klasse in Bedingungen', () => {
  /** RIBiTWO schreibt die Klasse ohne `Ifc`-Praefix, wir antworten mit ihm.
   *  Ohne Wildcards ist der Vergleich exakt, also traf frueher keine einzige
   *  importierte ifcType-Regel etwas. */
  const objekt = (ifcType: string): { read: PropReader; readByName: (id: number, p: string) => string | null } => ({
    read: () => null,
    readByName: (_id, prop) => (prop === 'ifcType' ? ifcType : null),
  });

  const regel = (bedingung: string): AttributeRule => ({
    id: 'r', conditions: [], entityIds: [], match: [{ attribute: 'ifcType', value: bedingung }],
    action: { kind: 'add', target: { psetName: '5D', propName: '5D_Kategorie' },
      value: 'Rohrformteile', dataType: 'text', unit: '', mode: 'add' },
    enabled: true,
  });

  it('nimmt RIBs Schreibweise ohne Praefix', () => {
    const { read, readByName } = objekt('IfcPipeFitting');
    assert.equal(planWrites([regel('PIPEFITTING')], read, readByName, [1]).length, 1);
  });

  it('nimmt weiterhin unsere eigene Schreibweise', () => {
    // So sammelt der Objektfilter eine Bedingung ein.
    const { read, readByName } = objekt('IfcPipeFitting');
    assert.equal(planWrites([regel('IfcPipeFitting')], read, readByName, [1]).length, 1);
  });

  it('nimmt eine ODER-Liste und Wildcards in beiden Schreibweisen', () => {
    const { read, readByName } = objekt('IfcValve');
    assert.equal(planWrites([regel('VALVE||PUMP||FLOWMETER')], read, readByName, [1]).length, 1);
    assert.equal(planWrites([regel('*VALVE*')], read, readByName, [1]).length, 1);
  });

  it('trifft trotzdem nicht die falsche Klasse', () => {
    const { read, readByName } = objekt('IfcPipeSegment');
    assert.equal(planWrites([regel('PIPEFITTING')], read, readByName, [1]).length, 0);
  });

  it('laesst andere Attribute in Ruhe', () => {
    // Nur die Klassen-Attribute duerfen das Praefix verlieren; ein normales
    // Attribut, dessen Wert zufaellig mit "Ifc" beginnt, darf das nicht.
    const read: PropReader = () => null;
    const readByName = (_id: number, prop: string) => (prop === 'Hersteller' ? 'IfcSoft GmbH' : null);
    const r: AttributeRule = {
      id: 'r', conditions: [], entityIds: [], match: [{ attribute: 'Hersteller', value: 'Soft GmbH' }],
      action: { kind: 'add', target: { psetName: '5D', propName: 'X' }, value: 'y', dataType: 'text', unit: '', mode: 'add' },
      enabled: true,
    };
    assert.equal(planWrites([r], read, readByName, [1]).length, 0);
  });
});
