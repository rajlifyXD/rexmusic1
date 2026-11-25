import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { api, highResolutionArtworkUrl, img, recoverHighResolutionArtwork, recoverImage } from '../api';
import FluidCanvas from '../components/FluidCanvas';
import AnimatedArtwork from '../components/AnimatedArtwork';
import { SoapBubbleSlider, SoapBubbleToggle } from '../components/soap-bubble';
import { fmt, go, openAddTo } from '../components/ui';
import LyricsView from '../lyrics/LyricsView';
import { currentTrack, cycleRepeat, jump, next, prev, previewVolume, seek, setVolume, toggle, toggleLike, toggleShuffle, usePlayer } from '../player/store';
import type { LyricsResponse } from '../types';
import { safeGetItem, safeSetItem } from '../lib/storage';

type TransportIconName = 'previous' | 'next' | 'play' | 'pause';
const TRANSPORT_ICON_SRC: Record<TransportIconName, string> = {
  previous: '/icons/rex-rewind.png',
  next: '/icons/rex-forward.png',
  play: '/icons/rex-play.png',
  pause: '/icons/rex-pause.png',
};
function TransportIcon({ kind, size = 30 }: { kind: TransportIconName; size?: number }) {
  return <img className={`rex-transport-image rex-transport-${kind}`} src={TRANSPORT_ICON_SRC[kind]} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
const LINE_ICONS = {
  back: ['M15 18l-6-6 6-6', 'M9 12h12'],
  video: ['M3.5 7.5A2.5 2.5 0 0 1 6 5h8a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 14 19H6a2.5 2.5 0 0 1-2.5-2.5z', 'm16.5 10 4-2.5v9L16.5 14'],
  expand: ['M8.5 3.5h-5v5M15.5 3.5h5v5M20.5 15.5v5h-5M3.5 15.5v5h5'],
  heart: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z'],
  shuffle: ['M16 3h5v5', 'M4 20 21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5'],
  repeat: ['M17 1l4 4-4 4', 'M3 5v-1a3 3 0 0 1 3-3h11', 'M7 23l-4-4 4-4', 'M21 19v1a3 3 0 0 1-3 3H7'],
  repeatOne: ['M17 1l4 4-4 4', 'M3 5v-1a3 3 0 0 1 3-3h11', 'M7 23l-4-4 4-4', 'M21 19v1a3 3 0 0 1-3 3H7', 'M12 9v6', 'm10 11 2-2 2 2'],
  volume: ['M11 5 6 9H3v6h3l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7'],
  lyrics: ['M20 14a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4z', 'M7 9h6', 'M7 13h4'],
  queue: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  headphones: ['M3 14v-3a9 9 0 0 1 18 0v3', 'M3 14h4v7H6a3 3 0 0 1-3-3z', 'M17 14h4v4a3 3 0 0 1-3 3h-1z'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  playlistAdd: ['M3 6h12', 'M3 11h12', 'M3 16h8', 'M18 14v8', 'M14 18h8'],
} as const;
type LineIconName = keyof typeof LINE_ICONS;
function LineIcon({ name, size = 22, filled = false }: { name: LineIconName; size?: number; filled?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {LINE_ICONS[name].map((d, i) => <path d={d} key={i} />)}
  </svg>;
}

type LyricsPrefs = { fontSize?: number; autoScroll?: boolean };

type RexWakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void, options?: AddEventListenerOptions) => void;
};
type RexWakeLockApi = { request: (type: 'screen') => Promise<RexWakeLockSentinel> };
// Mirrors the original responsive lyric sizing before the Settings slider existed.
function defaultLyricsFontSize(): number {
  if (typeof window !== 'undefined' && window.innerWidth <= 820) {
    return Math.round(Math.max(25, Math.min(35, window.innerWidth * 0.072)));
  }
  return 34;
}
function readLyricsPrefs(): LyricsPrefs {
  try {
    const parsed: unknown = JSON.parse(safeGetItem('lm.lyrics') ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const value = parsed as Record<string, unknown>;
    return {
      fontSize: typeof value.fontSize === 'number' && Number.isFinite(value.fontSize) ? Math.min(42, Math.max(22, value.fontSize)) : undefined,
      autoScroll: typeof value.autoScroll === 'boolean' ? value.autoScroll : undefined,
    };
  } catch {
    return {};
  }
}

/** Validate lyric payloads before they reach the JSX renderer. Providers can return
 * incomplete optional fields; a malformed line must not crash the whole player. */
function normalizeLyricsResponse(input: unknown): LyricsResponse {
  const root = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawResult = root.result && typeof root.result === 'object' ? root.result as Record<string, unknown> : null;
  const rawLines = rawResult && Array.isArray(rawResult.lines) ? rawResult.lines : [];
  const lines = rawLines.flatMap((candidate): NonNullable<LyricsResponse['result']>['lines'] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const line = candidate as Record<string, unknown>;
    if (typeof line.text !== 'string') return [];
    const words = Array.isArray(line.words) ? line.words.flatMap((candidateWord) => {
      if (!candidateWord || typeof candidateWord !== 'object') return [];
      const word = candidateWord as Record<string, unknown>;
      if (typeof word.text !== 'string') return [];
      const start = typeof word.start === 'number' && Number.isFinite(word.start) ? word.start : 0;
      const end = typeof word.end === 'number' && Number.isFinite(word.end) ? word.end : null;
      return [{ text: word.text, start, end, ...(word.space === true ? { space: true } : {}) }];
    }) : null;
    const start = typeof line.start === 'number' && Number.isFinite(line.start) ? line.start : null;
    const end = typeof line.end === 'number' && Number.isFinite(line.end) ? line.end : null;
    return [{ text: line.text, start, end, words: words?.length ? words : null }];
  });
  const syncValue = rawResult?.sync;
  const sync: 'word' | 'line' | 'none' = syncValue === 'word' || syncValue === 'line' ? syncValue : 'none';
  const wordTiming: NonNullable<LyricsResponse['result']>['wordTiming'] =
    rawResult?.wordTiming === 'source'
      ? 'source'
      : rawResult?.wordTiming === 'estimated'
        ? 'estimated'
        : undefined;
  const result: LyricsResponse['result'] = rawResult ? {
    source: typeof rawResult.source === 'string' ? rawResult.source : 'unknown',
    sync,
    lines,
    attribution: typeof rawResult.attribution === 'string' ? rawResult.attribution : undefined,
    wordTiming,
  } : null;
  const attempts = Array.isArray(root.attempts) ? root.attempts.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const attempt = candidate as Record<string, unknown>;
    return [{ provider: typeof attempt.provider === 'string' ? attempt.provider : 'Provider', status: typeof attempt.status === 'string' ? attempt.status : 'unknown' }];
  }) : [];
  return { result, attempts };
}

