/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `Bauteiltyp` — the component type a QTO condition compares against
 * (`Bauteil:="Bauteiltyp=='Wall'"`).
 *
 * It is resolved in TWO steps, and the order matters. In this project's own
 * models the type is not derived from the IFC class at all: the mapping rules
 * write it, `<out property="cpiComponentType" value="Attribute" mode="Add"/>`
 * for everything and `Default` for DUCTFITTING/FLOWSEGMENT. So a written
 * `cpiComponentType` always wins; the IFC class is only the fallback for a
 * model that carries no mapping.
 *
 * The vocabulary is RIB's, from "Überblick der Geometrie-Parameter": the 20
 * component types the geometry catalogue is indexed by. Several of them
 * (Alcove, Face_Formwork, Shutter_Case, Surface, Point, Line) are iTWO
 * constructs with no IFC counterpart — they stay unmapped rather than being
 * bent onto an approximate class, because a wrong Bauteiltyp silently moves
 * quantities between LV positions.
 */

/** The attribute the mapping rules write the component type into. */
export const COMPONENT_TYPE_ATTRIBUTE = 'cpiComponentType';

/** RIB's component types, as the geometry catalogue indexes them. */
export const COMPONENT_TYPES = [
  'Wall', 'Multi_Wall', 'Column', 'Beam', 'Slab', 'Foundation', 'Foundation_Slab',
  'Space', 'Opening', 'Alcove', 'Surface', 'Default', 'Face_Formwork', 'Lintel',
  'Chimney', 'Shutter_Case', 'Window', 'Door', 'Point', 'Line',
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

/**
 * IFC classes that stand for a component type, lower-cased for comparison.
 * Only unambiguous correspondences are listed — see the file header.
 */
const IFC_CLASS_TO_TYPE = new Map<string, ComponentType>([
  ['ifcwall', 'Wall'],
  ['ifcwallstandardcase', 'Wall'],
  ['ifcwallelementedcase', 'Wall'],
  ['ifccolumn', 'Column'],
  ['ifccolumnstandardcase', 'Column'],
  ['ifcbeam', 'Beam'],
  ['ifcbeamstandardcase', 'Beam'],
  ['ifcslab', 'Slab'],
  ['ifcslabstandardcase', 'Slab'],
  ['ifcslabelementedcase', 'Slab'],
  ['ifcfooting', 'Foundation'],
  ['ifcspace', 'Space'],
  ['ifcopeningelement', 'Opening'],
  ['ifcopeningstandardcase', 'Opening'],
  ['ifcwindow', 'Window'],
  ['ifcwindowstandardcase', 'Window'],
  ['ifcdoor', 'Door'],
  ['ifcdoorstandardcase', 'Door'],
  ['ifcchimney', 'Chimney'],
]);

/**
 * The component type of one element: the written `cpiComponentType` if the
 * mapping produced one, else the IFC class translated, else `null` — never a
 * guess.
 */
export function componentTypeOf(
  written: string | null,
  ifcClass: string | null,
): ComponentType | string | null {
  const w = written?.trim();
  if (w) return w;
  if (!ifcClass) return null;
  return IFC_CLASS_TO_TYPE.get(ifcClass.trim().toLowerCase()) ?? null;
}

/** True when the IFC class alone can answer a Bauteiltyp comparison. */
export function ifcClassIsMapped(ifcClass: string | null): boolean {
  return ifcClass !== null && IFC_CLASS_TO_TYPE.has(ifcClass.trim().toLowerCase());
}
