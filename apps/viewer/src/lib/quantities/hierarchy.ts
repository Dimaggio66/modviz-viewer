/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The object hierarchy a Mengenabfrage walks.
 *
 * Two features need it and neither works without it:
 *
 *   • the Tiefensuche — every `;` in a `Bauteil` chain steps one level DOWN,
 *     so `Bauteiltyp=='Wall';Bauteiltyp=='Opening'` counts the openings IN
 *     walls rather than all of them;
 *   • the `$` prefix — "Attribute, die sowohl am Objekt direkt als auch bei
 *     einem Eltern-Objekt vorkommen dürfen", which walks UP.
 *
 * WHAT COUNTS AS A CHILD. Three IFC relationships, because RIB's CPI model
 * has one containment idea where IFC has three, and a Mengenabfrage means all
 * of them:
 *
 *   IfcRelAggregates                  a whole and its parts
 *   IfcRelVoidsElement                a wall and the openings cut into it
 *   IfcRelContainedInSpatialStructure a storey and what stands on it
 *
 * Leaving the last one out would make a storey childless, and a chain that
 * starts at a storey is exactly how one filters "the openings on level 3".
 * Leaving out voids would make the manual's own opening example impossible.
 *
 * Direction: `forward` runs Relating → Related, matching the EXPRESS attribute
 * order, and for all three of these the relating side is the containing one.
 * So forward is downward and inverse is upward.
 *
 * The maps are built once per store and cached by the caller; a model with a
 * few hundred thousand entities resolves a couple of thousand relationships,
 * which is cheap next to walking them per query.
 */

import { RelationshipType } from '@ifc-lite/data';

/** The little of a store this needs, so tests can hand in a fake. */
export interface RelationshipSource {
  getRelated(entityId: number, relType: RelationshipType, direction: 'forward' | 'inverse'): number[];
}

export interface Hierarchy {
  /** Direct children — parts, openings, and what a storey contains. */
  childrenOf(entityId: number): readonly number[];
  /** Direct parents. An element usually has one; nothing guarantees it. */
  parentsOf(entityId: number): readonly number[];
  /** Every ancestor, outermost last, without repeating one. */
  ancestorsOf(entityId: number): readonly number[];
}

const CONTAINMENT: readonly RelationshipType[] = [
  RelationshipType.Aggregates,
  RelationshipType.VoidsElement,
  RelationshipType.ContainsElements,
];

/** Reads all three relationships in one direction, without duplicates. */
function relatedAcross(
  source: RelationshipSource,
  entityId: number,
  direction: 'forward' | 'inverse',
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const type of CONTAINMENT) {
    let ids: number[];
    try {
      ids = source.getRelated(entityId, type, direction) ?? [];
    } catch {
      // A store that does not carry one of these relationships must not take
      // the whole query down — it simply has no children of that kind.
      continue;
    }
    for (const id of ids) {
      if (id === entityId || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function buildHierarchy(source: RelationshipSource | null | undefined): Hierarchy | null {
  if (!source || typeof source.getRelated !== 'function') return null;

  const children = new Map<number, readonly number[]>();
  const parents = new Map<number, readonly number[]>();

  const childrenOf = (entityId: number): readonly number[] => {
    let c = children.get(entityId);
    if (!c) { c = relatedAcross(source, entityId, 'forward'); children.set(entityId, c); }
    return c;
  };
  const parentsOf = (entityId: number): readonly number[] => {
    let p = parents.get(entityId);
    if (!p) { p = relatedAcross(source, entityId, 'inverse'); parents.set(entityId, p); }
    return p;
  };

  return {
    childrenOf,
    parentsOf,
    ancestorsOf(entityId: number): readonly number[] {
      const out: number[] = [];
      const seen = new Set<number>([entityId]);
      // Breadth-first and cycle-guarded: a malformed model can point a parent
      // back at its own child, and an infinite walk would hang the table.
      const queue = [...parentsOf(entityId)];
      let head = 0;
      while (head < queue.length) {
        const id = queue[head++]!;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        for (const up of parentsOf(id)) if (!seen.has(up)) queue.push(up);
      }
      return out;
    },
  };
}
