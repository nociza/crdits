import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {creditViewUrl} from '../app/ui/credit-state.ts';

const source=await readFile(new URL('../app/ui/ReportingPeriodSelect.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText
  .replace(/from ["'](react(?:\/jsx-runtime)?)["']/g,(_,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`);
const {ReportingPeriodSelect}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('renewal periods are the default view, calendar years are explicit history, and links preserve the choice',async()=>{
  const html=renderToStaticMarkup(createElement(ReportingPeriodSelect,{value:'rolling',onChange:()=>{},className:'test'}));
  assert.match(html,/value="rolling" selected="">This rolling period/);
  assert.match(html,/Calendar \d{4} · bookkeeping/);
  assert.match(html,/aria-label="Reporting period"/);
  assert.equal(creditViewUrl('wallet','rolling',6),'?tab=wallet&year=rolling&card=6');
  const dashboard=await readFile(new URL('../app/ui/CrditsDashboard.tsx',import.meta.url),'utf8');
  assert.match(dashboard,/Available now/);
  assert.match(dashboard,/upcoming within these periods/);
  assert.match(dashboard,/reporting_period\.start/);
});
