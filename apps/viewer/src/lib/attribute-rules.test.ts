/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PropertyValueType } from '@ifc-lite/data';
import {
  planWrites,
  planWritesStepwise,
  type RulePlanStat,
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

  it('overwrite: every object — it CREATES the attribute as well', () => {
    // Belegt am selben Modell mit demselben Regelsatz: iTWO fuellt
    // `5D_Systemklassifizierung`, das nur von zwei Overwrite-Ausgaben
    // geschrieben wird und von keinem einzigen Add. Waere "nur wo schon ein
    // Wert steht" richtig, koennte es nie entstehen.
    const w = planWrites([rule({ kind: 'add', target, value: 'Final', ...TEXT, mode: 'overwrite' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => x.entityId), [1, 2]);
  });

  it('overwrite legt auch beim Kopieren ein noch unbekanntes Attribut an', () => {
    // Genau die Form aus der Heizungs-Mapping-Datei:
    //   <out property="HLS\Systemklassifizierung"
    //        name="5D_Systemklassifizierung" mode="Overwrite" />
    const w = planWrites([rule({
      kind: 'copy',
      source: { psetName: 'Pset_A', propName: 'Status' },
      target: { psetName: '5D', propName: '5D_Neu' },
      mode: 'overwrite',
    })], read, readByName);
    assert.deepStrictEqual(w.map((x) => x.entityId), [1], 'nur Objekt 1 traegt die Quelle');
    assert.strictEqual(w[0]?.propName, '5D_Neu');
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

describe('cpiID ist unsere ifcGuid', () => {
  const GUID = '2RAUXetKHBCA_0N2jUYzjx';
  const read: PropReader = () => null;
  const readByName = (_id: number, prop: string) => (prop === 'ifcGuid' ? GUID : null);

  const regel = (attribut: string, wert: string): AttributeRule => ({
    id: 'r', conditions: [], entityIds: [], match: [{ attribute: attribut, value: wert }],
    action: { kind: 'add', target: { psetName: '5D', propName: 'X' }, value: 'ja', dataType: 'text', unit: '', mode: 'add' },
    enabled: true,
  });

  it('loest eine Bedingung auf cpiID ueber die GlobalId auf', () => {
    assert.equal(planWrites([regel('cpiID', GUID)], read, readByName, [1]).length, 1);
  });

  it('trifft nicht die falsche GlobalId', () => {
    assert.equal(planWrites([regel('cpiID', 'ein-anderer-guid')], read, readByName, [1]).length, 0);
  });

  it('kopiert cpiID als Quelle', () => {
    const r: AttributeRule = {
      id: 'r', conditions: [], entityIds: [], match: [],
      action: { kind: 'copy', source: { psetName: '', propName: 'cpiID' },
        target: { psetName: '5D', propName: '5D_Guid' }, mode: 'add' },
      enabled: true,
    };
    const w = planWrites([r], read, readByName, [1]);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.value, GUID);
  });

  it('laesst dem Modell den Vortritt, wenn es selbst ein cpiID traegt', () => {
    // Nach einem RIB-Roundtrip kann das Attribut wirklich am Objekt stehen.
    const eigen = (_id: number, prop: string) =>
      (prop === 'cpiID' ? 'eigener-wert' : prop === 'ifcGuid' ? GUID : null);
    assert.equal(planWrites([regel('cpiID', 'eigener-wert')], read, eigen, [1]).length, 1);
    assert.equal(planWrites([regel('cpiID', GUID)], read, eigen, [1]).length, 0);
  });
});

describe('Zaehler je Regel', () => {
  // Zwei Objekte: 1 traegt Pset_A.Status, 2 nicht.
  const ziel = { psetName: '5D', propName: 'X' };

  it('trennt "Bedingung traf niemanden" von "Quelle war leer"', () => {
    const kopie: AttributeRule = {
      id: 'kopie', conditions: [], entityIds: [], match: [],
      action: { kind: 'copy', source: { psetName: 'Pset_A', propName: 'Status' }, target: ziel, mode: 'add' },
      enabled: true,
    };
    const nieTrifft: AttributeRule = {
      id: 'nie', conditions: [], entityIds: [],
      match: [{ attribute: 'Pset_A\Status', value: 'gibt-es-nicht' }],
      action: { kind: 'add', target: ziel, value: 'y', ...TEXT, mode: 'addOverwrite' },
      enabled: true,
    };
    const stats = new Map<string, RulePlanStat>();
    planWrites([kopie, nieTrifft], read, readByName, [1, 2], undefined, stats);

    // Die Kopie trifft beide Objekte, kann aber nur bei einem lesen.
    assert.deepStrictEqual(stats.get('kopie'), { matched: 2, wrote: 1, sourceMissing: 1, unchanged: 0 },
      'getroffen 2, geschrieben 1 — die Quelle fehlt auf Objekt 2');
    // Die zweite Regel scheitert schon an der Bedingung.
    assert.deepStrictEqual(stats.get('nie'), { matched: 0, wrote: 0, sourceMissing: 0, unchanged: 0 });
  });


  it('trennt "schreibt nichts" von "steht schon so drin"', () => {
    // Der Fall, der die Diagnose blockierte: eine Regel schrieb 0, und das
    // konnte "Quelle nicht gefunden" ODER "Wert ist schon da" heissen.
    const schonDa: AttributeRule = {
      id: 'da', conditions: [], entityIds: [], match: [],
      action: { kind: 'add', target: { psetName: 'Pset_A', propName: 'Status' },
        value: 'Draft', ...TEXT, mode: 'addOverwrite' },
      enabled: true,
    };
    const stats = new Map<string, RulePlanStat>();
    planWrites([schonDa], read, readByName, [1, 2], undefined, stats);
    const st = stats.get('da')!;
    assert.strictEqual(st.matched, 2);
    assert.strictEqual(st.unchanged, 1, 'Objekt 1 traegt "Draft" bereits');
    assert.strictEqual(st.wrote, 1, 'nur Objekt 2 aendert sich');
    assert.strictEqual(st.sourceMissing, 0, 'kein Kopieren, also keine fehlende Quelle');
  });
  it('kostet nichts, wenn keine Map uebergeben wird', () => {
    const r: AttributeRule = {
      id: 'r', conditions: [], entityIds: [], match: [],
      action: { kind: 'add', target: ziel, value: 'y', ...TEXT, mode: 'addOverwrite' },
      enabled: true,
    };
    assert.strictEqual(planWrites([r], read, readByName, [1, 2]).length, 2);
  });
});

describe('Ein zweiter Lauf darf die spezielle Regel nicht ueberschreiben', () => {
  /** Die Kette aus der Heizungs-Mapping-Datei: erst "2er Bogen", dann der
   *  allgemeine "Bogen", beide mode "add". Objekt 1 hat 5D_Typ = "2er Bogen". */
  const regeln = (): AttributeRule[] => [
    {
      id: 'speziell', conditions: [], entityIds: [], match: [{ attribute: '5D_Typ', value: '*2er Bogen*' }],
      action: { kind: 'add', target: { psetName: '5D', propName: '5D_Bauteilname' },
        value: '2er Bogen', ...TEXT, mode: 'add' },
      enabled: true,
    },
    {
      id: 'allgemein', conditions: [], entityIds: [], match: [{ attribute: '5D_Typ', value: '*Bogen*' }],
      action: { kind: 'add', target: { psetName: '5D', propName: '5D_Bauteilname' },
        value: 'Bogen', ...TEXT, mode: 'add' },
      enabled: true,
    },
  ];

  /** Modell: 5D_Typ steht fest, 5D_Bauteilname kommt aus `bereits`. */
  const modell = (bereits: string | null) => {
    const eff: PropReader = (_id, pset, prop) =>
      (pset === '5D' && prop === '5D_Bauteilname' ? bereits : null);
    const effByName = (_id: number, prop: string) =>
      (prop === '5D_Typ' ? '2er Bogen' : prop === '5D_Bauteilname' ? bereits : null);
    // Die Datei kennt keine 5D_*-Attribute — so ist es im echten Modell auch.
    const datei: PropReader = () => null;
    return { eff, effByName, datei };
  };

  it('erster Lauf: die spezielle Regel gewinnt', () => {
    const { eff, effByName, datei } = modell(null);
    const w = planWrites(regeln(), eff, effByName, [1], datei);
    assert.deepStrictEqual(w.map((x) => x.value), ['2er Bogen'],
      'die allgemeine Regel tritt zurueck, weil die spezielle geschrieben hat');
  });

  it('zweiter Lauf: sie gewinnt WIEDER, obwohl sie nichts zu schreiben hat', () => {
    // Frueher stand hier "Bogen": die spezielle Regel hatte nichts zu tun,
    // landete damit nicht in der live-Schicht, und die allgemeine Regel sah
    // das Attribut gegen die Datei als leer an.
    const { eff, effByName, datei } = modell('2er Bogen');
    const w = planWrites(regeln(), eff, effByName, [1], datei);
    assert.deepStrictEqual(w, [], 'nichts zu tun — und vor allem kein "Bogen"');
  });
});

describe('planWritesStepwise', () => {
  const drei: AttributeRule[] = [
    { ...rule({ kind: 'add', target: { psetName: 'Pset_A', propName: 'Eins' }, value: 'a', dataType: 'text', unit: '', mode: 'overwrite' }), id: 'a' },
    { ...rule({ kind: 'add', target: { psetName: 'Pset_A', propName: 'Zwei' }, value: 'b', dataType: 'text', unit: '', mode: 'overwrite' }), id: 'b', enabled: false },
    { ...rule({ kind: 'add', target: { psetName: 'Pset_A', propName: 'Drei' }, value: 'c', dataType: 'text', unit: '', mode: 'overwrite' }), id: 'c' },
  ];

  it('haelt nach jeder aktiven Regel an', () => {
    // Die abgeschaltete zaehlt nicht mit — sie macht keine Arbeit, an der sich
    // anzuhalten lohnte.
    const steps = planWritesStepwise(drei, read, readByName);
    const gezaehlt: number[] = [];
    let step = steps.next();
    while (!step.done) { gezaehlt.push(step.value); step = steps.next(); }
    assert.deepEqual(gezaehlt, [1, 2]);
  });

  it('liefert dasselbe wie der Lauf am Stueck', () => {
    const steps = planWritesStepwise(drei, read, readByName);
    let step = steps.next();
    while (!step.done) step = steps.next();
    assert.deepEqual(step.value, planWrites(drei, read, readByName));
  });

  it('haelt die Verkettung ueber die Haltepunkte hinweg', () => {
    // Regel 2 liest, was Regel 1 geschrieben hat. Ginge diese Schicht beim
    // Anhalten verloren, kaeme genau das heraus, was der Dialog zeigt: eine
    // Regel, die nichts findet.
    const kette: AttributeRule[] = [
      { ...rule({ kind: 'add', target: { psetName: 'Pset_A', propName: 'Typ' }, value: '2er Bogen', dataType: 'text', unit: '', mode: 'overwrite' }), id: '1' },
      { ...rule({ kind: 'copy', source: { psetName: 'Pset_A', propName: 'Typ' }, target: { psetName: 'Pset_B', propName: 'Kopie' }, mode: 'overwrite' }), id: '2' },
    ];
    const steps = planWritesStepwise(kette, read, readByName);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const kopien = step.value.filter((w) => w.propName === 'Kopie');
    assert.equal(kopien.length, 2);
    assert.equal(kopien[0].value, '2er Bogen');
  });
});
