/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Mengenabfrage — the QTO formula an Ausstattung row carries in its own
 * column. Modelled on the RIB manual "CPI-Modell / Mengenabfragen in RIB iTWO"
 * (2024) and on the hand-built Ausstattung table this project has to reproduce.
 *
 *   QTO(Typ:="Stückzahl";ME:="St")
 *   QTO(Typ:="Volumen";ME:="m3")
 *   roundk(QTO(Typ:="Attribut{5D_Länge}";ME:="m");1)
 *   QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Attribut{5D_DN} == (40.000 [mm])")*(1,18*0,05)
 *   QTO(Typ:="Stückzahl";ME:="St";Bauteil:="Bauteiltyp=='Wall';Bauteiltyp=='Opening'")
 *
 * THE SEMICOLON INSIDE `Bauteil` IS NOT "OR". The manual is explicit: each
 * `;` steps one level DOWN the component hierarchy, and a trailing `;` turns
 * the depth search on. Its example counts 10 openings anywhere, but only 8
 * once the chain reads Wall-then-Opening. Reading `;` as OR would have
 * produced plausible, wrong quantities — which is the whole failure mode this
 * module exists to prevent. Within one level, `und` joins comparisons.
 *
 * TWO number conventions live in one string: the arithmetic outside a literal
 * uses the German DECIMAL COMMA (`1,18*0,05`), while a `Bauteil` literal is
 * written with either separator (`40.000 [mm]` and `0,3[m]` both occur, both
 * meaning what they read as). Both are parsed as written; neither is guessed.
 *
 * WHAT THIS MODULE EVALUATES, and what it refuses to:
 * counts and attribute sums, filtered by attribute comparisons on ONE level.
 * That is exactly the vocabulary the project's own Ausstattung table uses.
 * Also Bauteiltyp comparisons, and the Tiefensuche when a hierarchy is
 * supplied. The ~95 geometry parameters need a provider and the `$` system
 * parameters need a resolver; without those a formula PARSES but yields NO
 * number and names the reason in `QtoResult.unsupported`. Returning 0 for a
 * Mantelfläche nobody computed would be a quantity that looks priced and is
 * not. An element whose Bauteiltyp cannot be decided is different: it simply
 * does not match, and is counted in `unresolved` — see there.
 *
 * Units are RECORDED, NOT APPLIED. Applying `[mm]` would mean assuming which
 * unit the attribute is stored in, and a wrong assumption there is a silent
 * factor of 1000 that surfaces as a wrong price rather than as an error.
 */

import { COMPONENT_TYPE_ATTRIBUTE, componentTypeOf } from './component-types.js';
import { geometryParameter } from './geometry-parameters.js';

/* ── Model ───────────────────────────────────────────────────────────────── */

/** What a QTO measures. */
export type QtoMeasure =
  /** `Typ:="Stückzahl"` */
  | { kind: 'count' }
  /** `Typ:="Attribut{5D_Länge}"` — sum of a mapped attribute. */
  | { kind: 'attribute'; name: string }
  /** `Typ:="Mantelfläche"` and the rest of the geometry catalogue. */
  | { kind: 'geometry'; parameter: string };

export type CompareOp = '==' | '!=' | '>' | '<' | '>=' | '<=';

export type ConditionSubject =
  /** `Attribut{MaterialName}` — a property on the element. */
  | { kind: 'attribute'; name: string }
  /** `$MaterialName`, `$Modell` — a system parameter. */
  | { kind: 'system'; name: string }
  /** `Bauteiltyp`, `HöheOptOBB`, `Bodenversatz` — a bare parameter. */
  | { kind: 'parameter'; name: string };

export type ConditionValue =
  /** `'Walls'`, `'*'` — single-quoted text; `*` matches anything. */
  | { kind: 'text'; text: string; wildcard: boolean }
  /** `(0,3[m])`, `(40.000 [mm])`, `0` — number with an optional unit. */
  | { kind: 'number'; value: number; unit: string | null };

