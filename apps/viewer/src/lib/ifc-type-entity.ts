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

/** Just enough of an IfcDataStore to name an entity's class. */
export interface EntityClassSource {
  entityIndex?: { byId?: { get(id: number): { type?: string } | undefined } | null } | null;
  entities?: { getTypeName?(id: number): string | undefined } | null;
}

/**
 * The IFC class of one entity, preferring the entity index over the schema
 * lookup.
 *
 * `entities.getTypeName` answers `"Unknown"` for a class its schema table does
 * not carry, and in the browser that includes the TYPE entities: the same
 * `IfcPipeFittingType` that reads as `IfcPipeFittingType` in node came back as
 * `"Unknown"` there. Every caller that asked "is this a type entity?" then got
 * no, and every attribute living on a type became invisible — 920 of 982
 * objects could not supply `Text\CAx Typ` to a rule.
 *
 * The index holds the class exactly as the file spells it (`IFCPIPEFITTINGTYPE`)
 * and is what `byType` is built from, so it is populated whenever the entity is.
 */
export function ifcClassOf(store: EntityClassSource | null | undefined, entityId: number): string {
  const fromIndex = store?.entityIndex?.byId?.get?.(entityId)?.type;
  if (fromIndex) return fromIndex;
  return store?.entities?.getTypeName?.(entityId) ?? '';
}
