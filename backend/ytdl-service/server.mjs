import { createServer } from "node:http";
import { Ytdl } from "@distube/ytdl-core";
import { pipeline } from "node:stream";

const HOST = "127.0.0.1";
const PORT = Number(process.env.REX_YTDL_PORT || 4181);

function ytdlFetch(input, init) {
  let url;
  try {
    url = new URL(input instanceof Request ? input.url : input);
  } catch {
    return fetch(input, init);
  }

  // Match the November 2026 player workaround used by the Vercel function.
  // Rewrite only the known player JS path, never signed media URLs.
  const prefix = "/s/player/";
  const suffix = "/player_ias.vflset/en_US/base.js";
  const playerId = url.pathname.startsWith(prefix) && url.pathname.endsWith(suffix)
    ? url.pathname.slice(prefix.length, -suffix.length)
    : "";
  if (url.hostname !== "www.youtube.com" || !/^[a-f0-9]{8}$/i.test(playerId)) {
    return fetch(input, init);
  }

  url.pathname = `/s/player/${playerId}/tv-player-ias.vflset/tv-player-ias.js`;
  const rewrittenInput = input instanceof Request ? new Request(url, input) : url;
  return fetch(rewrittenInput, init);
}

const yt = new Ytdl({
  ...(process.env.YT_COOKIE ? { cookie: process.env.YT_COOKIE } : {}),
  fetch: ytdlFetch,
  lang: "en",
  country: "IN",
  timeoutMs: 35_000,
});
const infoCache = new Map();
const INFO_TTL_MS = 4 * 60 * 1000;

function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(data.length),
    "Cache-Control": "no-store",
  });
  res.end(data);
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

// Never return cookies, signed URLs, tokens, or arbitrary library error fields.
function safeMessage(value) {
  return String(value || "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url redacted]")
    .replace(/(cookie|authorization|token|signature|sig|n)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

function safeError(error) {
  const result = {
    name: safeMessage(error?.name || "Error"),
    message: safeMessage(error?.message || "ytdl-core request failed"),
  };
  if (typeof error?.code === "string" || typeof error?.code === "number") result.code = String(error.code).slice(0, 100);
  if (typeof error?.statusCode === "number") result.statusCode = error.statusCode;
  return result;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === "/health" && req.method === "GET") {
    return json(res, 200, { ok: true, service: "REX ytdl-core sidecar" });
  }
  if (url.pathname === "/health" && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed" });
  }

  const streamMatch = url.pathname.match(/^\/stream\/([^/]+)$/);
  if (!streamMatch || req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 404, { error: "Not found" });
  }

  const id = streamMatch[1];
  if (!validId(id)) return json(res, 400, { error: "Invalid video id" });
  const profile = url.searchParams.get("quality") || "balanced";
  if (!["data-saver", "balanced", "high"].includes(profile)) {
    return json(res, 400, { error: "Unsupported quality profile" });
  }

  const info = await getInfo(id);
  const format = selectAudioFormat(info, profile);
  const size = Number(format.contentLength || 0) || null;
  const rangeHeader = req.headers.range;
  let range;

  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) return json(res, 416, { error: "Only a single byte range is supported." });
    if (size) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start >= size || end < start) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        return res.end();
      }
      range = { start, end };
    }
  }

  const headers = {
    "Content-Type": format.mimeType || "audio/webm",
    "Cache-Control": "no-store",
    "X-REX-Playback-Engine": "distube-ytdl-core-v5-oci",
    "X-REX-YTDL-Format": String(format.itag),
  };
  if (range && size) {
    headers["Accept-Ranges"] = "bytes";
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
    res.writeHead(206, headers);
  } else {
    headers["Accept-Ranges"] = size ? "bytes" : "none";
    if (size) headers["Content-Length"] = String(size);
    res.writeHead(200, headers);
  }

  const stream = yt.download(info, {
    format,
    ...(range ? { range } : {}),
    highWaterMark: 1024 * 1024,
  });
  res.on("close", () => {
    if (!res.writableEnded) stream.destroy();
  });
  pipeline(stream, res, (error) => {
    if (error && !res.destroyed) res.destroy(error);
  });
}

const server = createServer((req, res) => {
  Promise.resolve(handle(req, res)).catch((error) => {
    const diagnostic = safeError(error);
    console.error("[REX YTDL] request failed", JSON.stringify(diagnostic));
    if (!res.headersSent) json(res, Number(error?.statusCode) || 502, {
      error: diagnostic.code || "YTDL_REQUEST_FAILED",
      message: diagnostic.message,
    });
    else if (!res.destroyed) res.destroy(error);
  });
});

server.listen(PORT, HOST);
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
