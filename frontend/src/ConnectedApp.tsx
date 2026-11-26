import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft, AudioLines, Check, ChevronRight, Clock3, Disc3, Download, Globe2, Heart, HeartHandshake, Headphones,
  Home, Info, ListMusic, Maximize2, Minimize2, MoreHorizontal, Pause, Play,
  Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, X, Copy, ExternalLink, type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { api, img } from './api';
import AuthScreen, { RecoveryCodeNotice } from './components/AuthScreen';
import { supabase, supabaseConfigured, type RexSession } from './lib/supabase';
import type { Track as RexTrack, Card as RexCard, Entity as RexEntity } from './types';
import { isTrack } from './types';
import { safeGetItem, safeSetItem } from './lib/storage';
import { initPlayer, playQueue, playTrack, refreshLikes, reloadCurrentStream, resetPlayerForSignOut, toggle, usePlayerSel } from './player/store';
import AppShell from './components/AppShell';
import FullPlayer from './pages/FullPlayer';
import PlayerErrorBoundary from './components/PlayerErrorBoundary';
import RexBubbleMaterial from './components/RexBubbleMaterial';
import { AddToPlaylist, openAddTo } from './components/ui';
import { SoapBubbleButton, SoapBubbleSlider, SoapBubbleToggle } from './components/soap-bubble';

type PageId = 'home' | 'discover' | 'library' | 'settings' | 'about' | 'loading' | 'not-found' | 'detail';
type Route = { page: PageId; path: string; detailKind?: 'album' | 'artist' | 'playlist' | 'mine' | 'mood'; detailId?: string };
type BackendHome = Awaited<ReturnType<typeof api.home>>;
type BackendLibrary = Awaited<ReturnType<typeof api.library>>;
type AvatarDef = { id: string; label: string; colors: [string, string, string]; motif: string; image?: string };

const AVATARS: AvatarDef[] = [
  { id: 'rex-portrait-01', label: 'Golden Bloom', colors: ['#3a241a', '#b97840', '#f6cf91'], motif: 'bloom', image: '/avatars/rex-portrait-01.webp' },
  { id: 'rex-portrait-02', label: 'Audiophile', colors: ['#210d16', '#89303c', '#e99a77'], motif: 'pulse', image: '/avatars/rex-portrait-02.webp' },
  { id: 'rex-portrait-03', label: 'Soft Rhythm', colors: ['#241a18', '#996d57', '#f2d6c1'], motif: 'wave', image: '/avatars/rex-portrait-03.webp' },
  { id: 'rex-portrait-04', label: 'Saffron', colors: ['#281a18', '#a65a3d', '#f2c0a4'], motif: 'bloom', image: '/avatars/rex-portrait-04.webp' },
  { id: 'rex-portrait-05', label: 'Midnight', colors: ['#180f20', '#63517f', '#d5c0ed'], motif: 'orbit', image: '/avatars/rex-portrait-05.webp' },
  { id: 'rex-portrait-06', label: 'Guitarist', colors: ['#241a15', '#9a5631', '#f0c79b'], motif: 'pulse', image: '/avatars/rex-portrait-06.webp' },
  { id: 'rex-portrait-07', label: 'Peach', colors: ['#2e1b1c', '#bb7569', '#f5c9bc'], motif: 'star', image: '/avatars/rex-portrait-07.webp' },
  { id: 'rex-portrait-08', label: 'Crimson', colors: ['#3a1018', '#9e2632', '#f2a078'], motif: 'orbit', image: '/avatars/rex-portrait-08.webp' },
];

function readStore<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}
function writeStore(key: string, value: unknown) {
  try {
    const remember = key === 'rex.preview.remember' || key === 'rex.preview.cookies' || readStore('rex.preview.remember', true);
    if (remember) window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* Storage can be unavailable in private browsing. */ }
}
function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  const displayMode = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return Boolean(displayMode || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}
function routeFromHash(): Route {
  const hashValue = window.location.hash.replace(/^#/, '') || '/';
  const [rawPathPart, ...queryParts] = hashValue.split('?');
  const rawPath = (rawPathPart || '/').replace(/\/$/, '') || '/';
  const routeKey = rawPath + (queryParts.length ? `?${queryParts.join('?')}` : '');
  let path = rawPath;
  try { path = decodeURI(rawPath); } catch { /* Keep the raw route if malformed. */ }
  if (path === '/') return { page: 'home', path: routeKey };
  if (path === '/discover' || path === '/search') return { page: 'discover', path: '/search' };
  if (path === '/library') return { page: 'library', path: routeKey };
  if (path === '/settings') return { page: 'settings', path: routeKey };
  if (path === '/about') return { page: 'about', path: routeKey };
  if (path === '/loading') return { page: 'loading', path: routeKey };
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2 && ['album', 'artist', 'playlist', 'mine', 'mood'].includes(parts[0])) {
    return { page: 'detail', path: routeKey, detailKind: parts[0] as Route['detailKind'], detailId: parts.slice(1).join('/') };
  }
  return { page: 'not-found', path: routeKey };
}
function durationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}
/** Smaller artwork renditions for catalogue UI only. FullPlayer uses its own
 * high-resolution artwork pipeline and never calls this helper. */
function catalogueArtworkUrl(u: string): string {
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('googleusercontent.com') || host.endsWith('ggpht.com')) {
      const match = parsed.pathname.match(/=w(\d+)-h(\d+)(?:-[^/]*)?$/i);
      if (!match || Number(match[1]) > 320 || Number(match[2]) > 320) {
        if (match) parsed.pathname = parsed.pathname.replace(/=w\d+-h\d+(?:-[^/]*)?$/i, '=w320-h320-l80-rj');
        else parsed.pathname += '=w320-h320-l80-rj';
      }
    } else if (host === 'i.ytimg.com') {
      // A 480×360 catalogue thumbnail is ample for the small cards and rows.
      parsed.pathname = parsed.pathname.replace(/\/(?:maxresdefault|sddefault|mqdefault)\.(?:jpg|webp)$/i, '/hqdefault.jpg');
    } else if (host.endsWith('mzstatic.com')) {
      parsed.pathname = parsed.pathname.replace(/\/(?:\d{2,4})x(?:\d{2,4})bb(?=\.)/i, '/320x320bb');
    }
    return parsed.toString();
  } catch {
    return u;
  }
}
function asset(u?: string) { return u ? img(catalogueArtworkUrl(u)) : ''; }
function firstTrack(items: RexEntity[]): RexTrack | undefined { return items.find(isTrack) as RexTrack | undefined; }
function allHomeTracks(home: BackendHome | null): RexTrack[] {
  if (!home) return [];
  const merged = [...home.shelves.flatMap(shelf => shelf.items), ...(home.charts?.songs ?? [])];
  const seen = new Set<string>();
  return merged.filter(isTrack).filter(track => { if (seen.has(track.videoId)) return false; seen.add(track.videoId); return true; }) as RexTrack[];
}

