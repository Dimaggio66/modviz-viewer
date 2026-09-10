/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deflate the IFC source into blocks, off the main thread (#2183).
 *
 * The thin shell `source-compress.ts` says it is: every decision — block size,
 * deflate level, what to store verbatim, the content key — lives in
 * `compressSource`, which is a plain function so it can be tested without a
 * Worker. This file only moves the work to another thread and hands the result
 * back.
 *
 * Nothing is transferred INTO the worker. Above `COMPRESSION_MIN_BYTES` the
 * source is SharedArrayBuffer-backed, so the structured clone shares it rather
 * than copying — which is the whole reason that threshold sits where it does.
 * Transferring instead would detach the buffer the store is reading from and
 * blank the model.
 *
 * The result IS transferred: `blocks`, `index` and `storedMask` are the
 * worker's own exact-size allocations and nothing here touches them again.
 */

import { compressSource, type CompressedSource } from '@ifc-lite/parser';

export interface SourceCompressRequest {
  bytes: Uint8Array;
  /** Omitted = `DEFAULT_BLOCK_SIZE`. Present so tests can use tiny blocks. */
  blockSize?: number;
}

export type SourceCompressResponse =
  | { ok: true; payload: CompressedSource }
  | { ok: false; error: string };

/** Same guard the zone-split worker uses: this module is also reachable from a
 *  main-thread import (the type exports), where `self` is the window. */
const isWorkerScope =
  typeof self !== 'undefined'
  && typeof (globalThis as { window?: unknown }).window === 'undefined'
  && typeof (self as unknown as Worker).postMessage === 'function';

if (isWorkerScope) {
  self.onmessage = (event: MessageEvent<SourceCompressRequest>) => {
    const { bytes, blockSize } = event.data;
    try {
      const payload = blockSize === undefined ? compressSource(bytes) : compressSource(bytes, blockSize);
      (self as unknown as Worker).postMessage(
        { ok: true, payload } satisfies SourceCompressResponse,
        [payload.blocks.buffer, payload.index.buffer, payload.storedMask.buffer],
      );
    } catch (error) {
      (self as unknown as Worker).postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies SourceCompressResponse);
    }
  };
}
