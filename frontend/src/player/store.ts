import { useSyncExternalStore } from 'react';
import { api, apiUrl } from '../api';
import type { Track } from '../types';
import { safeGetItem, safeSetItem } from '../lib/storage';

type RexYtdlQuality = 'data-saver' | 'balanced' | 'high';
export interface PlayerState {
  queue: Track[]; index: number; playing: boolean; ready: boolean;
  current: number; duration: number; volume: number;
  shuffle: boolean; repeat: 'off' | 'all' | 'one'; error: string | null; liked: Set<string>;
}
const storedVolume = Number(safeGetItem('lm.volume') ?? 80);
const initialVolume = Number.isFinite(storedVolume) ? Math.max(0, Math.min(100, storedVolume)) : 80;

let state: PlayerState = {
  queue: [], index: -1, playing: false, ready: false, current: 0, duration: 0,
  volume: initialVolume, shuffle: false, repeat: 'off', error: null, liked: new Set(),
};
const subs = new Set<() => void>();
const set = (p: Partial<PlayerState>) => { state = { ...state, ...p }; subs.forEach(f => f()); };
export const usePlayer = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => state);
export const getPlayer = () => state;
export function usePlayerSel<T>(sel: (s: PlayerState) => T): T {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => sel(state));
}
export const currentTrack = (s: PlayerState = state): Track | null => s.queue[s.index] ?? null;

let audio: HTMLAudioElement | null = null;
let loadToken = 0;
let seekResumePending = false;
let seekResumeHandler: (() => void) | null = null;

function clearPendingSeekResume() {
  if (audio && seekResumeHandler) audio.removeEventListener('seeked', seekResumeHandler);
  seekResumeHandler = null;
  seekResumePending = false;
}
function updateMediaSession(playing = state.playing) {
  try {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!session) return;
    session.playbackState = playing ? 'playing' : (state.index >= 0 ? 'paused' : 'none');
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0 && typeof session.setPositionState === 'function') {
      session.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime || 0, audio.duration) });
    }
  } catch { /* Some Android browser builds expose a partial Media Session API. */ }
}
function mediaMetadata(t: Track) {
  try {
    const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    const Metadata = typeof window !== 'undefined' ? window.MediaMetadata : undefined;
    if (!session || typeof Metadata !== 'function') return;
    const artwork = t.thumb ? [96, 128, 192, 256, 384, 512].map(size => ({ src: apiUrl(`/api/img?u=${encodeURIComponent(t.thumb)}`), sizes: `${size}x${size}` })) : [];
    session.metadata = new Metadata({ title: t.title, artist: t.artist || 'Unknown artist', album: t.album ?? 'REX', artwork });
    updateMediaSession(false);
  } catch { /* Media Session is optional and may be unavailable on LAN HTTP origins. */ }
}

export function initPlayer() {
  if (audio) return;
  try { audio = new Audio(); } catch (error) {
    set({ error: `Audio is unavailable in this browser: ${(error as Error)?.message ?? 'unknown error'}` });
    return;
  }
  audio.preload = 'auto';
  audio.volume = Math.max(0, Math.min(1, state.volume / 100));
  audio.addEventListener('loadedmetadata', () => set({ ready: true, duration: Number.isFinite(audio?.duration) ? audio!.duration : state.duration }));
  audio.addEventListener('durationchange', () => set({ duration: Number.isFinite(audio?.duration) ? audio!.duration : state.duration }));
  let lastMediaPositionUpdate = 0;
  audio.addEventListener('timeupdate', () => {
    set({ current: audio?.currentTime ?? 0 });
    const now = Date.now();
    if (now - lastMediaPositionUpdate > 1000) { lastMediaPositionUpdate = now; updateMediaSession(true); }
  });
  audio.addEventListener('play', () => { set({ playing: true, error: null, ready: true }); updateMediaSession(true); });
  audio.addEventListener('pause', () => { set({ playing: false }); updateMediaSession(false); });
  audio.addEventListener('ended', () => { updateMediaSession(false); onEnded(); });
  audio.addEventListener('error', () => {
    const code = audio?.error?.code;
    const reason = code === 2 ? 'Network error while loading audio.' : code === 3 ? 'The browser could not decode this audio format.' : code === 4 ? 'No playable audio stream was returned.' : 'Audio playback failed. Try another track or refresh the stream.';
    set({ playing: false, error: reason });
  });
  try {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (ms && typeof ms.setActionHandler === 'function') {
      const on = (a: MediaSessionAction, f: MediaSessionActionHandler) => { try { ms.setActionHandler(a, f); } catch { /* unsupported action */ } };
      on('play', () => { void toggle(); }); on('pause', () => audio?.pause());
      on('previoustrack', () => prev()); on('nexttrack', () => next());
      on('seekto', d => { if (d.seekTime != null) seek(d.seekTime); });
    }
  } catch { /* LAN HTTP origins may not expose Media Session. */ }
}