function Avatar({ id, size = 44 }: { id: string; size?: number }) {
  const avatar = AVATARS.find(item => item.id === id) ?? AVATARS[0];
  if (avatar.image) {
    // The provided portraits are square illustrations. A circular mask clips
    // their corners, even with object-fit: contain. Use a soft squircle frame.
    const corner = `${Math.round(size * 0.18)}px`;
    return (
      <span
        className="rx-avatar rx-avatar-artwork"
        role="img"
        aria-label={`${avatar.label} profile picture`}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          aspectRatio: '1 / 1',
          flex: `0 0 ${size}px`,
          display: 'block',
          overflow: 'hidden',
          borderRadius: corner,
          boxSizing: 'border-box',
          background: 'rgba(255,255,255,.045)',
          lineHeight: 0,
        }}
      >
        <img
          src={avatar.image}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            maxWidth: '100%',
            maxHeight: '100%',
            margin: 0,
            padding: 0,
            border: 0,
            objectFit: 'contain',
            objectPosition: 'center',
            aspectRatio: '1 / 1',
            borderRadius: corner,
            transform: 'none',
          }}
        />
      </span>
    );
  }
  const [deep, mid, light] = avatar.colors;
  const bgId = `avatar-bg-${id}`; const lineId = `avatar-line-${id}`;
  return <span className={`rx-avatar rx-avatar-graphic motif-${avatar.motif}`} role="img" aria-label={`${avatar.label} graphic profile`} style={{ width: size, height: size, aspectRatio: '1 / 1', '--avatar-deep': deep, '--avatar-mid': mid, '--avatar-light': light } as CSSProperties}>
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs><radialGradient id={bgId} cx="30%" cy="24%" r="90%"><stop offset="0%" stopColor={light}/><stop offset="42%" stopColor={mid}/><stop offset="100%" stopColor={deep}/></radialGradient><linearGradient id={lineId} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={light}/><stop offset="100%" stopColor={mid}/></linearGradient></defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${bgId})`}/><circle cx="50" cy="50" r="39" fill="none" stroke={light} strokeOpacity=".22" strokeWidth=".9"/>
      {avatar.motif === 'orbit' && <><ellipse cx="50" cy="50" rx="37" ry="17" fill="none" stroke={light} strokeWidth="4" transform="rotate(-34 50 50)"/><ellipse cx="50" cy="50" rx="18" ry="38" fill="none" stroke={light} strokeOpacity=".55" strokeWidth="2" transform="rotate(32 50 50)"/><circle cx="72" cy="25" r="7" fill="#fff"/></>}
      {avatar.motif === 'wave' && <><path d="M8 56 C20 16 32 16 44 56 S68 96 80 56 S92 16 100 48" fill="none" stroke={light} strokeWidth="7" strokeLinecap="round"/><path d="M5 70 C20 45 31 45 45 70 S70 94 86 66" fill="none" stroke="#fff" strokeOpacity=".42" strokeWidth="2"/></>}
      {avatar.motif === 'star' && <><path d="M50 10 L59 39 L90 50 L59 61 L50 90 L41 61 L10 50 L41 39Z" fill={light}/><circle cx="50" cy="50" r="10" fill={deep}/><circle cx="77" cy="22" r="4" fill="#fff"/></>}
      {avatar.motif === 'bloom' && <><g fill={light} fillOpacity=".76">{Array.from({ length: 8 }, (_, i) => <ellipse key={i} cx="50" cy="29" rx="10" ry="21" transform={`rotate(${i * 45} 50 50)`}/>)}</g><circle cx="50" cy="50" r="13" fill="#fff" fillOpacity=".85"/><circle cx="50" cy="50" r="7" fill={mid}/></>}
      {avatar.motif === 'flare' && <><circle cx="50" cy="50" r="25" fill={light} fillOpacity=".9"/><g stroke={light} strokeWidth="4" strokeLinecap="round">{Array.from({ length: 12 }, (_, i) => <line key={i} x1="50" y1="7" x2="50" y2="16" transform={`rotate(${i * 30} 50 50)`}/>)}</g><circle cx="50" cy="50" r="12" fill="#fff" fillOpacity=".55"/></>}
      {avatar.motif === 'moon' && <><circle cx="45" cy="48" r="29" fill={light}/><circle cx="60" cy="37" r="27" fill={deep}/><circle cx="73" cy="68" r="5" fill="#fff"/><circle cx="27" cy="25" r="3" fill="#fff"/></>}
      {avatar.motif === 'pulse' && <><path d="M8 54 H25 L35 30 L47 76 L61 39 L70 57 H92" fill="none" stroke={light} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="47" cy="76" r="5" fill="#fff"/></>}
      {avatar.motif === 'signal' && <><g fill={light}>{[18, 31, 44, 57, 70].map((x, i) => <rect key={x} x={x} y={46 - [12, 23, 34, 23, 12][i] / 2} width="7" height={[12, 23, 34, 23, 12][i]} rx="3.5"/>)}</g><circle cx="50" cy="50" r="39" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="1.3"/></>}
      <circle cx="50" cy="50" r="48" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="2"/>
    </svg>
  </span>;
}

function BubbleAction({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return <SoapBubbleButton {...props} className={`rx-bubble-action ${className}`.trim()} glass={1.02} tint="rgba(255,255,255,.035)" iridescence={0.012} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={1.7} refraction={0.42} dispersion={0.9} bevel={10} wobble={0.28}>{children}</SoapBubbleButton>;
}

function ProfileMenu({ username, avatar, onSave, onLogout, close, navigate }: { username: string; avatar: string; onSave: (name: string, avatar: string) => Promise<void>; onLogout: () => void; close: () => void; navigate: (path: string) => void }) {
  const [draft, setDraft] = useState(username); const [selectedAvatar, setSelectedAvatar] = useState(() => AVATARS.some(item => item.id === avatar) ? avatar : AVATARS[0].id); const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await onSave(draft.trim() || 'Listener', selectedAvatar); close(); } finally { setSaving(false); } };
  return <div className="rx-modal-backdrop" onMouseDown={close}>
    <motion.section className="rx-profile-sheet" role="dialog" aria-modal="true" aria-label="Your profile" onMouseDown={event => event.stopPropagation()} initial={{ opacity: 0, y: 28, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .99 }} transition={{ type: 'spring', stiffness: 340, damping: 30 }}>
      <div className="rx-sheet-handle"/><div className="rx-sheet-title"><div><span>PROFILE</span><h2>Your REX profile</h2></div><button className="rx-round-icon" onClick={close} aria-label="Close"><X size={18}/></button></div>
      <div className="rx-profile-preview"><Avatar id={selectedAvatar} size={104}/><div><b>{draft || 'Listener'}</b><small>Profile saved with your REX library</small></div></div>
      <label className="rx-input-label" htmlFor="rx-display-name">Display name</label><input id="rx-display-name" className="rx-input" maxLength={24} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Your name"/>
      <span className="rx-input-label rx-avatar-label">Choose a profile picture</span>
      <div className="rx-avatar-options">{AVATARS.map(item => <button key={item.id} className={selectedAvatar === item.id ? 'selected' : ''} onClick={() => setSelectedAvatar(item.id)} aria-label={`Choose ${item.label}`}><Avatar id={item.id} size={64}/>{selectedAvatar === item.id && <i><Check size={12}/></i>}</button>)}</div>
      <div className="rx-profile-sheet-links"><button onClick={() => { close(); navigate('/about'); }}><Info size={17}/> About REX <ChevronRight size={16}/></button><button onClick={() => { close(); onLogout(); }}><ArrowLeft size={17}/> Sign out <ChevronRight size={16}/></button></div>
      <BubbleAction className="rx-sheet-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'} <Check size={16}/></BubbleAction>
    </motion.section>
  </div>;
}

function FullscreenAction({ onToggleFullscreen, isFullscreen }: { onToggleFullscreen: () => void; isFullscreen: boolean }) {
  return <button type="button" className="rx-header-icon rx-fullscreen-icon" onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>{isFullscreen ? <Minimize2 size={18} strokeWidth={1.8}/> : <Maximize2 size={18} strokeWidth={1.8}/>}</button>;
}
function HeaderActions({ username, avatar, onProfile, onToggleFullscreen, isFullscreen }: { username: string; avatar: string; onProfile: () => void; onToggleFullscreen: () => void; isFullscreen: boolean }) {
  return <div className="rx-header-actions"><FullscreenAction onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/><button className="rx-profile-button" onClick={onProfile} aria-label={`Open ${username}'s profile`}><Avatar id={avatar} size={48}/></button></div>;
}

