import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft, AudioLines, Check, ChevronRight, Clock3, Disc3,
  Flower2, Heart, Headphones, Home, Info, Library, ListMusic, Maximize2,
  Mic, Minimize2, MoreHorizontal, Music2, Pause, Play, Plus,
  Search, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal,
  Sparkles, UserRound, Volume2, Waves, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { SoapBubbleButton, SoapBubbleSlider, SoapBubbleToggle } from '../components/soap-bubble';
import RexBubbleMaterial from '../components/RexBubbleMaterial';
import PreviewNavigation from './PreviewNavigation';
import './preview.css';

type PageId = 'home' | 'discover' | 'library' | 'settings' | 'about' | 'loading' | 'not-found';
type Track = { id: string; title: string; artist: string; album: string; duration: string; cover: string };

const TRACKS: Track[] = [
  { id: 'after-hours', title: 'After Hours', artist: 'The Weeknd', album: 'After Hours', duration: '6:01', cover: 'https://www.dinealonestore.com/cdn/shop/products/20UMGIM12176.rgb_5000x.jpg?v=1674229238&width=1000' },
  { id: 'snooze', title: 'Snooze', artist: 'SZA', album: 'SOS', duration: '3:22', cover: 'https://www.ibs.it/images/0196587792121_0_0_536_0_75.jpg' },
  { id: 'blonde', title: 'Nights', artist: 'Frank Ocean', album: 'Blonde', duration: '5:07', cover: 'https://assets.capitalfm.com/2016/34/frank-ocean-blonde-album-1471870441.png' },
  { id: 'starboy', title: 'Starboy', artist: 'The Weeknd', album: 'Starboy', duration: '3:50', cover: 'https://upload.wikimedia.org/wikipedia/en/3/39/The_Weeknd_-_Starboy.png' },
  { id: 'violet', title: 'The Color Violet', artist: 'Tory Lanez', album: 'Alone at Prom', duration: '3:46', cover: 'https://images.squarespace-cdn.com/content/v1/6144d106ee0f834ae92b4f60/1638973568530-R0ZXDZTBF61MCWK433JK/Here%27s%2BTory%2BLanez%27s%2B%27Alone%2BAt%2BProm%27%2Bofficial%2Balbum%2Bcover.jpg?format=1000w' },
  { id: 'best-part', title: 'Best Part', artist: 'Daniel Caesar, H.E.R.', album: 'Freudian', duration: '3:29', cover: 'https://akamai.sscdn.co/uploadfile/letras/albuns_high/59365_20180716080106.jpg' },
];

const PLAYLISTS = [
  { id: 'late-night', title: 'Late Night', count: 24, cover: TRACKS[0].cover },
  { id: 'chill-mix', title: 'Chill Mix', count: 67, cover: TRACKS[1].cover },
  { id: 'indie-alt', title: 'Indie & Alt', count: 38, cover: 'https://images.unsplash.com/photo-1490730141103-6cac27aaab94?auto=format&fit=crop&w=420&q=85' },
  { id: 'favourites', title: 'Favourites', count: 102, cover: TRACKS[2].cover },
];

const AVATARS = [
  { id: 'avatar-1', label: 'Crimson Orbit', colors: ['#4d0d22', '#f33b61', '#ff9baf'], motif: 'orbit' },
  { id: 'avatar-2', label: 'Blue Echo', colors: ['#101d3b', '#3979d8', '#8ad5ff'], motif: 'wave' },
  { id: 'avatar-3', label: 'Ruby Star', colors: ['#3a0919', '#bd2048', '#ffb4c4'], motif: 'star' },
  { id: 'avatar-4', label: 'Violet Bloom', colors: ['#21112f', '#8153b8', '#e2b9ff'], motif: 'bloom' },
  { id: 'avatar-5', label: 'Solar Flare', colors: ['#3a1c13', '#d76a36', '#ffd08c'], motif: 'flare' },
  { id: 'avatar-6', label: 'Rose Moon', colors: ['#310e26', '#be477f', '#ffc0dd'], motif: 'moon' },
  { id: 'avatar-7', label: 'Neon Pulse', colors: ['#0c2630', '#1599a7', '#a4fff2'], motif: 'pulse' },
  { id: 'avatar-8', label: 'Red Signal', colors: ['#260d18', '#c82b4e', '#ff8198'], motif: 'signal' },
];

