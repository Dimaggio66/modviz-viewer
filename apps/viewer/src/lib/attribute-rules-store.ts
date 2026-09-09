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
/**
 * Upper bound on rules per project. 200 was chosen when a rule was something
 * you collected by hand from the filter, a handful at a time. An imported
 * RIBiTWO mapping is nothing like that: `Attributregeln Heizung 1+2` alone is
 * 339 rules, and a project that had accumulated several imports reached 539.
 * The old bound silently dropped everything past the 200th — the rules stayed
 * in the open dialog and were gone after the next load.
 *
 * The real limit is the browser's storage quota, which `writeEntry` already
 * catches. This is only here so a pathological input cannot try to serialise
 * something absurd first.
 */
const MAX_RULES_PER_PROJECT = 5_000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * All projects' rule sets, keyed by project key.
 *
 * `applied` is the rule set as it stood at the last apply. It is kept
 * separately from `rules` because a rule the user deletes must still be
 * rolled back on the next apply — once it is gone from `rules` there is
 * nothing left to say what it wrote.
 */
type Catalog = Record<string, { rules: AttributeRule[]; applied?: AttributeRule[]; updatedAt: number }>;

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

/** Defensive: only keep entries that still look like rules, so a catalog
 *  written by an older build can't crash planning. */
function sane(list: unknown): AttributeRule[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (r): r is AttributeRule =>
      !!r && typeof r === 'object' && typeof r.id === 'string'
      && Array.isArray(r.entityIds) && Array.isArray(r.conditions) && !!r.action,
  );
}

/** Rules saved for this project, or [] when there are none / storage is off. */
export function loadRules(projectKey: string): AttributeRule[] {
  const ls = safeStorage();
  if (!ls) return [];
  return sane(readCatalog(ls)[projectKey]?.rules);
}

/** The rule set as it stood at the last apply — what a rollback compares against. */
export function loadApplied(projectKey: string): AttributeRule[] {
  const ls = safeStorage();
  if (!ls) return [];
  return sane(readCatalog(ls)[projectKey]?.applied);
}

/** Trimmed rules, and whether anything had to be dropped — a caller must not
 *  report a partial save as a save. */
function trim(rules: readonly AttributeRule[]): { rules: AttributeRule[]; dropped: number } {
  const dropped = Math.max(0, rules.length - MAX_RULES_PER_PROJECT);
  if (dropped > 0) {
    console.warn(`[ifc-lite] ${dropped} of ${rules.length} attribute rules exceed the per-project limit of ${MAX_RULES_PER_PROJECT} and were not stored.`);
  }
  return {
    dropped,
    rules: rules.slice(0, MAX_RULES_PER_PROJECT).map((r) => ({
      ...r,
      entityIds: r.entityIds.length > MAX_IDS_PER_RULE ? r.entityIds.slice(0, MAX_IDS_PER_RULE) : r.entityIds,
    })),
  };
}

/** Read-modify-write one project entry, leaving the other field intact. */
function writeEntry(projectKey: string, patch: (e: { rules: AttributeRule[]; applied: AttributeRule[] }) => void): boolean {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    const catalog = readCatalog(ls);
    const current = catalog[projectKey];
    const entry = { rules: sane(current?.rules), applied: sane(current?.applied) };
    patch(entry);
    if (entry.rules.length === 0 && entry.applied.length === 0) delete catalog[projectKey];
    else catalog[projectKey] = { rules: entry.rules, applied: entry.applied, updatedAt: Date.now() };
    ls.setItem(STORAGE_KEY, JSON.stringify(catalog));
    return true;
  } catch (err) {
    // Most likely a quota error from a very large id list.
    console.warn(`[ifc-lite] attribute rules could not be written to "${STORAGE_KEY}".`, err);
    return false;
  }
}

/**
 * Replace this project's rules. Returns false when nothing reached storage —
 * the caller must not claim the rules were saved in that case.
 */
export function saveRules(projectKey: string, rules: readonly AttributeRule[]): boolean {
  const t = trim(rules);
  return writeEntry(projectKey, (e) => { e.rules = t.rules; }) && t.dropped === 0;
}

/** Record what the just-finished apply put into the model. */
export function saveApplied(projectKey: string, applied: readonly AttributeRule[]): boolean {
  const t = trim(applied);
  return writeEntry(projectKey, (e) => { e.applied = t.rules; }) && t.dropped === 0;
}

/** Drop every saved rule for one project, including the applied snapshot. */
export function clearRules(projectKey: string): boolean {
  return writeEntry(projectKey, (e) => { e.rules = []; e.applied = []; });
}

export const __internal = { STORAGE_KEY, MAX_IDS_PER_RULE, MAX_RULES_PER_PROJECT };
