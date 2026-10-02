import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const source = await readFile(new URL('../app/ui/FreeNightAwards.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace('import "./free-night-awards.css";', ''), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
const { FreeNightAwards } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const benefit = { id: 'example', title: 'Example free night', catalog_value_usd: 240, valuation_source_url: 'https://example.test/value',
  certificate_policy: { expires: true, expiry_months: 12, rule: 'Stay before expiry', source_url: 'https://example.test/terms', stay_deadline: 'checkout_before' }, awards: [] };
const render = data => renderToStaticMarkup(createElement(FreeNightAwards, { benefit: data, asOf: '2026-10-02', onSave: async () => {} }));
const award = { id: 1, label: 'Annual free night', issued_on: '2026-01-01', expires_on: '2027-01-01', used_on: null, value_usd: 240, revision: 1, status: 'available', days_remaining: 91 };

test('free-night panel shows source, actual-expiry policy, and no invented balance for unrecorded awards', () => {
  const html = render(benefit);
  assert.match(html, /\$240 estimated \/ night/);
  assert.match(html, /counts only when used/);
  assert.match(html, /No awards recorded/);
  assert.match(html, /Add award/);
  assert.doesNotMatch(html, /Use free night<\/button>/);
  assert.match(html, /https:\/\/example.test\/value/);
});

test('only available awards offer use; used and expired records retain correction controls', () => {
  const html = render({ ...benefit, awards: [award, { ...award, id: 2, label: 'Previous', status: 'used', used_on: '2026-08-09' }, { ...award, id: 3, label: 'Expired', status: 'expired', expires_on: '2026-03-04' }] });
  assert.equal((html.match(/Use free night<\/button>/g) || []).length, 1);
  assert.match(html, /91 days left/);
  assert.match(html, /Used 2026-08-09/);
  assert.match(html, /Expired 2026-03-04 · \$0 counted/);
  assert.match(html, /Used &amp; expired awards \(2\)/);
  assert.match(html, /Edit \/ log past stay/);
});

test('award text is escaped and user overrides are not falsely called sourced estimates', () => {
  const html = render({ ...benefit, awards: [{ ...award, label: '<img src=x onerror=alert(1)>', value_usd: 150, value_basis: 'user_override' }] });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /\$150 recorded/);
  assert.match(source, /showModal\(\)/);
  assert.match(source, /expected_revision: award.revision/);
  assert.match(source, /crypto.randomUUID\(\)/);
  assert.match(source, /role="alert"/);
});

test('a tentative bookkeeping year remains explicit and missing expiry never looks like non-expiring value', () => {
  const html = render({ ...benefit, awards: [{ ...award, used_on: null, used_year: 2025, used_year_confidence: 'estimated', status: 'used' }, { ...award, id: 2, expires_on: null, status: 'unknown_expiry' }] });
  assert.match(html, /Used in 2025 \(year estimated; date unknown\)/);
  assert.match(html, /Expiry date needed · \$0 counted/);
  assert.doesNotMatch(html, /No expiration · counted/);
  assert.equal((html.match(/Use free night<\/button>/g) || []).length, 0);
});