/** Extract the artwork's dominant colour so the whole player inherits the current album mood. */
function tintFrom(url: string, cb: (colour: string) => void) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 24;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 24, 24);
      const pixels = context.getImageData(0, 0, 24, 24).data;
      let red = 0, green = 0, blue = 0, weightSum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const high = Math.max(r, g, b), low = Math.min(r, g, b);
        const saturation = high ? (high - low) / high : 0;
        const luminance = (r * .2126 + g * .7152 + b * .0722) / 255;
        const weight = (.32 + saturation * 1.35) * Math.max(.12, 1 - Math.abs(luminance - .48) * 1.35);
        red += r * weight; green += g * weight; blue += b * weight; weightSum += weight;
      }
      if (weightSum > 0) {
        const average = [red / weightSum, green / weightSum, blue / weightSum];
        // Slightly lift saturation/brightness, while keeping the same artwork hue.
        const max = Math.max(...average), min = Math.min(...average);
        const midpoint = (max + min) / 2;
        const enhanced = average.map(channel => Math.max(0, Math.min(255, midpoint + (channel - midpoint) * 1.18 + 4)));
        cb(enhanced.map(Math.round).join(', '));
      }
    } catch {
      // Keep the previous colour when a remote thumbnail blocks canvas sampling.
    }
  };
  image.onerror = () => undefined;
  image.src = url;
}

