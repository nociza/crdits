import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const source = await readFile(new URL('../app/ui/EntryPerks.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace('import "./entry-perks.css";', ''), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
const { EntryPerks } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const styles = await readFile(new URL('../app/ui/entry-perks.css', import.meta.url), 'utf8');

test('per-card entry disclosure starts closed, keeps controls intact and omits empty sections', () => {
  const html = renderToStaticMarkup(createElement(EntryPerks, {count: 2}, createElement('button', null, 'Edit usage')));
  assert.match(html, /<details class="entry-perks">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /Show entry perks \(2\)/);
  assert.match(html, /Hide entry perks \(2\)/);
  assert.match(html, /Edit usage/);
  assert.match(styles, /\.entry-perks\[open\]/);
  assert.match(styles, /focus-visible/);
  assert.equal(renderToStaticMarkup(createElement(EntryPerks, {count: 0}, 'empty')), '');
});
