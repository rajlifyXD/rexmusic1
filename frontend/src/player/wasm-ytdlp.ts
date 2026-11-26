/**
 * Experimental client-side YouTube resolver for REX.
 *
 * yt-dlp runs in its own module worker through Pyodide/WASM. We only ask it
 * for media metadata and then hand the signed Google Video URL to REX's
 * existing HTMLAudioElement. The audio bytes are NOT downloaded into memory.
 *
 * Requires a trusted, user-operated yt-dlp-wasm CORS proxy. Never pass account
 * cookies or Supabase credentials to this engine or its proxy.
 */
import { apiUrl } from '../api';

const YTDLP_WASM_VERSION = '0.6.0';
const YTDLP_WASM_MODULE_URL =
  `https://cdn.jsdelivr.net/npm/@project516/yt-dlp-wasm@${YTDLP_WASM_VERSION}/src/browser.mjs`;

type Quality = 'data-saver' | 'balanced' | 'high';

type YtdlpFormat = {
  url?: string;
  format_id?: string;
  ext?: string;
  protocol?: string;
  acodec?: string;
  vcodec?: string;
  abr?: number | string;
  tbr?: number | string;
  filesize?: number;
  filesize_approx?: number;
  has_drm?: boolean;
  is_drm?: boolean;
};

type YtdlpInfo = {
  id?: string;
  title?: string;
  duration?: number;
  formats?: YtdlpFormat[];
};

type YtdlpInstance = {
  extractInfo(url: string, options?: Record<string, unknown>): Promise<YtdlpInfo>;
  close(): Promise<void>;
  terminate(): void;
};

type YtdlpModule = {
  createYtDlp(options?: {
    corsProxy?: string;
    corsProxyKey?: string;
    onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  }): Promise<YtdlpInstance>;
};

export type WasmAudioStream = {
  url: string;
  formatId: string;
  bitrate: number;
  mimeType: string;
  duration: number;
  expiresAt: number;
};

type TokenReply = {
  po_token?: string;
  visitor_data?: string;
};

const env = import.meta.env as Record<string, string | undefined>;
const streamEngine = (env.VITE_REX_STREAM_ENGINE || '').trim().toLowerCase();
const corsProxy = (env.VITE_YTDLP_WASM_CORS_PROXY || '').trim();
const corsProxyKey = (env.VITE_YTDLP_WASM_CORS_PROXY_KEY || '').trim();

let enginePromise: Promise<YtdlpInstance> | null = null;
const streamCache = new Map<string, WasmAudioStream>();

export function isWasmStreamEngineSelected(): boolean {
  return streamEngine === 'wasm';
}

function hasJspi(): boolean {
  const wasm = WebAssembly as unknown as {
    Suspending?: unknown;
    promising?: unknown;
  };
  return typeof wasm.Suspending === 'function' && typeof wasm.promising === 'function';
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[upstream URL redacted]')
    .replace(/(cookie|authorization|token|signature|sig)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 600);
}

async function getPoToken(videoId: string, client: 'mweb' | 'web'): Promise<TokenReply | null> {
  const url = apiUrl(
    `/api/potoken?video_id=${encodeURIComponent(videoId)}&client=${client}&context=gvs`,
  );
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json() as TokenReply;
    return typeof data.po_token === 'string' && data.po_token
      ? data
      : null;
  } catch {
    // Token providers are optional. Extraction still gets one unauthenticated
    // attempt, and the final extractor error is shown to the user.
    return null;
  }
}

