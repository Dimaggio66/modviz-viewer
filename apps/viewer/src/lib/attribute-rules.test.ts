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
  staleTargets,
  targetKey,
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

describe('staleTargets — what an apply must roll back', () => {
  const add = (id: string, prop: string, ids = [1, 2]) =>
    rule({ kind: 'add', target: { psetName: 'P', propName: prop }, value: 'v', ...TEXT, mode: 'addOverwrite' }, ids);

  it('reports nothing while the rule set is unchanged', () => {
    const r = { ...add('a', 'A'), id: 'a' };
    assert.deepStrictEqual(staleTargets([r], [r]), []);
  });

  it('reports every address of a rule that was deleted', () => {
    const r = { ...add('a', 'A'), id: 'a' };
    const out = staleTargets([r], []);
    assert.deepStrictEqual(out.map(targetKey), ['1|P|A', '2|P|A']);
  });

  it('reports a rule that was switched off', () => {
    const r = { ...add('a', 'A'), id: 'a' };
    assert.strictEqual(staleTargets([r], [{ ...r, enabled: false }]).length, 2);
  });

  it('keeps addresses another rule still writes', () => {
    const a = { ...add('a', 'A'), id: 'a' };
    const b = { ...add('b', 'A', [1]), id: 'b' };
    // b still writes 1|P|A, so only 2|P|A is stale.
    assert.deepStrictEqual(staleTargets([a], [b]).map(targetKey), ['2|P|A']);
  });

  it('reports an address only once', () => {
    const a = { ...add('a', 'A', [1]), id: 'a' };
    assert.strictEqual(staleTargets([a, { ...a, id: 'b' }], []).length, 1);
  });

  it('rename reports both the created and the removed name', () => {
    const r: AttributeRule = {
      ...rule({ kind: 'rename', source: { psetName: 'P', propName: 'Old' }, propName: 'New' }, [1]),
      id: 'r',
    };
    assert.deepStrictEqual(staleTargets([r], []).map(targetKey), ['1|P|New', '1|P|Old']);
  });

  it('delete reports what it removed, so rolling back restores it', () => {
    const r: AttributeRule = {
      ...rule({ kind: 'delete', targets: [{ psetName: 'P', propName: 'A' }] }, [1]),
      id: 'r',
    };
    assert.deepStrictEqual(staleTargets([r], []).map(targetKey), ['1|P|A']);
  });
});

describe('describeAction', () => {
  it('renders each kind', () => {
    assert.strictEqual(describeAction({ kind: 'add', target: { psetName: 'P', propName: 'A' }, value: 'v', ...TEXT, mode: 'add' }), 'P.A = "v"');
    assert.strictEqual(describeAction({ kind: 'rename', source: { psetName: 'P', propName: 'A' }, propName: 'B' }), 'P.A → B');
    assert.strictEqual(describeAction({ kind: 'delete', targets: [{ psetName: 'P', propName: 'A' }] }), 'P.A');
  });
});
