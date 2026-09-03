/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The RIBiTWO value-query language, shared by the object filter's value cells
 * and by attribute-rule conditions (including the ones imported from a
 * `<transform>` mapping file, which use exactly this syntax):
 *
 *   `*`  wildcard — `A*` starts-with, `*A` ends-with, `*A*` contains,
 *        a bare term is an exact match
 *   `&`  AND — every term must match the SAME value  ("*Wasser* & *150*")
 *   `||` OR  — any term may match; binds looser than `&`
 *
 * Matching is case-insensitive and spaces around the operators are optional.
 */

/** Does the text use the query language rather than being a literal value? */
export function isQueryExpr(s: string): boolean {
  return s.includes('*') || s.includes('&') || s.includes('|');
}

/** One term → an anchored, case-insensitive regex with `*` standing for any
 *  run of characters (so a bare term is an exact match, `A*` starts-with, …). */
export function termToRegExp(term: string): RegExp {
  const escaped = term.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Compile `A & B || C` into a predicate — OR of AND-groups (`&` binds tighter
 *  than `||`). Every term in an AND-group must match the SAME value. */
export function compileQuery(input: string): (value: string) => boolean {
  const groups = input
    .split('||')
    .map((g) => g.split('&').map((t) => t.trim()).filter(Boolean).map(termToRegExp))
    .filter((g) => g.length > 0);
  if (groups.length === 0) return () => false;
  return (value: string) => groups.some((and) => and.every((re) => re.test(value)));
}

/**
 * Compile any value expression — a query or a plain literal — into a predicate.
 * A literal compares case-insensitively, matching how the filter treats a value
 * picked from a dropdown.
 */
export function compileValueMatch(input: string): (value: string) => boolean {
  const t = input.trim();
  if (isQueryExpr(t)) return compileQuery(t);
  const lower = t.toLowerCase();
  return (value: string) => value.toLowerCase() === lower;
}