export interface Comparison {
  subject: ConditionSubject;
  op: CompareOp;
  value: ConditionValue;
}

/** One level of the chain: every comparison must hold ("und"). */
export interface ConditionLevel {
  all: Comparison[];
}

/**
 * `A und B ; C` — the levels are steps DOWN the component hierarchy, not
 * alternatives. `depthSearch` is the trailing semicolon.
 */
export interface BauteilFilter {
  levels: ConditionLevel[];
  depthSearch: boolean;
}

export type QtoExpr =
  | { kind: 'number'; value: number }
  | { kind: 'qto'; measure: QtoMeasure; me: string | null; bauteil: BauteilFilter | null }
  | { kind: 'product'; factors: QtoExpr[] }
  | { kind: 'roundk'; inner: QtoExpr; digits: number };

export type ParseResult =
  | { ok: true; expr: QtoExpr }
  | { ok: false; error: string; at: number };

/* ── Parsing ─────────────────────────────────────────────────────────────── */

class Cursor {
  pos = 0;
  constructor(readonly src: string) {}
  ws(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }
  eat(token: string): boolean {
    this.ws();
    if (!this.src.startsWith(token, this.pos)) return false;
    this.pos += token.length;
    return true;
  }
  done(): boolean {
    this.ws();
    return this.pos >= this.src.length;
  }
}

class ParseError extends Error {
  constructor(message: string, readonly at: number) {
    super(message);
  }
}

/** German decimal comma — the convention OUTSIDE a Bauteil literal. */
function readCommaNumber(c: Cursor): number {
  c.ws();
  const m = /^\d+(?:,\d+)?/.exec(c.src.slice(c.pos));
  if (!m) throw new ParseError('Zahl erwartet', c.pos);
  c.pos += m[0].length;
  return Number(m[0].replace(',', '.'));
}

function readQuoted(c: Cursor): string {
  c.ws();
  if (c.src[c.pos] !== '"') throw new ParseError('Zeichenkette erwartet', c.pos);
  const end = c.src.indexOf('"', c.pos + 1);
  if (end < 0) throw new ParseError('Schliessendes Anfuehrungszeichen fehlt', c.pos);
  const out = c.src.slice(c.pos + 1, end);
  c.pos = end + 1;
  return out;
}

const ATTRIBUT = /^Attribut\s*\{([^}]+)\}$/;

/** A Bauteil literal writes numbers with EITHER separator — both occur. */
function bauteilNumber(text: string): number {
  return Number(text.includes(',') ? text.replace(',', '.') : text);
}

const COMPARISON =
  /^\s*(?:Attribut\s*\{([^}]+)\}|\$([A-Za-zÄÖÜäöüß0-9_]+)|([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9_]*))\s*(==|!=|>=|<=|>|<)\s*(?:'([^']*)'|\(\s*(-?\d+(?:[.,]\d+)?)\s*(?:\[([^\]]*)\])?\s*\)|(-?\d+(?:[.,]\d+)?))\s*$/;

function parseComparison(text: string, at: number): Comparison {
  const m = COMPARISON.exec(text);
  if (!m) throw new ParseError('Bedingung nicht verstanden: ' + text.trim(), at);
  const subject: ConditionSubject = m[1] !== undefined
    ? { kind: 'attribute', name: m[1].trim() }
    : m[2] !== undefined
      ? { kind: 'system', name: m[2].trim() }
      : { kind: 'parameter', name: m[3]!.trim() };
  const value: ConditionValue = m[5] !== undefined
    ? { kind: 'text', text: m[5], wildcard: m[5].includes('*') }
    : { kind: 'number', value: bauteilNumber((m[6] ?? m[8])!), unit: m[7]?.trim() || null };
  return { subject, op: m[4] as CompareOp, value };
}

/**
 * `Bauteiltyp=='Wall' und Attribut{X}=='Y';Bauteiltyp=='Opening'`
 * Levels split on `;` (hierarchy step), comparisons within a level on `und`.
 */