const GENRES = [
  { title: 'Pop', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=360&q=82' },
  { title: 'Hip-Hop', cover: TRACKS[0].cover },
  { title: 'R&B', cover: 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=360&q=82' },
  { title: 'Indie', cover: 'https://images.unsplash.com/photo-1490730141103-6cac27aaab94?auto=format&fit=crop&w=360&q=82' },
  { title: 'Rock', cover: 'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=360&q=82' },
];

function readStore<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}
function writeStore(key: string, value: unknown) {
  try {
    const remember = key === 'rex.preview.remember' || key === 'rex.preview.cookies' || readStore('rex.preview.remember', true);
    if (remember) window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* Private browsing may block storage. */ }
}
function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  const displayMode = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return Boolean(displayMode || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}
function routeFromHash(): { page: PageId; path: string } {
  const path = (window.location.hash.replace(/^#/, '').split('?')[0] || '/').replace(/\/$/, '') || '/';
  if (path === '/') return { page: 'home', path };
  if (path === '/discover' || path === '/search') return { page: 'discover', path: '/discover' };
  if (path === '/library') return { page: 'library', path };
  if (path === '/settings') return { page: 'settings', path };
  if (path === '/about') return { page: 'about', path };
  if (path === '/loading') return { page: 'loading', path };
  return { page: 'not-found', path };
}

function Avatar({ id, size = 44 }: { id: string; size?: number }) {
  const avatar = AVATARS.find(item => item.id === id) ?? AVATARS[0];
  const [deep, mid, light] = avatar.colors;
  return <span className={`rx-avatar rx-avatar-graphic motif-${avatar.motif}`} role="img" aria-label={`${avatar.label} graphic profile`} style={{ width: size, height: size, aspectRatio: '1 / 1', '--avatar-deep': deep, '--avatar-mid': mid, '--avatar-light': light } as CSSProperties}>
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`avatar-bg-${id}`} cx="30%" cy="24%" r="90%"><stop offset="0%" stopColor={light}/><stop offset="42%" stopColor={mid}/><stop offset="100%" stopColor={deep}/></radialGradient>
        <linearGradient id={`avatar-line-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={light}/><stop offset="100%" stopColor={mid}/></linearGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#avatar-bg-${id})`}/>
      <circle cx="50" cy="50" r="39" fill="none" stroke={light} strokeOpacity=".22" strokeWidth=".9"/>
      {avatar.motif === 'orbit' && <><ellipse cx="50" cy="50" rx="37" ry="17" fill="none" stroke={light} strokeWidth="4" transform="rotate(-34 50 50)"/><ellipse cx="50" cy="50" rx="18" ry="38" fill="none" stroke={light} strokeOpacity=".55" strokeWidth="2" transform="rotate(32 50 50)"/><circle cx="72" cy="25" r="7" fill="#fff"/></>}
      {avatar.motif === 'wave' && <><path d="M8 56 C20 16 32 16 44 56 S68 96 80 56 S92 16 100 48" fill="none" stroke={light} strokeWidth="7" strokeLinecap="round"/><path d="M5 70 C20 45 31 45 45 70 S70 94 86 66" fill="none" stroke="#fff" strokeOpacity=".42" strokeWidth="2"/></>}
      {avatar.motif === 'star' && <><path d="M50 10 L59 39 L90 50 L59 61 L50 90 L41 61 L10 50 L41 39Z" fill={light}/><circle cx="50" cy="50" r="10" fill={deep}/><circle cx="77" cy="22" r="4" fill="#fff"/></>}
      {avatar.motif === 'bloom' && <><g fill={light} fillOpacity=".76">{Array.from({length:8},(_,i)=><ellipse key={i} cx="50" cy="29" rx="10" ry="21" transform={`rotate(${i*45} 50 50)`}/>)}</g><circle cx="50" cy="50" r="13" fill="#fff" fillOpacity=".85"/><circle cx="50" cy="50" r="7" fill={mid}/></>}
      {avatar.motif === 'flare' && <><circle cx="50" cy="50" r="25" fill={light} fillOpacity=".9"/><g stroke={light} strokeWidth="4" strokeLinecap="round">{Array.from({length:12},(_,i)=><line key={i} x1="50" y1="7" x2="50" y2="16" transform={`rotate(${i*30} 50 50)`}/>)}</g><circle cx="50" cy="50" r="12" fill="#fff" fillOpacity=".55"/></>}
      {avatar.motif === 'moon' && <><circle cx="45" cy="48" r="29" fill={light}/><circle cx="60" cy="37" r="27" fill={deep}/><circle cx="73" cy="68" r="5" fill="#fff"/><circle cx="27" cy="25" r="3" fill="#fff"/></>}
      {avatar.motif === 'pulse' && <><path d="M8 54 H25 L35 30 L47 76 L61 39 L70 57 H92" fill="none" stroke={light} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="47" cy="76" r="5" fill="#fff"/></>}
      {avatar.motif === 'signal' && <><g fill={light}>{[18,31,44,57,70].map((x,i)=><rect key={x} x={x} y={46-[12,23,34,23,12][i]/2} width="7" height={[12,23,34,23,12][i]} rx="3.5"/>)}</g><circle cx="50" cy="50" r="39" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="1.3"/></>}
      <circle cx="50" cy="50" r="48" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="2"/>
    </svg>
  </span>;
}

function BubbleAction({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return <SoapBubbleButton {...props} className={`rx-bubble-action ${className}`.trim()} glass={1.02} tint="rgba(255,255,255,.035)" iridescence={0.012} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={1.7} refraction={0.42} dispersion={0.9} bevel={10} wobble={0.28}>{children}</SoapBubbleButton>;
}

function ProfileMenu({ username, setUsername, avatar, setAvatar, close, navigate }: {
  username: string; setUsername: (value: string) => void; avatar: string; setAvatar: (value: string) => void; close: () => void; navigate: (path: string) => void;
}) {
  const [draft, setDraft] = useState(username);
  return <div className="rx-modal-backdrop" onMouseDown={close}>
    <motion.section className="rx-profile-sheet" role="dialog" aria-modal="true" aria-label="Your profile" onMouseDown={event => event.stopPropagation()} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }}>
      <div className="rx-sheet-handle"/><div className="rx-sheet-title"><div><span>PROFILE</span><h2>Your REX profile</h2></div><button className="rx-round-icon" onClick={close} aria-label="Close"><X size={18}/></button></div>
      <div className="rx-profile-preview"><Avatar id={avatar} size={64}/><div><b>{username}</b><small>Preview profile · Stored on this device</small></div></div>
      <label className="rx-input-label" htmlFor="rx-display-name">Display name</label>
      <input id="rx-display-name" className="rx-input" maxLength={24} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Your name" />
      <span className="rx-input-label rx-avatar-label">Choose a profile picture</span>
      <div className="rx-avatar-options">{AVATARS.map(item => <button key={item.id} className={avatar === item.id ? 'selected' : ''} onClick={() => setAvatar(item.id)} aria-label={`Choose ${item.label}`}><Avatar id={item.id} size={48}/>{avatar === item.id && <i><Check size={12}/></i>}</button>)}</div>
      <div className="rx-profile-sheet-links"><button onClick={() => { close(); navigate('/about'); }}><Info size={17}/> About REX <ChevronRight size={16}/></button></div>
      <BubbleAction className="rx-sheet-primary" onClick={() => { setUsername(draft.trim() || 'Listener'); close(); }}>Save changes <Check size={16}/></BubbleAction>
    </motion.section>
  </div>;
}

function FullscreenAction({ onToggleFullscreen, isFullscreen }: { onToggleFullscreen: () => void; isFullscreen: boolean }) {
  return <BubbleAction className="rx-header-icon rx-fullscreen-icon" onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
    {isFullscreen ? <Minimize2 size={20}/> : <Maximize2 size={20}/>}
  </BubbleAction>;
}

function HeaderActions({ username, avatar, onProfile, onSearch, onToggleFullscreen, isFullscreen = false }: {
  username: string; avatar: string; onProfile: () => void; onSearch?: () => void;
  onToggleFullscreen?: () => void; isFullscreen?: boolean;
}) {
  return <div className="rx-header-actions">
    {onSearch && <BubbleAction className="rx-header-icon" onClick={onSearch} aria-label="Search"><Search size={22}/></BubbleAction>}
    {onToggleFullscreen && <FullscreenAction onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/>}
    <button className="rx-profile-button" onClick={onProfile} aria-label={`Open ${username}'s profile`}><Avatar id={avatar} size={48}/></button>
  </div>;
}

function HomePage({ username, avatar, onProfile, onToast, navigate, onToggleFullscreen, isFullscreen }: { username: string; avatar: string; onProfile: () => void; onToast: (message: string) => void; navigate: (path: string) => void; onToggleFullscreen: () => void; isFullscreen: boolean }) {
  const greeting = new Date().getHours() < 12 ? 'Good Morning,' : new Date().getHours() < 18 ? 'Good Afternoon,' : 'Good Evening,';
  const firstName = username.trim().split(/\s+/)[0] || 'Listener';
  return <div className="rx-page rx-home-page">
    <header className="rx-home-header"><button className="rx-wordmark" onClick={() => navigate('/')} aria-label="REX home">REX<span/></button><HeaderActions username={username} avatar={avatar} onProfile={onProfile} onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/></header>
    <section className="rx-home-greeting"><span>{greeting}</span><h1>{firstName}<i>.</i></h1><p>What are we listening to today?</p></section>
    <button className="rx-feature-card" onClick={() => onToast('After Hours is sample content in this frontend preview.')}>
      <img src={TRACKS[0].cover} alt="After Hours cover artwork"/><span className="rx-feature-shade"/><span className="rx-feature-copy"><small>NEW RELEASE</small><b>After Hours</b><em>The Weeknd</em><span className="rx-feature-play"><i><Play size={16} fill="currentColor"/></i> Play Now</span></span><span className="rx-feature-dots"><i className="active"/><i/><i/></span>
    </button>
    <section className="rx-quick-grid" aria-label="Your music shortcuts">
      <button className="rx-quick-action" onClick={() => navigate('/library?tab=liked')}>
        <span className="rx-quick-icon"><Heart size={21} strokeWidth={1.8}/></span>
        <span className="rx-quick-copy"><b>Liked Songs</b><small>Your saved tracks</small></span>
        <ChevronRight size={17} className="rx-quick-chevron"/>
      </button>
      <button className="rx-quick-action" onClick={() => navigate('/library?tab=playlists')}>
        <span className="rx-quick-icon"><ListMusic size={21} strokeWidth={1.8}/></span>
        <span className="rx-quick-copy"><b>Your Playlists</b><small>Your music, your way</small></span>
        <ChevronRight size={17} className="rx-quick-chevron"/>
      </button>
    </section>
    <section className="rx-home-section">
      <div className="rx-section-title"><h2>Recently Played</h2><button onClick={() => navigate('/library')}>See All <ChevronRight size={16}/></button></div>
      <div className="rx-artwork-shelf">{TRACKS.slice(0, 4).map(track => <button key={track.id} className="rx-artwork-tile" onClick={() => onToast(`${track.title} is sample content.`)}><span className="rx-artwork-image"><img src={track.cover} alt="" loading="lazy"/><i><Play size={13} fill="currentColor"/></i></span><b>{track.title}</b><small>{track.artist}</small></button>)}</div>
    </section>
    <section className="rx-home-section rx-discovery-home-section">
      <div className="rx-section-title"><h2>Songs from Discovery</h2><button onClick={() => navigate('/discover')}>See All <ChevronRight size={16}/></button></div>
      <div className="rx-discovery-row">{TRACKS.slice(2, 5).map(track => <button key={track.id} className="rx-discovery-card" onClick={() => onToast(`${track.title} is sample content.`)}><img src={track.cover} alt="" loading="lazy"/><span><b>{track.title}</b><small>{track.artist}</small></span></button>)}</div>
    </section>
    <section className="rx-home-section rx-made-for-you">
      <div className="rx-section-title"><h2>Made for You</h2></div>
      <div className="rx-mix-row"><button className="rx-mix-card rx-mix-red" onClick={() => onToast('Daily Mix is sample content.')}><span><b>Daily Mix</b><small>Your everyday mix</small></span><i><Play size={16} fill="currentColor"/></i></button><button className="rx-mix-card rx-mix-dark" onClick={() => onToast('Discover Weekly is sample content.')}><span><b>Discover Weekly</b><small>New music for you</small></span><i><Play size={16} fill="currentColor"/></i></button></div>
    </section>
  </div>;
}

function LibraryPage({ username, avatar, onProfile, navigate, onToast, onToggleFullscreen, isFullscreen }: { username: string; avatar: string; onProfile: () => void; navigate: (path: string) => void; onToast: (message: string) => void; onToggleFullscreen: () => void; isFullscreen: boolean }) {
  const [tab, setTab] = useState(() => { const params = new URLSearchParams(window.location.hash.split('?')[1] ?? ''); return params.get('tab') === 'playlists' ? 'Playlists' : params.get('tab') === 'albums' ? 'Albums' : params.get('tab') === 'artists' ? 'Artists' : 'Music'; });
  const tabs = ['Music', 'Playlists', 'Albums', 'Artists'];
  const artists = Array.from(new Map(TRACKS.map(track => [track.artist, track])).values());
  return <div className="rx-page rx-library-page">
    <header className="rx-page-header"><h1>Library</h1><HeaderActions username={username} avatar={avatar} onProfile={onProfile} onSearch={() => navigate('/discover')} onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/></header>
    <div className="rx-segmented-control" role="tablist" aria-label="Library views">{tabs.map(item => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === 'Music' && <>
      <div className="rx-library-shortcuts">
        {[
          { title: 'Liked Songs', count: '542 songs', Icon: Heart },
          { title: 'Recently Played', count: '28 songs', Icon: Clock3 },
        ].map(({ title, count, Icon }) => <button className="rx-library-shortcut" key={title} onClick={() => onToast(`${title} is sample library content.`)}><span className="rx-shortcut-icon"><Icon size={31} strokeWidth={1.6}/></span><span className="rx-shortcut-copy"><b>{title}</b><small>{count}</small></span><ChevronRight size={21}/></button>)}
      </div>
      <div className="rx-library-section-head"><h2>Your Playlists</h2><button onClick={() => onToast('Playlist creation will be connected with the backend later.')}>New Playlist <Plus size={20}/></button></div>
      <PlaylistRows onToast={onToast}/>
    </>}
    {tab === 'Playlists' && <><div className="rx-library-section-head"><h2>Your Playlists</h2><button onClick={() => onToast('Playlist creation will be connected later.')}>New Playlist <Plus size={20}/></button></div><PlaylistRows onToast={onToast}/></>}
    {tab === 'Albums' && <div className="rx-library-albums">{TRACKS.map(track => <button className="rx-library-album" key={track.album} onClick={() => onToast(`${track.album} is sample content.`)}><img src={track.cover} alt=""/><b>{track.album}</b><small>{track.artist}</small></button>)}</div>}
    {tab === 'Artists' && <div className="rx-library-artists">{artists.map(track => <button key={track.artist} onClick={() => onToast(`${track.artist} is sample content.`)}><img src={track.cover} alt=""/><span><b>{track.artist}</b><small>Artist</small></span><ChevronRight size={18}/></button>)}</div>}
  </div>;
}

function PlaylistRows({ onToast }: { onToast: (message: string) => void }) {
  return <div className="rx-playlist-rows">{PLAYLISTS.map(item => <div className="rx-playlist-row" key={item.id}><button className="rx-playlist-row-main" onClick={() => onToast(`${item.title} is sample playlist content.`)}><img src={item.cover} alt="" loading="lazy"/><span><b>{item.title}</b><small>{item.count} songs</small></span></button><button className="rx-more-button" onClick={() => onToast(`More options for ${item.title}.`)} aria-label={`More options for ${item.title}`}><MoreHorizontal size={24}/></button></div>)}</div>;
}

function DiscoverPage({ onToast, onToggleFullscreen, isFullscreen }: { onToast: (message: string) => void; onToggleFullscreen: () => void; isFullscreen: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [history, setHistory] = useState(['The Weeknd', 'SZA', 'After Hours']);
  const filters = ['All', 'Songs', 'Artists', 'Albums', 'Playlists'];
  const catalog = useMemo(() => {
    const songs = TRACKS.map(track => ({ id: `song-${track.id}`, title: track.title, subtitle: `${track.artist} · ${track.album}`, kind: 'Songs', cover: track.cover }));
    const artists = Array.from(new Map(TRACKS.map(track => [track.artist, track])).values()).map(track => ({ id: `artist-${track.artist}`, title: track.artist, subtitle: 'Artist', kind: 'Artists', cover: track.cover }));
    const albums = Array.from(new Map(TRACKS.map(track => [track.album, track])).values()).map(track => ({ id: `album-${track.album}`, title: track.album, subtitle: `${track.artist} · Album`, kind: 'Albums', cover: track.cover }));
    const playlists = PLAYLISTS.map(item => ({ id: `playlist-${item.id}`, title: item.title, subtitle: `${item.count} songs · Playlist`, kind: 'Playlists', cover: item.cover }));
    return [...songs, ...artists, ...albums, ...playlists];
  }, []);
  const results = useMemo(() => catalog.filter(item => {
    const matchesFilter = filter === 'All' || item.kind === filter;
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || `${item.title} ${item.subtitle}`.toLowerCase().includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  }), [catalog, filter, query]);
  const submitSearch = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setQuery(normalized);
    setHistory(current => [normalized, ...current.filter(item => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 5));
  };
  return <div className="rx-page rx-search-page rx-original-search-page">
    <header className="rx-original-search-heading"><div><h1>Search</h1><p>Find songs, artists, albums and playlists.</p></div><FullscreenAction onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/></header>
    <label className="rx-original-searchbox"><Search size={22}/><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitSearch(query); }} placeholder="Songs, artists, albums, playlists" aria-label="Search REX"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={17}/></button>}</label>
    <div className="rx-original-filter-row" role="tablist" aria-label="Search filters">{filters.map(item => <button key={item} role="tab" aria-selected={filter === item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {query.trim() ? <section className="rx-original-results"><div className="rx-original-section-title"><h2>Results</h2><span>{results.length} found</span></div>{results.length ? results.map(item => <button className="rx-original-result" key={item.id} onClick={() => onToast(`${item.title} is sample discovery content.`)}><img src={item.cover} alt="" loading="lazy"/><span><b>{item.title}</b><small>{item.subtitle}</small></span><ChevronRight size={18}/></button>) : <p className="rx-original-empty">No matches. Try another search.</p>}</section> : <section className="rx-original-history"><div className="rx-original-section-title"><h2>Recent searches</h2><button onClick={() => setHistory([])}>Clear</button></div>{history.length ? history.map(item => <button key={item} className="rx-original-history-row" onClick={() => submitSearch(item)}><span><Search size={17}/></span><b>{item}</b><ChevronRight size={17}/></button>) : <p className="rx-original-empty">Your recent searches will appear here.</p>}<div className="rx-original-discovery-note"><span>DISCOVER SOMETHING NEW</span><b>Start with a song, an artist, or an album.</b><small>Search across your music universe with REX.</small></div></section>}
  </div>;
}

function QualitySlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const options = [
    { name: 'Data Saver', sub: 'Uses less mobile data', bitrate: 'LOW' },
    { name: 'Balanced', sub: 'A clear everyday listen', bitrate: 'STANDARD' },
    { name: 'High', sub: 'Best available stream quality', bitrate: '320 KBPS' },
  ];
  const current = options[value];
  return <div className="rx-quality-panel">
    <div className="rx-quality-value"><div><small>STREAMING QUALITY</small><b>{current.name}</b><span>{current.sub}</span></div><strong>{current.bitrate}</strong></div>
    <SoapBubbleSlider className="rx-quality-slider" value={value} min={0} max={2} step={1} scale={0.92} label="Audio quality" onValueChange={onChange} from="#9b263d" to="#ff4562" glass={1.12} tint="rgba(255,255,255,.025)" iridescence={0.01} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={1.9} refraction={0.5} dispersion={1.1} bevel={9} wobble={0.27} maxDpr={1.2}/>
    <div className="rx-quality-options">{options.map((option, index) => <button key={option.name} className={index === value ? 'active' : ''} onClick={() => onChange(index)}>{option.name}</button>)}</div>
    <p className="rx-quality-note">Available quality depends on the audio source. High quality does not mean lossless.</p>
  </div>;
}

function LyricsSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <div className="rx-lyrics-panel"><div className="rx-lyrics-sample" style={{ fontSize: `${13 + value * .055}px` }}>Let the music say it for you.</div><SoapBubbleSlider className="rx-lyrics-slider" value={value} min={0} max={100} step={1} scale={0.84} label="Lyrics text size" onValueChange={onChange} from="#9b263d" to="#ff4562" glass={1.08} tint="rgba(255,255,255,.02)" iridescence={0.01} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={1.8} refraction={0.45} dispersion={1} bevel={9} wobble={0.25} maxDpr={1.2}/><div className="rx-lyrics-range-labels"><span>Aa</span><span>Text size</span><span className="large-aa">Aa</span></div></div>;
}

function GlassToggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <SoapBubbleToggle className="rx-glass-toggle" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled} color="#ee3154" scale={0.94} glass={1.16} tint="rgba(255,255,255,.035)" iridescence={0.012} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={2} refraction={0.5} dispersion={1.15} bevel={10} wobble={0.4} maxDpr={1.2}/>;
}

