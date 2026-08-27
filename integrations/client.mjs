import { readFile } from "node:fs/promises";

const MAX_RESPONSE_BYTES = 1024 * 1024;

async function loadToken(token, tokenFile) {
  if (token) return token;
  if (!tokenFile) return null;
  const value = (await readFile(tokenFile, "utf8")).trim();
  if (!value || value.length > 4096) throw new Error("invalid CRDITS_API_TOKEN_FILE");
  return value;
}

async function readJsonBounded(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("crdits API response too large");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error("crdits API response too large");
  return JSON.parse(new TextDecoder().decode(buffer));
}

export function createApiClient({
  baseUrl = process.env.CRDITS_API_URL,
  token = process.env.CRDITS_API_TOKEN || null,
  tokenFile = process.env.CRDITS_API_TOKEN_FILE || null,
  fetchImpl = fetch,
} = {}) {
  if (!baseUrl) throw new Error("CRDITS_API_URL is required for remote wallet access");
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (!new Set(["http:", "https:"]).has(base.protocol)) throw new Error("CRDITS_API_URL must use http or https");

  async function request(pathname, { method = "GET", body } = {}) {
    const resolvedToken = await loadToken(token, tokenFile);
    const headers = { accept: "application/json" };
    if (resolvedToken) headers.authorization = `Bearer ${resolvedToken}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchImpl(new URL(pathname.replace(/^\//, ""), base), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await readJsonBounded(response);
    if (!response.ok) throw new Error(value?.error || `crdits API returned ${response.status}`);
    return value;
  }

  return {
    dashboard: () => request("v1/dashboard"),
    reminders: (days = 30) => request(`v1/reminders?days=${encodeURIComponent(days)}`),
    recommend: ({ category, merchant, amount }) => {
      const query = new URLSearchParams({ category: category || "", merchant: merchant || "", amount: String(amount || 100) });
      return request(`v1/recommend?${query}`);
    },
    addUsage: (input) => request("v1/usage", { method: "POST", body: input }),
    setBenefitStatus: (input) => request("v1/benefit-status", { method: "POST", body: input }),
    addOffer: (input) => request("v1/offers", { method: "POST", body: input }),
    addWalletCard: (input) => request("v1/wallet/cards", { method: "POST", body: input }),
    updateWalletCard: (identifier, input) => request(`v1/wallet/cards/${encodeURIComponent(identifier)}`, { method: "PATCH", body: input }),
    async walletCards() {
      const dashboard = await request("v1/dashboard");
      return dashboard.cards;
    },
  };
}
