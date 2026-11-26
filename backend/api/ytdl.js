import { Readable } from "node:stream";
import { Ytdl } from "@distube/ytdl-core";

const yt = new Ytdl({
  ...(process.env.YT_COOKIE ? { cookie: process.env.YT_COOKIE } : {}),
  lang: "en",
  country: "IN",
  timeoutMs: 35_000,
});
const infoCache = new Map();
const INFO_TTL_MS = 4 * 60 * 1000;

function allowedOrigin(request) {
  const origin = request.headers.get("origin") || "";
  const allowed = (process.env.REX_CORS_ORIGINS || "")
    .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

function corsHeaders(request) {
  const origin = allowedOrigin(request);
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, If-Range, Authorization, Content-Type",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified, X-REX-Playback-Engine, X-REX-YTDL-Format",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(request, status, body) {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{6,32}$/.test(id);
}

async function getInfo(id) {
  const cached = infoCache.get(id);
  if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.info;
  const info = await yt.getInfo(id);
  if (infoCache.size > 80) infoCache.delete(infoCache.keys().next().value);
  infoCache.set(id, { at: Date.now(), info });
  return info;
}

function selectAudioFormat(info, profile) {
  const formats = (info.formats || []).filter((format) =>
    format.hasAudio && !format.hasVideo && Boolean(format.url) && !format.isDrm && !format.isOtf
  );
  if (!formats.length) {
    const error = new Error("No downloadable audio-only formats were returned.");
    error.statusCode = 502;
    throw error;
  }
  const rate = (format) => Number(format.audioBitrate || format.bitrate || 0);
  const sorted = [...formats].sort((a, b) => rate(a) - rate(b));
  if (profile === "data-saver") return sorted.find((format) => rate(format) > 0 && rate(format) <= 96) || sorted[0];
  if (profile === "balanced") return sorted.find((format) => rate(format) > 0 && rate(format) <= 160) || sorted[Math.floor((sorted.length - 1) / 2)];
  return sorted[sorted.length - 1];
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      const response = json(request, 405, { error: "Method not allowed" });
      response.headers.set("Allow", "GET, OPTIONS");
      return response;
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id") || "";
    if (!validId(id)) return json(request, 400, { error: "Invalid video id" });

    const profile = url.searchParams.get("quality") || "balanced";
    if (!["data-saver", "balanced", "high"].includes(profile)) {
      return json(request, 400, { error: "Unsupported quality profile" });
    }

    try {
      const info = await getInfo(id);
      const format = selectAudioFormat(info, profile);
      const size = Number(format.contentLength || 0) || null;
      const rangeHeader = request.headers.get("range");
      let range;

      if (rangeHeader) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
        if (!match) return json(request, 416, { error: "Only a single byte range is supported." });
        if (size) {
          const start = Number(match[1]);
          const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          if (start >= size || end < start) {
            const headers = corsHeaders(request);
            headers.set("Content-Range", `bytes */${size}`);
            return new Response(null, { status: 416, headers });
          }
          range = { start, end };
        }
      }

      const headers = corsHeaders(request);
      headers.set("Content-Type", format.mimeType || "audio/webm");
      headers.set("X-REX-Playback-Engine", "distube-ytdl-core-v5-vercel");
      headers.set("X-REX-YTDL-Format", String(format.itag));

      let status = 200;
      if (range && size) {
        status = 206;
        headers.set("Accept-Ranges", "bytes");
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
        headers.set("Content-Length", String(range.end - range.start + 1));
      } else if (size) {
        headers.set("Accept-Ranges", "bytes");
        headers.set("Content-Length", String(size));
      } else {
        headers.set("Accept-Ranges", "none");
      }

      const stream = yt.download(info, {
        format,
        ...(range ? { range } : {}),
        highWaterMark: 1024 * 1024,
      });
      const body = Readable.toWeb(stream);
      request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
      return new Response(body, { status, headers });
    } catch (error) {
      // Preserve the solver's attempt ladder so Vercel logs expose the failing
      // player/client step rather than only PLAYER_SOLVE_FAILED.
      const attempts = Array.isArray(error?.attempts)
        ? error.attempts.map((attempt) => ({
            client: String(attempt?.client || ""),
            signedIn: Boolean(attempt?.signedIn),
            step: String(attempt?.step || ""),
            code: String(attempt?.code || ""),
            reason: String(attempt?.reason || "").slice(0, 1200),
            cause: String(attempt?.cause?.message || attempt?.cause || "").slice(0, 1200),
          }))
        : [];

      const diagnostic = {
        code: error?.code || "YTDL_REQUEST_FAILED",
        message: error?.message || "ytdl-core request failed",
        attempts,
        cause: String(error?.cause?.message || error?.cause || "").slice(0, 1600),
      };
      console.error("[REX YTDL] stream preparation failed", JSON.stringify(diagnostic));

      return json(request, Number(error?.statusCode) || 502, diagnostic);
    }
  },
};
