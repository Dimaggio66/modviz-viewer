/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Should an attribute still get a row in the object filter?
 *
 * The filter's attribute list comes from the FILE's schema, which cannot know
 * that a rule has since removed the attribute. Renaming `Nenndurchmesser` to
 * `5D_FormteilDN` left the old name in the list forever, because the file
 * still lists values for it.
 *
 * Three cases, and the middle one is the reason this is a function rather than
 * a boolean expression:
 *
 *   a rule WROTE values          → alive, whatever the file said
 *   a rule DELETED some          → alive only if some object still carries it
 *   the file had it, untouched   → alive
 *
 * A partial deletion must NOT hide the attribute: the objects the rule did not
 * match still have it, and hiding it would make them unfilterable. So the
 * model is only scanned when a deletion could actually have emptied it, and
 * the scan is the caller's — it stops at the first object that still has one.
 */

export interface OverlayVerdict {
  /** Keep a row for this attribute. */
  live: boolean;
  /** Values the rules wrote, to merge into the row's options. */
  written: string[];
}

export function judgeOverlay(
  fileHasValues: boolean,
  overlayValues: Iterable<string | null>,
  /** Does any object still carry it? Called at most once, and only when the
   *  answer can change the outcome — it walks the model. */
  anyObjectStillHasIt: () => boolean,
): OverlayVerdict {
  const written: string[] = [];
  let deleted = false;
  for (const v of overlayValues) {
    if (v !== null && v !== '') written.push(v);
    else deleted = true;
  }
  if (written.length > 0) return { live: true, written };
  if (!fileHasValues) {
    // Nothing written, nothing in the file: the rule that created this
    // attribute has been rolled back, so no row should be left behind.
    return { live: false, written };
  }
  return { live: deleted ? anyObjectStillHasIt() : true, written };
}
