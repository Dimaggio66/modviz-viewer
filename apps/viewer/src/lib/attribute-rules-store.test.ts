/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { loadRules, saveRules, clearRules, projectKeyFor, __internal } from './attribute-rules-store.js';
import type { AttributeRule } from './attribute-rules.js';

/** Minimal in-memory localStorage so the module under test can be exercised
 *  in node, the same way saved-filters is tested. */
function installStorage(impl?: Partial<Storage>) {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    ...impl,
  };
  return map;
}

function rule(id: string, entityIds = [1, 2, 3]): AttributeRule {
  return {
    id,
    conditions: [{ label: 'ifcType', value: '*wall*' }],
    entityIds,
    action: { kind: 'delete', targets: [{ psetName: 'P', propName: 'A' }] },
    enabled: true,
  };
}

const KEY = 'model.ifc#100';

describe('attribute-rules-store', () => {
  beforeEach(() => { installStorage(); });

  it('round-trips rules for a project', () => {
    assert.strictEqual(saveRules(KEY, [rule('a'), rule('b')]), true);
    assert.deepStrictEqual(loadRules(KEY).map((r) => r.id), ['a', 'b']);
  });

  it('keeps projects apart', () => {
    saveRules(KEY, [rule('a')]);
    saveRules('other.ifc#5', [rule('z')]);
    assert.deepStrictEqual(loadRules(KEY).map((r) => r.id), ['a']);
    assert.deepStrictEqual(loadRules('other.ifc#5').map((r) => r.id), ['z']);
  });

  it('overwrites the project entry rather than appending', () => {
    saveRules(KEY, [rule('a'), rule('b')]);
    saveRules(KEY, [rule('c')]);
    assert.deepStrictEqual(loadRules(KEY).map((r) => r.id), ['c']);
  });

  it('clearing removes the entry', () => {
    saveRules(KEY, [rule('a')]);
    clearRules(KEY);
    assert.deepStrictEqual(loadRules(KEY), []);
  });

  it('returns [] for an unknown project', () => {
    assert.deepStrictEqual(loadRules('nope#0'), []);
  });

  it('survives a corrupt catalog instead of throwing', () => {
    const map = installStorage();
    map.set(__internal.STORAGE_KEY, '{not json');
    assert.deepStrictEqual(loadRules(KEY), []);
  });

  it('drops entries that no longer look like rules', () => {
    const map = installStorage();
    map.set(__internal.STORAGE_KEY, JSON.stringify({
      [KEY]: { rules: [{ id: 'ok', conditions: [], entityIds: [], action: { kind: 'delete', targets: [] }, enabled: true }, { nonsense: true }], updatedAt: 1 },
    }));
    assert.deepStrictEqual(loadRules(KEY).map((r) => r.id), ['ok']);
  });

  it('caps the id list so one rule cannot fill storage', () => {
    const huge = Array.from({ length: __internal.MAX_IDS_PER_RULE + 10 }, (_, i) => i);
    saveRules(KEY, [rule('a', huge)]);
    assert.strictEqual(loadRules(KEY)[0].entityIds.length, __internal.MAX_IDS_PER_RULE);
  });

  it('reports failure when storage refuses the write', () => {
    installStorage({ setItem: () => { throw new Error('QuotaExceededError'); } });
    assert.strictEqual(saveRules(KEY, [rule('a')]), false);
  });

  it('degrades to not-persisted when there is no storage at all', () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    assert.strictEqual(saveRules(KEY, [rule('a')]), false);
    assert.deepStrictEqual(loadRules(KEY), []);
  });

  it('project key separates revisions of the same file name', () => {
    assert.notStrictEqual(projectKeyFor('a.ifc', 100), projectKeyFor('a.ifc', 101));
    assert.strictEqual(projectKeyFor('a.ifc', 100), projectKeyFor('a.ifc', 100));
  });
});