type MotionArtworkDecision = {
  videoId: string;
  status: 'loading' | 'available' | 'none';
  tallUrl?: string | null;
  staticUrl?: string | null;
};

const motionArtworkCache = new Map<string, MotionArtworkDecision>();
function rememberMotionArtwork(decision: MotionArtworkDecision) {
  if (decision.status === 'loading') return;
  motionArtworkCache.delete(decision.videoId);
  motionArtworkCache.set(decision.videoId, decision);
  // Keep the cache bounded during long listening sessions.
  while (motionArtworkCache.size > 120) {
    const oldestKey = motionArtworkCache.keys().next().value;
    if (oldestKey === undefined) break;
    motionArtworkCache.delete(oldestKey);
  }
}

export default function FullPlayer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const player = usePlayer();
  const track = currentTrack(player);
  const root = useRef<HTMLDivElement>(null);
  const lyricsHideTimer = useRef<number | null>(null);
  const [tab, setTab] = useState<'player' | 'lyrics' | 'queue'>('player');
  const [fontSize, setFontSize] = useState<number>(() => readLyricsPrefs().fontSize ?? defaultLyricsFontSize());
  const [autoScroll, setAutoScroll] = useState<boolean>(() => readLyricsPrefs().autoScroll ?? true);
  const [lyricsState, setLyricsState] = useState<{ loading: boolean; data?: LyricsResponse; error?: string }>({ loading: false });
  const [offset, setOffset] = useState(0);
  const [tint, setTint] = useState('88, 52, 68');
  const trackId = track?.videoId;
  const [motionArtwork, setMotionArtwork] = useState<MotionArtworkDecision | null>(() => {
    if (!trackId) return null;
    const seededTallUrl = track?.animatedTallThumb?.trim();
    if (seededTallUrl) return { videoId: trackId, status: 'available', tallUrl: seededTallUrl };
    const cached = motionArtworkCache.get(trackId);
    return cached ?? { videoId: trackId, status: 'loading' };
  });
  const [lyricsControlsVisible, setLyricsControlsVisible] = useState(true);

  // Keep the phone display awake only while the full player is open and audio is
  // actively playing. Android Chrome releases the lock when the document hides;
  // reacquire it when the player becomes visible again.
  useEffect(() => {
    if (!open || !player.playing || typeof navigator === 'undefined' || typeof document === 'undefined') return;

    const wakeLockApi = (navigator as Navigator & { wakeLock?: RexWakeLockApi }).wakeLock;
    if (!wakeLockApi || typeof wakeLockApi.request !== 'function') return;

    let disposed = false;
    let requesting = false;
    let sentinel: RexWakeLockSentinel | null = null;

    const releaseCurrent = async () => {
      const active = sentinel;
      sentinel = null;
      if (!active || active.released) return;
      try { await active.release(); } catch { /* The browser may have released it already. */ }
    };

    const acquire = async () => {
      if (disposed || requesting || sentinel || document.visibilityState !== 'visible') return;
      requesting = true;
      try {
        const lock = await wakeLockApi.request('screen');
        if (disposed || document.visibilityState !== 'visible') {
          try { await lock.release(); } catch { /* Ignore a lock released by the browser. */ }
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        }, { once: true });
      } catch (error) {
        // Screen Wake Lock is optional: unsupported browsers or battery policies
        // must never interrupt music playback.
        console.info('[REX] Screen wake lock unavailable:', error);
      } finally {
        requesting = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
      else void releaseCurrent();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void acquire();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void releaseCurrent();
    };
  }, [open, player.playing]);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    setLyricsState({ loading: true });
    setOffset(0);
    setTint('88, 52, 68');
    api.lyrics(track).then(data => { if (!cancelled) setLyricsState({ loading: false, data: normalizeLyricsResponse(data) }); })
      .catch(error => { if (!cancelled) setLyricsState({ loading: false, error: error instanceof Error ? error.message : String(error) }); });
    api.getOffset(track.videoId).then(result => { if (!cancelled) setOffset(result.offset); }).catch(() => undefined);
    if (track.thumb) tintFrom(img(track.thumb), colour => { if (!cancelled) setTint(colour); });
    return () => { cancelled = true; };
  }, [trackId]); // track changes only

  // Resolve tall Apple Motion compatibility before rendering a static cover.
  // Cache decisions per track so a player remount never flashes static artwork
  // for an album that has already been confirmed to have a tall animation.
  useEffect(() => {
    if (!trackId || !track) {
      setMotionArtwork(null);
      return;
    }

    const seededTallUrl = track.animatedTallThumb?.trim();
    if (seededTallUrl) {
      const decision: MotionArtworkDecision = { videoId: trackId, status: 'available', tallUrl: seededTallUrl };
      rememberMotionArtwork(decision);
      setMotionArtwork(decision);
      return;
    }

    const cached = motionArtworkCache.get(trackId);
    if (cached) {
      setMotionArtwork(cached);
      return;
    }

    let cancelled = false;
    setMotionArtwork({ videoId: trackId, status: 'loading' });
    const albumQuery = track.album?.trim() || track.title?.trim();
    if (!track.artist?.trim() || !albumQuery) {
      const decision: MotionArtworkDecision = { videoId: trackId, status: 'none' };
      rememberMotionArtwork(decision);
      setMotionArtwork(decision);
      return () => { cancelled = true; };
    }

    api.animatedArtwork(track.artist, albumQuery, track.title).then(result => {
      if (cancelled) return;
      const decision: MotionArtworkDecision = result.available && result.tallUrl
        ? { videoId: trackId, status: 'available', tallUrl: result.tallUrl, staticUrl: result.staticUrl || undefined }
        : { videoId: trackId, status: 'none', staticUrl: result.staticUrl || undefined };
      rememberMotionArtwork(decision);
      setMotionArtwork(decision);
    }).catch(() => {
      if (cancelled) return;
      // Do not cache transient API failures; a later opening can retry.
      setMotionArtwork({ videoId: trackId, status: 'none' });
    });

    return () => { cancelled = true; };
  }, [trackId, track?.artist, track?.album, track?.title, track?.animatedTallThumb]);

  const artworkDecision: MotionArtworkDecision | null = motionArtwork?.videoId === trackId
    ? motionArtwork
    : trackId ? { videoId: trackId, status: 'loading' } : null;
  const motionSource = artworkDecision?.status === 'available' ? artworkDecision.tallUrl || undefined : undefined;
  const motionArtworkPending = artworkDecision?.status === 'loading';
  const staticArtworkUrl = artworkDecision?.staticUrl || highResolutionArtworkUrl(track?.thumb, 1600);

  const revealLyricsControls = () => {
    if (tab !== 'lyrics') return;
    setLyricsControlsVisible(true);
    if (lyricsHideTimer.current !== null) window.clearTimeout(lyricsHideTimer.current);
    lyricsHideTimer.current = window.setTimeout(() => setLyricsControlsVisible(false), 2000);
  };

  useEffect(() => {
    if (!open || tab !== 'lyrics') {
      if (lyricsHideTimer.current !== null) window.clearTimeout(lyricsHideTimer.current);
      lyricsHideTimer.current = null;
      setLyricsControlsVisible(true);
      return;
    }
    setLyricsControlsVisible(true);
    if (lyricsHideTimer.current !== null) window.clearTimeout(lyricsHideTimer.current);
    lyricsHideTimer.current = window.setTimeout(() => setLyricsControlsVisible(false), 2000);
    return () => {
      if (lyricsHideTimer.current !== null) window.clearTimeout(lyricsHideTimer.current);
      lyricsHideTimer.current = null;
    };
  }, [open, tab]);

  const changeOffset = (value: number) => {
    const nextOffset = Math.round(value * 10) / 10;
    setOffset(nextOffset);
    if (trackId) api.putOffset(trackId, nextOffset).catch(() => undefined);
  };

  const changeAutoScroll = (checked: boolean) => {
    setAutoScroll(checked);
    try {
      const current = readLyricsPrefs();
      const nextPrefs = { ...current, autoScroll: checked };
      safeSetItem('lm.lyrics', JSON.stringify(nextPrefs));
      window.dispatchEvent(new CustomEvent('rex-lyrics-preferences', { detail: nextPrefs }));
    } catch {
      // The current session still honours the in-memory switch.
    }
  };

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ autoScroll?: boolean; fontSize?: number }>).detail;
      if (typeof detail?.autoScroll === 'boolean') setAutoScroll(detail.autoScroll);
      if (typeof detail?.fontSize === 'number' && Number.isFinite(detail.fontSize)) {
        setFontSize(Math.min(42, Math.max(22, Math.round(detail.fontSize))));
      }
    };
    window.addEventListener('rex-lyrics-preferences', sync);
    return () => window.removeEventListener('rex-lyrics-preferences', sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const lyrics = lyricsState.data?.result;
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen?.();
    } catch {
    }
  };
  const retryLyrics = () => {
    if (!track) return;
    setLyricsState({ loading: true });
    api.lyrics(track, true).then(data => setLyricsState({ loading: false, data: normalizeLyricsResponse(data) }))
      .catch(error => setLyricsState({ loading: false, error: error instanceof Error ? error.message : String(error) }));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={root}
          className={`full mode-karaoke view-${tab}${tab === 'lyrics' && !lyricsControlsVisible ? ' lyrics-controls-hidden' : ''}${motionArtworkPending ? ' motion-art-pending' : ''}${motionSource ? ' motion-art-present' : ''}`}
          style={{ ['--tint' as string]: tint, ['--song-accent' as string]: `rgb(${tint})`, ['--rex-accent' as string]: `rgb(${tint})` }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 260 }}
          role="dialog"
          aria-modal="true"
          aria-label="Now playing"
          onPointerDown={revealLyricsControls}
          onPointerMove={revealLyricsControls}
        >
          <FluidCanvas className="music-canvas" tint={tint} active={player.playing} quality="hero" />
          {track?.thumb && (
            <>
              {/* Full-bleed backdrop uses the same high-resolution source as the
                  cover. Never replace it with the compact catalogue thumbnail. */}
              <img key={`${track.videoId}:bleed`} className="bgart-bleed" crossOrigin="anonymous" data-rex-artwork-width="1600" src={img(staticArtworkUrl)} onError={event => recoverHighResolutionArtwork(event.currentTarget, track.thumb)} alt="" aria-hidden="true" decoding="async" fetchPriority="high" />
              <img key={`${track.videoId}:bg`} className="bgart" crossOrigin="anonymous" data-rex-artwork-width="1600" src={img(staticArtworkUrl)} onError={event => recoverHighResolutionArtwork(event.currentTarget, track.thumb)} alt="" aria-hidden="true" decoding="async" fetchPriority="high" />
            </>
          )}
          <div className="bgshade" aria-hidden="true" />
          {track?.thumb && motionSource && (
            <div
              className={`rex-artwork-stage rex-artwork-fullbleed ${tab === 'player' ? 'artwork-tab-active' : 'artwork-tab-hidden'}`}
              aria-label={`Animated tall album artwork for ${track.album || track.title}`}
              aria-hidden={tab !== 'player'}
            >
              {/* Mount the full-bleed layer only for a confirmed motion source.
                  The original bgart/bgart-bleed images remain the static fallback
                  until this video reports that it is actually playing. */}
              <AnimatedArtwork key={`${track.videoId}:${motionSource}`} src={motionSource} className="rex-artwork-media" onFailure={() => {
                const fallbackDecision: MotionArtworkDecision = { videoId: track.videoId, status: 'none', staticUrl: artworkDecision?.staticUrl };
                rememberMotionArtwork(fallbackDecision);
                setMotionArtwork(fallbackDecision);
              }} />
            </div>
          )}

          <header className={`ftop ${tab === 'player' ? 'ftop-player' : 'ftop-secondary'}`}>
            <button className="ico big player-back" type="button" onClick={() => tab === 'player' ? onClose() : setTab('player')} aria-label={tab === 'player' ? 'Back to Rex' : 'Back to player'} title="Back">
              <LineIcon name="back" size={23} />
            </button>
            {tab !== 'player' && track && (
              <div className="player-header-meta" aria-label={`Now playing ${track.title} by ${track.artist}`}>
                {track.thumb
                  ? <img crossOrigin="anonymous" className="player-header-art" src={img(track.thumb)} onError={event => recoverImage(event.currentTarget, track.thumb)} alt="" />
                  : <span className="player-header-art player-header-art-empty" />}
                <span className="player-header-copy"><b>{track.title}</b><small>{track.artist}</small></span>
              </div>
            )}
            {tab !== 'player' && (
              <>
                <button className={`ico big player-header-like ${player.liked.has(track?.videoId ?? '') ? 'liked' : ''}`} type="button" onClick={() => track && toggleLike(track)} aria-label={player.liked.has(track?.videoId ?? '') ? 'Unlike track' : 'Like track'}>
                  <LineIcon name="heart" filled={player.liked.has(track?.videoId ?? '')} size={20} />
                </button>
                <details className="track-actions-menu player-header-more">
                  <summary className="ico big" aria-label="More playback options" title="More playback options"><LineIcon name="more" size={22} /></summary>
                  <div className="ctx player-actions-menu">
                    <button type="button" onClick={(event) => { toggleShuffle(); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>{player.shuffle ? 'Turn shuffle off' : 'Turn shuffle on'}</button>
                    <button type="button" onClick={(event) => { cycleRepeat(); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Repeat: {player.repeat === 'off' ? 'Off' : player.repeat === 'all' ? 'All' : 'One'}</button>
                    {tab === 'lyrics' && (
                      <>
                        <button type="button" onClick={(event) => { changeAutoScroll(!autoScroll); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Auto-scroll: {autoScroll ? 'On' : 'Off'}</button>
                        <button type="button" onClick={(event) => { setFontSize(size => Math.min(64, size + 2)); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Larger lyrics</button>
                        <button type="button" onClick={(event) => { setFontSize(size => Math.max(18, size - 2)); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Smaller lyrics</button>
                        <button type="button" onClick={(event) => { changeOffset(offset - .1); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Lyrics timing −0.1s</button>
                        <button type="button" onClick={(event) => { changeOffset(offset + .1); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Lyrics timing +0.1s</button>
                      </>
                    )}
                  </div>
                </details>
              </>
            )}
            <button className="ico big player-fullscreen" type="button" onClick={() => void fullscreen()} aria-label="Toggle fullscreen" title="Fullscreen">
              <LineIcon name="expand" />
            </button>
          </header>

          {!track ? <div className="fempty">Nothing is playing. Search for a song to begin.</div> : (
            <div className={`fgrid tab-${tab}`}>
              <section className="fleft">
                <div className="now-playing-hero">
                  <div className="now-art">
                    {track.thumb && <img crossOrigin="anonymous" src={img(track.thumb)} onError={event => recoverImage(event.currentTarget, track.thumb)} alt={`Artwork for ${track.title}`} />}
                    <span className="art-gloss" />
                  </div>
                </div>
                {tab === 'player' && track.thumb && <div className="rex-artwork-spacer" aria-hidden="true" />}
                <div className="track-meta-row">
                  <div className="now-copy">
                    <span className="eyebrow">NOW PLAYING</span>
                    <h2>{track.title}</h2>
                    <button className="link" type="button" onClick={() => { if (track.artistId) { onClose(); go(`/artist/${track.artistId}`); } }}>{track.artist}</button>
                  </div>
                  <div className="track-meta-actions">
                    <button className="ico track-meta-button player-add-playlist" type="button" onClick={() => openAddTo(track)} aria-label="Add to playlist" title="Add to playlist">
                      <LineIcon name="playlistAdd" size={17}/>
                    </button>
                    <details className="track-actions-menu player-more-menu">
                      <summary className="ico track-meta-button" aria-label="More playback options" title="More playback options"><LineIcon name="more" size={17} /></summary>
                      <div className="ctx player-actions-menu">
                        <button type="button" onClick={(event) => { toggleShuffle(); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>{player.shuffle ? 'Turn shuffle off' : 'Turn shuffle on'}</button>
                        <button type="button" onClick={(event) => { cycleRepeat(); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Repeat: {player.repeat === 'off' ? 'Off' : player.repeat === 'all' ? 'All' : 'One'}</button>
                      </div>
                    </details>
                    <button className={`ico now-like track-meta-button ${player.liked.has(track.videoId) ? 'liked' : ''}`} type="button" onClick={() => toggleLike(track)} aria-label={player.liked.has(track.videoId) ? 'Unlike track' : 'Like track'}>
                      <LineIcon name="heart" filled={player.liked.has(track.videoId)} size={18} />
                    </button>
                  </div>
                </div>

                {player.error && <div className="notice"><b>Can’t play this here</b><p>{player.error}</p><button className="pill" type="button" onClick={() => window.open(`https://www.youtube.com/watch?v=${track.videoId}`, '_blank', 'noopener,noreferrer')}>Open in YouTube</button></div>}

                <div className="timeline">
                  <span>{fmt(player.current)}</span>
                  <SoapBubbleSlider className="seek-glass rex-player-bubble-slider" label="Seek" min={0} max={Math.max(1, player.duration)} value={player.current} onValueCommit={seek} from={`rgb(${tint})`} to="rgba(255,255,255,0.92)" scale={0.72} glass={0.98} iridescence={0.05} oilOpacity={0} oilCoverage={0} tint="rgba(255,255,255,0.14)" reflectivity={1.62} refraction={0.26} dispersion={0.82} />
                  <span>{fmt(player.duration)}</span>
                </div>
                <div className="controls">
                  <button className="transport-skip" type="button" onClick={prev} aria-label="Previous"><TransportIcon kind="previous" size={31} /></button>
                  <button className="playbig" type="button" onClick={toggle} aria-label={player.playing ? 'Pause' : 'Play'}><TransportIcon kind={player.playing ? "pause" : "play"} size={36} /></button>
                  <button className="transport-skip" type="button" onClick={next} aria-label="Next"><TransportIcon kind="next" size={31} /></button>
                </div>
                <label className="vol"><LineIcon name="volume" /><SoapBubbleSlider className="volume-glass rex-player-bubble-slider" label="Volume" min={0} max={100} step={1} value={player.volume} onValueChange={previewVolume} onValueCommit={setVolume} from={`rgb(${tint})`} to="rgba(255,255,255,0.92)" scale={0.66} glass={0.98} iridescence={0.05} oilOpacity={0} oilCoverage={0} tint="rgba(255,255,255,0.14)" reflectivity={1.62} refraction={0.26} dispersion={0.82} /></label>
                <div className="mobile-shortcuts">
                  <button type="button" className="ico" onClick={() => setTab('lyrics')} aria-label="Open lyrics"><LineIcon name="lyrics" size={21} /></button>
                  <span><LineIcon name="headphones" size={18} /> This device</span>
                  <button type="button" className="ico" onClick={() => setTab('queue')} aria-label="Open queue"><LineIcon name="queue" size={21} /></button>
                </div>
              </section>

              <section className="fright">
                {tab !== 'queue' && (
                  <>
                    <div className="lbar">
                      <div className="karaoke-label">WORD-BY-WORD KARAOKE</div>
                      <label className="lyrics-auto-toggle"><span>Auto-scroll</span><SoapBubbleToggle checked={autoScroll} onCheckedChange={changeAutoScroll} aria-label="Auto-scroll lyrics" color="#E44765" scale={0.82} /></label>
                      <span className="nudge"><button type="button" onClick={() => setFontSize(size => Math.max(18, size - 2))}>A−</button><button type="button" onClick={() => setFontSize(size => Math.min(64, size + 2))}>A+</button></span>
                      <span className="nudge" title="Timing offset (saved for this song)"><button type="button" onClick={() => changeOffset(offset - .1)}>−</button><b>{offset.toFixed(1)}s</b><button type="button" onClick={() => changeOffset(offset + .1)}>+</button></span>
                    </div>
                    <div className="lwrap">
                      {lyricsState.loading && <p className="dim lmsg">Finding lyrics…</p>}
                      {lyricsState.error && <p className="dim lmsg">{lyricsState.error}</p>}
                      {!lyricsState.loading && !lyricsState.error && !lyrics && <div className="lyrics-empty"><span><LineIcon name="lyrics" size={27} /></span><h3>Lyrics aren’t available right now</h3><p>We’ll keep the player ready while a provider is unavailable or this track has no published lyrics.</p><button className="pill" type="button" onClick={retryLyrics}>Retry lyrics</button><small className="dim">{(lyricsState.data?.attempts ?? []).map(attempt => `${attempt.provider}: ${attempt.status.split(':')[0]}`).join(' · ')}</small></div>}
                      {lyrics && tab === 'lyrics' && <LyricsView key={`${track.videoId}-${lyrics.source}`} lyrics={lyrics} offset={offset} fontSize={fontSize} autoScroll={autoScroll} />}
                    </div>
                    {lyrics && <div className="lsrc">Source: {lyrics.attribution ?? lyrics.source} · {lyrics.sync === 'word' ? (lyrics.wordTiming === 'estimated' ? 'estimated word pacing' : 'word-synced') : lyrics.sync === 'line' ? 'line-synced' : 'not synchronized'}<button className="link" type="button" onClick={retryLyrics}>Retry</button></div>}
                  </>
                )}
                {tab === 'queue' && <div className="queue">{player.queue.map((item, index) => (
                  <button key={`${item.videoId}-${index}`} type="button" className={index === player.index ? 'cur' : ''} onClick={() => jump(index)}>
                    <img crossOrigin="anonymous" src={img(item.thumb)} alt="" /><span><b>{item.title}</b><em>{item.artist}</em></span>
                  </button>
                ))}</div>}
              </section>
            </div>
          )}

          {track && tab === 'lyrics' && (
            <div className="lyrics-dock" aria-label="Playback controls">
              <div className="lyrics-dock-progress"><span>{fmt(player.current)}</span><SoapBubbleSlider className="seek-glass rex-player-bubble-slider" label="Seek playback" min={0} max={Math.max(1, player.duration)} value={player.current} onValueCommit={seek} from={`rgb(${tint})`} to="rgba(255,255,255,0.92)" scale={0.72} glass={0.98} iridescence={0.05} oilOpacity={0} oilCoverage={0} tint="rgba(255,255,255,0.14)" reflectivity={1.62} refraction={0.26} dispersion={0.82} /><span>{fmt(player.duration)}</span></div>
              <div className="lyrics-dock-bottom">
                <button className="lyrics-dock-nav" type="button" onClick={() => setTab('player')} aria-label="Return to player" title="Player"><LineIcon name="headphones" size={21} /><span>Player</span></button>
                <div className="lyrics-dock-controls">
                  <button className="ico" type="button" onClick={prev} aria-label="Previous"><TransportIcon kind="previous" size={29} /></button>
                  <button className="playbig" type="button" onClick={toggle} aria-label={player.playing ? 'Pause' : 'Play'}><TransportIcon kind={player.playing ? "pause" : "play"} size={32} /></button>
                  <button className="ico" type="button" onClick={next} aria-label="Next"><TransportIcon kind="next" size={29} /></button>
                </div>
                <button className="lyrics-dock-nav lyrics-dock-queue" type="button" onClick={() => setTab('queue')} aria-label="Open queue" title="Queue"><LineIcon name="queue" size={21} /><span>Queue</span></button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
