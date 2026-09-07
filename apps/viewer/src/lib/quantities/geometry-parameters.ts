/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The geometry parameters a Mengenabfrage can ask for — `Typ:="Mantelfläche"`,
 * `Typ:="Volumen"`, and so on. Taken verbatim from RIB's "Überblick der
 * Geometrie-Parameter", which is the authority on the vocabulary.
 *
 * NONE OF THESE ARE COMPUTED HERE. This module is the catalogue and the
 * plug: it lets the editor offer real names, lets a formula be validated
 * before it is saved, and gives the evaluator a single place to ask a
 * geometry provider. Computing them means oriented bounding boxes, contact
 * surfaces and opening deductions per component type — a project of its own,
 * deliberately outside this step. Until a provider is supplied, a formula
 * using one of these yields no number at all rather than a zero that would
 * look like a measured quantity.
 *
 * `dimension` is what the result is measured in, so the editor can check the
 * declared ME against it (an `Oberfläche` in `m` is a mistake worth catching
 * before it reaches a price).
 */

export type GeometryDimension = 'count' | 'length' | 'area' | 'volume' | 'angle' | 'coordinate' | 'other';

export interface GeometryParameter {
  name: string;
  dimension: GeometryDimension;
}

/** Every parameter name in the catalogue, with what it measures. */
export const GEOMETRY_PARAMETERS: readonly GeometryParameter[] = [
  { name: 'Anzahl', dimension: 'count' },
  { name: 'AnzahlPunkte', dimension: 'count' },
  { name: 'Stückzahl', dimension: 'count' },

  { name: 'Volumen', dimension: 'volume' },
  { name: 'BewehrungsvolumenBalken', dimension: 'volume' },
  { name: 'KontaktVolumen', dimension: 'volume' },

  { name: 'Bodenfläche', dimension: 'area' },
  { name: 'Deckenfläche', dimension: 'area' },
  { name: 'Fläche', dimension: 'area' },
  { name: 'FlächeMax', dimension: 'area' },
  { name: 'FlächeMin', dimension: 'area' },
  { name: 'FlächeSeitenflächen', dimension: 'area' },
  { name: 'FlächeStirnseite', dimension: 'area' },
  { name: 'Flächeninhalt', dimension: 'area' },
  { name: 'Gebäudefläche', dimension: 'area' },
  { name: 'GekrümmteFläche', dimension: 'area' },
  { name: 'KontaktFläche', dimension: 'area' },
  { name: 'Mantelfläche', dimension: 'area' },
  { name: 'Oberfläche', dimension: 'area' },
  { name: 'ProjizierteFlächeXY', dimension: 'area' },
  { name: 'Rückfläche', dimension: 'area' },
  { name: 'Schnittfläche', dimension: 'area' },

  { name: 'Breite', dimension: 'length' },
  { name: 'BreiteAngrenzendeElemente', dimension: 'length' },
  { name: 'BreiteMaxSchnOptOBB', dimension: 'length' },
  { name: 'BreiteMaxSchnOptOBBxy', dimension: 'length' },
  { name: 'BreiteMinSchnOptOBB', dimension: 'length' },
  { name: 'BreiteMinSchnOptOBBxy', dimension: 'length' },
  { name: 'BreiteOptOBB', dimension: 'length' },
  { name: 'BreiteOptOBBxy', dimension: 'length' },
  { name: 'Bodenversatz', dimension: 'length' },
  { name: 'Deckenversatz', dimension: 'length' },
  { name: 'Flächenbreite', dimension: 'length' },
  { name: 'Flächenlänge', dimension: 'length' },
  { name: 'HöheAngrenzendesElementLokal', dimension: 'length' },
  { name: 'HöheAngrenzendesElementVertikal', dimension: 'length' },
  { name: 'HöheOptOBB', dimension: 'length' },
  { name: 'HöheOptOBBxy', dimension: 'length' },
  { name: 'KontaktBreite', dimension: 'length' },
  { name: 'KontaktLänge', dimension: 'length' },
  { name: 'KontaktTiefe', dimension: 'length' },
  { name: 'Länge', dimension: 'length' },
  { name: 'LängeAngrenzendesElement', dimension: 'length' },
  { name: 'LängeLinie', dimension: 'length' },
  { name: 'LängeProjizierteLinie', dimension: 'length' },
  { name: 'LängsteSeiteOptOBB', dimension: 'length' },
  { name: 'LängsteSeiteOptOBBxy', dimension: 'length' },
  { name: 'ObereAbgrenzungOptOBB', dimension: 'length' },
  { name: 'ObereAbgrenzungOptOBBxy', dimension: 'length' },
  { name: 'ObereBegrenzung', dimension: 'length' },
  { name: 'OberkanteMax', dimension: 'length' },
  { name: 'OberkanteMaxAbs', dimension: 'length' },
  { name: 'OberkanteMin', dimension: 'length' },
  { name: 'OberkanteMinAbs', dimension: 'length' },
  { name: 'TiefeMaxSchnOptOBB', dimension: 'length' },
  { name: 'TiefeMaxSchnOptOBBxy', dimension: 'length' },
  { name: 'TiefeMinSchnOptOBB', dimension: 'length' },
  { name: 'TiefeMinSchnOptOBBxy', dimension: 'length' },
  { name: 'TiefeOptOBB', dimension: 'length' },
  { name: 'TiefeOptOBBxy', dimension: 'length' },
  { name: 'Umfang', dimension: 'length' },
  { name: 'UmfangBodenfläche', dimension: 'length' },
  { name: 'UmfangDeckenfläche', dimension: 'length' },
  { name: 'UntereAbgrenzungOptOBB', dimension: 'length' },
  { name: 'UntereAbgrenzungOptOBBxy', dimension: 'length' },
  { name: 'UntereBegrenzung', dimension: 'length' },
  { name: 'UnterkanteMax', dimension: 'length' },
  { name: 'UnterkanteMaxAbs', dimension: 'length' },
  { name: 'UnterkanteMin', dimension: 'length' },
  { name: 'UnterkanteMinAbs', dimension: 'length' },

  { name: 'NeigungswinkelOben', dimension: 'angle' },
  { name: 'NeigungswinkelUnten', dimension: 'angle' },
  { name: 'WinkelAnPunkt', dimension: 'angle' },

  { name: 'WertXKoordinate', dimension: 'coordinate' },
  { name: 'WertYKoordinate', dimension: 'coordinate' },
  { name: 'WertZKoordinate', dimension: 'coordinate' },

  { name: 'Bauteiltyp', dimension: 'other' },
  { name: 'BerechnungNichtVorhandeneUntergründe', dimension: 'other' },
  { name: 'BerechnungNurKontakt', dimension: 'other' },
  { name: 'BerNurRaumKontakt', dimension: 'other' },
  { name: 'HatKontakt', dimension: 'other' },
  { name: 'ObereBegrenzungObjekt', dimension: 'other' },
  { name: 'ObererHöhenbezug', dimension: 'other' },
  { name: 'SchnittHöhenbezug', dimension: 'other' },
  { name: 'Schnittebene', dimension: 'other' },
  { name: 'UntereBegrenzungBauteil', dimension: 'other' },
  { name: 'UntereBegrenzungBoundingBox', dimension: 'other' },
  { name: 'UntererHöhenbezug', dimension: 'other' },
  { name: 'ÖffnungenNichtRaumseitig', dimension: 'other' },
  { name: 'ÖffnungenRaumseitig', dimension: 'other' },
];