function HomePage({ username, avatar, onProfile, navigate, onToggleFullscreen, isFullscreen, home, library, homeLoading, homeError, onPlay, onRetry }: {
  username: string; avatar: string; onProfile: () => void; navigate: (path: string) => void; onToggleFullscreen: () => void; isFullscreen: boolean;
  home: BackendHome | null; library: BackendLibrary | null; homeLoading: boolean; homeError: string; onPlay: (t: RexTrack) => void; onRetry: () => void;
}) {
  const greeting = new Date().getHours() < 12 ? 'Good Morning,' : new Date().getHours() < 18 ? 'Good Afternoon,' : 'Good Evening,';
  const firstName = username.trim().split(/\s+/)[0] || 'Listener';
  const recents = library?.recent ?? [];
  const discovery = allHomeTracks(home).slice(0, 12);
  const featureCandidates = [...recents, ...discovery, ...(home?.charts?.songs ?? [])];
  const seenFeatureIds = new Set<string>();
  const featureItems = featureCandidates.filter(track => { if (seenFeatureIds.has(track.videoId)) return false; seenFeatureIds.add(track.videoId); return true; }).slice(0, 3);
  const [featureIndex, setFeatureIndex] = useState(0);
  const featureRail = useRef<HTMLDivElement>(null);
  useEffect(() => { setFeatureIndex(0); if (featureRail.current) featureRail.current.scrollLeft = 0; }, [featureItems.map(track => track.videoId).join('|')]);
  const syncFeatureIndex = () => { const rail = featureRail.current; if (rail) setFeatureIndex(Math.max(0, Math.min(featureItems.length - 1, Math.round(rail.scrollLeft / Math.max(1, rail.clientWidth))))); };
  const featured = featureItems[featureIndex] ?? featureItems[0];
  return <div className="rx-page rx-home-page">
    <header className="rx-home-header"><button className="rx-wordmark" onClick={() => navigate('/')} aria-label="REX home">REX<span/></button><HeaderActions username={username} avatar={avatar} onProfile={onProfile} onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/></header>
    <section className="rx-home-greeting"><span>{greeting}</span><h1>{firstName}<i>.</i></h1><p>What are we listening to today?</p></section>
    {featured ? <><div className="rx-feature-carousel" ref={featureRail} onScroll={syncFeatureIndex} aria-label="Pick up where you left off">{featureItems.map((track, index) => <motion.button key={track.videoId} className="rx-feature-card" onClick={() => onPlay(track)} whileTap={{ scale: .985 }} transition={{ type: 'spring', stiffness: 420, damping: 24 }}>
      <img crossOrigin="anonymous" src={asset(track.thumb)} alt={`${track.title} cover artwork`} loading={index === 0 ? 'eager' : 'lazy'} decoding="async" /><span className="rx-feature-shade"/><span className="rx-feature-copy"><small>{recents.some(item => item.videoId === track.videoId) ? 'PICK UP WHERE YOU LEFT OFF' : 'FROM YOUR DISCOVERY'}</small><b>{track.title}</b><em>{track.artist}</em><span className="rx-feature-play"><i><Play size={16} fill="currentColor"/></i> Play Now</span></span></motion.button>)}</div><div className="rx-feature-dots">{featureItems.map((track, index) => <button key={track.videoId} className={index === featureIndex ? 'active' : ''} aria-label={`Show featured track ${index + 1}`} onClick={() => featureRail.current?.scrollTo({ left: featureRail.current.clientWidth * index, behavior: 'smooth' })}/>)}</div></> : <div className="rx-feature-empty"><Sparkles size={23}/><b>Your next favourite is waiting.</b><span>Search the catalogue and start a new queue.</span><BubbleAction onClick={() => navigate('/search')}>Discover music <ChevronRight size={15}/></BubbleAction></div>}
    <section className="rx-quick-grid" aria-label="Your music shortcuts">
      <motion.button className="rx-quick-action" onClick={() => navigate('/library?tab=liked')} whileTap={{ scale: .96 }}><span className="rx-quick-icon"><Heart size={21} strokeWidth={1.8}/></span><span className="rx-quick-copy"><b>Liked Songs</b><small>{library?.likes.length ?? 0} saved tracks</small></span><ChevronRight size={17} className="rx-quick-chevron"/></motion.button>
      <motion.button className="rx-quick-action" onClick={() => navigate('/library?tab=playlists')} whileTap={{ scale: .96 }}><span className="rx-quick-icon"><ListMusic size={21} strokeWidth={1.8}/></span><span className="rx-quick-copy"><b>Your Playlists</b><small>{library?.playlists.length ?? 0} collections</small></span><ChevronRight size={17} className="rx-quick-chevron"/></motion.button>
    </section>
    {recents.length > 0 && <section className="rx-home-section"><div className="rx-section-title"><h2>Recently Played</h2><button onClick={() => navigate('/library?tab=recent')}>See All <ChevronRight size={16}/></button></div><div className="rx-artwork-shelf">{recents.slice(0, 12).map((track, index) => <motion.button key={track.videoId} className="rx-artwork-tile" onClick={() => playQueue(recents, index)} whileTap={{ scale: .96 }}><span className="rx-artwork-image"><img crossOrigin="anonymous" src={asset(track.thumb)} alt="" loading="lazy" decoding="async" /><i><Play size={13} fill="currentColor"/></i></span><b>{track.title}</b><small>{track.artist}</small></motion.button>)}</div></section>}
    {discovery.length > 0 && <section className="rx-home-section rx-discovery-home-section"><div className="rx-section-title"><h2>Songs from Discovery</h2><button onClick={() => navigate('/search')}>See All <ChevronRight size={16}/></button></div><div className="rx-discovery-row">{discovery.slice(0, 3).map(track => <motion.button key={track.videoId} className="rx-discovery-card" onClick={() => onPlay(track)} whileTap={{ scale: .97 }}><img crossOrigin="anonymous" src={asset(track.thumb)} alt="" loading="lazy" decoding="async" /><span><b>{track.title}</b><small>{track.artist}</small></span></motion.button>)}</div></section>}
    {home?.moods?.length ? <section className="rx-home-section rx-made-for-you"><div className="rx-section-title"><h2>Made for You</h2></div><div className="rx-mix-row">{home.moods.slice(0, 2).map((mood, index) => <motion.button key={mood.params} className={`rx-mix-card ${index === 0 ? 'rx-mix-red' : 'rx-mix-dark'}`} onClick={() => navigate(`/mood/${encodeURIComponent(mood.params)}?t=${encodeURIComponent(mood.title)}`)} whileTap={{ scale: .975 }}><span><b>{mood.title}</b><small>Explore this mood</small></span><i><Play size={16} fill="currentColor"/></i></motion.button>)}</div></section> : null}
    {homeLoading && !featured && <div className="rx-loading-inline"><span className="rx-loading-dot"/>Loading your music…</div>}
    {homeError && <div className="rx-error-inline"><span>{homeError}</span><button onClick={onRetry}>Retry</button></div>}
  </div>;
}

function PlaylistRows({ playlists, navigate }: { playlists: BackendLibrary['playlists']; navigate: (path: string) => void }) {
  return <div className="rx-playlist-rows">{playlists.map((item, index) => <div className="rx-playlist-row" key={item.id}><button className="rx-playlist-row-main" onClick={() => navigate(`/mine/${item.id}`)}><span className={`rx-playlist-placeholder tone-${index % 4}`}><Disc3 size={27}/></span><span><b>{item.name}</b><small>{item.count} {item.count === 1 ? 'song' : 'songs'}</small></span></button><button className="rx-more-button" onClick={() => navigate(`/mine/${item.id}`)} aria-label={`Open ${item.name}`}><MoreHorizontal size={24}/></button></div>)}</div>;
}

function LibraryPage({ username, avatar, onProfile, navigate, onToggleFullscreen, isFullscreen, library, loading, onRefresh, onPlay }: {
  username: string; avatar: string; onProfile: () => void; navigate: (path: string) => void; onToggleFullscreen: () => void; isFullscreen: boolean;
  library: BackendLibrary | null; loading: boolean; onRefresh: () => void; onPlay: (t: RexTrack) => void;
}) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const initialTab = params.get('tab') === 'playlists' ? 'Playlists' : params.get('tab') === 'albums' ? 'Albums' : params.get('tab') === 'artists' ? 'Artists' : 'Music';
  const [tab, setTab] = useState(initialTab); const [subView, setSubView] = useState<'main' | 'liked' | 'recent'>(params.get('tab') === 'liked' ? 'liked' : params.get('tab') === 'recent' ? 'recent' : 'main');
  const [creating, setCreating] = useState(false); const [playlistName, setPlaylistName] = useState(''); const [creatingBusy, setCreatingBusy] = useState(false);
  const tabs = ['Music', 'Playlists', 'Albums', 'Artists'];
  const createPlaylist = async (event: FormEvent) => { event.preventDefault(); if (!playlistName.trim()) return; setCreatingBusy(true); try { await api.createPlaylist(playlistName.trim()); setPlaylistName(''); setCreating(false); onRefresh(); setTab('Playlists'); } catch (error) { window.alert((error as Error).message); } finally { setCreatingBusy(false); } };
  const activeTracks = subView === 'liked' ? library?.likes ?? [] : library?.recent ?? [];
  const savedAlbums = library?.saved.album ?? []; const savedArtists = library?.saved.artist ?? [];
  useEffect(() => { onRefresh(); }, [onRefresh]);
  return <div className="rx-page rx-library-page">
    <header className="rx-page-header"><h1>Library</h1><HeaderActions username={username} avatar={avatar} onProfile={onProfile} onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/></header>
    <div className="rx-segmented-control" role="tablist" aria-label="Library views">{tabs.map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); setSubView('main'); }}>{item}</button>)}</div>
    {loading && !library && <div className="rx-loading-inline"><span className="rx-loading-dot"/>Loading your library…</div>}
    {library && tab === 'Music' && subView === 'main' && <>
      <div className="rx-library-shortcuts">
        {[{ title: 'Liked Songs', count: `${library.likes.length} songs`, Icon: Heart, action: () => setSubView('liked') }, { title: 'Recently Played', count: `${library.recent.length} songs`, Icon: Clock3, action: () => setSubView('recent') }].map(({ title, count, Icon, action }) => <button className="rx-library-shortcut" key={title} onClick={action}><span className="rx-shortcut-icon"><Icon size={31} strokeWidth={1.6}/></span><span className="rx-shortcut-copy"><b>{title}</b><small>{count}</small></span><ChevronRight size={21}/></button>)}
      </div>
      <div className="rx-library-section-head"><h2>Your Playlists</h2><button onClick={() => setCreating(value => !value)}>New Playlist <Plus size={20}/></button></div>
      {creating && <form className="rx-library-create-form" onSubmit={createPlaylist}><input value={playlistName} onChange={e => setPlaylistName(e.target.value)} maxLength={64} placeholder="Name your playlist" aria-label="Playlist name"/><BubbleAction disabled={creatingBusy || !playlistName.trim()} type="submit">{creatingBusy ? 'Creating…' : 'Create'}</BubbleAction></form>}
      {library.playlists.length ? <PlaylistRows playlists={library.playlists} navigate={navigate}/> : <div className="rx-empty-state"><ListMusic size={26}/><b>Your playlists will live here.</b><span>Create your first collection to get started.</span><BubbleAction onClick={() => setCreating(true)}>Create playlist <Plus size={15}/></BubbleAction></div>}
    </>}
    {library && tab === 'Music' && subView !== 'main' && <section className="rx-library-list-view"><div className="rx-library-section-head"><button className="rx-back-link" onClick={() => setSubView('main')}><ArrowLeft size={17}/> Library</button><h2>{subView === 'liked' ? 'Liked Songs' : 'Recently Played'}</h2></div>{activeTracks.length ? activeTracks.map((track, index) => <button key={track.videoId} className="rx-original-result" onClick={() => playQueue(activeTracks, index)}><img crossOrigin="anonymous" src={asset(track.thumb)} alt="" decoding="async" loading="lazy" /><span><b>{track.title}</b><small>{track.artist}{track.album ? ` · ${track.album}` : ''}</small></span><Play size={18}/></button>) : <div className="rx-empty-state"><Heart size={24}/><b>{subView === 'liked' ? 'No liked songs yet.' : 'Nothing played yet.'}</b><span>Music you keep and play will appear here.</span></div>}</section>}
    {library && tab === 'Playlists' && <><div className="rx-library-section-head"><h2>Your Playlists</h2><button onClick={() => setCreating(value => !value)}>New Playlist <Plus size={20}/></button></div>{creating && <form className="rx-library-create-form" onSubmit={createPlaylist}><input value={playlistName} onChange={e => setPlaylistName(e.target.value)} maxLength={64} placeholder="Name your playlist" aria-label="Playlist name"/><BubbleAction disabled={creatingBusy || !playlistName.trim()} type="submit">{creatingBusy ? 'Creating…' : 'Create'}</BubbleAction></form>}{library.playlists.length ? <PlaylistRows playlists={library.playlists} navigate={navigate}/> : <div className="rx-empty-state"><ListMusic size={26}/><b>No playlists yet.</b><BubbleAction onClick={() => setCreating(true)}>Create playlist <Plus size={15}/></BubbleAction></div>}{(library.saved.playlist ?? []).length > 0 && <><div className="rx-library-section-head rx-library-saved-head"><h2>Saved from Discovery</h2></div><div className="rx-library-artists">{library.saved.playlist.map(item => <button key={item.id} onClick={() => navigate(`/playlist/${encodeURIComponent(item.id)}`)}><img crossOrigin="anonymous" src={asset(item.thumb)} alt="" decoding="async" loading="lazy" /><span><b>{item.title}</b><small>{item.subtitle ?? 'Playlist'}</small></span><ChevronRight size={18}/></button>)}</div></>}</>}
    {library && tab === 'Albums' && <div className="rx-library-albums">{savedAlbums.length ? savedAlbums.map(album => <button className="rx-library-album" key={album.id} onClick={() => navigate(`/album/${encodeURIComponent(album.id)}`)}><img crossOrigin="anonymous" src={asset(album.thumb)} alt="" decoding="async" loading="lazy" /><b>{album.title}</b><small>{album.subtitle ?? 'Album'}</small></button>) : <div className="rx-empty-state"><Disc3 size={26}/><b>No saved albums yet.</b><span>Save an album from Search to keep it here.</span></div>}</div>}
    {library && tab === 'Artists' && <div className="rx-library-artists">{savedArtists.length ? savedArtists.map(artist => <button key={artist.id} onClick={() => navigate(`/artist/${encodeURIComponent(artist.id)}`)}><img crossOrigin="anonymous" src={asset(artist.thumb)} alt="" decoding="async" loading="lazy" /><span><b>{artist.title}</b><small>{artist.subtitle ?? 'Artist'}</small></span><ChevronRight size={18}/></button>) : <div className="rx-empty-state"><Headphones size={26}/><b>No saved artists yet.</b><span>Save artists from Search to see them here.</span></div>}</div>}
    {!library && !loading && <div className="rx-error-inline"><span>Couldn't load your library. Is the REX backend running?</span><button onClick={onRefresh}>Retry</button></div>}
  </div>;
}

