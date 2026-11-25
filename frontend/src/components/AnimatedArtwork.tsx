import { useEffect, useRef } from 'react';

type HlsErrorData = {
  fatal?: boolean;
  type?: string;
  details?: string;
  response?: { code?: number };
};
type HlsInstance = {
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  destroy: () => void;
  startLoad: () => void;
  recoverMediaError: () => void;
  levels?: Array<{ width?: number; height?: number; bitrate?: number }>;
  startLevel?: number;
  autoLevelCapping?: number;
  /** Assigning currentLevel manually pins HLS.js to that rendition. */
  currentLevel?: number;
  on: (event: string, callback: (_event: string, data: HlsErrorData) => void) => void;
};
type HlsConstructor = {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported: () => boolean;
  Events: { ERROR: string; MANIFEST_PARSED: string };
  ErrorTypes?: { NETWORK_ERROR?: string; MEDIA_ERROR?: string };
};
declare global {
  interface Window { Hls?: HlsConstructor }
}

const HLS_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/hls.js@1.7.4/dist/hls.min.js',
  'https://unpkg.com/hls.js@1.7.4/dist/hls.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.7.4/hls.min.js',
];
let hlsLoad: Promise<HlsConstructor | null> | null = null;

function loadScript(url: string): Promise<HlsConstructor | null> {
  return new Promise<HlsConstructor | null>(resolve => {
    const script = document.createElement('script');
    let settled = false;
    const finish = (value: HlsConstructor | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (!value) script.remove();
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(window.Hls ?? null), 3500);
    script.src = url;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.rexHlsjs = '1';
    script.onload = () => finish(window.Hls ?? null);
    script.onerror = () => finish(null);
    document.head.appendChild(script);
  });
}

function loadHls(): Promise<HlsConstructor | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLoad) return hlsLoad;
  // Race CDNs instead of waiting for each timeout sequentially. On a slow or
  // blocked CDN this cuts worst-case startup from ~10.5s to ~2.5s.
  hlsLoad = new Promise<HlsConstructor | null>(resolve => {
    let failures = 0;
    let settled = false;
    const finish = (value: HlsConstructor | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    for (const url of HLS_SCRIPTS) {
      void loadScript(url).then(loaded => {
        if (loaded || window.Hls) finish(loaded ?? window.Hls ?? null);
        else if (++failures === HLS_SCRIPTS.length) finish(null);
      }).catch(() => {
        if (++failures === HLS_SCRIPTS.length) finish(null);
      });
    }
  }).catch(() => null);
  return hlsLoad;
}

function setStatus(video: HTMLVideoElement, status: string, detail?: string) {
  video.dataset.rexMotionStatus = status;
  if (detail) video.dataset.rexMotionDetail = detail;
  else delete video.dataset.rexMotionDetail;
}

/** Plays only a selected tall Apple Music HLS artwork loop, separate from music audio. */
export default function AnimatedArtwork({
  src, className = '', onFailure,
}: { src: string; className?: string; onFailure?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onFailureRef = useRef(onFailure);
  useEffect(() => { onFailureRef.current = onFailure; }, [onFailure]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let disposed = false;
    let hls: HlsInstance | null = null;
    let recoveredMedia = false;
    let retriedNetwork = false;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    setStatus(video, 'loading');

    const play = () => {
      if (disposed) return;
      void video.play().then(() => setStatus(video, 'playing')).catch(error => {
        setStatus(video, 'autoplay-blocked', error instanceof Error ? error.name : 'play-rejected');
        });
    };
    const fail = (detail: string) => {
      if (disposed) return;
      setStatus(video, 'failed', detail);
      onFailureRef.current?.();
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };

    const start = async () => {
      if (!/\.m3u8(?:$|[?#])/i.test(src)) {
        video.src = src;
        video.load();
        video.addEventListener('canplay', play, { once: true });
        video.addEventListener('error', () => fail(`media-error-${video.error?.code ?? 'unknown'}`), { once: true });
        return;
      }

      const Hls = await loadHls();
      if (disposed) return;
      if (Hls?.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 5,
          maxBufferLength: 8,
          maxMaxBufferLength: 12,
          startFragPrefetch: true,
          capLevelToPlayerSize: false,
          startLevel: -1,
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 2,
          fragLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 400,
          levelLoadingRetryDelay: 400,
          fragLoadingRetryDelay: 500,
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (disposed || !hls) return;
          const levels = hls.levels ?? [];
          if (levels.length) {
            const bestLevel = levels.reduce((best, level, index, all) => {
              const score = (level.width ?? 0) * (level.height ?? 0);
              const bestScore = (all[best]?.width ?? 0) * (all[best]?.height ?? 0);
              return score > bestScore ? index : best;
            }, 0);
            hls.autoLevelCapping = bestLevel;
            hls.startLevel = bestLevel;
            // Pin the animation to its best advertised rendition. This prevents
            // ABR from silently switching the cover to a blurry low-res level.
            hls.currentLevel = bestLevel;
          }
          play();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (disposed || !data.fatal || !hls) return;
          const networkType = Hls.ErrorTypes?.NETWORK_ERROR ?? 'networkError';
          const mediaType = Hls.ErrorTypes?.MEDIA_ERROR ?? 'mediaError';
          if (data.type === networkType && !retriedNetwork) {
            retriedNetwork = true;
            hls.startLoad();
            return;
          }
          if (data.type === mediaType && !recoveredMedia) {
            recoveredMedia = true;
            hls.recoverMediaError();
            return;
          }
          fail(`${data.type ?? 'hls-error'}:${data.details ?? 'fatal'}:${data.response?.code ?? ''}`);
        });
        hls.attachMedia(video);
        hls.loadSource(src);
        return;
      }

      // Native HLS is available on Safari and some embedded browser engines.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        video.load();
        video.addEventListener('canplay', play, { once: true });
        video.addEventListener('error', () => fail(`native-hls-error-${video.error?.code ?? 'unknown'}`), { once: true });
        return;
      }
      fail('hlsjs-unavailable-and-no-native-hls');
    };

    void start().catch(error => fail(error instanceof Error ? error.message : String(error)));
    return () => {
      disposed = true;
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      delete video.dataset.rexMotionStatus;
      delete video.dataset.rexMotionDetail;
    };
  }, [src]);

  return <video
    ref={videoRef}
    className={className}
    muted
    loop
    autoPlay
    playsInline
    preload="auto"
    crossOrigin="anonymous"
    aria-hidden="true"
    tabIndex={-1}
  />;
}