function SettingRow({ icon: Icon, title, subtitle, onClick, trailing, last = false }: { icon: LucideIcon; title: string; subtitle?: string; onClick?: () => void; trailing?: ReactNode; last?: boolean }) {
  const content = <><span className="rx-setting-icon"><Icon size={24} strokeWidth={1.65}/></span><span className="rx-setting-copy"><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>{trailing ?? <ChevronRight size={21} className="rx-setting-chevron"/>}</>;
  return onClick ? <button className={`rx-setting-entry ${last ? 'last' : ''}`} onClick={onClick}>{content}</button> : <div className={`rx-setting-entry ${last ? 'last' : ''}`}>{content}</div>;
}

function SettingsPage({ username, avatar, onProfile, onToast, navigate, onToggleFullscreen, isFullscreen, isStandalone }: {
  username: string; avatar: string; onProfile: () => void; onToast: (message: string) => void; navigate: (path: string) => void;
  onToggleFullscreen: () => void; isFullscreen: boolean; isStandalone: boolean;
}) {
  const [qualityOpen, setQualityOpen] = useState(false);
  const [behaviourOpen, setBehaviourOpen] = useState(false);
  const [quality, setQuality] = useState(() => Math.max(0, Math.min(2, Number(readStore('rex.preview.quality', 2)))));
  const [lyricsSize, setLyricsSize] = useState(() => Math.max(0, Math.min(100, Number(readStore('rex.preview.lyrics-size', 50)))));
  const [toggles, setToggles] = useState(() => ({ lyrics: true, autoplay: true, crossfade: false, gapless: true, normalize: false, ...readStore<Partial<{ lyrics: boolean; autoplay: boolean; crossfade: boolean; gapless: boolean; normalize: boolean }>>('rex.preview.toggles', {}) }));
  const setToggle = (key: keyof typeof toggles, value: boolean) => { const next = { ...toggles, [key]: value }; setToggles(next); writeStore('rex.preview.toggles', next); };
  return <div className="rx-page rx-settings-page">
    <header className="rx-settings-header"><button onClick={() => navigate('/')} aria-label="Back to home"><ArrowLeft size={25}/></button><h1>Settings</h1><FullscreenAction onToggleFullscreen={onToggleFullscreen} isFullscreen={isFullscreen}/></header>
    <button className="rx-account-card" onClick={onProfile}><Avatar id={avatar} size={84}/><span><b>{username}</b><small>REX Account</small></span><ChevronRight size={22}/></button>
    <section className="rx-settings-group"><h2>Playback</h2><div className="rx-settings-panel">
      <SettingRow icon={SlidersHorizontal} title="Audio Quality" subtitle={`${['Data Saver', 'Balanced', 'High (320 kbps)'][quality]}`} onClick={() => setQualityOpen(open => !open)}/>
      <AnimatePresence>{qualityOpen && <motion.div className="rx-settings-expanded" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}><QualitySlider value={quality} onChange={value => { setQuality(value); writeStore('rex.preview.quality', value); }}/></motion.div>}</AnimatePresence>
      <SettingRow icon={AudioLines} title="Playback Behaviour" subtitle="Crossfade, Gapless Playback" onClick={() => setBehaviourOpen(open => !open)}/>
      <AnimatePresence>{behaviourOpen && <motion.div className="rx-settings-expanded rx-behaviour-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}><div><span><b>Autoplay</b><small>Continue when your queue ends</small></span><GlassToggle label="Autoplay" checked={toggles.autoplay} onChange={value => setToggle('autoplay', value)}/></div><div><span><b>Crossfade</b><small>Blend between tracks</small></span><GlassToggle label="Crossfade" checked={toggles.crossfade} onChange={value => setToggle('crossfade', value)}/></div><div><span><b>Gapless Playback</b><small>Remove silence between tracks</small></span><GlassToggle label="Gapless Playback" checked={toggles.gapless} onChange={value => setToggle('gapless', value)}/></div><div><span><b>Sound Normalization</b><small>Keep playback volume consistent</small></span><GlassToggle label="Sound normalization" checked={toggles.normalize} onChange={value => setToggle('normalize', value)}/></div></motion.div>}</AnimatePresence>
      <div className="rx-setting-entry rx-setting-lyrics last"><span className="rx-setting-icon"><Headphones size={24} strokeWidth={1.65}/></span><span className="rx-setting-copy"><b>Lyrics</b><small>Show synced lyrics (Karaoke)</small></span><GlassToggle label="Lyrics" checked={toggles.lyrics} onChange={value => setToggle('lyrics', value)}/></div>
      {toggles.lyrics && <div className="rx-settings-expanded rx-lyrics-expanded"><div className="rx-lyrics-caption">LYRICS TEXT SIZE</div><LyricsSlider value={lyricsSize} onChange={value => { setLyricsSize(value); writeStore('rex.preview.lyrics-size', value); }}/></div>}
    </div></section>
    <section className="rx-settings-group"><h2>More</h2><div className="rx-settings-panel">
      <SettingRow icon={Maximize2} title="Fullscreen" subtitle={isStandalone ? 'Home Screen app mode' : isFullscreen ? 'Fullscreen is active' : 'Use the full available display'} onClick={onToggleFullscreen}/>
      <SettingRow icon={Info} title="About REX" subtitle="Version 1.0.0" onClick={() => navigate('/about')} last/>
    </div></section>
    <p className="rx-settings-footnote">REX · MADE FOR THE MUSIC</p>
  </div>;
}

