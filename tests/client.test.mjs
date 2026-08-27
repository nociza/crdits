import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiClient } from "../integrations/client.mjs";

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("remote client reads its token file and bounds wallet calls", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crdits-client-"));
  const tokenFile = path.join(directory, "api-token");
  await writeFile(tokenFile, "client-token\n", { mode: 0o600 });
  const calls = [];
  const client = createApiClient({
    baseUrl: "http://smoldb.example:8788",
    tokenFile,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ recommendation: [] });
    },
  });
  await client.recommend({ category: "dining", merchant: "Cafe", amount: 25 });
  assert.match(calls[0].url, /v1\/recommend\?/);
  assert.match(calls[0].url, /category=dining/);
  assert.equal(calls[0].options.headers.authorization, "Bearer client-token");
});

test("remote client sends private mutations only to the authenticated API", async () => {
  let call;
  const client = createApiClient({
    baseUrl: "https://crdits.example/private/",
    token: "token",
    fetchImpl: async (url, options) => {
      call = { url: String(url), options };
      return response({ amount_usd: 10, benefit_id: "credit" }, 201);
    },
  });
  await client.addUsage({ card: "example", benefit_id: "credit", amount_usd: 10 });
  assert.equal(call.url, "https://crdits.example/private/v1/usage");
  assert.equal(call.options.method, "POST");
  assert.equal(JSON.parse(call.options.body).amount_usd, 10);
});

test("remote client fails closed on API errors", async () => {
  const client = createApiClient({
    baseUrl: "https://crdits.example",
    fetchImpl: async () => response({ error: "unauthorized" }, 401),
  });
  await assert.rejects(client.dashboard(), /unauthorized/);
});