const BY_NAME = new Map(GEOMETRY_PARAMETERS.map((p) => [p.name.toLowerCase(), p]));

/** The catalogue entry for a `Typ:="…"` value, or null if it is not one. */
export function geometryParameter(name: string): GeometryParameter | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/** Units that go with a dimension, for checking a declared ME. */
const UNITS_BY_DIMENSION: Record<GeometryDimension, readonly string[]> = {
  count: ['st', 'stk', 'stck', 'stück'],
  length: ['m', 'cm', 'mm', 'km'],
  area: ['m2', 'm²', 'm^2', 'qm'],
  volume: ['m3', 'm³', 'm^3', 'cbm'],
  angle: ['°', 'grad', 'deg'],
  coordinate: ['m', 'cm', 'mm'],
  other: [],
};

/**
 * Does the declared ME fit what the parameter measures? `null` when there is
 * nothing to check (no unit given, or a dimension with no fixed unit).
 * An `Oberfläche` declared in `m` is worth catching before it is priced.
 */
export function unitFitsParameter(param: GeometryParameter, me: string | null): boolean | null {
  if (!me) return null;
  const allowed = UNITS_BY_DIMENSION[param.dimension];
  if (allowed.length === 0) return null;
  return allowed.includes(me.trim().toLowerCase());
}
