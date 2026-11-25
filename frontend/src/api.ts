import type { AnimatedArtwork, Card, Track } from './types';
import { safeGetItem } from './lib/storage';
import { supabase } from './lib/supabase';

export class ApiError extends Error {}

// Empty by default: local REX keeps calling its same-origin FastAPI backend.
// Set VITE_API_BASE_URL to the public HTTPS backend origin for a split Vercel deployment.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
export const apiUrl = (path: string) => `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  const headers = new Headers(init?.headers ?? {});
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`);
    } catch { /* The auth screen will handle a missing or expired session. */ }
  }
  try { r = await fetch(apiUrl(path), { ...init, headers }); } catch { throw new ApiError('Cannot reach the Rex music server. Is it running?'); }
  if (!r.ok) {
    if (r.status === 401) void supabase?.auth.signOut();
    let msg = r.statusText;
    try { msg = (await r.json()).detail ?? msg; } catch { /* ignore */ }
    throw new ApiError(msg);
  }
  return r.json();
}
const j = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Upgrade YouTube/Google-hosted artwork for the full-screen player.
 * Catalogue cards intentionally keep their compact thumbnails; only the player
 * asks Google for a large rendition so we never paint a tiny tile across the screen.
 */
export const highResolutionArtworkUrl = (u?: string, width = 1600) => {
  if (!u) return '';
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('googleusercontent.com') || host.endsWith('ggpht.com')) {
      const resizeSuffix = /=(?:w\d+-h\d+|s\d+)(?:-[^/]+)?$/i;
      if (resizeSuffix.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(resizeSuffix, `=w${width}-h${width}-l90-rj`);
      } else {
        parsed.pathname += `=w${width}-h${width}-l90-rj`;
      }
      return parsed.toString();
    }
    if (host === 'i.ytimg.com') {
      // Prefer YouTube's max-resolution thumbnail when the source is a standard
      // video thumbnail. If it is unavailable, the caller keeps a high-res URL;
      // it never falls back to the compact hqdefault/mqdefault rendition.
      parsed.pathname = parsed.pathname.replace(/\/(?:default|mqdefault|hqdefault|sddefault)\.(?:jpg|webp)$/i, '/maxresdefault.jpg');
      return parsed.toString();
    }
    return u;
  } catch {
    return u;
  }
};

/** Artwork always goes through the backend proxy so WebGL texture capture is never cross-origin tainted. */
export const img = (u?: string) => (u ? apiUrl(`/api/img?u=${encodeURIComponent(u)}`) : '');

/**
 * Retry only large artwork renditions. Never switch a failed full-player image
 * back to the small catalogue thumbnail: that caused the sharp-then-blurry flash.
 * The lowest retry remains 1200px; non-Google sources are not silently downgraded.
 */
export const recoverHighResolutionArtwork = (image: HTMLImageElement, original?: string) => {
  if (!original || image.dataset.rexArtworkRetrying === '1') return;
  const currentWidth = Number(image.dataset.rexArtworkWidth || '1600');
  const nextWidth = currentWidth > 1440 ? 1440 : currentWidth > 1200 ? 1200 : 0;
  if (!nextWidth) {
    image.dataset.rexArtworkHighResFailed = '1';
    return;
  }
  const currentUrl = highResolutionArtworkUrl(original, currentWidth);
  const nextUrl = highResolutionArtworkUrl(original, nextWidth);
  if (!nextUrl || nextUrl === currentUrl) {
    image.dataset.rexArtworkHighResFailed = '1';
    return;
  }
  image.dataset.rexArtworkRetrying = '1';
  image.dataset.rexArtworkWidth = String(nextWidth);
  image.src = img(nextUrl);
  image.dataset.rexArtworkRetrying = '0';
};

/** Keep small artwork visible in compact lists when their optional image proxy fails. */
export const recoverImage = (image: HTMLImageElement, original?: string) => {
  if (!original || image.dataset.directFallback === '1') return;
  image.dataset.directFallback = '1';
  image.removeAttribute('crossorigin');
  image.src = original;
};

