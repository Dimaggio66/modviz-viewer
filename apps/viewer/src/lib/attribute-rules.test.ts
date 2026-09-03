/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  planWrites,
  resolveTemplate,
  templateTokens,
  describeAction,
  type AttributeRule,
  type PropReader,
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
  return { id: 'r1', conditions: [{ label: 'ifcType', value: '*wall*' }], entityIds, action };
}

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

describe('planWrites', () => {
  it('add/overwrite: writes every object', () => {
    const w = planWrites([rule({ kind: 'add', target: { psetName: 'Pset_A', propName: 'Status' }, value: 'Final', mode: 'overwrite' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => x.entityId), [1, 2]);
    assert.strictEqual(w[0].value, 'Final');
  });

  it('add/add-mode: skips objects that already carry a value', () => {
    const w = planWrites([rule({ kind: 'add', target: { psetName: 'Pset_A', propName: 'Status' }, value: 'Final', mode: 'add' })], read, readByName);
    // 1 has Status='Draft' already, so only 2 is written.
    assert.deepStrictEqual(w.map((x) => x.entityId), [2]);
  });

  it('compose: skips an object whose referenced attributes are all absent', () => {
    const w = planWrites([rule({ kind: 'compose', target: { psetName: 'Pset_A', propName: 'SN' }, template: '@Attr{LevelNo}@Attr{TradeNo}', mode: 'overwrite' })], read, readByName);
    assert.deepStrictEqual(w.map((x) => [x.entityId, x.value]), [[1, '15']]);
  });

  it('copy: only where the source has a value', () => {
    const w = planWrites([rule({ kind: 'copy', source: { psetName: 'Pset_A', propName: 'Status' }, target: { psetName: 'Pset_B', propName: 'Status2' }, mode: 'overwrite' })], read, readByName);
    assert.deepStrictEqual(w, [{ entityId: 1, op: 'set', psetName: 'Pset_B', propName: 'Status2', value: 'Draft' }]);
  });

  it('rename: writes the new name and deletes the old one', () => {
    const w = planWrites([rule({ kind: 'rename', source: { psetName: 'Pset_A', propName: 'Status' }, propName: 'State' })], read, readByName);
    assert.deepStrictEqual(w, [
      { entityId: 1, op: 'set', psetName: 'Pset_A', propName: 'State', value: 'Draft' },
      { entityId: 1, op: 'delete', psetName: 'Pset_A', propName: 'Status' },
    ]);
  });

  it('delete: skips objects that do not carry the attribute', () => {
    const w = planWrites([rule({ kind: 'delete', targets: [{ psetName: 'Pset_A', propName: 'Status' }] })], read, readByName);
    assert.deepStrictEqual(w, [{ entityId: 1, op: 'delete', psetName: 'Pset_A', propName: 'Status' }]);
  });

  it('applies collected rules in order', () => {
    const w = planWrites(
      [
        rule({ kind: 'add', target: { psetName: 'P', propName: 'A' }, value: '1', mode: 'overwrite' }, [1]),
        rule({ kind: 'add', target: { psetName: 'P', propName: 'B' }, value: '2', mode: 'overwrite' }, [1]),
      ],
      read,
      readByName,
    );
    assert.deepStrictEqual(w.map((x) => x.propName), ['A', 'B']);
  });
});

describe('describeAction', () => {
  it('renders each kind for the collected-rules table', () => {
    assert.strictEqual(describeAction({ kind: 'add', target: { psetName: 'P', propName: 'A' }, value: 'v', mode: 'add' }), 'P.A = "v"');
    assert.strictEqual(describeAction({ kind: 'rename', source: { psetName: 'P', propName: 'A' }, propName: 'B' }), 'P.A → B');
    assert.strictEqual(describeAction({ kind: 'delete', targets: [{ psetName: 'P', propName: 'A' }] }), 'P.A');
  });
});
