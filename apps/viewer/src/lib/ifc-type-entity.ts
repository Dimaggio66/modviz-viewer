/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Is this IFC class a TYPE entity — one that carries `HasPropertySets` of its
 * own, which the occurrence property extractor cannot see?
 *
 * Three places asked this with `typeName.endsWith('Type')`, and that misses
 * two things:
 *
 *  - `IfcDoorStyle` and `IfcWindowStyle`. IFC2X3 defines doors and windows
 *    through a *Style entity instead of a *Type one, and they are reached by
 *    `IfcRelDefinesByType` like any other. In `DHL_Leer_R2026` that is 36
 *    doors and 30 windows whose type attributes were invisible to the
 *    attribute rules — a rule built on them matched nothing, silently.
 *  - the case. `getTypeName` answers in the schema's spelling where it knows
 *    the class (`IfcWallType`) and in the file's where it does not
 *    (`IFCDOORSTYLE`), so a case-sensitive suffix test is a coin flip.
 *
 * Only the two Style classes that really are type objects are listed. The
 * other `*Style` classes — `IfcSurfaceStyle` and the rest of the presentation
 * hierarchy — are not, and must not be treated as such.
 */

const STYLE_TYPE_ENTITIES: ReadonlySet<string> = new Set([
  'ifcdoorstyle',
  'ifcwindowstyle',
]);

export function isTypeEntityName(typeName: string | null | undefined): boolean {
  if (!typeName) return false;
  const name = typeName.toLowerCase();
  return name.endsWith('type') || STYLE_TYPE_ENTITIES.has(name);
}