function DiscoverPage({ onToggleFullscreen, isFullscreen, onPlay, navigate }: { onToggleFullscreen: () => void; isFullscreen: boolean; onPlay: (t: RexTrack) => void; navigate: (path: string) => void }) {
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all'); const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]); const [results, setResults] = useState<RexEntity[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const filters = [['all', 'All'], ['songs', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['playlists', 'Playlists']] as const;
  useEffect(() => { api.searchHistory().then(result => setHistory(result.history)).catch(() => undefined); }, []);
  useEffect(() => {
    const q = query.trim(); if (!q) { setResults([]); setSuggestions([]); setError(''); setLoading(false); return; }
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      api.search(q, filter).then(result => { setResults(result.results); setLoading(false); }).catch(e => { setResults([]); setLoading(false); setError((e as Error).message || 'Search is unavailable.'); });
      api.suggest(q).then(result => setSuggestions(result.suggestions)).catch(() => setSuggestions([]));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, filter]);
  const submit = (value: string) => { const q = value.trim(); if (!q) return; setQuery(q); setHistory(current => [q, ...current.filter(item => item.toLowerCase() !== q.toLowerCase())].slice(0, 10)); };
  const openEntity = (entity: RexEntity) => {
    if (isTrack(entity)) { onPlay(entity); return; }
    const path = `/${entity.type}/${encodeURIComponent(entity.id)}`;
    const label = entity.title?.trim() || (entity.type === 'artist' ? query.trim() : '');
    navigate(entity.type === 'artist' && label ? `${path}?name=${encodeURIComponent(label)}` : path);
  };
  return <div className="rx-page rx-search-page rx-original-search-page">
    <header className="rx-original-search-heading"><div><h1>Search</h1><p>Find songs, artists, albums and playlists.</p></div><FullscreenAction onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/></header>
    <label className="rx-original-searchbox"><Search size={22}/><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit(query); }} placeholder="Songs, artists, albums, playlists" aria-label="Search REX"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={17}/></button>}</label>
    <div className="rx-original-filter-row" role="tablist" aria-label="Search filters">{filters.map(([value, label]) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
    {query.trim() ? <section className="rx-original-results"><div className="rx-original-section-title"><h2>Results</h2><span>{loading ? 'Searching…' : `${results.length} found`}</span></div>{loading && <div className="rx-loading-inline"><span className="rx-loading-dot"/>Searching the catalogue…</div>}{error && <div className="rx-error-inline"><span>{error}</span><button onClick={() => setQuery(value => `${value} `)}>Retry</button></div>}{!loading && !error && results.map((entity, index) => isTrack(entity) ? (
      <motion.div key={entity.videoId} className="rx-search-track-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .12 }}>
        <button type="button" className="rx-original-result rx-search-track-main" onClick={() => openEntity(entity)}>
          <img crossOrigin="anonymous" src={asset(entity.thumb)} alt="" loading="lazy" decoding="async" />
          <span><b>{entity.title}</b><small>{`${entity.artist}${entity.album ? ` · ${entity.album}` : ''}`}</small></span>
          <Play size={17}/>
        </button>
        <button type="button" className="rx-search-add-button" onClick={() => openAddTo(entity)} aria-label={`Add ${entity.title} to a playlist`} title="Add to playlist"><Plus size={17}/></button>
      </motion.div>
    ) : (
      <motion.button key={`${entity.type}-${entity.id}`} className="rx-original-result" onClick={() => openEntity(entity)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .12 }}>
        <img crossOrigin="anonymous" src={asset(entity.thumb)} alt="" loading="lazy" decoding="async" /><span><b>{entity.type === 'artist' && (!entity.title || entity.title === 'Unknown artist') ? query.trim() || 'Artist' : entity.title}</b><small>{`${entity.type} · ${entity.subtitle ?? ''}`}</small></span><ChevronRight size={18}/>
      </motion.button>
    ))}{!loading && !error && !results.length && <p className="rx-original-empty">No matches. Try another search.</p>}</section> : <section className="rx-original-history"><div className="rx-original-section-title"><h2>Recent searches</h2><button onClick={async () => { try { await api.clearSearchHistory(); setHistory([]); } catch (error) { setError((error as Error).message || 'Could not clear search history.'); } }}>Clear</button></div>{history.length ? history.map(item => <button key={item} className="rx-original-history-row" onClick={() => submit(item)}><span><Search size={17}/></span><b>{item}</b><ChevronRight size={17}/></button>) : <p className="rx-original-empty">Your recent searches will appear here.</p>}<div className="rx-original-discovery-note"><span>DISCOVER SOMETHING NEW</span><b>Start with a song, an artist, or an album.</b><small>REX searches the live music catalogue.</small></div></section>}
    {query && !loading && suggestions.length > 0 && <div className="rx-search-suggestions">{suggestions.slice(0, 5).map(suggestion => <button key={suggestion} onClick={() => submit(suggestion)}>{suggestion}<ChevronRight size={15}/></button>)}</div>}
  </div>;
}

function QualitySlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const options = [{ name: 'Data Saver', sub: 'Uses less mobile data', bitrate: 'LOW' }, { name: 'Balanced', sub: 'A clear everyday listen', bitrate: 'STANDARD' }, { name: 'High', sub: 'Best available stream quality', bitrate: 'SOURCE MAX' }];
  const current = options[value];
  return <div className="rx-quality-panel"><div className="rx-quality-value"><div><small>STREAMING QUALITY</small><b>{current.name}</b><span>{current.sub}</span></div><strong>{current.bitrate}</strong></div><SoapBubbleSlider className="rx-quality-slider" value={value} min={0} max={2} step={1} scale={.92} label="Audio quality" onValueChange={onChange} from="#9b263d" to="#ff4562" glass={1.12} tint="rgba(255,255,255,.025)" iridescence={.01} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={1.9} refraction={.5} dispersion={1.1} bevel={9} wobble={.27} maxDpr={1.2}/><div className="rx-quality-options">{options.map((option, index) => <button key={option.name} className={index === value ? 'active' : ''} onClick={() => onChange(index)}>{option.name}</button>)}</div><p className="rx-quality-note">High selects the best format exposed by the source. It is not lossless audio.</p></div>;
}
const LYRIC_FONT_MIN = 22;
const LYRIC_FONT_MAX = 42;
// Match the original pre-slider lyrics size: the mobile player used clamp(25px, 7.2vw, 35px).
// Desktop kept the original 34px default.
const defaultLyricsFontSize = () => typeof window !== 'undefined' && window.innerWidth <= 820
  ? Math.round(Math.max(25, Math.min(35, window.innerWidth * 0.072)))
  : 34;