function parseBauteil(text: string, at: number): BauteilFilter {
  const raw = text.split(';');
  const depthSearch = raw.length > 1 && raw[raw.length - 1]!.trim() === '';
  const parts = raw.filter((p, i) => p.trim() !== '' || (i < raw.length - 1 && false));
  const levels: ConditionLevel[] = [];
  for (const part of parts) {
    if (part.trim() === '') continue;
    const all = part
      .split(/\s+und\s+/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseComparison(s, at));
    if (all.length > 0) levels.push({ all });
  }
  if (levels.length === 0) throw new ParseError('Bauteil ohne Bedingung', at);
  return { levels, depthSearch };
}

function parseQto(c: Cursor): QtoExpr {
  let measure: QtoMeasure | null = null;
  let me: string | null = null;
  let bauteil: BauteilFilter | null = null;
  do {
    c.ws();
    const keyAt = c.pos;
    const key = /^(Typ|ME|Bauteil)\s*:=/.exec(c.src.slice(c.pos));
    if (!key) throw new ParseError('Typ:=, ME:= oder Bauteil:= erwartet', c.pos);
    c.pos += key[0].length;
    const value = readQuoted(c);
    if (key[1] === 'Typ') {
      const attr = ATTRIBUT.exec(value.trim());
      if (attr) measure = { kind: 'attribute', name: attr[1]!.trim() };
      else if (value.trim().toLowerCase() === 'stückzahl') measure = { kind: 'count' };
      else if (value.trim()) measure = { kind: 'geometry', parameter: value.trim() };
      else throw new ParseError('Typ ist leer', keyAt);
    } else if (key[1] === 'ME') {
      me = value.trim() || null;
    } else {
      bauteil = parseBauteil(value, keyAt);
    }
  } while (c.eat(';'));
  if (!measure) throw new ParseError('QTO ohne Typ', c.pos);
  if (!c.eat(')')) throw new ParseError('Schliessende Klammer erwartet', c.pos);
  return { kind: 'qto', measure, me, bauteil };
}

function parseFactor(c: Cursor): QtoExpr {
  if (c.eat('roundk(')) {
    const inner = parseExpr(c);
    if (!c.eat(';')) throw new ParseError('Semikolon erwartet (roundk braucht Nachkommastellen)', c.pos);
    const digits = readCommaNumber(c);
    if (!c.eat(')')) throw new ParseError('Schliessende Klammer erwartet', c.pos);
    return { kind: 'roundk', inner, digits };
  }
  if (c.eat('QTO(')) return parseQto(c);
  if (c.eat('(')) {
    const inner = parseExpr(c);
    if (!c.eat(')')) throw new ParseError('Schliessende Klammer erwartet', c.pos);
    return inner;
  }
  return { kind: 'number', value: readCommaNumber(c) };
}

function parseExpr(c: Cursor): QtoExpr {
  const factors = [parseFactor(c)];
  while (c.eat('*')) factors.push(parseFactor(c));
  return factors.length === 1 ? factors[0]! : { kind: 'product', factors };
}

/**
 * Parse a Mengenabfrage. Never throws: a formula that cannot be read is a
 * review task, and the row carrying it has to say so rather than take the
 * whole table down.
 */
export function parseQtoQuery(src: string): ParseResult {
  const c = new Cursor(src);
  try {
    const expr = parseExpr(c);
    if (!c.done()) throw new ParseError('Unerwarteter Text nach der Formel', c.pos);
    return { ok: true, expr };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message, at: e.at };
    throw e;
  }
}

/* ── Evaluation ──────────────────────────────────────────────────────────── */

