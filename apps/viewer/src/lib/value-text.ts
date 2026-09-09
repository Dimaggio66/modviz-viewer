/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A property or quantity value as text, with double-precision noise rounded
 * away.
 *
 * `125` reached the filter's value list as `125.00000000000001` and `250` as
 * `250.00000000000003` — the residue of the unit conversions the parser does
 * on the way out of the file. iTWO shows `125` and `250`, and a value list is
 * unusable when the same nominal diameter appears under two spellings.
 *
 * Twelve significant digits is the point where that residue is gone and real
 * data is not: a double carries about sixteen, so the noise sits well below,
 * while a volume of `0.005598 m³` or a diameter of `42.4` survives untouched.
 * `toFixed` would not do — it rounds by decimal places, so it would flatten
 * exactly those small quantities.
 *
 * Only actual numbers are touched. A string is returned as it stands, because
 * an article number like `0008436` is text that happens to look numeric, and
 * parsing it would turn it into `8436`.
 */
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : String(value);
  }
  return String(value);
}