const lyricFontFromSlider = (value: number) => Math.round(LYRIC_FONT_MIN + Math.max(0, Math.min(100, value)) * (LYRIC_FONT_MAX - LYRIC_FONT_MIN) / 100);
const lyricSliderFromFont = (fontSize: number) => Math.max(0, Math.min(100, ((fontSize - LYRIC_FONT_MIN) / (LYRIC_FONT_MAX - LYRIC_FONT_MIN)) * 100));
function LyricsSlider({ value, onChange, onReset }: { value: number; onChange: (value: number) => void; onReset: () => void }) {
  const previewSize = lyricFontFromSlider(value);
  return <div className="rx-lyrics-panel">
    <div className="rx-lyrics-preview-head"><span className="rx-lyrics-preview-label">LIVE PREVIEW</span><div className="rx-lyrics-preview-actions"><span className="rx-lyrics-size-value" aria-live="polite">{previewSize}<small>px</small></span><button type="button" className="rx-lyrics-reset" onClick={onReset} title="Reset lyrics text size" aria-label="Reset lyrics text size">Reset size</button></div></div>
    <div className="rx-lyrics-sample" style={{ fontSize: `${previewSize}px` }} aria-label={`Lyrics preview at ${previewSize} pixels`}>
      <span>Let the</span><span>music say</span><span>it for you.</span>
    </div>
    <SoapBubbleSlider className="rx-lyrics-slider" value={value} min={0} max={100} step={1} scale={.84} label="Lyrics text size" onValueChange={onChange} from="#9b263d" to="#ff4562" glass={1.08} tint="rgba(255,255,255,.02)" iridescence={.01} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={1.8} refraction={.45} dispersion={1} bevel={9} wobble={.25} maxDpr={1.2}/>
    <div className="rx-lyrics-range-labels"><span>Compact</span><span>Text size</span><span className="large-aa">Large</span></div>
  </div>;
}
function GlassToggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <SoapBubbleToggle className="rx-glass-toggle" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled} color="#ee3154" scale={.94} glass={1.16} tint="rgba(255,255,255,.035)" iridescence={.012} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={2} refraction={.5} dispersion={1.15} bevel={10} wobble={.4} maxDpr={1.2}/>;
}
function SettingRow({ icon: Icon, title, subtitle, onClick, trailing, last = false }: { icon: LucideIcon; title: string; subtitle?: string; onClick?: () => void; trailing?: ReactNode; last?: boolean }) {
  const content = <><span className="rx-setting-icon"><Icon size={24} strokeWidth={1.65}/></span><span className="rx-setting-copy"><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>{trailing ?? <ChevronRight size={21} className="rx-setting-chevron"/>}</>;
  return onClick ? <button className={`rx-setting-entry ${last ? 'last' : ''}`} onClick={onClick}>{content}</button> : <div className={`rx-setting-entry ${last ? 'last' : ''}`}>{content}</div>;
}

function SettingsPage({ username, avatar, onProfile, onToast, navigate, onToggleFullscreen, isFullscreen, isStandalone }: {
  username: string; avatar: string; onProfile: () => void; onToast: (message: string) => void; navigate: (path: string) => void; onToggleFullscreen: () => void; isFullscreen: boolean; isStandalone: boolean;
}) {
  const [qualityOpen, setQualityOpen] = useState(false); const [behaviourOpen, setBehaviourOpen] = useState(false); const [donationOpen, setDonationOpen] = useState(false);
  const [quality, setQuality] = useState(() => { const v = safeGetItem('rex.audioQuality'); return v === 'data-saver' ? 0 : v === 'high' ? 2 : 1; });
  const [lyricsSize, setLyricsSize] = useState(() => { try { const p = JSON.parse(safeGetItem('lm.lyrics') ?? '{}') as { fontSize?: number }; return lyricSliderFromFont(Number(p.fontSize ?? defaultLyricsFontSize())); } catch { return lyricSliderFromFont(defaultLyricsFontSize()); } });
  const [toggles, setToggles] = useState({ autoplay: safeGetItem('rex.autoplay') !== 'false', autoScroll: (() => { try { const p = JSON.parse(safeGetItem('lm.lyrics') ?? '{}') as { autoScroll?: boolean }; return p.autoScroll !== false; } catch { return true; } })() });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => { api.settings().then(settings => {
    const q = settings.audioQuality;
    if (q === 'data-saver' || q === 'balanced' || q === 'high') {
      setQuality(q === 'data-saver' ? 0 : q === 'high' ? 2 : 1);
      safeSetItem('rex.audioQuality', q);
    }
    const p = settings.playbackPrefs as Partial<typeof toggles> | undefined;
    if (p && typeof p === 'object') {
      setToggles(current => ({ ...current, ...p }));
      if (typeof p.autoplay === 'boolean') safeSetItem('rex.autoplay', String(p.autoplay));
    }
    const lyricsPrefs = settings.lyricsPrefs as { autoScroll?: boolean; fontSize?: number } | undefined;
    if (lyricsPrefs && typeof lyricsPrefs === 'object') {
      try {
        const current = JSON.parse(safeGetItem('lm.lyrics') ?? '{}') as Record<string, unknown>;
        const merged = { ...current, ...lyricsPrefs };
        safeSetItem('lm.lyrics', JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent('rex-lyrics-preferences', { detail: merged }));
      } catch { /* Keep the settings screen usable if local preference data is malformed. */ }
    }
    if (typeof settings.lyricsSize === 'number') setLyricsSize(Math.max(0, Math.min(100, settings.lyricsSize)));
    if (typeof lyricsPrefs?.autoScroll === 'boolean') setToggles(current => ({ ...current, autoScroll: lyricsPrefs.autoScroll! }));
    if (typeof lyricsPrefs?.fontSize === 'number') setLyricsSize(lyricSliderFromFont(lyricsPrefs.fontSize));
    setPrefsLoaded(true);
  }).catch(() => setPrefsLoaded(true)); }, []);
  const persist = (body: Record<string, unknown>) => { api.saveSettings(body).catch(() => onToast('Could not sync this setting to the REX database.')); };
  const setToggle = (key: keyof typeof toggles, value: boolean) => {
    const updated = { ...toggles, [key]: value }; setToggles(updated); persist({ playbackPrefs: updated });
    if (key === 'autoplay') safeSetItem('rex.autoplay', String(value));
    if (key === 'autoScroll') {
      try { const current = JSON.parse(safeGetItem('lm.lyrics') ?? '{}') as Record<string, unknown>; const nextPrefs = { ...current, autoScroll: value }; safeSetItem('lm.lyrics', JSON.stringify(nextPrefs)); window.dispatchEvent(new CustomEvent('rex-lyrics-preferences', { detail: nextPrefs })); persist({ lyricsPrefs: nextPrefs }); } catch { /* Keep the player setting usable even if local storage is invalid. */ }
    }
  };
  const setQualityValue = (value: number) => {
    const next = Math.max(0, Math.min(2, value)); setQuality(next);
    const qualityKey = (['data-saver', 'balanced', 'high'] as const)[next]; safeSetItem('rex.audioQuality', qualityKey); persist({ audioQuality: qualityKey });
  };
  const setLyricsValue = (value: number) => { const next = Math.max(0, Math.min(100, value)); const fontSize = lyricFontFromSlider(next); setLyricsSize(next); try { const current = JSON.parse(safeGetItem('lm.lyrics') ?? '{}') as Record<string, unknown>; const nextPrefs = { ...current, fontSize }; safeSetItem('lm.lyrics', JSON.stringify(nextPrefs)); window.dispatchEvent(new CustomEvent('rex-lyrics-preferences', { detail: nextPrefs })); persist({ lyricsPrefs: nextPrefs }); } catch { /* Ignore malformed local preference data. */ } };
  return <div className="rx-page rx-settings-page">
    <header className="rx-settings-header"><button onClick={() => navigate('/')} aria-label="Back to home"><ArrowLeft size={25}/></button><h1>Settings</h1><FullscreenAction onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/></header>
    <button className="rx-account-card" onClick={onProfile}><Avatar id={avatar} size={84}/><span><b>{username}</b><small>REX profile</small></span><ChevronRight size={22}/></button>
    <section className="rx-settings-group"><h2>Playback</h2><div className="rx-settings-panel">
      <SettingRow icon={SlidersHorizontal} title="Audio Quality" subtitle={`${['Data Saver', 'Balanced', 'High'][quality]}`} onClick={() => setQualityOpen(open => !open)}/>
      {qualityOpen && <motion.div className="rx-settings-expanded" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} transition={{ duration: .24, ease: [0.22, 1, .36, 1] }}><QualitySlider value={quality} onChange={setQualityValue}/><BubbleAction className="rx-quality-apply" onClick={() => { reloadCurrentStream(); onToast('Applying the selected stream quality.'); }}>Apply to current track</BubbleAction></motion.div>}
      <SettingRow icon={AudioLines} title="Playback Behaviour" subtitle="Autoplay and lyrics follow" onClick={() => setBehaviourOpen(open => !open)}/>
      <AnimatePresence initial={false}>{behaviourOpen && <motion.div className="rx-settings-expanded rx-behaviour-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .28, ease: [0.22, 1, .36, 1] }}><div><span><b>Autoplay</b><small>Continue through the queue</small></span><GlassToggle label="Autoplay" checked={toggles.autoplay} onChange={value => setToggle('autoplay', value)}/></div><div><span><b>Automatic lyric scrolling</b><small>Follow the currently sung line</small></span><GlassToggle label="Automatic lyric scrolling" checked={toggles.autoScroll} onChange={value => setToggle('autoScroll', value)}/></div></motion.div>}</AnimatePresence>
      <div className="rx-setting-entry rx-setting-lyrics last"><span className="rx-setting-icon"><Headphones size={24} strokeWidth={1.65}/></span><span className="rx-setting-copy"><b>Lyrics</b><small>Synced lyrics and karaoke display</small></span><span className="rx-setting-status">Ready</span></div>
      <div className="rx-settings-expanded rx-lyrics-expanded"><div className="rx-lyrics-caption">LYRICS DISPLAY</div><LyricsSlider value={lyricsSize} onChange={setLyricsValue} onReset={() => { setLyricsValue(lyricSliderFromFont(defaultLyricsFontSize())); onToast('Lyrics text size restored to the original default.'); }}/></div>
    </div></section>
    <section className="rx-settings-group"><h2>More</h2><div className="rx-settings-panel">
      {!isStandalone && <SettingRow icon={Download} title="Install REX" subtitle="Add REX to your Home Screen" onClick={() => window.dispatchEvent(new Event('rex:show-pwa-install'))}/>}
      {!isStandalone && <SettingRow icon={Maximize2} title="Fullscreen" subtitle={isFullscreen ? 'Fullscreen is active' : 'Use the full available display'} onClick={onToggleFullscreen}/>}
      <SettingRow icon={Info} title="About REX" subtitle="Version 1.0.0" onClick={() => navigate('/about')} last/>
    </div></section>
    <section className="rx-settings-group"><h2>Support REX</h2><div className="rx-settings-panel">
      <SettingRow icon={HeartHandshake} title="Donate to REX" subtitle="Help keep the music playing" onClick={() => setDonationOpen(open => !open)} trailing={<span className="rx-setting-status">{donationOpen ? 'Hide details' : 'View details'}</span>} last={!donationOpen}/>
      {donationOpen && <div className="rx-donation-panel">
        <p className="rx-donation-message">Running REX takes money — hosting, infrastructure, and ongoing development all add up. If you feel REX is a better fit for you than higher-cost streaming subscriptions, please consider supporting the project. Every contribution helps keep it going.</p>
        <div className="rx-donation-content">
          <div className="rx-donation-payment">
            <span className="rx-donation-eyebrow">SUPPORT REX WITH UPI</span>
            <span className="rx-donation-upi-label">UPI ID</span>
            <div className="rx-donation-upi-value"><code>rajnildas@fam</code><button type="button" onClick={() => { const clipboard = navigator.clipboard; if (clipboard?.writeText) void clipboard.writeText('rajnildas@fam').then(() => onToast('UPI ID copied.')).catch(() => onToast('UPI ID: rajnildas@fam')); else onToast('UPI ID: rajnildas@fam'); }} aria-label="Copy UPI ID" title="Copy UPI ID"><Copy size={16}/></button></div>
            <button type="button" className="rx-donation-pay" onClick={() => { window.location.assign('upi://pay?pa=rajnildas%40fam'); }}><ExternalLink size={16}/> Open UPI app</button>
            <small className="rx-donation-minimum">Any amount from ₹0.50 upward. Donate only what you’re comfortable with.</small>
          </div>
          <div className="rx-donation-qr-wrap"><img src="/donation/rex-upi-qr.png" alt="REX donation UPI QR code for rajnildas@fam" loading="lazy" decoding="async"/><span>Scan to donate</span></div>
        </div>
        <p className="rx-donation-thanks">Thank you for helping keep REX independent. ❤️</p>
      </div>}
    </div></section>
    <section className="rx-settings-group"><h2>REX links</h2><div className="rx-settings-panel"><SettingRow icon={Globe2} title="Showcase website" subtitle="News, features and the story behind REX" trailing={<span className="rx-setting-status coming-soon">Coming soon</span>}/><SettingRow icon={Download} title="Install APK" subtitle="Get the Android app outside the browser" trailing={<span className="rx-setting-status coming-soon">Coming soon</span>} last/></div></section>
    {!prefsLoaded && <p className="rx-settings-footnote">Syncing preferences…</p>}
    <p className="rx-settings-footnote">REX · MADE FOR THE MUSIC</p>
  </div>;
}

