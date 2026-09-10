/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Main-thread client for {@link ../workers/sourceCompress.worker.ts}.
 *
 * The IFC source is the whole file and it stays resident for the model's
 * lifetime, because property and attribute reads slice it synchronously during
 * render. Measured on 410_Krankenhaus_BaWue.ifc (985 MB) right after the load:
 * 4,212 MB RSS, of which 2,226 MB is ArrayBuffers and only 249 MB is reachable
 * through the store's indexes. A Chrome renderer has about 4 GB, and a second
 * viewer tab on the same origin shares that process — which is how the tab came
 * back with "Out of Memory".
 *
 * Everything this needs already existed and was never called: `compressSource`,
 * `compressSourceInPlace`, `BlockStore`, `shouldCompressSource`, and tests for
 * all of them (#2183). This file is the missing call site.
 *
 * One worker per model, terminated as soon as the run settles — the same trade
 * `split-worker-client.ts` makes. Compression happens once in a model's life;
 * a resident worker would pin a second heap for the whole session to save one
 * module compile.
 */

import {
  compressSourceInPlace,
  shouldCompressSource,
  type IfcDataStore,
} from '@ifc-lite/parser';
import type {
  SourceCompressRequest,
  SourceCompressResponse,
} from '@/workers/sourceCompress.worker.js';

export type CompressionOutcome =
  | { kind: 'done'; before: number; after: number }
  /** Nothing was attempted. `why` is for the log line, not for the user. */
  | { kind: 'skipped'; why: string }
  | { kind: 'failed'; error: string };

/**
 * Ceiling on one run.
 *
 * Deflate at level 6 runs in the tens of MB/s, so a 985 MB source is well
 * inside a minute. Five is not a budget, it is the point at which the worker is
 * GONE rather than slow — a worker killed by the OS (renderer OOM, the very
 * thing this is meant to prevent) fires neither `message` nor `error`, and
 * without a deadline the promise would never settle.
 */
export const SOURCE_COMPRESS_TIMEOUT_MS = 300_000;

/**
 * Compress this model's source in place, if it is worth it and safe.
 *
 * Returns rather than throws: this is opportunistic relief, and a model that
 * stays uncompressed is a model that behaves exactly as it did before.
 */
export async function compressStoreSource(store: IfcDataStore): Promise<CompressionOutcome> {
  const source = store.source;
  if (!source || source.byteLength === 0) return { kind: 'skipped', why: 'no source' };
  if (!source.isResident) return { kind: 'skipped', why: 'already compressed' };
  if (!shouldCompressSource(source.byteLength)) {
    return { kind: 'skipped', why: `below the threshold (${source.byteLength} bytes)` };
  }
  if (typeof Worker === 'undefined') return { kind: 'skipped', why: 'no Worker' };

  // Reads the view without materialising or hashing anything.
  const transfer = source.toTransferable();
  if (transfer.kind !== 'contiguous') return { kind: 'skipped', why: 'not contiguous' };

  // The guard that keeps this from backfiring. A SharedArrayBuffer is SHARED by
  // the structured clone; a plain ArrayBuffer would be COPIED, and a second
  // 985 MB at exactly the moment the tab is already near its ceiling is the
  // opposite of the point. Above COMPRESSION_MIN_BYTES the loader always
  // streams into a SAB, so this should not trigger — it is here because
  // "should not" is not "cannot".
  const shared = typeof SharedArrayBuffer !== 'undefined'
    && transfer.bytes.buffer instanceof SharedArrayBuffer;
  if (!shared) return { kind: 'skipped', why: 'source is not shared — a copy would cost more than it saves' };

  const before = source.byteLength;
  let payload;
  try {
    payload = await runWorker({ bytes: transfer.bytes });
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }

  // Throws when the payload does not describe these bytes — deliberately, per
  // `compressSourceInPlace`: swapping in a different source's blocks would
  // corrupt every later read silently.
  if (!compressSourceInPlace(source, payload)) {
    return { kind: 'skipped', why: 'this source cannot swap' };
  }
  return { kind: 'done', before, after: payload.blocks.byteLength };
}

function runWorker(request: SourceCompressRequest) {
  return new Promise<Extract<SourceCompressResponse, { ok: true }>['payload']>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/sourceCompress.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(new Error(`could not spawn the compression worker: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`compression did not finish within ${SOURCE_COMPRESS_TIMEOUT_MS} ms`))),
      SOURCE_COMPRESS_TIMEOUT_MS,
    );
    worker.onmessage = (event: MessageEvent<SourceCompressResponse>) => {
      const data = event.data;
      finish(() => (data.ok ? resolve(data.payload) : reject(new Error(data.error))));
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'compression worker failed')));
    // No transfer list: the bytes are shared, and detaching them would blank
    // the model the store is reading from.
    worker.postMessage(request);
  });
}