/** Reads one mapped attribute off an element, by bare name ("5D_Länge"). */
export interface QtoContext {
  entityIds: readonly number[];
  readAttribute: (entityId: number, name: string) => string | null;
  /** Direct children in the component hierarchy — what a `;` steps into. */
  childrenOf?: (entityId: number) => readonly number[];
  /** The element's IFC class, the FALLBACK for Bauteiltyp when the mapping
   *  wrote no `cpiComponentType`. */
  ifcClassOf?: (entityId: number) => string | null;
  /** A geometry provider. Absent means geometry parameters stay uncomputed
   *  and the formula yields no number — see the file header. */
  readGeometryParameter?: (entityId: number, parameter: string) => number | null;
}

export interface QtoResult {
  /** `null` when something in the formula could not be evaluated — never 0. */
  value: number | null;
  /** The ME the QTO itself declared, before any factor outside it. */
  unit: string | null;
  /** Every element that fed the measure — the audit trail back to the model. */
  matchedIds: number[];
  /** Matched, but carried no readable number for the summed attribute. */
  skipped: number[];
  /**
   * Elements a `Bauteiltyp` condition could not decide, because they carry
   * neither `cpiComponentType` nor a mapped IFC class. They simply do not
   * match. They must NOT void the quantity: a real model mixes classes, and
   * one undecidable element would otherwise wipe out the other thousands.
   * The count belongs on the row as a review note.
   */
  unresolved: number[];
  /** Named reasons this formula is not (yet) computable here. */
  unsupported: string[];
}

/** Attribute values come from the model, where IFC reals carry a decimal
 *  POINT. A stray German comma is still read rather than silently dropped. */
