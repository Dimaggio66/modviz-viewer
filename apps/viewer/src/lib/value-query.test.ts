/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The value-query language is shared by the object filter's value cells and by
 * attribute-rule conditions, so a mistake here moves quantities in both. The
 * wildcard set is RIB's: "Die Verwendung von Wildcards ist zulässig ('*' and
 * '?')" — BIM Qualifier 6.8.1.10.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { compileQuery, compileValueMatch, isQueryExpr, termToRegExp } from './value-query.js';

describe('Wildcards', () => {
  it('behandelt * als beliebig viele Zeichen', () => {
    assert.equal(termToRegExp('*Rohr*').test('Abwasserrohr DN100'), true);
    assert.equal(termToRegExp('AW*').test('AW Rohrstutzen'), true);
    assert.equal(termToRegExp('AW*').test('Bogen AW'), false, 'A* ist starts-with');
  });

  it('behandelt ? als GENAU EIN Zeichen', () => {
    const re = termToRegExp('DN1?0');
    assert.equal(re.test('DN100'), true);
    assert.equal(re.test('DN150'), true);
    assert.equal(re.test('DN1000'), false, '? ist nicht *');
    assert.equal(re.test('DN10'), false);
  });

  it('erkennt ? als Abfrage, nicht als Literal', () => {
    // Vorher stand ? in der Escape-Klasse: die Bedingung traf still nichts.
    assert.equal(isQueryExpr('DN1?0'), true);
    assert.equal(compileValueMatch('DN1?0')('DN150'), true);
  });

  it('lässt einen bloßen Text weiterhin exakt vergleichen', () => {
    assert.equal(isQueryExpr('Bogen'), false);
    assert.equal(compileValueMatch('Bogen')('Bogen'), true);
    assert.equal(compileValueMatch('Bogen')('2er Bogen'), false);
  });

  it('schützt Regex-Sonderzeichen, die keine Wildcards sind', () => {
    assert.equal(termToRegExp('L80*8').test('L80x8'), true, '* bleibt Wildcard');
    assert.equal(termToRegExp('a.b').test('a.b'), true);
    assert.equal(termToRegExp('a.b').test('axb'), false, 'der Punkt bleibt ein Punkt');
    assert.equal(termToRegExp('4,50 (m)').test('4,50 (m)'), true, 'Klammern sind Text');
  });
});

describe('Operatoren', () => {
  it('verknüpft mit && und || wie RIB', () => {
    const q = compileQuery('*Rohr* & *DN100* || *DN150*');
    assert.equal(q('Rohr DN100'), true);
    assert.equal(q('Bogen DN150'), true, 'der ODER-Zweig steht für sich');
    assert.equal(q('Rohr DN200'), false);
  });

  it('mischt Wildcards und ODER, wie die Attributregel-Tabelle es zulässt', () => {
    const q = compileValueMatch('DN1?0 || DN2?0');
    assert.equal(q('DN150'), true);
    assert.equal(q('DN250'), true);
    assert.equal(q('DN350'), false);
  });

  it('vergleicht ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    assert.equal(compileValueMatch('*rohr*')('ABWASSERROHR'), true);
  });
});
