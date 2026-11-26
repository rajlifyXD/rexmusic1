// Yozora-inspired Proof-of-Origin token bridge for the client-side yt-dlp-wasm engine.
// This endpoint returns only short-lived PO token material, never account cookies.
const tokenCache = new Map();
const requestBuckets = new Map();
const TOKEN_TTL_MS = 90_000;

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowed = (process.env.REX_CORS_ORIGINS || "")
    .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "Content-Type",
  });
  if (allowed.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(request, status, body) {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedClient(client) {
  return client === "mweb" || client === "web";
}

function allowedContext(context) {
  return context === "gvs" || context === "player";
}

function checkRateLimit(request) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const values = (requestBuckets.get(key) || []).filter((time) => now - time < 60_000);
  if (values.length >= 30) return false;
  values.push(now);
  requestBuckets.set(key, values);
  if (requestBuckets.size > 500) requestBuckets.delete(requestBuckets.keys().next().value);
  return true;
}

async function getToken(videoId, client, context) {
  const cacheKey = `${videoId}:${client}:${context}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const provider = (process.env.PO_TOKEN_PROVIDER_URL || "https://poptox.onrender.com").replace(/\/$/, "");
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (process.env.PO_TOKEN_API_KEY) headers["x-api-key"] = process.env.PO_TOKEN_API_KEY;

  const response = await fetch(`${provider}/get_pot`, {
    method: "POST",
    headers,
    body: JSON.stringify({ video_id: videoId, client, context }),
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Token provider HTTP ${response.status}`);
  const data = await response.json();
  if (typeof data.po_token !== "string" || !data.po_token.trim()) {
    throw new Error("Token provider returned no PO token");
  }

  const value = {
    po_token: data.po_token,
    visitor_data: typeof data.visitor_data === "string" ? data.visitor_data : null,
  };
  tokenCache.set(cacheKey, { value, expiresAt: Date.now() + TOKEN_TTL_MS });
  if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value);
  return value;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== "GET") {
      const response = json(request, 405, { error: "Method not allowed" });
      response.headers.set("Allow", "GET, OPTIONS");
      return response;
    }

    const url = new URL(request.url);
    const videoId = url.searchParams.get("video_id") || "";
    const client = url.searchParams.get("client") || "mweb";
    const context = url.searchParams.get("context") || "gvs";

    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return json(request, 400, { error: "Invalid video id" });
    if (!allowedClient(client) || !allowedContext(context)) return json(request, 400, { error: "Unsupported token context" });
    if (!checkRateLimit(request)) return json(request, 429, { error: "Too many token requests" });

    const origin = request.headers.get("origin") || "";
    const allowed = (process.env.REX_CORS_ORIGINS || "")
      .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
    if (origin && !allowed.includes(origin)) return json(request, 403, { error: "Origin not allowed" });

    try {
      return json(request, 200, await getToken(videoId, client, context));
    } catch (error) {
      // Do not expose provider responses, token material, or upstream diagnostics.
      console.warn("[REX PO Token] provider unavailable:", String(error?.message || "unknown").slice(0, 120));
      return json(request, 503, { error: "Proof-of-Origin token provider is temporarily unavailable" });
    }
  },
};