export function attributeNumber(text: string | null): number | null {
  if (text === null) return null;
  const t = text.trim();
  if (!t) return null;
  const n = Number(t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

/** Kaufmaennisch runden: half away from zero, on n decimals. Doubles put
 *  2.675*100 at 267.49999999999997, so a naive round would return 2.67. */
export function roundk(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  const scaled = value * f;
  const eps = Math.abs(scaled) * Number.EPSILON * 4;
  return (Math.sign(scaled) * Math.round(Math.abs(scaled) + eps)) / f;
}

/** `'L80*8'` and `'*'` — `*` stands for any run of characters. */
function textMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function compareNumbers(a: number, op: CompareOp, b: number): boolean {
  const tol = Math.max(1e-9, Math.abs(b) * 1e-9);
  switch (op) {
    case '==': return Math.abs(a - b) <= tol;
    case '!=': return Math.abs(a - b) > tol;
    case '>': return a > b + tol;
    case '<': return a < b - tol;
    case '>=': return a >= b - tol;
    case '<=': return a <= b + tol;
  }
}

function matchValue(cmp: Comparison, raw: string | null): boolean {
  if (cmp.value.kind === 'text') {
    if (raw === null) return cmp.op === '!=';
    const hit = textMatches(cmp.value.text, raw);
    return cmp.op === '!=' ? !hit : hit;
  }
  const got = attributeNumber(raw);
  if (got === null) return false;
  return compareNumbers(got, cmp.op, cmp.value.value);
}

/** Evaluates one comparison, or reports why it cannot. */
function testComparison(cmp: Comparison, id: number, ctx: QtoContext, unsupported: Set<string>, unresolved: Set<number>): boolean {
  if (cmp.subject.kind === 'attribute') {
    return matchValue(cmp, ctx.readAttribute(id, cmp.subject.name));
  }
  if (cmp.subject.kind === 'system') {
    unsupported.add(`Systemparameter $${cmp.subject.name}`);
    return false;
  }
  // Bauteiltyp: what the mapping wrote wins, the IFC class is the fallback.
  if (cmp.subject.name.toLowerCase() === 'bauteiltyp') {
    const resolved = componentTypeOf(
      ctx.readAttribute(id, COMPONENT_TYPE_ATTRIBUTE),
      ctx.ifcClassOf?.(id) ?? null,
    );
    if (resolved === null) {
      unresolved.add(id);
      return false;
    }
    return matchValue(cmp, resolved);
  }
  // Any other bare name is a geometry parameter, answerable only by a provider.
  if (geometryParameter(cmp.subject.name) && ctx.readGeometryParameter) {
    const v = ctx.readGeometryParameter(id, cmp.subject.name);
    if (v === null) return false;
    return cmp.value.kind === 'number' && compareNumbers(v, cmp.op, cmp.value.value);
  }
  unsupported.add(`Geometrie-Parameter ${cmp.subject.name}`);
  return false;
}

/** Every descendant of `ids`, or just the direct children. */
function descend(
  ids: readonly number[],
  ctx: QtoContext,
  deep: boolean,
  unsupported: Set<string>,
): number[] {
  if (!ctx.childrenOf) {
    unsupported.add('Tiefensuche über die Bauteilhierarchie (keine Hierarchie übergeben)');
    return [];
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const queue = [...ids];
  let head = 0;
  while (head < queue.length) {
    for (const child of ctx.childrenOf(queue[head++]!)) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      if (deep) queue.push(child);
    }
  }
  return out;
}

/**
 * Walks the `;` chain. Level 0 selects among the elements in scope; every
 * further level selects among the descendants of what the level before it
 * matched. A trailing `;` makes each step search to any depth instead of
 * direct children only — the manual's example counts 10 openings that way and
 * 8 through the Wall-then-Opening chain.
 */
function selectByFilter(filter: BauteilFilter, ctx: QtoContext, unsupported: Set<string>, unresolved: Set<number>): number[] {
  const deep = filter.depthSearch;
  let current: number[] = [...ctx.entityIds];
  if (deep) current = current.concat(descend(current, ctx, true, unsupported));
  for (let i = 0; i < filter.levels.length; i++) {
    if (i > 0) current = descend(current, ctx, deep, unsupported);
    const level = filter.levels[i]!;
    current = current.filter((id) => level.all.every((c) => testComparison(c, id, ctx, unsupported, unresolved)));
  }
  return current;
}

function evalNode(node: QtoExpr, ctx: QtoContext, out: QtoResult, unsupported: Set<string>, unresolved: Set<number>): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'roundk':
      return roundk(evalNode(node.inner, ctx, out, unsupported, unresolved), node.digits);
    case 'product':
      return node.factors.reduce((acc, f) => acc * evalNode(f, ctx, out, unsupported, unresolved), 1);
    case 'qto': {
      if (out.unit === null) out.unit = node.me;
      const measure = node.measure;
      if (measure.kind === 'geometry' && !ctx.readGeometryParameter) {
        unsupported.add(`Geometrie-Parameter ${measure.parameter}`);
        return 0;
      }
      const selected = node.bauteil ? selectByFilter(node.bauteil, ctx, unsupported, unresolved) : ctx.entityIds;
      let total = 0;
      for (const id of selected) {
        if (measure.kind === 'count') {
          out.matchedIds.push(id);
          total += 1;
          continue;
        }
        const v = measure.kind === 'attribute'
          ? attributeNumber(ctx.readAttribute(id, measure.name))
          : ctx.readGeometryParameter!(id, measure.parameter);
        if (v === null) {
          out.skipped.push(id);
          continue;
        }
        out.matchedIds.push(id);
        total += v;
      }
      return total;
    }
  }
}

export function evaluateQtoQuery(expr: QtoExpr, ctx: QtoContext): QtoResult {
  const unsupported = new Set<string>();
  const unresolved = new Set<number>();
  const out: QtoResult = {
    value: null, unit: null, matchedIds: [], skipped: [], unresolved: [], unsupported: [],
  };
  const value = evalNode(expr, ctx, out, unsupported, unresolved);
  out.unsupported = [...unsupported];
  out.unresolved = [...unresolved];
  // A number is only handed back when the WHOLE formula was computable.
  out.value = out.unsupported.length === 0 ? value : null;
  if (out.value === null) {
    out.matchedIds = [];
    out.skipped = [];
  }
  return out;
}
