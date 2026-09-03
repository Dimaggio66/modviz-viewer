/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { importMappingXml, splitPropertyPath } from './attribute-rules-xml.js';
import { planWrites, type PropReader } from './attribute-rules.js';

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><transform><mapping enable="true" name="Initial">${body}</mapping></transform>`;

describe('splitPropertyPath', () => {
  it('splits a Pset\\Prop path', () => {
    assert.deepStrictEqual(splitPropertyPath('Andere\\Kategorie'), { setName: 'Andere', propName: 'Kategorie' });
  });
  it('leaves a bare name without a set', () => {
    assert.deepStrictEqual(splitPropertyPath('5D_Typ'), { setName: '', propName: '5D_Typ' });
  });
});

describe('importMappingXml', () => {
  it('reads the mapping name', () => {
    assert.strictEqual(importMappingXml(wrap('')).name, 'Initial');
  });

  it('maps <out value=…> to a literal write', () => {
    const { rules } = importMappingXml(wrap(`
      <map source="Project">
        <in property="5D_Typ" datatype="xs:string" value="*IST*" />
        <out property="5D_Bauteilname" datatype="xs:string" value="Innenstützen" mode="Add" />
      </map>`), 'P');
    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(rules[0].match, [{ attribute: '5D_Typ', value: '*IST*' }]);
    assert.deepStrictEqual(rules[0].action, {
      kind: 'add', target: { psetName: 'P', propName: '5D_Bauteilname' },
      value: 'Innenstützen', dataType: 'text', unit: '', mode: 'add',
    });
  });

  it('maps <out name=…> to a copy, property being the SOURCE', () => {
    const { rules } = importMappingXml(wrap(`
      <map source="Project">
        <out property="Andere\\Kategorie" name="5D_Kategorie" mode="Add" />
      </map>`), 'P');
    assert.deepStrictEqual(rules[0].action, {
      kind: 'copy',
      source: { psetName: 'Andere', propName: 'Kategorie' },
      target: { psetName: 'P', propName: '5D_Kategorie' },
      mode: 'add',
    });
  });

  it('maps mode="Remove" to a delete', () => {
    const { rules } = importMappingXml(wrap(`
      <map source="Project"><out property="*Wide*" mode="Remove" /></map>`), 'P');
    assert.deepStrictEqual(rules[0].action, { kind: 'delete', targets: [{ psetName: 'P', propName: '*Wide*' }] });
  });

  it('collapses an Overwrite+Add pair of the same write into one always-rule', () => {
    const { rules } = importMappingXml(wrap(`
      <map source="Project">
        <out property="5D_Bauteilname" value="Innenwände" mode="Overwrite" />
        <out property="5D_Bauteilname" value="Innenwände" mode="Add" />
      </map>`), 'P');
    assert.strictEqual(rules.length, 1, 'the pair must not become two competing rules');
    assert.strictEqual(rules[0].action.kind === 'add' && rules[0].action.mode, 'addOverwrite');
  });

  it('keeps several distinct <out> as separate rules sharing the condition', () => {
    const { rules } = importMappingXml(wrap(`
      <map source="Project">
        <in property="cpiID" datatype="xs:ID" value="*" />
        <out property="ifcTypeObjectName" name="5D_Typ" mode="Add" />
        <out property="RevitTypeName" name="5D_Typ" mode="Add" />
      </map>`), 'P');
    assert.strictEqual(rules.length, 2);
    assert.deepStrictEqual(rules.map((r) => r.match), [[], []], 'cpiID="*" is not a real condition');
  });

  it('ANDs several <in> and decodes entities', () => {
    const { rules } = importMappingXml(wrap(`
      <map source="Project">
        <in property="5D_Kategorie" value="Räume" />
        <in property="Phasen\\Phase" value="Bestand" />
        <out property="X" value="Y" mode="Add" />
      </map>
      <map source="Project">
        <in property="5D_Kategorie" value="&lt;Not Existing&gt;" />
        <out property="X" value="Z" mode="Add" />
      </map>`), 'P');
    assert.strictEqual(rules[0].match?.length, 2);
    assert.strictEqual(rules[1].match?.[0].value, '<Not Existing>');
  });

  it('reports an <out> it cannot map instead of dropping it silently', () => {
    const { rules, skipped } = importMappingXml(wrap(`
      <map source="Project"><out property="X" mode="Add" /></map>`), 'P');
    assert.strictEqual(rules.length, 0);
    assert.strictEqual(skipped.length, 1);
    assert.match(skipped[0], /neither a value nor a name/);
  });
});

describe('imported mappings chain', () => {
  /** One object whose only base attribute is the Revit type name. */
  const base = new Map<string, string>([['1|Andere|Typenname', 'IST_ALG_STB-240']]);
  const read: PropReader = (id, pset, prop) => base.get(`${id}|${pset}|${prop}`) ?? null;
  const readByName = (id: number, prop: string) =>
    [...base].find(([k]) => k.startsWith(`${id}|`) && k.endsWith(`|${prop}`))?.[1] ?? null;

  it('a later rule matches what an earlier rule wrote', () => {
    // Rule 1 copies Andere\Typenname into 5D_Typ; rule 2 keys off 5D_Typ.
    const { rules } = importMappingXml(wrap(`
      <map source="Project">
        <in property="cpiID" datatype="xs:ID" value="*" />
        <out property="Andere\\Typenname" name="5D_Typ" mode="Add" />
      </map>
      <map source="Project">
        <in property="5D_Typ" datatype="xs:string" value="*IST*" />
        <out property="5D_Bauteilname" value="Innenstützen" mode="Add" />
      </map>`), 'P');

    const writes = planWrites(rules, read, readByName, [1]);
    assert.deepStrictEqual(
      writes.map((w) => [w.propName, w.value]),
      [['5D_Typ', 'IST_ALG_STB-240'], ['5D_Bauteilname', 'Innenstützen']],
      'the second rule only fires if it can see the first rule\'s output',
    );
  });

  it('a rule whose condition no object satisfies writes nothing', () => {
    const { rules } = importMappingXml(wrap(`
      <map source="Project">
        <in property="5D_Typ" datatype="xs:string" value="*NOPE*" />
        <out property="5D_Bauteilname" value="X" mode="Add" />
      </map>`), 'P');
    assert.deepStrictEqual(planWrites(rules, read, readByName, [1]), []);
  });

  it('<Not Existing> matches only objects without the attribute', () => {
    const { rules } = importMappingXml(wrap(`
      <map source="Project">
        <in property="5D_Typ" value="&lt;Not Existing&gt;" />
        <out property="Flag" value="ja" mode="Add" />
      </map>`), 'P');
    assert.strictEqual(planWrites(rules, read, readByName, [1]).length, 1);
    // Once 5D_Typ exists the same condition must stop matching.
    base.set('1|P|5D_Typ', 'anything');
    assert.strictEqual(planWrites(rules, read, readByName, [1]).length, 0);
    base.delete('1|P|5D_Typ');
  });
});
