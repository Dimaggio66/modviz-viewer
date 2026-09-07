/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ausstattung persistence — a localStorage catalogue keyed per project, the
 * same shape the attribute rules use, so both survive a reload together.
 *
 * This is a KNOWN TEMPORARY HOME. A tender that has to be auditable cannot
 * have its source of truth in one browser profile that a cleared cache
 * destroys, and this module deliberately makes no claim otherwise: every
 * write reports whether it actually reached storage so the UI can say so out
 * loud rather than pretend the table is safe.
 */

import { emptyProject, type AusstattungProject } from './model.js';

const STORAGE_KEY = 'ifc-lite:ausstattung';
const MAX_ROWS_PER_PROJECT = 20_000;
const MAX_GROUPS = 2_000;
const MAX_POSITIONS = 20_000;

type Catalog = Record<string, AusstattungProject>;

function storage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = `${STORAGE_KEY}:__probe__`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

function readCatalog(): Catalog {
  const ls = storage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Catalog) : {};
  } catch (err) {
    // A corrupt entry must not take the table down; it is left in place rather
    // than deleted, so the data can still be recovered by hand.
    console.warn(`[ifc-lite] "${STORAGE_KEY}" could not be read.`, err);
    return {};
  }
}

function writeCatalog(catalog: Catalog): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(catalog));
    return true;
  } catch (err) {
    console.warn(`[ifc-lite] ausstattung could not be written to "${STORAGE_KEY}".`, err);
    return false;
  }
}

function capped(project: AusstattungProject): AusstattungProject {
  return {
    rows: project.rows.slice(0, MAX_ROWS_PER_PROJECT),
    gruppen: project.gruppen.slice(0, MAX_GROUPS),
    positionen: project.positionen.slice(0, MAX_POSITIONS),
  };
}

export function loadAusstattung(projectKey: string): AusstattungProject {
  const stored = readCatalog()[projectKey];
  if (!stored) return emptyProject();
  return {
    rows: Array.isArray(stored.rows) ? stored.rows : [],
    gruppen: Array.isArray(stored.gruppen) ? stored.gruppen : [],
    positionen: Array.isArray(stored.positionen) ? stored.positionen : [],
  };
}

/** `false` means the change is in memory only — the caller must say so. */
export function saveAusstattung(projectKey: string, project: AusstattungProject): boolean {
  const catalog = readCatalog();
  catalog[projectKey] = capped(project);
  return writeCatalog(catalog);
}

export function clearAusstattung(projectKey: string): boolean {
  const catalog = readCatalog();
  delete catalog[projectKey];
  return writeCatalog(catalog);
}

export const __internal = { STORAGE_KEY, MAX_ROWS_PER_PROJECT };