function MiniPlayer({ onToast }: { onToast: (message: string) => void }) {
  const [playing, setPlaying] = useState(true);
  return <div className="rx-mini-player"><img src={TRACKS[0].cover} alt=""/><div className="rx-mini-meta"><b>After Hours</b><small>The Weeknd</small></div><div className="rx-mini-controls"><button aria-label="Previous track" onClick={() => onToast('Previous track is a demo action.')}><SkipBack size={22}/></button><button className="rx-mini-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={21} fill="currentColor"/> : <Play size={21} fill="currentColor"/>}</button><button aria-label="Next track" onClick={() => onToast('Next track is a demo action.')}><SkipForward size={22}/></button></div><span className="rx-mini-progress"><i/></span></div>;
}

function AboutPage({ navigate }: { navigate: (path: string) => void }) {
  return <div className="rx-page rx-about-page"><header className="rx-settings-header"><button onClick={() => navigate('/settings')} aria-label="Back to settings"><ArrowLeft size={25}/></button><h1>About REX</h1></header><div className="rx-about-mark">REX<span>.</span></div><h2>Music, without the noise.</h2><p>REX is a personal music space built around discovery, the albums you return to, and the moments you want to keep.</p><div className="rx-about-meta"><span>VERSION</span><b>1.0.0 · FRONTEND PREVIEW</b></div></div>;
}
function LoadingPage({ navigate }: { navigate: (path: string) => void }) {
  return <div className="rx-loading-page"><div className="rx-loading-logo">REX<span>.</span></div><div className="rx-loading-bars">{Array.from({ length: 5 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 90}ms` }}/>)}</div><p>MADE FOR THE MUSIC</p><BubbleAction onClick={() => navigate('/')}>Continue <ChevronRight size={16}/></BubbleAction></div>;
}
function NotFoundPage({ navigate }: { navigate: (path: string) => void }) {
  return <div className="rx-notfound-page"><div>404</div><h1>Lost the track?</h1><p>This page doesn't exist. Let's get you back to the music.</p><BubbleAction onClick={() => navigate('/')}>Back to REX <Home size={16}/></BubbleAction></div>;
}
function CookieConsent({ onClose }: { onClose: (choice: 'all' | 'essential') => void }) {
  return <motion.aside className="rx-cookie-banner" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }}><div><ShieldCheck size={19}/><span><b>Your privacy matters.</b><small>This preview uses local storage for your profile and preferences. No analytics or advertising cookies.</small></span></div><div className="rx-cookie-actions"><button onClick={() => onClose('essential')}>Essential only</button><BubbleAction onClick={() => onClose('all')}>Accept cookies <Check size={14}/></BubbleAction></div></motion.aside>;
}
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 2600); return () => window.clearTimeout(timer); }, [message, onClose]);
  return <motion.div className="rx-toast" role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><Check size={15}/>{message}<button onClick={onClose} aria-label="Dismiss"><X size={14}/></button></motion.div>;
}

export default function PreviewApp() {
  const [route, setRoute] = useState(routeFromHash);
  const [username, setUsernameState] = useState(() => readStore('rex.preview.username', 'Rajnil'));
  const [avatar, setAvatarState] = useState(() => readStore('rex.preview.avatar', 'avatar-1'));
  const [profileOpen, setProfileOpen] = useState(false);
  const [cookieChoice, setCookieChoice] = useState(() => readStore<string | null>('rex.preview.cookies', null));
  const [toast, setToast] = useState('');
  const [booting, setBooting] = useState(true);
  const [isStandalone, setIsStandalone] = useState(isStandaloneDisplay);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement) || isStandaloneDisplay());
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    const timer = window.setTimeout(() => setBooting(false), 1000);
    document.title = 'REX — Music';
    document.documentElement.setAttribute('data-theme', 'dark');
    return () => { window.removeEventListener('hashchange', onHash); window.clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const sync = () => { const standalone = isStandaloneDisplay(); setIsStandalone(standalone); setIsFullscreen(Boolean(document.fullscreenElement) || standalone); };
    const media = window.matchMedia?.('(display-mode: standalone)');
    document.addEventListener('fullscreenchange', sync); window.addEventListener('pageshow', sync); media?.addEventListener?.('change', sync); sync();
    return () => { document.removeEventListener('fullscreenchange', sync); window.removeEventListener('pageshow', sync); media?.removeEventListener?.('change', sync); };
  }, []);
  useEffect(() => { document.querySelector('.rx-content-scroll')?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [route.path]);
  const navigate = (path: string) => { window.location.hash = `#${path}`; setRoute(routeFromHash()); };
  const notify = (message: string) => setToast(message);
  const setUsername = (value: string) => { setUsernameState(value); writeStore('rex.preview.username', value); };
  const setAvatar = (value: string) => { setAvatarState(value); writeStore('rex.preview.avatar', value); };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (isStandaloneDisplay()) notify('REX is already using its Home Screen app view.');
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else notify('Fullscreen is not available here. Add REX to your Home Screen for an app-like view.');
    } catch { notify('Your browser blocked fullscreen. Add REX to your Home Screen for an app-like view.'); }
  };
  let page;
  if (route.page === 'home') page = <HomePage username={username} avatar={avatar} onProfile={() => setProfileOpen(true)} onToast={notify} navigate={navigate} onToggleFullscreen={toggleFullscreen} isFullscreen={isFullscreen}/>;
  else if (route.page === 'discover') page = <DiscoverPage onToast={notify} onToggleFullscreen={toggleFullscreen} isFullscreen={isFullscreen}/>;
  else if (route.page === 'library') page = <LibraryPage username={username} avatar={avatar} onProfile={() => setProfileOpen(true)} navigate={navigate} onToast={notify} onToggleFullscreen={toggleFullscreen} isFullscreen={isFullscreen}/>;
  else if (route.page === 'settings') page = <SettingsPage username={username} avatar={avatar} onProfile={() => setProfileOpen(true)} onToast={notify} navigate={navigate} onToggleFullscreen={toggleFullscreen} isFullscreen={isFullscreen} isStandalone={isStandalone}/>;
  else if (route.page === 'about') page = <AboutPage navigate={navigate}/>;
  else if (route.page === 'loading') page = <LoadingPage navigate={navigate}/>;
  else page = <NotFoundPage navigate={navigate}/>;

  const showChrome = !['about', 'loading', 'not-found'].includes(route.page);
  return <RexBubbleMaterial><div id="rex-root" className={`rex-preview-root${showChrome ? '' : ' rx-no-chrome'}`}>
    <div className="rx-ambient-glow" aria-hidden="true"/>
    <main className="rx-content-scroll"><AnimatePresence mode="wait" initial={false}><motion.div key={route.path} className="rx-route-stage" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .2, ease: [0.22, 1, .36, 1] }}>{page}</motion.div></AnimatePresence></main>
    {showChrome && <><MiniPlayer onToast={notify}/><PreviewNavigation path={route.path} navigate={navigate}/></>}
    <AnimatePresence>{!cookieChoice && !booting && <CookieConsent onClose={choice => { setCookieChoice(choice); writeStore('rex.preview.cookies', choice); }}/>}</AnimatePresence>
    <AnimatePresence>{profileOpen && <ProfileMenu username={username} setUsername={setUsername} avatar={avatar} setAvatar={setAvatar} close={() => setProfileOpen(false)} navigate={navigate}/>}</AnimatePresence>
    <AnimatePresence>{toast && <Toast message={toast} onClose={() => setToast('')}/>}</AnimatePresence>
    <AnimatePresence>{booting && <motion.div className="rx-splash-screen" exit={{ opacity: 0 }} transition={{ duration: .32 }}><LoadingPage navigate={navigate}/></motion.div>}</AnimatePresence>
  </div></RexBubbleMaterial>;
}
