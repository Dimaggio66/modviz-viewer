/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persistence for attribute rules — localStorage-backed, keyed per project,
 * mirroring RIB BIM Qualifier §6.8.1.1: "Das Programm speichert projektbezogen
 * jede Definition einer Attributregel … Eine geänderte Regel überschreibt eine
 * ggf. bestehende Regel."
 *
 * A rule keeps the express ids its condition matched, so a saved rule still
 * targets the objects it was built for rather than whatever the filter happens
 * to show later. Those ids are only meaningful for the file they came from, so
 * the catalog is keyed by a project key derived from the model (see
 * `projectKeyFor`) and a restored entry is dropped when that key changes.
 *
 * Pure module — safe to import from tests; storage access is guarded so a
 * private-mode or quota-blocked browser degrades to "not persisted" instead of
 * throwing.
 */

import type { AttributeRule } from './attribute-rules.js';

const STORAGE_KEY = 'ifc-lite:attribute-rules';
/** Guard against filling storage with a giant id list (~8 bytes per id). */
const MAX_IDS_PER_RULE = 200_000;
const MAX_RULES_PER_PROJECT = 200;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** All projects' rule sets, keyed by project key. */
type Catalog = Record<string, { rules: AttributeRule[]; updatedAt: number }>;

function safeStorage(): StorageLike | null {
  try {
    const ls = (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage;
    if (!ls) return null;
    const probe = `${STORAGE_KEY}:__probe__`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Identify the loaded file, so rules (and the express ids they carry) are only
 * restored for the model they were authored against. The name alone would
 * collide across revisions of the same file; pairing it with the entity count
 * makes a re-exported model read as a different project instead of silently
 * reusing ids that now name other objects.
 */
export function projectKeyFor(modelName: string | undefined, entityCount: number): string {
  return `${modelName ?? 'model'}#${entityCount}`;
}

function readCatalog(ls: StorageLike): Catalog {
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Catalog) : {};
  } catch {
    // Unreadable entry: treat as empty rather than throwing on every open.
    return {};
  }
}

/** Rules saved for this project, or [] when there are none / storage is off. */
export function loadRules(projectKey: string): AttributeRule[] {
  const ls = safeStorage();
  if (!ls) return [];
  const entry = readCatalog(ls)[projectKey];
  if (!entry || !Array.isArray(entry.rules)) return [];
  // Defensive: only keep entries that still look like rules, so a catalog
  // written by an older build can't crash planning.
  return entry.rules.filter(
    (r): r is AttributeRule =>
      !!r && typeof r === 'object' && typeof r.id === 'string'
      && Array.isArray(r.entityIds) && Array.isArray(r.conditions) && !!r.action,
  );
}

/**
 * Replace this project's rules. Returns false when nothing reached storage —
 * the caller must not claim the rules were saved in that case.
 */
export function saveRules(projectKey: string, rules: readonly AttributeRule[]): boolean {
  const ls = safeStorage();
  if (!ls) return false;
  const trimmed = rules.slice(0, MAX_RULES_PER_PROJECT).map((r) => ({
    ...r,
    entityIds: r.entityIds.length > MAX_IDS_PER_RULE ? r.entityIds.slice(0, MAX_IDS_PER_RULE) : r.entityIds,
  }));
  try {
    const catalog = readCatalog(ls);
    if (trimmed.length === 0) delete catalog[projectKey];
    else catalog[projectKey] = { rules: trimmed, updatedAt: Date.now() };
    ls.setItem(STORAGE_KEY, JSON.stringify(catalog));
    return true;
  } catch (err) {
    // Most likely a quota error from a very large id list.
    console.warn(`[ifc-lite] attribute rules could not be written to "${STORAGE_KEY}".`, err);
    return false;
  }
}

/** Drop every saved rule for one project. */
export function clearRules(projectKey: string): boolean {
  return saveRules(projectKey, []);
}

export const __internal = { STORAGE_KEY, MAX_IDS_PER_RULE, MAX_RULES_PER_PROJECT };
