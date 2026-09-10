/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `applyPropertyEdits` — many writes, one store update.
 *
 * `setProperty` rebuilds the undo stack on every call (`[...stack, mutation]`),
 * so N writes copy N²/2 entries. Applying an imported RIBiTWO rule set means
 * 521,383 of them, and that pattern alone is what turned an apply into an hour
 * and a half. The count of `set()` calls is therefore not an implementation
 * detail to be left untested: it is the fix.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMutationSlice, type MutationSlice, type PropertyEdit } from './mutationSlice.js';
import type { ViewerState } from '../index.js';

function buildSlice(canEdit = true, deleteFails = false) {
  const calls: string[] = [];
  let n = 0;
  const view = {
    setProperty: () => { calls.push('setProperty'); return { id: `m${n++}`, type: 'UPDATE_PROPERTY' }; },
    deleteProperty: () => {
      calls.push('deleteProperty');
      return deleteFails ? null : { id: `m${n++}`, type: 'DELETE_PROPERTY' };
    },
  };
  const mirrored: string[] = [];
  let sets = 0;
  let state: Record<string, unknown> = {
    mutationViews: new Map([['m1', view]]),
    undoStacks: new Map(),
    redoStacks: new Map(),
    dirtyModels: new Set(),
    mutationVersion: 0,
    canCollabEdit: () => canEdit,
    mirrorPropertyEdit: () => { mirrored.push('edit'); },
    mirrorPropertyDelete: () => { mirrored.push('delete'); },
  };
  const setState = (partial: unknown) => {
    sets += 1;
    const updates = typeof partial === 'function'
      ? (partial as (s: Record<string, unknown>) => Record<string, unknown>)(state)
      : (partial as Record<string, unknown>);
    state = { ...state, ...updates };
  };
  const slice = createMutationSlice(
    setState as never,
    (() => state as unknown as ViewerState) as never,
    {} as never,
  ) as MutationSlice;
  state = { ...slice, ...state };
  return {
    calls, mirrored,
    sets: () => sets,
    state: () => state as unknown as ViewerState & MutationSlice,
  };
}

const setzen = (entityId: number): PropertyEdit =>
  ({ op: 'set', entityId, psetName: '5D', propName: 'Typ', value: 'Bogen' });

describe('applyPropertyEdits', () => {
  it('macht aus 500 Schreibvorgaengen EINE Store-Aenderung', () => {
    const h = buildSlice();
    const vorher = h.sets();
    h.state().applyPropertyEdits('m1', Array.from({ length: 500 }, (_, i) => setzen(i)));
    assert.equal(h.sets() - vorher, 1);
    assert.equal(h.calls.length, 500, 'jeder Schreibvorgang geht trotzdem in den View');
  });

  it('legt alle Mutationen auf den Undo-Stapel, in der Reihenfolge', () => {
    const h = buildSlice();
    h.state().applyPropertyEdits('m1', [setzen(1), setzen(2), setzen(3)]);
    const stack = (h.state() as unknown as { undoStacks: Map<string, unknown[]> }).undoStacks.get('m1');
    assert.equal(stack?.length, 3);
    assert.deepEqual(stack?.map((m) => (m as { id: string }).id), ['m0', 'm1', 'm2']);
  });

  it('antwortet mit einem Eintrag je Auftrag, damit der Aufrufer zuordnen kann', () => {
    // Ein Loeschen, das nichts vorfindet, liefert null — daran erkennt der
    // Dialog, welche Regel wirklich geschrieben hat.
    const h = buildSlice(true, true);
    const r = h.state().applyPropertyEdits('m1', [
      setzen(1),
      { op: 'delete', entityId: 2, psetName: '5D', propName: 'Typ' },
      setzen(3),
    ]);
    assert.equal(r.length, 3);
    assert.ok(r[0]);
    assert.equal(r[1], null);
    assert.ok(r[2]);
  });

  it('markiert das Modell als geaendert und hebt die Version genau einmal', () => {
    const h = buildSlice();
    h.state().applyPropertyEdits('m1', [setzen(1), setzen(2)]);
    const s = h.state() as unknown as { mutationVersion: number; dirtyModels: Set<string> };
    assert.equal(s.mutationVersion, 1, 'ein Signal je Buendel, kein Zaehler');
    assert.ok(s.dirtyModels.has('m1'));
  });

  it('spiegelt jeden Auftrag einzeln — das CRDT kennt keine Buendel', () => {
    const h = buildSlice();
    h.state().applyPropertyEdits('m1', [setzen(1), { op: 'delete', entityId: 2, psetName: '5D', propName: 'Typ' }]);
    assert.deepEqual(h.mirrored, ['edit', 'delete']);
  });

  it('haelt die Rolle vor dem View auf, wie setProperty', () => {
    const h = buildSlice(false);
    const r = h.state().applyPropertyEdits('m1', [setzen(1), setzen(2)]);
    assert.deepEqual(r, [null, null]);
    assert.deepEqual(h.calls, [], 'nichts darf lokal geschrieben werden');
    assert.equal((h.state() as unknown as { mutationVersion: number }).mutationVersion, 0);
  });

  it('ruehrt den Store nicht an, wenn nichts gelandet ist', () => {
    const h = buildSlice(true, true);
    const vorher = h.sets();
    h.state().applyPropertyEdits('m1', [{ op: 'delete', entityId: 1, psetName: '5D', propName: 'Typ' }]);
    assert.equal(h.sets() - vorher, 0);
  });

  it('kennt kein Modell ohne View', () => {
    const h = buildSlice();
    assert.deepEqual(h.state().applyPropertyEdits('unbekannt', [setzen(1)]), [null]);
  });
});
