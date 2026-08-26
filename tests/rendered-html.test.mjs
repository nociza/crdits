import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(workerUrl.href);
  const request = new Request("http://localhost/", { headers: { accept: "text/html" } });
  if (typeof handler === "function") return handler(request);
  return handler.fetch(
    request,
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the crdits application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>crdits — card value ledger<\/title>/i);
  assert.match(html, /Your card value/);
  assert.match(html, /minus the wishful thinking/);
  assert.match(html, /Public rules in Git/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps private data out of the server-rendered shell", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(page, /CrditsDashboard/);
  assert.match(layout, /index:\s*false/);
  assert.doesNotMatch(page, /last_four|merchant|benefit_usage/);
});
