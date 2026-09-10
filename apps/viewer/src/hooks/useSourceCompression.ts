/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hand each loaded model's source to the compression worker, once, after the
 * load has finished.
 *
 * After the load, not during: the geometry needs the main thread, and the
 * `postMessage` that starts the worker crosses it. The gate is the loader's own
 * flags, the same pair the filter panel's discovery waits on.
 *
 * Failure is silent by design — the source stays resident, which is exactly how
 * the viewer behaved before this existed.
 */

import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useViewerStore } from '@/store';
import { compressStoreSource } from '@/lib/source-compression.js';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

export function useSourceCompression(): void {
  const { models, loading, geometryStreamingActive } = useViewerStore(
    useShallow((s) => ({
      models: s.models,
      loading: s.loading,
      geometryStreamingActive: s.geometryStreamingActive,
    })),
  );
  /** Models already handled. Compression happens once per model, and a second
   *  attempt would only find a source that is no longer resident. */
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (loading || geometryStreamingActive) return;
    for (const id of handled.current) if (!models.has(id)) handled.current.delete(id);

    let cancelled = false;
    void (async () => {
      for (const [id, model] of models) {
        if (cancelled) return;
        if (handled.current.has(id)) continue;
        const store = model.ifcDataStore;
        if (!store) continue;
        // Marked BEFORE the await: this effect re-runs on every `models`
        // change, and a second run would otherwise start a second worker on
        // the same source while the first is still deflating it.
        handled.current.add(id);

        const outcome = await compressStoreSource(store);
        if (outcome.kind === 'done') {
          const pct = ((outcome.after / outcome.before) * 100).toFixed(1);
          console.log(`[source] ${id}: ${mb(outcome.before)} → ${mb(outcome.after)} (${pct}%)`);
        } else if (outcome.kind === 'failed') {
          console.warn(`[source] ${id}: compression failed — ${outcome.error}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [models, loading, geometryStreamingActive]);
}
