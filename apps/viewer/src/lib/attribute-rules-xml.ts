/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Import RIBiTWO mapping files — the `<transform><mapping><map>` format its
 * attribute rules are saved and exchanged in:
 *
 *   <map source="Project">
 *     <in  property="5D_Typ" datatype="xs:string" value="*IST*" />
 *     <out property="5D_Bauteilname" datatype="xs:string" value="Innenstützen" mode="Add" />
 *   </map>
 *
 * Shape of the dialect, as it appears in real files:
 *  - `<in>`  — a condition. Several `<in>` in one `<map>` are ANDed; the value
 *    is the shared query language (`*`, `||`), or `<Not Existing>` for absence.
 *  - `<out property="P" value="V">` — write the literal V into P.
 *  - `<out property="P" name="N">`  — COPY: take P's value into a new
 *    attribute N. `property` is the source here, `name` the target.
 *  - `<out property="P" mode="Remove">` — delete P (the name may be a wildcard).
 *  - `property="Pset\Prop"` addresses one property set; a bare name is
 *    resolved across sets.
 *  - `mode` is Add | Overwrite | Remove. A `<map>` that emits the SAME write
 *    twice, once Overwrite and once Add, means "always" — those collapse into
 *    one `addOverwrite` rule instead of two rules fighting each other.
 *
 * Parsing is done by hand rather than through `DOMParser` so the importer can
 * be unit-tested in node, and so a malformed file yields skipped entries with
 * reasons rather than an exception.
 */

import {
  NOT_EXISTING,
  type AttributeRule, type PropRef, type RuleAction, type RuleMatch, type WriteMode,
} from './attribute-rules.js';

export interface ImportResult {
  rules: AttributeRule[];
  /** Human-readable reasons for `<out>` entries that could not be mapped. */
  skipped: string[];
  /** `<mapping name="…">`, when the file names itself. */
  name?: string;
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'",
};

function decode(s: string): string {
  return s
    .replace(/&(?:lt|gt|amp|quot|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

/** Attributes of one self-closing tag, decoded. */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

/** `Pset\Prop` -> both parts; a bare name keeps an empty set, meaning
 *  "whichever set carries it" for reads and the default set for writes. */
export function splitPropertyPath(path: string): { setName: string; propName: string } {
  const i = path.indexOf('\\');
  return i >= 0
    ? { setName: path.slice(0, i), propName: path.slice(i + 1) }
    : { setName: '', propName: path };
}

function toMode(raw: string | undefined): WriteMode | 'remove' {
  switch ((raw ?? 'Add').toLowerCase()) {
    case 'remove': return 'remove';
    case 'overwrite': return 'overwrite';
    default: return 'add';
  }
}

/** A single `<out>` turned into an action, or null with a reason. */
function toAction(
  out: Record<string, string>,
  defaultPset: string,
): { action: RuleAction; mode: WriteMode | 'remove'; signature: string } | { error: string } {
  const property = out.property?.trim();
  if (!property) return { error: '<out> without a property' };
  const mode = toMode(out.mode);

  if (mode === 'remove') {
    const ref = splitPropertyPath(property);
    return {
      action: { kind: 'delete', targets: [{ psetName: ref.setName || defaultPset, propName: ref.propName }] },
      mode,
      signature: `delete:${property}`,
    };
  }

  const writeMode: WriteMode = mode;

  // `name` present -> copy the SOURCE property into that new attribute.
  if (out.name) {
    const source = splitPropertyPath(property);
    const target = splitPropertyPath(out.name);
    return {
      action: {
        kind: 'copy',
        source: { psetName: source.setName, propName: source.propName },
        target: { psetName: target.setName || defaultPset, propName: target.propName },
        mode: writeMode,
      },
      mode,
      signature: `copy:${property}->${out.name}`,
    };
  }

  if (out.value !== undefined) {
    const target = splitPropertyPath(property);
    return {
      action: {
        kind: 'add',
        target: { psetName: target.setName || defaultPset, propName: target.propName },
        value: out.value,
        dataType: 'text',
        unit: '',
        mode: writeMode,
      },
      mode,
      signature: `set:${property}=${out.value}`,
    };
  }

  return { error: `<out property="${property}"> has neither a value nor a name` };
}

/**
 * Parse a mapping file into rules, in document order — the order matters,
 * because later maps read attributes that earlier ones create.
 *
 * `defaultPset` is where an attribute with no `Pset\` prefix is written; reads
 * still search every set, matching how the source format treats bare names.
 */
export function importMappingXml(xml: string, defaultPset = 'Pset_ModViz'): ImportResult {
  const rules: AttributeRule[] = [];
  const skipped: string[] = [];
  const name = /<mapping\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1];

  const maps = xml.matchAll(/<map\b([^>]*)>([\s\S]*?)<\/map>/g);
  let index = 0;
  for (const m of maps) {
    const body = m[2];
    index += 1;

    const match: RuleMatch[] = [];
    for (const tag of body.matchAll(/<in\b[^>]*\/?>/g)) {
      const a = attrsOf(tag[0]);
      const property = a.property?.trim();
      if (!property) continue;
      // `value="*"` on the id column is RIBiTWO's "every object" — it selects
      // nothing in particular, so it would only cost a scan.
      if (property.toLowerCase() === 'cpiid' && (a.value ?? '*').trim() === '*') continue;
      match.push({ attribute: property, value: (a.value ?? '*').trim() || '*' });
    }

    // Collapse an Overwrite+Add pair of the same write into "always".
    const parsed: Array<{ action: RuleAction; mode: WriteMode | 'remove'; signature: string }> = [];
    for (const tag of body.matchAll(/<out\b[^>]*\/?>/g)) {
      const result = toAction(attrsOf(tag[0]), defaultPset);
      if ('error' in result) { skipped.push(`map ${index}: ${result.error}`); continue; }
      const twin = parsed.find((p) => p.signature === result.signature && p.mode !== result.mode
        && p.mode !== 'remove' && result.mode !== 'remove');
      if (twin) {
        if ('mode' in twin.action) twin.action.mode = 'addOverwrite';
        twin.mode = 'addOverwrite';
        continue;
      }
      parsed.push(result);
    }

    for (const [i, p] of parsed.entries()) {
      rules.push({
        id: `xml-${index}-${i}`,
        conditions: match.map((c) => ({ label: c.attribute, value: c.value })),
        match,
        entityIds: [],
        action: p.action,
        enabled: true,
      });
    }
  }

  return { rules, skipped, name };
}
