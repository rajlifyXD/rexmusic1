import { motion } from 'motion/react';
import BubbleButton from './BubbleButton';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, img } from '../api';
import { currentTrack, enqueue, playQueue, playTrack, toggleLike, usePlayer } from '../player/store';
import { type Entity, type Track, isTrack } from '../types';

export const go = (p: string) => { location.hash = '#' + p; };
export const fmt = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');

/** BlurText-style word reveal (motion). Inspired by React Bits' BlurText; implemented locally with `motion`. */
export function BlurText({ text, className }: { text: string; className?: string }) {
  return (
    <h1 className={className} aria-label={text}>
      {text.split(' ').map((w, i) => (
        <motion.span key={i} style={{ display: 'inline-block', marginRight: '0.28em' }}
          initial={{ opacity: 0, filter: 'blur(12px)', y: 18 }} animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{ delay: i * 0.09, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>{w}</motion.span>
      ))}
    </h1>
  );
}

export function Fade({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '40px' }} transition={{ duration: 0.5, delay }}>{children}</motion.div>;
}

export const Skeleton = ({ n = 6 }: { n?: number }) => (
  <div className="row-scroll">{Array.from({ length: n }, (_, i) => <div key={i} className="tile skel"><div className="art" /><i /><i className="s" /></div>)}</div>
);
export const ErrorBox = ({ msg, retry }: { msg: string; retry?: () => void }) => (
  <div className="notice"><b>Something went wrong</b><p>{msg}</p>{retry && <BubbleButton className="pill" onClick={retry}>Try again</BubbleButton>}</div>
);

// ---- add to playlist modal (tiny global store) ----
let modal: Track | null = null;
const ms = new Set<() => void>();
export const openAddTo = (t: Track) => { modal = t; ms.forEach(f => f()); };
export function AddToPlaylist() {
  const t = useSyncExternalStore(f => { ms.add(f); return () => ms.delete(f); }, () => modal);
  const [lists, setLists] = useState<{ id: string; name: string; count: number }[]>([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!t) return;
    let active = true;
    setMsg('');
    setName('');
    setLoading(true);
    api.library()
      .then(l => { if (active) setLists(l.playlists); })
      .catch(e => { if (active) setMsg(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);
  if (!t) return null;
  const close = () => { modal = null; ms.forEach(f => f()); };
  const add = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      await api.addToPlaylist(id, t);
      window.dispatchEvent(new Event('rex-library-updated'));
      close();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    const cleanName = name.trim();
    if (!cleanName || busy) return;
    setBusy(true);
    setMsg('');
    try {
      const p = await api.createPlaylist(cleanName);
      await api.addToPlaylist(p.id, t);
      window.dispatchEvent(new Event('rex-library-updated'));
      close();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-bg rex-add-playlist-bg" onClick={close}>
      <div className="modal rex-add-playlist-modal" role="dialog" aria-modal="true" aria-labelledby="rex-add-playlist-title" onClick={e => e.stopPropagation()}>
        <header className="rap-header">
          <div className="rap-heading">
            <span className="rap-eyebrow">REX LIBRARY</span>
            <h3 id="rex-add-playlist-title">Add to playlist</h3>
            <p>{t.title}<span> · {t.artist}</span></p>
          </div>
          <button className="rap-close" type="button" onClick={close} aria-label="Close">×</button>
        </header>

        <section className="rap-existing" aria-label="Existing playlists">
          <div className="rap-section-heading">
            <span>Your playlists</span>
            <small>{loading ? 'LOADING' : `${lists.length} ${lists.length === 1 ? 'PLAYLIST' : 'PLAYLISTS'}`}</small>
          </div>
          <div className="rap-playlist-list">
            {loading && <div className="rap-empty">Loading your playlists…</div>}
            {!loading && lists.map((list, index) => (
              <button className="rap-playlist-row" type="button" key={list.id} onClick={() => add(list.id)} disabled={busy}>
                <span className={`rap-playlist-cover rap-cover-${index % 6}`} aria-hidden="true"><i>♫</i></span>
                <span className="rap-playlist-copy"><b>{list.name}</b><small>{list.count} {list.count === 1 ? 'song' : 'songs'}</small></span>
                <span className="rap-playlist-add" aria-hidden="true">+</span>
              </button>
            ))}
            {!loading && !lists.length && <div className="rap-empty">No playlists yet. Create one below to get started.</div>}
          </div>
        </section>

        <section className="rap-create-section" aria-label="Create a new playlist">
          <div className="rap-create-heading">
            <span className="rap-create-symbol" aria-hidden="true">＋</span>
            <span><b>Create new playlist</b><small>A fresh place for this track</small></span>
          </div>
          <div className="rap-create-field">
            <input className="rap-name-input" value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Give your playlist a name" aria-label="New playlist name" onKeyDown={e => e.key === 'Enter' && create()} disabled={busy} />
            <button className="rap-create-button" type="button" onClick={create} disabled={!name.trim() || busy}>{busy ? 'Adding…' : 'Create'}</button>
          </div>
        </section>
        {msg && <p className="rap-error" role="alert">{msg}</p>}
      </div>
    </div>
  );
}

export function Tile({ e, onPlay }: { e: Entity; onPlay?: () => void }) {
  const t = isTrack(e);
  const click = () => (t ? onPlay?.() : go(`/${e.type}/${encodeURIComponent(e.id)}`));
  const title = e.title, sub = t ? e.artist : e.subtitle;
  return (
    <motion.button className={`tile ${!t && e.type === 'artist' ? 'round' : ''}`} onClick={click} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }}>
      <div className="art">{e.thumb && <img loading="lazy" crossOrigin="anonymous" src={img(e.thumb)} alt="" />}</div>
      <b>{title}</b><span>{sub}</span>
    </motion.button>
  );
}

export function Shelf({ title, items, onPlayTrack }: { title: string; items: Entity[]; onPlayTrack?: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <Fade><section className="shelf"><h2>{title}</h2>
      <div className="row-scroll">{items.map((e, i) => <Tile key={(isTrack(e) ? e.videoId : e.id) + i} e={e} onPlay={() => onPlayTrack?.(i)} />)}</div>
    </section></Fade>
  );
}

type TrackAction = { label: string; onSelect: () => void };

function TrackActionsMenu({ items }: { items: TrackAction[] }) {
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const root = details.current;
      if (root?.open && !root.contains(event.target as Node)) root.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && details.current?.open) {
        details.current.open = false;
        details.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <details ref={details} className="track-actions-menu">
      <summary className="ico" aria-label="More track actions" title="More actions">⋯</summary>
      <div className="ctx" role="menu">
        {items.map((item) => (
          <button key={item.label} type="button" role="menuitem" onClick={() => {
            if (details.current) details.current.open = false;
            item.onSelect();
          }}>{item.label}</button>
        ))}
      </div>
    </details>
  );
}