type ArtistTab = 'popular' | 'songs' | 'albums' | 'singles' | 'videos' | 'related';
type ArtistPageData = Awaited<ReturnType<typeof api.artist>>;

function ArtistDetailContent({ data, navigate, onPlay, isSaved, saving, onToggleSave, saveStatus }: {
  data: ArtistPageData; navigate: (path: string) => void; onPlay: (track: RexTrack) => void;
  isSaved: boolean; saving: boolean; onToggleSave: () => void; saveStatus: string;
}) {
  const [tab, setTab] = useState<ArtistTab>('popular');
  const tabs: { id: ArtistTab; label: string }[] = [
    { id: 'popular', label: 'Popular' }, { id: 'songs', label: 'Songs' },
    { id: 'albums', label: 'Albums' }, { id: 'singles', label: 'Singles & EPs' },
    { id: 'videos', label: 'Videos' }, { id: 'related', label: 'Similar artists' },
  ];
  const tracks = tab === 'popular' ? (data.popular?.length ? data.popular : data.songs.slice(0, 10))
    : tab === 'videos' ? data.videos : data.songs;
  const cards = tab === 'albums' ? data.albums : tab === 'singles' ? data.singles : tab === 'related' ? data.related : [];
  const count = tab === 'popular' || tab === 'songs' || tab === 'videos' ? tracks.length : cards.length;
  const playVisible = () => { if (tracks.length) playQueue(tracks); };
  const openCard = (card: RexCard) => {
    const path = `/${card.type}/${encodeURIComponent(card.id)}`;
    navigate(card.type === 'artist' ? `${path}?name=${encodeURIComponent(card.title)}` : path);
  };
  return <div className="rx-page rx-detail-page rx-artist-page">
    <header className="rx-artist-backbar"><button onClick={() => navigate('/search')} aria-label="Back to search"><ArrowLeft size={19}/> Back</button><span>ARTIST</span></header>
    <section className="rx-artist-hero">
      {data.thumb ? <img crossOrigin="anonymous" className="rx-artist-image" src={asset(data.thumb)} alt="" decoding="async" loading="lazy" /> : <span className="rx-artist-image rx-artist-image-empty"><Disc3 size={38}/></span>}
      <div className="rx-artist-details">
        <h1>{data.name || 'Artist'}</h1>
        <p className="rx-artist-listeners">{data.monthlyListeners || data.subscribers || 'Artist profile'}</p>
        {data.description && <p className="rx-artist-description">{data.description}</p>}
        <div className="rx-artist-actions">
          <BubbleAction onClick={playVisible} disabled={!tracks.length}><Play size={15} fill="currentColor"/> Play</BubbleAction>
          <BubbleAction disabled={saving} onClick={onToggleSave}>{isSaved ? <Check size={15}/> : <Plus size={15}/>} {saving ? 'Saving…' : isSaved ? 'Saved' : 'Save'}</BubbleAction>
        </div>
      </div>
    </section>
    {saveStatus && <p className="rx-detail-save-status" role="status">{saveStatus}</p>}
    <div className="rx-artist-tabs" role="tablist" aria-label={`${data.name || 'Artist'} sections`}>
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
        className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>
    <div className="rx-artist-list-heading"><h2>{tabs.find(item => item.id === tab)?.label}</h2><span>{count}</span></div>
    {(tab === 'popular' || tab === 'songs' || tab === 'videos') && tracks.map((trackItem, index) =>
      <button key={`${trackItem.videoId}-${index}`} className="rx-original-result rx-artist-track" onClick={() => onPlay(trackItem)}>
        <img crossOrigin="anonymous" src={asset(trackItem.thumb)} alt="" loading="lazy" decoding="async" /><span><b>{trackItem.title}</b><small>{trackItem.artist || data.name}{trackItem.album ? ` · ${trackItem.album}` : ''}</small></span><Play size={17}/>
      </button>)}
    {(tab === 'albums' || tab === 'singles' || tab === 'related') && cards.map(card =>
      <button className="rx-original-result rx-artist-card" key={`${card.type}-${card.id}`} onClick={() => openCard(card)}>
        <img crossOrigin="anonymous" src={asset(card.thumb)} alt="" loading="lazy" decoding="async" /><span><b>{card.title}</b><small>{tab === 'related' ? `Artist${card.subtitle ? ` · ${card.subtitle}` : ''}` : [card.subtitle, tab === 'singles' ? 'Single / EP' : 'Album'].filter(Boolean).join(' · ')}</small></span><ChevronRight size={18}/>
      </button>)}
    {count === 0 && <div className="rx-empty-state"><Disc3 size={24}/><b>Nothing listed here yet.</b><span>Try another artist section.</span></div>}
  </div>;
}