/** Read the native audio clock directly for frame-synchronised lyrics. */
export const getTime = () => audio?.currentTime ?? state.current;

function waitForMetadata(element: HTMLAudioElement, token: number): Promise<void> {
  if (element.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener('loadedmetadata', ready);
      element.removeEventListener('error', failed);
      window.clearTimeout(timer);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('The browser could not read audio metadata.')); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Audio metadata timed out.')); }, 25000);
    element.addEventListener('loadedmetadata', ready, { once: true });
    element.addEventListener('error', failed, { once: true });
    if (token !== loadToken) { cleanup(); reject(new Error('Playback request was superseded.')); }
  });
}

async function openTrackStream(t: Track, token: number, position = 0, resume = true): Promise<void> {
  if (!audio) return;
  const quality = (safeGetItem('rex.audioQuality') ?? 'balanced') as RexYtdlQuality;
  audio.pause();
  clearPendingSeekResume();

  if (token !== loadToken) return;
  audio.removeAttribute('src');
  audio.load();

  const streamUrl = api.streamUrl(t.videoId, quality);
  audio.src = streamUrl;
  audio.load();

  try {
    // Start new tracks immediately. Only resumed positions wait for metadata.
    if (position > 0) {
      await waitForMetadata(audio, token);
      if (token !== loadToken) return;
      audio.currentTime = Math.min(
        position,
        Number.isFinite(audio.duration) ? audio.duration : position,
      );
    }

    if (token !== loadToken) return;
    set({
      ready: true,
      playing: false,
      error: null,
      current: audio.currentTime || position,
      duration: Number.isFinite(audio.duration) ? audio.duration : state.duration,
    });

    if (resume) {
      try {
        await audio.play();
      } catch (playError) {
        const error = playError as Error;
        const message = error?.name === 'NotAllowedError'
          ? 'Tap play to start audio (the browser blocked autoplay).'
          : `Playback could not start: ${error?.message ?? 'unknown error'}`;
        if (token === loadToken) {
          set({ playing: false, error: message });
        }
        return;
      }
    }

    if (token === loadToken) {
      set({ ready: true, playing: !audio.paused, error: null });
    }
  } catch (streamError) {
    if (token !== loadToken) return;
    const detail = streamError instanceof Error ? streamError.message : String(streamError);
    set({ ready: false, playing: false, error: `ytdl-core stream: ${detail}` });
  }
}

function load(i: number) {
  const t = state.queue[i];
  if (!t || !audio) return;
  const token = ++loadToken;
  set({ index: i, current: 0, duration: t.duration || 0, ready: false, playing: false, error: null });
  void openTrackStream(t, token, 0, true);
  mediaMetadata(t);
  api.history(t).catch(() => undefined);
}