export function TrackRow({ t, i, list, playlistId, onRemove, onMove }: {
  t: Track; i: number; list: Track[]; playlistId?: string; onRemove?: () => void; onMove?: (d: -1 | 1) => void;
}) {
  const p = usePlayer();
  const cur = currentTrack(p)?.videoId === t.videoId;
  const currentTrackPlaying = cur && p.playing;
  const liked = p.liked.has(t.videoId);
  const [likePulse, setLikePulse] = useState(false);
  const likePulseTimer = useRef<number | null>(null);
  const pulseLike = () => {
    setLikePulse(false);
    window.requestAnimationFrame(() => setLikePulse(true));
    if (likePulseTimer.current !== null) window.clearTimeout(likePulseTimer.current);
    likePulseTimer.current = window.setTimeout(() => setLikePulse(false), 540);
  };
  useEffect(() => () => { if (likePulseTimer.current !== null) window.clearTimeout(likePulseTimer.current); }, []);
  void playlistId;
  const menuItems = [
    { label: 'Play next', onSelect: () => enqueue(t, true) },
    { label: 'Add to queue', onSelect: () => enqueue(t) },
    { label: 'Add to playlist…', onSelect: () => openAddTo(t) },
    ...(t.artistId ? [{ label: 'Go to artist', onSelect: () => go(`/artist/${t.artistId}`) }] : []),
    ...(t.albumId ? [{ label: 'Go to album', onSelect: () => go(`/album/${t.albumId}`) }] : []),
    { label: 'Open in YouTube Music', onSelect: () => window.open(`https://music.youtube.com/watch?v=${t.videoId}`, '_blank') },
    ...(onMove ? [
      { label: 'Move up', onSelect: () => onMove(-1) },
      { label: 'Move down', onSelect: () => onMove(1) },
    ] : []),
    ...(onRemove ? [{ label: 'Remove from playlist', onSelect: onRemove }] : []),
  ];
  return (
    <div className={`trow ${cur ? 'cur' : ''}`}>
      <button className="tmain" onClick={() => (list.length === 1 ? playTrack(t) : playQueue(list, i))}>
        <span className="num">{currentTrackPlaying ? '♪' : i + 1}</span>
        {t.thumb ? <img crossOrigin="anonymous" loading="lazy" src={img(t.thumb)} alt="" /> : <span className="ph" />}
        <span className="tt"><b>{t.title}</b><em>{t.artist}{t.album ? ` · ${t.album}` : ''}</em></span>
        <span className="dur">{fmt(t.duration)}</span>
      </button>
      <BubbleButton className={`ico rex-like-action ${liked ? 'liked' : ''} ${likePulse ? 'is-popping' : ''}`} aria-label={liked ? 'Unlike track' : 'Like track'} onClick={() => { pulseLike(); void toggleLike(t); }}><span className="rex-like-glyph">{liked ? '♥' : '♡'}</span></BubbleButton>
      <div className="menuwrap">
        <TrackActionsMenu items={menuItems} />
      </div>
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    set({ loading: true });
    fn().then(data => !dead && set({ data, loading: false })).catch(e => !dead && set({ error: e.message, loading: false }));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...s, retry: () => setN(x => x + 1), setData: (d: T) => set({ data: d, loading: false }) };
}

export function Actions({ tracks, extra }: { tracks: Track[]; extra?: ReactNode }) {
  return (
    <div className="actions">
      <BubbleButton className="pill primary" onClick={() => playQueue(tracks, 0)}>▶ Play</BubbleButton>
      <BubbleButton className="pill" onClick={() => { const s = [...tracks].sort(() => Math.random() - 0.5); playQueue(s, 0); }}>⤮ Shuffle</BubbleButton>
      {extra}
    </div>
  );
}
