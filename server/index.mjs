import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createService } from "./service.mjs";

const host = process.env.CRDITS_HOST || "127.0.0.1";
const port = Number(process.env.CRDITS_PORT || 8788);
async function loadApiToken() {
  const tokenFile = process.env.CRDITS_API_TOKEN_FILE?.trim();
  if (tokenFile) {
    const value = (await readFile(tokenFile, "utf8")).trim();
    if (!value || value.length > 4096) throw new Error("invalid CRDITS_API_TOKEN_FILE");
    return value;
  }
  return process.env.CRDITS_API_TOKEN?.trim() || null;
}

const token = await loadApiToken();
const service = createService();

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store, max-age=0",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorized(request, pathname) {
  if (!token || pathname === "/health") return true;
  return request.headers.authorization === `Bearer ${token}`;
}

function pathMatch(pathname, pattern) {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    if (patternParts[index].startsWith(":")) params[patternParts[index].slice(1)] = decodeURIComponent(pathParts[index]);
    else if (patternParts[index] !== pathParts[index]) return null;
  }
  return params;
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (!authorized(request, url.pathname)) return json(response, 401, { error: "unauthorized" });

  if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, service: "crdits" });
  if (request.method === "GET" && url.pathname === "/v1/dashboard") return json(response, 200, await service.dashboard({ year: url.searchParams.get("year") ?? undefined }));
  if (request.method === "GET" && url.pathname === "/v1/reminders") return json(response, 200, await service.reminders(url.searchParams.get("days") || 30));
  if (request.method === "GET" && url.pathname === "/v1/recommend") {
    return json(response, 200, await service.recommend({
      category: url.searchParams.get("category") || "",
      merchant: url.searchParams.get("merchant") || "",
      amount: url.searchParams.get("amount") || 100,
      context: JSON.parse(url.searchParams.get("context") || "{}"),
    }));
  }
  if (request.method === "GET" && url.pathname === "/v1/monitor") {
    const dashboard = await service.dashboard();
    return json(response, 200, {
      ok: true,
      as_of: dashboard.as_of,
      active_cards: dashboard.cards.length,
      reminders_due: dashboard.reminders.length,
      urgent_reminders: dashboard.reminders.filter((item) => item.severity === "urgent").length,
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/wallet/cards") return json(response, 201, await service.addWalletCard(await body(request)));
  const walletCardParams = pathMatch(url.pathname, "/v1/wallet/cards/:id");
  if (request.method === "PATCH" && walletCardParams) return json(response, 200, service.updateWalletCard(walletCardParams.id, await body(request)));
  if (request.method === "POST" && url.pathname === "/v1/usage") return json(response, 201, await service.addUsage(await body(request)));
  if (request.method === "POST" && url.pathname === "/v1/usage/period") return json(response, 200, await service.addUsage(await body(request), { replace: true }));
  if (request.method === "GET" && url.pathname === "/v1/usage/history") return json(response, 200, service.usageHistory(url.searchParams.get("card"), url.searchParams.get("benefit")));
  if (request.method === "POST" && url.pathname === "/v1/usage/evidence") return json(response, 200, await service.setPeriodEvidence(await body(request)));
  if (request.method === "POST" && url.pathname === "/v1/benefit-status") return json(response, 200, await service.setBenefitStatus(await body(request)));
  if (request.method === "POST" && url.pathname === "/v1/preferences") return json(response, 200, await service.setPreference(await body(request)));
  if (request.method === "POST" && url.pathname === "/v1/offers") return json(response, 201, service.addOffer(await body(request)));
  const offerParams = pathMatch(url.pathname, "/v1/offers/:id");
  if (request.method === "PATCH" && offerParams) return json(response, 200, service.updateOffer(offerParams.id, await body(request)));

  const benefitParams = pathMatch(url.pathname, "/v1/catalog/cards/:slug/benefits");
  if (request.method === "POST" && benefitParams) return json(response, 200, await service.upsertBenefit(benefitParams.slug, await body(request)));
  const rewardParams = pathMatch(url.pathname, "/v1/catalog/cards/:slug/rewards");
  if (request.method === "POST" && rewardParams) return json(response, 200, await service.upsertRewardRule(rewardParams.slug, await body(request)));
  const cardParams = pathMatch(url.pathname, "/v1/catalog/cards/:slug");
  if (request.method === "GET" && cardParams) return json(response, 200, await service.catalogCard(cardParams.slug));
  if (request.method === "PATCH" && cardParams) return json(response, 200, await service.patchCardFacts(cardParams.slug, await body(request)));

  return json(response, 404, { error: "not found" });
}

const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(error);
    json(response, error.code === "SQLITE_CONSTRAINT" ? 409 : 400, { error: error.message || "request failed" });
  });
});

server.listen(port, host, () => {
  console.log(`crdits api listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    service.db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