export function playQueue(tracks: Track[], index = 0) {
  const q = tracks.filter(t => t.videoId);
  if (!q.length) return;
  set({ queue: q }); load(Math.min(index, q.length - 1));
}
export function playTrack(t: Track) {
  // Ignore incomplete catalogue rows before starting playback or requesting
  // related tracks. This prevents /api/watch/undefined and its Vercel 502.
  if (!t || typeof t.videoId !== 'string' || !t.videoId.trim()) return;
  playQueue([t], 0);
  api.watch(t.videoId).then(w => {
    if (currentTrack()?.videoId !== t.videoId || state.queue.length !== 1) return;
    const more = w.tracks.filter(x => typeof x.videoId === 'string' && x.videoId && x.videoId !== t.videoId);
    if (more.length) set({ queue: [t, ...more] });
  }).catch(() => undefined);
}
export function enqueue(t: Track, nextUp = false) {
  const q = [...state.queue]; q.splice(nextUp ? state.index + 1 : q.length, 0, t); set({ queue: q });
  if (state.index < 0) load(0);
}
export function jump(i: number) { load(i); }
export async function toggle() {
  if (!audio) initPlayer();
  if (!audio) return;
  clearPendingSeekResume();
  if (!audio.paused) audio.pause();
  else {
    try { await audio.play(); } catch (e) { set({ error: `Playback could not start: ${(e as Error).message}` }); }
  }
}
export function seek(s: number) {
  if (!audio) return;
  const target = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : s, s));
  const wasPlaying = !audio.paused || state.playing;

  clearPendingSeekResume();

  if (wasPlaying && Math.abs(audio.currentTime - target) > 0.05) {
    seekResumePending = true;
    const resumeAfterSeek = () => {
      if (seekResumeHandler !== resumeAfterSeek) return;
      audio?.removeEventListener('seeked', resumeAfterSeek);
      seekResumeHandler = null;
      if (!seekResumePending) return;
      seekResumePending = false;
      if (audio?.paused) {
        void audio.play().catch(error => {
          set({
            playing: false,
            error: `Playback could not resume after seeking: ${(error as Error)?.message ?? 'unknown error'}`,
          });
        });
      }
    };
    seekResumeHandler = resumeAfterSeek;
    audio.addEventListener('seeked', resumeAfterSeek, { once: true });
  }

  try {
    audio.currentTime = target;
    set({ current: target });
  } catch (error) {
    clearPendingSeekResume();
    set({ error: `Could not seek in this stream: ${(error as Error)?.message ?? 'unknown error'}` });
  }
}

/** Re-resolve the current track with the selected stream profile, preserving position/play state. */
export function reloadCurrentStream() {
  const t = currentTrack();
  if (!audio || !t) return;
  const position = audio.currentTime || state.current;
  const resume = !audio.paused;
  const token = ++loadToken;
  set({ ready: false, playing: false, error: null });
  void openTrackStream(t, token, position, resume);
}

/** Update the actual audio element during a drag without notifying the React tree. */
export function previewVolume(v: number) {
  const volume = Math.max(0, Math.min(100, v));
  if (audio) audio.volume = volume / 100;
}

/** Persist and publish the final volume once the user releases the slider. */
export function setVolume(v: number) {
  const volume = Math.max(0, Math.min(100, v));
  if (audio) audio.volume = volume / 100;
  safeSetItem('lm.volume', String(volume));
  set({ volume });
}
export const toggleShuffle = () => set({ shuffle: !state.shuffle });
export const cycleRepeat = () => set({ repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' });
export function next() {
  const n = state.queue.length; if (!n) return;
  if (state.shuffle && n > 1) { let r = state.index; while (r === state.index) r = Math.floor(Math.random() * n); return load(r); }
  if (state.index + 1 < n) return load(state.index + 1);
  if (state.repeat === 'all') return load(0);
}
export function prev() {
  if (getTime() > 3 || state.index <= 0) return seek(0);
  load(state.index - 1);
}
function onEnded() {
  if (state.repeat === 'one') { seek(0); void audio?.play(); return; }
  if (safeGetItem('rex.autoplay') === 'false') { set({ playing: false }); return; }
  if (state.index + 1 >= state.queue.length && state.repeat === 'off' && !state.shuffle) { set({ playing: false }); return; }
  next();
}
export async function refreshLikes() {
  try { const l = await api.library(); set({ liked: new Set(l.likes.map(t => t.videoId)) }); } catch { /* offline */ }
}
export function clearLikes() {
  set({ liked: new Set() });
}

/** Stop playback and discard the previous account's in-memory queue on sign-out. */
export function resetPlayerForSignOut() {
  loadToken += 1;
  clearPendingSeekResume();
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  try {
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
  } catch { /* Media Session is optional. */ }
  set({ queue: [], index: -1, playing: false, ready: false, current: 0, duration: 0, error: null, liked: new Set() });
}
export async function toggleLike(t: Track) {
  const r = await api.like(t); const s = new Set(state.liked);
  if (r.liked) s.add(t.videoId); else s.delete(t.videoId); set({ liked: s });
}