function DetailPage({ kind, id, navigate, onPlay, library, onLibraryRefresh }: { kind: NonNullable<Route['detailKind']>; id: string; navigate: (path: string) => void; onPlay: (t: RexTrack) => void; library: BackendLibrary | null; onLibraryRefresh: () => void }) {
  const [data, setData] = useState<unknown>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState('');
  const artistName = kind === 'artist' ? new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('name') ?? '' : '';
  useEffect(() => { let active = true; setLoading(true); setError(''); setData(null);
    const task: Promise<unknown> = kind === 'album' ? api.album(id) : kind === 'artist' ? api.artist(id, artistName) : kind === 'playlist' ? api.playlist(id) : kind === 'mine' ? api.localPlaylist(id) : api.mood(id, new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('t') ?? '');
    task.then(value => { if (active) setData(value); }).catch(e => { if (active) setError((e as Error).message || 'Could not load this page.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, id, artistName]);
  if (loading) return <div className="rx-page"><div className="rx-loading-inline"><span className="rx-loading-dot"/>Loading music…</div></div>;
  if (error || !data) return <div className="rx-page"><div className="rx-detail-back"><button onClick={() => navigate('/search')}><ArrowLeft size={17}/> Back</button></div><div className="rx-error-inline"><span>{error || 'Not available.'}</span></div></div>;
  const value = data as Record<string, unknown>;
  const tracks = (Array.isArray(value.tracks) ? value.tracks : Array.isArray(value.songs) ? value.songs : []) as RexTrack[];
  const title = String(value.title ?? value.name ?? artistName ?? new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('t') ?? 'Discovery');
  const subtitle = String(value.artist ?? value.author ?? value.description ?? (kind === 'mine' ? `${tracks.length} songs` : ''));
  const thumb = typeof value.thumb === 'string' ? value.thumb : '';
  const playAll = () => { if (tracks.length) playQueue(tracks); };
  const cards = Array.isArray(value.results) ? value.results as RexCard[] : [];
  const canSave = kind === 'album' || kind === 'artist' || kind === 'playlist';
  const savedList = canSave ? (library?.saved[kind] ?? []) : [];
  const entityId = kind === 'artist' ? String(value.id ?? id) : id;
  const isSaved = savedList.some(item => String(item.id) === entityId);
  const toggleSave = async () => {
    if (!canSave) return;
    setSaving(true); setSaveError('');
    try {
      const card: RexCard = { type: kind as RexCard['type'], id: entityId, title, subtitle, thumb };
      const result = await api.toggleSaved(kind as RexCard['type'], entityId, card);
      await onLibraryRefresh();
      setSaveError(result.saved ? 'Saved to your REX library.' : 'Removed from your REX library.');
    } catch (saveFailure) { setSaveError((saveFailure as Error).message || 'Could not update your library.'); }
    finally { setSaving(false); }
  };
  if (kind === 'artist') return <ArtistDetailContent data={value as ArtistPageData} navigate={navigate} onPlay={onPlay} isSaved={isSaved} saving={saving} onToggleSave={() => void toggleSave()} saveStatus={saveError}/>;
  return <div className="rx-page rx-detail-page"><header className="rx-settings-header"><button onClick={() => navigate('/search')} aria-label="Back"><ArrowLeft size={25}/></button><h1>{title}</h1></header>
    <div className="rx-detail-hero">{thumb ? <img crossOrigin="anonymous" src={asset(thumb)} alt="" decoding="async" loading="lazy" /> : <span className="rx-detail-art-placeholder"><Disc3 size={44}/></span>}<div><b>{title}</b><small>{subtitle}</small><div className="rx-detail-actions"><BubbleAction onClick={playAll} disabled={!tracks.length}><Play size={15} fill="currentColor"/> Play</BubbleAction>{canSave && <BubbleAction disabled={saving} onClick={() => void toggleSave()}>{isSaved ? <Check size={15}/> : <Plus size={15}/>} {saving ? 'Saving…' : isSaved ? 'Saved' : 'Save'}</BubbleAction>}</div></div></div>
    {saveError && <p className="rx-detail-save-status" role="status">{saveError}</p>}
    {tracks.length > 0 && <><div className="rx-section-title"><h2>Tracks</h2><button onClick={playAll}>Play all <Play size={14}/></button></div>{tracks.map((track, index) => <button key={track.videoId} className="rx-original-result" onClick={() => onPlay(track)}><img crossOrigin="anonymous" src={asset(track.thumb)} alt="" decoding="async" loading="lazy" /><span><b>{track.title}</b><small>{track.artist}</small></span><Play size={17}/></button>)}</>}
    {cards.map(card => <button className="rx-original-result" key={`${card.type}-${card.id}`} onClick={() => navigate(`/${card.type}/${encodeURIComponent(card.id)}`)}><img crossOrigin="anonymous" src={asset(card.thumb)} alt="" decoding="async" loading="lazy" /><span><b>{card.title}</b><small>{card.type} · {card.subtitle ?? ''}</small></span><ChevronRight size={18}/></button>)}
    {!tracks.length && !cards.length && <div className="rx-empty-state"><Disc3 size={25}/><b>Nothing to show here yet.</b></div>}
  </div>;
}

function AboutPage({ navigate }: { navigate: (path: string) => void }) {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [healthError, setHealthError] = useState('');
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let active = true;
    api.health().then(value => { if (active) setHealth(value); })
      .catch(error => { if (active) setHealthError((error as Error).message || 'REX services are unavailable.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  const status = (label: string, ready: boolean | undefined) => <div className="rx-about-status-row"><span><i className={ready ? 'is-ready' : 'is-offline'}/>{label}</span><b>{checking ? 'Checking…' : ready ? 'Online' : 'Unavailable'}</b></div>;
  return <div className="rx-page rx-about-page"><header className="rx-settings-header"><button onClick={() => navigate('/settings')} aria-label="Back to settings"><ArrowLeft size={25}/></button><h1>About REX</h1></header><div className="rx-about-mark">REX<span>.</span></div><h2>Music, without the noise.</h2><p>REX is a personal music space built around discovery, the albums you return to, and the moments you want to keep.</p><div className="rx-about-meta"><span>VERSION</span><b>1.0.0 · CONNECTED EDITION</b></div><section className="rx-about-health"><div className="rx-about-health-heading"><b>REX services</b><button onClick={() => { setChecking(true); setHealthError(''); api.health().then(setHealth).catch(error => setHealthError((error as Error).message || 'Services unavailable.')).finally(() => setChecking(false)); }}>Refresh</button></div>{status('API & database', health?.ok)}{status('Streaming engine', health?.streaming === 'ready')}{healthError && <small className="rx-about-health-error">{healthError}</small>}<small className="rx-about-health-note">This status checks the REX server running on this device or network.</small></section></div>;
}

function LoadingPage() {
  return <div className="rx-loading-page" aria-label="Loading REX"><motion.div className="rx-loading-logo" initial={{ opacity: 0, y: 12, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: .65, ease: [0.22, 1, .36, 1] }}>REX<span>.</span></motion.div><div className="rx-loading-bars">{Array.from({ length: 5 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 90}ms` }}/>)}</div><p>MADE FOR THE MUSIC</p></div>;
}
function NotFoundPage({ navigate }: { navigate: (path: string) => void }) {
  return <div className="rx-notfound-page"><div>404</div><h1>Lost the track?</h1><p>This page doesn't exist. Let's get you back to the music.</p><BubbleAction onClick={() => navigate('/')}>Back to REX <Home size={16}/></BubbleAction></div>;
}
function CookieConsent({ onClose }: { onClose: (choice: 'all' | 'essential') => void }) {
  return <motion.aside className="rx-cookie-banner" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }}><div><ShieldCheck size={19}/><span><b>Your privacy matters.</b><small>REX uses essential local preferences and its library database. No analytics or advertising cookies are included.</small></span></div><div className="rx-cookie-actions"><button onClick={() => onClose('essential')}>Essential only</button><BubbleAction onClick={() => onClose('all')}>Accept cookies <Check size={14}/></BubbleAction></div></motion.aside>;
}
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 2600); return () => window.clearTimeout(timer); }, [message, onClose]);
  return <motion.div className="rx-toast" role="status" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}><Check size={15}/>{message}<button onClick={onClose} aria-label="Dismiss"><X size={14}/></button></motion.div>;
}

export default function ConnectedApp() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [username, setUsernameState] = useState(() => readStore('rex.preview.username', 'Listener'));
  const [avatar, setAvatarState] = useState(() => { const saved = readStore<string>('rex.preview.avatar', ''); return AVATARS.some(item => item.id === saved) ? saved : AVATARS[0].id; });
  const [profileOpen, setProfileOpen] = useState(false);
  const [authSession, setAuthSession] = useState<RexSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [cookieChoice, setCookieChoice] = useState(() => readStore<string | null>('rex.preview.cookies', null));
  const [toast, setToast] = useState(''); const [booting] = useState(false);
  const [isStandalone, setIsStandalone] = useState(isStandaloneDisplay);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement) || isStandaloneDisplay());
  const [home, setHome] = useState<BackendHome | null>(null); const [homeLoading, setHomeLoading] = useState(true); const [homeError, setHomeError] = useState('');
  const [library, setLibrary] = useState<BackendLibrary | null>(null); const [libraryLoading, setLibraryLoading] = useState(true);
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const likedTracks = usePlayerSel(state => state.liked);
  const notify = useCallback((message: string) => setToast(message), []);
  const navigate = useCallback((path: string) => { window.location.hash = `#${path}`; setRoute(routeFromHash()); }, []);
  const refreshLibrary = useCallback(async () => { if (!authSession) { setLibrary(null); setLibraryLoading(false); return; } setLibraryLoading(true); try { const data = await api.library(); setLibrary(data); } catch { setLibrary(null); } finally { setLibraryLoading(false); } }, [authSession]);
  const refreshHome = useCallback(async () => { setHomeLoading(true); setHomeError(''); try { const data = await api.home(); setHome(data); } catch (error) { setHomeError((error as Error).message || 'Could not load Discovery.'); } finally { setHomeLoading(false); } }, []);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) { setAuthSession(data.session); setAuthReady(true); } }).catch(() => { if (active) setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session);
      setAuthReady(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => { void refreshLibrary(); }, [likedTracks, authSession?.user.id, refreshLibrary]);
  useEffect(() => {
    const refresh = () => { void refreshLibrary(); };
    window.addEventListener('rex-library-updated', refresh);
    return () => window.removeEventListener('rex-library-updated', refresh);
  }, [refreshLibrary]);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash()); window.addEventListener('hashchange', onHash);
    document.title = 'REX — Music'; document.documentElement.setAttribute('data-theme', 'dark');
    initPlayer(); void refreshHome();
    return () => { window.removeEventListener('hashchange', onHash); };
  }, [refreshHome]);

  useEffect(() => {
    if (!authSession) {
      setLibrary(null);
      resetPlayerForSignOut();
      setUsernameState('Listener');
      setAvatarState(AVATARS[0].id);
      return;
    }
    let active = true;
    refreshLikes();
    api.auth.me().then(({ profile }) => {
      if (!active) return;
      setUsernameState(profile.displayName || profile.username || 'Listener');
      setAvatarState(AVATARS.some(item => item.id === profile.avatar) ? profile.avatar : AVATARS[0].id);
    }).catch(() => undefined);
    // Load this account's saved playback preferences before the user starts a track.
    api.settings().then(settings => {
      if (!active) return;
      const quality = settings.audioQuality;
      safeSetItem('rex.audioQuality', quality === 'data-saver' || quality === 'high' ? quality : 'balanced');
      const playback = settings.playbackPrefs as { autoplay?: boolean } | undefined;
      safeSetItem('rex.autoplay', String(playback?.autoplay !== false));
      const lyrics = settings.lyricsPrefs as { autoScroll?: boolean; fontSize?: number } | undefined;
      const lyricPrefs = {
        autoScroll: lyrics?.autoScroll !== false,
        fontSize: typeof lyrics?.fontSize === 'number' ? lyrics.fontSize : defaultLyricsFontSize(),
      };
      safeSetItem('lm.lyrics', JSON.stringify(lyricPrefs));
      window.dispatchEvent(new CustomEvent('rex-lyrics-preferences', { detail: lyricPrefs }));
    }).catch(() => undefined);
    void refreshLibrary();
    return () => { active = false; };
  }, [authSession?.user.id, refreshLibrary]);

  useEffect(() => {
    const sync = () => { const standalone = isStandaloneDisplay(); setIsStandalone(standalone); setIsFullscreen(Boolean(document.fullscreenElement) || standalone); };
    const media = window.matchMedia?.('(display-mode: standalone)');
    document.addEventListener('fullscreenchange', sync); window.addEventListener('pageshow', sync); media?.addEventListener?.('change', sync); sync();
    return () => { document.removeEventListener('fullscreenchange', sync); window.removeEventListener('pageshow', sync); media?.removeEventListener?.('change', sync); };
  }, []);
  useEffect(() => { document.querySelector('.scroller')?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [route.path]);
  useEffect(() => { if (route.page !== 'loading') return; const timer = window.setTimeout(() => navigate('/'), 1500); return () => window.clearTimeout(timer); }, [route.page, navigate]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { const target = event.target as HTMLElement; if (event.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) && target.getAttribute('role') !== 'slider') { event.preventDefault(); void toggle(); } };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);

  const saveProfile = async (name: string, selectedAvatar: string) => {
    setUsernameState(name); setAvatarState(selectedAvatar); writeStore('rex.preview.username', name); writeStore('rex.preview.avatar', selectedAvatar);
    try { await api.saveSettings({ profile: { username: name, avatar: selectedAvatar } }); notify('Profile saved to your REX account.'); }
    catch (error) { notify((error as Error).message || 'Could not save your profile.'); }
  };
  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfileOpen(false);
    setFullPlayerOpen(false);
    notify('Signed out of REX.');
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (isStandaloneDisplay()) notify('REX is already using its Home Screen app view.');
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else notify('Fullscreen is unavailable in this browser. Add REX to your Home Screen for an app-like view.');
    } catch { notify('Your browser blocked fullscreen. Add REX to your Home Screen for an app-like view.'); }
  };
  const play = useCallback((track: RexTrack) => {
    playTrack(track);
    setLibrary(current => current ? { ...current, recent: [track, ...current.recent.filter(item => item.videoId !== track.videoId)].slice(0, 60) } : current);
  }, []);

  if (!authReady) return <div className="rex-splash-screen"><LoadingPage/></div>;
  if (!supabaseConfigured || !authSession) return <AuthScreen onAuthenticated={code => { if (code) setRecoveryNotice(code); }}/>

  let page: ReactNode;
  if (route.page === 'home') page = <HomePage username={username} avatar={avatar} onProfile={() => setProfileOpen(true)} navigate={navigate} onToggleFullscreen={toggleFullscreen} isFullscreen={isFullscreen} home={home} library={library} homeLoading={homeLoading} homeError={homeError} onPlay={play} onRetry={() => void refreshHome()}/>;
  else if (route.page === 'discover') page = <DiscoverPage onToggleFullscreen={toggleFullscreen} isFullscreen={isFullscreen} onPlay={play} navigate={navigate}/>;
  else if (route.page === 'library') page = <LibraryPage username={username} avatar={avatar} onProfile={() => setProfileOpen(true)} navigate={navigate} onToggleFullscreen={toggleFullscreen} isFullscreen={isFullscreen} library={library} loading={libraryLoading} onRefresh={() => void refreshLibrary()} onPlay={play}/>;
  else if (route.page === 'settings') page = <SettingsPage username={username} avatar={avatar} onProfile={() => setProfileOpen(true)} onToast={notify} navigate={navigate} onToggleFullscreen={toggleFullscreen} isFullscreen={isFullscreen} isStandalone={isStandalone}/>;
  else if (route.page === 'about') page = <AboutPage navigate={navigate}/>;
  else if (route.page === 'loading') page = <LoadingPage/>;
  else if (route.page === 'detail' && route.detailKind && route.detailId) page = <DetailPage kind={route.detailKind} id={route.detailId} navigate={navigate} onPlay={play} library={library} onLibraryRefresh={() => void refreshLibrary()}/>;
  else page = <NotFoundPage navigate={navigate}/>;

  const currentPage = <AnimatePresence mode="wait" initial={false}><motion.div key={route.path} className="rx-route-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .14, ease: 'easeOut' }}>{page}</motion.div></AnimatePresence>;
  return <RexBubbleMaterial>
    <AppShell path={route.path} navigate={navigate} openPlayer={() => setFullPlayerOpen(true)}>
      <div className="rx-connected-page"><div className="rx-ambient-glow" aria-hidden="true"/>{currentPage}</div>
    </AppShell>
    <PlayerErrorBoundary resetKey={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)}><FullPlayer open={fullPlayerOpen} onClose={() => setFullPlayerOpen(false)}/></PlayerErrorBoundary>
    <AddToPlaylist/>
    <AnimatePresence>{!cookieChoice && !booting && <CookieConsent onClose={choice => { setCookieChoice(choice); writeStore('rex.preview.cookies', choice); }}/>}</AnimatePresence>
    <AnimatePresence>{profileOpen && <ProfileMenu username={username} avatar={avatar} onSave={saveProfile} onLogout={() => void signOut()} close={() => setProfileOpen(false)} navigate={navigate}/>}</AnimatePresence>
    {recoveryNotice && <RecoveryCodeNotice code={recoveryNotice} onClose={() => setRecoveryNotice('')}/>}
    <AnimatePresence>{toast && <Toast message={toast} onClose={() => setToast('')}/>}</AnimatePresence>
    <AnimatePresence>{booting && <motion.div className="rx-splash-screen" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .48, ease: [0.22, 1, .36, 1] }}><LoadingPage/></motion.div>}</AnimatePresence>
  </RexBubbleMaterial>;
}
