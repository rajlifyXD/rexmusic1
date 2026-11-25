import { createServer } from "node:http";
import { Ytdl } from "@distube/ytdl-core";
import { pipeline } from "node:stream";

const HOST = "127.0.0.1";
const PORT = Number(process.env.REX_YTDL_PORT || 4181);
const yt = new Ytdl({ lang: "en", country: "IN", timeoutMs: 35_000 });
const infoCache = new Map();
const INFO_TTL_MS = 4 * 60 * 1000;

function json(res, status, body) {
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

function audioFormats(info) {
  // Only select formats that include a normal direct media URL.
  return (info.formats || []).filter((f) =>
    f.hasAudio && !f.hasVideo && Boolean(f.url) && !f.isDrm && !f.isOtf
  );
}

function selectAudioFormat(info, profile) {
  const formats = audioFormats(info);
  if (!formats.length) {
    const error = new Error("No downloadable audio-only formats were returned.");
    error.statusCode = 502;
    throw error;
  }

  const rate = (f) => Number(f.audioBitrate || f.bitrate || 0);
  const sorted = [...formats].sort((a, b) => rate(a) - rate(b));
  if (profile === "data-saver") {
    return sorted.find((f) => rate(f) > 0 && rate(f) <= 96) || sorted[0];
  }
  if (profile === "balanced") {
    return sorted.find((f) => rate(f) > 0 && rate(f) <= 160) ||
      sorted[Math.floor((sorted.length - 1) / 2)];
  }
  return sorted[sorted.length - 1];
}


async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === "/health") {
    return json(res, 200, { ok: true });
  }


  const streamMatch = url.pathname.match(/^\/stream\/([^/]+)$/);
  if (streamMatch && req.method === "GET") {
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
      if (!size) {
        // Unknown content length means range seeking cannot be advertised
        // safely; stream from the beginning rather than inventing metadata.
        range = undefined;
      } else {
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
      "X-REX-Playback-Engine": "distube-ytdl-core-v5",
      "X-REX-YTDL-Format": String(format.itag),
    };

    if (range && size) {
      headers["Accept-Ranges"] = "bytes";
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
      res.writeHead(206, headers);
    } else {
      if (size) {
        headers["Accept-Ranges"] = "bytes";
        headers["Content-Length"] = String(size);
      } else {
        headers["Accept-Ranges"] = "none";
      }
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
      if (error && !res.destroyed) {
        res.destroy(error);
      }
    });
    return;
  }

  return json(res, 404, { error: "Not found" });
}

const server = createServer((req, res) => {
  Promise.resolve(handle(req, res)).catch((error) => {
    if (!res.headersSent) {
      json(res, Number(error.statusCode) || 502, {
        error: error.code || "YTDL_REQUEST_FAILED",
        message: error.message || "ytdl-core request failed",
      });
    } else {
      res.destroy(error);
    }
  });
});

server.listen(PORT, HOST);

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