export const api = {
  auth: {
    register: (username: string, password: string) => req<{ email: string; username: string; recoveryCode: string }>('/api/auth/register', j('POST', { username, password })),
    recover: (username: string, recoveryCode: string, newPassword: string) => req<{ email: string; username: string; recoveryCode: string }>('/api/auth/recover', j('POST', { username, recoveryCode, newPassword })),
    me: () => req<{ profile: { id: string; username: string; displayName: string; avatar: string } }>('/api/auth/me'),
  },
  health: () => req<{ ok: boolean; service: string; database: 'ready' | 'unavailable'; streaming: 'ready' | 'unavailable'; engine: string }>('/api/health'),
  search: (q: string, filter?: string) => req<{ results: (Track | Card)[] }>(`/api/search?q=${encodeURIComponent(q)}${filter && filter !== 'all' ? `&filter=${filter}` : ''}`),
  suggest: (q: string) => req<{ suggestions: string[] }>(`/api/suggest?q=${encodeURIComponent(q)}`),
  searchHistory: () => req<{ history: string[] }>('/api/search/history'),
  clearSearchHistory: () => req<{ ok: boolean }>('/api/search/history', { method: 'DELETE' }),
  home: () => req<{ shelves: { title: string; items: (Track | Card)[] }[]; charts: { songs: Track[]; artists: Card[] } | null; moods: { title: string; params: string }[] }>('/api/home'),
  mood: (p: string, title = "") => req<{ results: Card[] }>(`/api/mood?params=${encodeURIComponent(p)}&title=${encodeURIComponent(title)}`),
  album: (id: string) => req<{ id: string; title: string; artist: string; year?: string; thumb: string; tracks: Track[] }>(`/api/album/${id}`),
  artist: (id: string, name = "") => req<{ id: string; name: string; description: string; thumb: string; subscribers: string; monthlyListeners: string; popular: Track[]; songs: Track[]; albums: Card[]; singles: Card[]; videos: Track[]; related: Card[] }>(`/api/artist/${encodeURIComponent(id)}${name.trim() ? `?name=${encodeURIComponent(name.trim())}` : ""}`),
  playlist: (id: string) => req<{ id: string; title: string; author: string; thumb: string; tracks: Track[] }>(`/api/playlist/${id}`),
  watch: (id: string) => req<{ tracks: Track[] }>(`/api/watch/${id}`),
  playable: (id: string) => req<{ playable: boolean; reason: string }>(`/api/playable/${id}`),
  animatedArtwork: (artist: string, album: string, title?: string) => req<AnimatedArtwork>(`/api/artwork/animated?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}${title ? `&title=${encodeURIComponent(title)}` : ''}`),
  streamUrl: (id: string, quality = safeGetItem('rex.audioQuality') ?? 'balanced') => apiUrl(`/api/stream/${encodeURIComponent(id)}?quality=${encodeURIComponent(quality)}`),  
  lyrics: (t: Track, refresh = false) => req<import('./types').LyricsResponse>(
    `/api/lyrics?videoId=${t.videoId}&title=${encodeURIComponent(t.title)}&artist=${encodeURIComponent(t.artist)}&album=${encodeURIComponent(t.album ?? '')}&duration=${t.duration}${refresh ? '&refresh=true' : ''}`),
  library: () => req<{ likes: Track[]; recent: Track[]; playlists: { id: string; name: string; count: number }[]; saved: Record<string, Card[]> }>('/api/library'),
  like: (t: Track) => req<{ liked: boolean }>('/api/library/like', j('POST', t)),
  history: (t: Track) => req('/api/library/history', j('POST', t)),
  toggleSaved: (kind: string, id: string, data: Card) => req<{ saved: boolean }>('/api/library/saved', j('POST', { kind, id, data })),
  createPlaylist: (name: string) => req<{ id: string }>('/api/playlists', j('POST', { name })),
  localPlaylist: (id: string) => req<{ id: string; name: string; tracks: Track[] }>(`/api/playlists/${id}`),
  renamePlaylist: (id: string, name: string) => req(`/api/playlists/${id}`, j('PATCH', { name })),
  deletePlaylist: (id: string) => req(`/api/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (id: string, t: Track) => req(`/api/playlists/${id}/items`, j('POST', t)),
  removeFromPlaylist: (id: string, vid: string) => req(`/api/playlists/${id}/items/${vid}`, { method: 'DELETE' }),
  reorder: (id: string, videoIds: string[]) => req(`/api/playlists/${id}/order`, j('PUT', { videoIds })),
  settings: () => req<Record<string, unknown>>('/api/settings'),
  saveSettings: (s: Record<string, unknown>) => req('/api/settings', j('PUT', s)),
  getOffset: (id: string) => req<{ offset: number }>(`/api/offset/${id}`),
  putOffset: (id: string, offset: number) => req(`/api/offset/${id}`, j('PUT', { offset })),
};
