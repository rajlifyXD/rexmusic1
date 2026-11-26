import { Readable } from "node:stream";
import { Innertube, Platform } from "youtubei.js/web";

// youtubei.js requires an interpreter for YouTube's player transforms.
// This executes only the player script returned by YouTube.js itself.
Platform.shim.eval = async (data) => new Function(data.output)();

let innertubePromise;
const infoCache = new Map();
const INFO_TTL_MS = 4 * 60 * 1000;

function getClient() {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({
      lang: "en",
      location: "IN",
      enable_session_cache: true,
    }).catch((error) => {
      innertubePromise = undefined;
      throw error;
    });
  }
  return innertubePromise;
}

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
  const client = await getClient();
  const info = await client.getBasicInfo(id);
  if (infoCache.size > 80) infoCache.delete(infoCache.keys().next().value);
  infoCache.set(id, { at: Date.now(), info });
  return info;
}

function formatDiagnostics(info) {
  const streamingData = info?.streaming_data;
  const formats = Array.isArray(streamingData?.adaptive_formats)
    ? streamingData.adaptive_formats
    : [];
  const regularFormats = Array.isArray(streamingData?.formats)
    ? streamingData.formats
    : [];
  const count = (predicate) => formats.filter(predicate).length;
  const mimeTypes = [...new Set(formats
    .map((format) => String(format.mime_type || "").split(";")[0])
    .filter((value) => /^[\w.+-]+\/[\w.+-]+$/.test(value)))].slice(0, 8);

  return {
    streamingDataPresent: Boolean(streamingData),
    adaptiveFormatCount: formats.length,
    regularFormatCount: regularFormats.length,
    formatsWithAudioFlag: count((format) => format.has_audio === true),
    formatsWithVideoFlag: count((format) => format.has_video === true),
    formatsMarkedAudioOnly: count((format) => format.has_audio === true && format.has_video === false),
    formatsMarkedOtf: count((format) => format.is_type_otf === true),
    formatsMarkedDrm: count((format) => Array.isArray(format.drm_families) && format.drm_families.length > 0),
    mimeTypes,
  };
}

function selectAudioFormat(info, profile) {
  const allFormats = info.streaming_data?.adaptive_formats || [];
  const formats = allFormats.filter((format) =>
    format.has_audio && !format.has_video && !format.is_type_otf &&
    !(format.drm_families?.length)
  );
  if (!formats.length) {
    const error = new Error("YouTube returned no compatible audio-only formats.");
    error.statusCode = 502;
    error.diagnostics = formatDiagnostics(info);
    throw error;
  }

  const bitrate = (format) => Number(format.average_bitrate || format.bitrate || 0) / 1000;
  const sorted = [...formats].sort((a, b) => bitrate(a) - bitrate(b));
  if (profile === "data-saver") return sorted.find((format) => bitrate(format) > 0 && bitrate(format) <= 96) || sorted[0];
  if (profile === "balanced") return sorted.find((format) => bitrate(format) > 0 && bitrate(format) <= 160) || sorted[Math.floor((sorted.length - 1) / 2)];
  return sorted[sorted.length - 1];
}

function safeMessage(error) {
  return String(error?.message || error || "YouTube playback request failed")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url redacted]")
    .replace(/(cookie|authorization|token|signature|sig)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 800);
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
    const id = url.searchParams.get("id") || "";
    if (!validId(id)) return json(request, 400, { error: "Invalid video id" });

    const profile = url.searchParams.get("quality") || "balanced";
    if (!["data-saver", "balanced", "high"].includes(profile)) {
      return json(request, 400, { error: "Unsupported quality profile" });
    }

    try {
      const info = await getInfo(id);
      const format = selectAudioFormat(info, profile);
      const size = Number(format.content_length || 0) || null;
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

      const client = await getClient();
      const webStream = await info.download({
        itag: format.itag,
        ...(range ? { range } : {}),
      });
      const body = Readable.toWeb(Readable.fromWeb(webStream));
      const headers = corsHeaders(request);
      headers.set("Content-Type", format.mime_type || "audio/webm");
      headers.set("X-REX-Playback-Engine", "youtubei-js-18");
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

      request.signal.addEventListener("abort", () => body.cancel().catch(() => {}), { once: true });
      return new Response(body, { status, headers });
    } catch (error) {
      const diagnostic = {
        code: error?.code || "YOUTUBEI_REQUEST_FAILED",
        name: String(error?.name || "Error").slice(0, 100),
        message: safeMessage(error),
        ...(error?.diagnostics ? { formatDiagnostics: error.diagnostics } : {}),
      };
      console.error("[REX YOUTUBEI] stream preparation failed", JSON.stringify(diagnostic));
      return json(request, Number(error?.statusCode) || 502, diagnostic);
    }
  },
};