async function getEngine(): Promise<YtdlpInstance> {
  if (!corsProxy) {
    throw new Error(
      'Client-side streaming is not configured yet. Set VITE_YTDLP_WASM_CORS_PROXY to your private yt-dlp-wasm proxy URL.',
    );
  }
  if (!hasJspi()) {
    throw new Error(
      'This browser does not expose WebAssembly JSPI. Update to a current Chrome, Firefox or Safari build to use the experimental engine.',
    );
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      // The library owns its Pyodide worker and its wheel/wasm asset loading.
      // Keep this as an external module import so Vite does not try to bundle
      // Pyodide's worker and its large WASM assets into the REX app bundle.
      const module = await import(/* @vite-ignore */ YTDLP_WASM_MODULE_URL) as YtdlpModule;
      return module.createYtDlp({
        corsProxy,
        ...(corsProxyKey ? { corsProxyKey } : {}),
        onLog: () => {
          // Do not forward yt-dlp logs to the console: diagnostics may contain
          // signed media URLs and short-lived PO tokens.
        },
      });
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

function bitrate(format: YtdlpFormat): number {
  const value = Number(format.abr ?? format.tbr ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function isProgressiveAudio(format: YtdlpFormat): boolean {
  if (!format.url || !format.acodec || format.acodec === 'none') return false;
  if (format.vcodec && format.vcodec !== 'none') return false;
  if (format.has_drm || format.is_drm) return false;

  const protocol = (format.protocol || '').toLowerCase();
  if (protocol && protocol !== 'http' && protocol !== 'https') return false;

  try {
    const url = new URL(format.url);
    return url.protocol === 'https:' &&
      (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'));
  } catch {
    return false;
  }
}

function chooseFormat(formats: YtdlpFormat[], quality: Quality): YtdlpFormat | null {
  const usable = formats
    .filter(isProgressiveAudio)
    .sort((a, b) => bitrate(a) - bitrate(b));

  if (!usable.length) return null;
  if (quality === 'high') return usable[usable.length - 1];

  const ceiling = quality === 'data-saver' ? 96 : 160;
  const underCeiling = usable.filter((format) => bitrate(format) > 0 && bitrate(format) <= ceiling);
  return underCeiling[underCeiling.length - 1] ?? usable[0];
}

function mimeType(ext?: string): string {
  switch ((ext || '').toLowerCase()) {
    case 'm4a': return 'audio/mp4';
    case 'mp3': return 'audio/mpeg';
    case 'opus': return 'audio/ogg; codecs=opus';
    case 'ogg': return 'audio/ogg';
    case 'wav': return 'audio/wav';
    default: return 'audio/webm';
  }
}

function signedUrlExpiry(value: string): number {
  try {
    const url = new URL(value);
    const expirySeconds = Number(url.searchParams.get('expire'));
    if (Number.isFinite(expirySeconds) && expirySeconds > 0) return expirySeconds * 1000;
  } catch {
    // The format URL is validated separately.
  }
  return Date.now() + 90_000;
}

function tokenOptions(token: TokenReply | null): Record<string, unknown> {
  const youtube: Record<string, unknown> = { player_client: ['mweb'] };
  if (token?.po_token) youtube.po_token = [`mweb.gvs+${token.po_token}`];
  if (token?.visitor_data) youtube.visitor_data = [token.visitor_data];
  return {
    noplaylist: true,
    quiet: true,
    no_warnings: true,
    extractor_args: { youtube },
  };
}

/**
 * Resolves a progressive, signed audio-only URL. Playback remains in REX's
 * existing audio element; only metadata extraction is performed by WASM.
 */
export async function resolveWasmAudioStream(
  videoId: string,
  quality: Quality = 'balanced',
): Promise<WasmAudioStream> {
  const cacheKey = `${videoId}:${quality}`;
  const cached = streamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 15_000) return cached;

  const engine = await getEngine();
  const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const mwebToken = await getPoToken(videoId, 'mweb');

  let info: YtdlpInfo | null = null;
  let lastError: unknown;
  const attempts: Array<{ client: 'mweb' | 'web'; token: TokenReply | null }> = [
    { client: 'mweb', token: mwebToken },
  ];
  if (!mwebToken) attempts.push({ client: 'web', token: await getPoToken(videoId, 'web') });

  for (const attempt of attempts) {
    const youtube: Record<string, unknown> = { player_client: [attempt.client] };
    if (attempt.token?.po_token) {
      youtube.po_token = [`${attempt.client}.gvs+${attempt.token.po_token}`];
    }
    if (attempt.token?.visitor_data) youtube.visitor_data = [attempt.token.visitor_data];
    try {
      info = await engine.extractInfo(videoUrl, {
        noplaylist: true,
        quiet: true,
        no_warnings: true,
        extractor_args: { youtube },
      });
      if (info.formats?.some(isProgressiveAudio)) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!info) {
    throw new Error(`yt-dlp-wasm could not resolve this track: ${safeError(lastError || 'no extractor response')}`);
  }

  const selected = chooseFormat(info.formats || [], quality);
  if (!selected?.url) {
    throw new Error(
      'YouTube returned no direct progressive audio-only format for this track. The current browser proxy or YouTube access response may not be compatible.',
    );
  }

  const expiresAt = Math.min(signedUrlExpiry(selected.url), Date.now() + 120_000);
  const result: WasmAudioStream = {
    url: selected.url,
    formatId: selected.format_id || 'unknown',
    bitrate: bitrate(selected),
    mimeType: mimeType(selected.ext),
    duration: Number(info.duration) || 0,
    expiresAt,
  };

  if (expiresAt > Date.now() + 15_000) {
    if (streamCache.size > 40) streamCache.clear();
    streamCache.set(cacheKey, result);
  }
  return result;
}

/** Clears cached signed URLs after a stream error or when the app changes engine. */
export function clearWasmStreamCache(videoId?: string): void {
  if (!videoId) {
    streamCache.clear();
    return;
  }
  for (const key of streamCache.keys()) {
    if (key.startsWith(`${videoId}:`)) streamCache.delete(key);
  }
}
