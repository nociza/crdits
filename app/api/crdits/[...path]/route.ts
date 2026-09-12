const apiBase = process.env.CRDITS_API_URL ?? "http://127.0.0.1:8788";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: Request, context: RouteContext) {
  if (!["GET", "POST", "PATCH"].includes(request.method)) return Response.json({ error: "method not allowed" }, { status: 405 });
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) return Response.json({ error: "cross-site mutation refused" }, { status: 403 });
  }
  const params = await context.params;
  const incoming = new URL(request.url);
  const target = new URL(`/${(params.path ?? []).join("/")}${incoming.search}`, apiBase);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const token = process.env.CRDITS_API_TOKEN;
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const outgoing = new Headers(response.headers);
  outgoing.set("cache-control", "private, no-store, max-age=0");
  return new Response(response.body, { status: response.status, headers: outgoing });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
