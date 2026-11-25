import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Library as LibraryIcon, Sparkles } from 'lucide-react';
import { api, img } from '../api';
import BubbleButton from '../components/BubbleButton';
import { SoapBubbleButton, SoapBubbleSlider, SoapBubbleToggle } from '../components/soap-bubble';
import { Actions, BlurText, ErrorBox, Fade, Shelf, Skeleton, Tile, TrackRow, go, useAsync } from '../components/ui';
import { playQueue, refreshLikes, reloadCurrentStream, usePlayer } from '../player/store';
import { type Entity, type Track, isTrack } from '../types';
import { safeGetItem, safeSetItem } from '../lib/storage';

const tracksOf = (l: Entity[]) => l.filter(isTrack);

// ---------------- Home ----------------
export function Home() {
  const h = useAsync(api.home, []);
  const lib = useAsync(api.library, []);
  const rec = lib.data?.recent ?? [];
  return (
    <div className="page home-page">
      <header className="home-masthead">
        <a className="home-wordmark" href="#/" aria-label="Rex home">
          <img src="/rex-wordmark.png" alt="rex." />
        </a>
        <div className="home-edition"><span className="home-edition-dot" /> PERSONAL LISTENING</div>
      </header>
      <header className="hero home-hero">
        <div className="home-eyebrow"><span>YOUR SOUND, YOUR SPACE</span><i /></div>
        <BlurText text="Find the sound of right now." className="display" />
        <p className="sub">A soundtrack for every side of you.</p>
        <div className="home-quick-actions" aria-label="Quick actions">
          <button type="button" className="home-quick-card home-quick-discover" onClick={() => go('/search')}>
            <span className="home-quick-icon"><Sparkles size={20} strokeWidth={1.8} /></span>
            <span className="home-quick-copy"><small>FIND YOUR NEXT FAVOURITE</small><b>Discover music</b><em>Search songs and artists</em></span>
            <ArrowUpRight className="home-quick-arrow" size={19} />
          </button>
          <button type="button" className="home-quick-card home-quick-library" onClick={() => go('/library')}>
            <span className="home-quick-icon"><LibraryIcon size={20} strokeWidth={1.8} /></span>
            <span className="home-quick-copy"><small>YOUR COLLECTION</small><b>Open your library</b><em>Playlists, likes and history</em></span>
            <ArrowUpRight className="home-quick-arrow" size={19} />
          </button>
        </div>
      </header>
      {rec.length > 0 && <Shelf title="Recently Played" items={rec} onPlayTrack={i => playQueue(rec, i)} />}
      {h.loading && <Skeleton />}
      {h.error && <ErrorBox msg={h.error} retry={h.retry} />}
      {h.data?.shelves.map(s => <Shelf key={s.title} title={s.title} items={s.items} onPlayTrack={i => playQueue(tracksOf(s.items), tracksOf(s.items).indexOf(s.items[i] as Track))} />)}
      {h.data?.charts?.songs.length ? <Shelf title="Top Charts" items={h.data.charts.songs} onPlayTrack={i => playQueue(h.data!.charts!.songs, i)} /> : null}
      {h.data?.charts?.artists.length ? <Shelf title="Featured Artists" items={h.data.charts.artists} /> : null}
      {h.data?.moods.length ? (
        <Fade><section className="shelf"><h2>Genres &amp; Moods</h2>
          <div className="chips">{h.data.moods.map(m => <BubbleButton key={m.params} className="chip" onClick={() => go(`/mood/${encodeURIComponent(m.params)}?t=${encodeURIComponent(m.title)}`)}>{m.title}</BubbleButton>)}</div>
        </section></Fade>
      ) : null}
    </div>
  );
}

// ---------------- Search ----------------
const FILTERS = [['all', 'All'], ['songs', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['playlists', 'Playlists']];
export function Search() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sug, setSug] = useState<string[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [state, setState] = useState<{ loading: boolean; error?: string; results: Entity[] }>({ loading: false, results: [] });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); api.searchHistory().then(h => setHist(h.history)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!q.trim()) { setState({ loading: false, results: [] }); setSug([]); return; }
    const t = setTimeout(() => {
      setState(s => ({ ...s, loading: true, error: undefined }));
      api.search(q, filter).then(r => setState({ loading: false, results: r.results })).catch(e => setState({ loading: false, error: e.message, results: [] }));
      api.suggest(q).then(s => setSug(s.suggestions)).catch(() => setSug([]));
    }, 350);
    return () => clearTimeout(t);
  }, [q, filter]);
  const songs = tracksOf(state.results);
  return (
    <div className="page">
      <h1 className="title">Search</h1>
      <input ref={input} type="search" className="searchbox" value={q} onChange={e => setQ(e.target.value)} placeholder="Songs, artists, albums, playlists" aria-label="Search songs, artists, albums and playlists" />
      <div className="chips">{FILTERS.map(([k, l]) => <BubbleButton key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</BubbleButton>)}</div>
      {!q && hist.length > 0 && <div className="chips">{hist.map(h => <BubbleButton key={h} className="chip ghost" onClick={() => setQ(h)}>↺ {h}</BubbleButton>)}</div>}
      {q && sug.length > 0 && state.results.length === 0 && <div className="chips">{sug.map(s => <BubbleButton key={s} className="chip ghost" onClick={() => setQ(s)}>{s}</BubbleButton>)}</div>}
      {state.loading && <Skeleton n={4} />}
      {state.error && <ErrorBox msg={state.error} />}
      {!state.loading && !state.error && q && state.results.length === 0 && <p className="dim">No results for “{q}”.</p>}
      <div className="results">
        {state.results.map((e, i) => isTrack(e)
          ? <TrackRow key={e.videoId + i} t={e} i={songs.indexOf(e)} list={songs} />
          : <button key={e.id + i} className="crow" onClick={() => go(`/${e.type}/${encodeURIComponent(e.id)}`)}>
            <img crossOrigin="anonymous" className={e.type === 'artist' ? 'round' : ''} src={img(e.thumb)} alt="" /><span><b>{e.title}</b><em>{e.type} · {e.subtitle}</em></span></button>)}
      </div>
    </div>
  );
}

// ---------------- Detail pages ----------------
export function Detail({ kind, id }: { kind: 'album' | 'artist' | 'playlist' | 'mood' | 'mine'; id: string }) {
  const r = useAsync<any>(async () => {  // eslint-disable-line @typescript-eslint/no-explicit-any
    if (kind === 'album') return api.album(id);
    if (kind === 'artist') return api.artist(id);
    if (kind === 'playlist') return api.playlist(id);
    if (kind === 'mood') return api.mood(id);
    return api.localPlaylist(id);
  }, [kind, id]);
  const p = usePlayer();
  const [saved, setSaved] = useState(false);
  const [localTracks, setLocal] = useState<Track[] | null>(null);
  useEffect(() => { if (kind === 'mine' && r.data) setLocal(r.data.tracks); }, [r.data, kind]);
  useEffect(() => { api.library().then(l => setSaved(!!l.saved[kind]?.some(c => c.id === id))).catch(() => undefined); }, [kind, id]);
  if (r.loading) return <div className="page"><Skeleton n={4} /></div>;
  if (r.error) return <div className="page"><ErrorBox msg={r.error} retry={r.retry} /></div>;
  const d = r.data;
  void p;

  if (kind === 'mood') return <div className="page"><h1 className="title">{new URLSearchParams(location.hash.split('?')[1]).get('t') ?? 'Mood'}</h1><div className="row-wrap">{d.results.map((c: Entity, i: number) => <Tile key={i} e={c} />)}</div></div>;

  const tracks: Track[] = kind === 'mine' ? localTracks ?? [] : d.tracks ?? d.songs ?? [];
  const title = d.title ?? d.name;
  const sub = kind === 'album' ? `${d.artist}${d.year ? ' · ' + d.year : ''}` : kind === 'playlist' ? d.author : kind === 'mine' ? `${tracks.length} songs` : '';
  const toggleSave = async () => {
    if (kind === 'mine') return;
    const card = { type: kind, id, title, subtitle: sub, thumb: d.thumb };
    try { const s = await api.toggleSaved(kind, id, card as never); setSaved(s.saved); } catch { /* shown via no change */ }
  };
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= tracks.length) return;
    const n = [...tracks]; [n[i], n[j]] = [n[j], n[i]]; setLocal(n);
    await api.reorder(id, n.map(t => t.videoId));
  };
  const remove = async (t: Track) => { await api.removeFromPlaylist(id, t.videoId); setLocal(tracks.filter(x => x.videoId !== t.videoId)); };

  return (
    <div className="page">
      <BubbleButton className="pill back" onClick={() => history.back()}>‹ Back</BubbleButton>
      <div className="dhead">
        {d.thumb && <img crossOrigin="anonymous" className={kind === 'artist' ? 'round' : ''} src={img(d.thumb)} alt="" />}
        <div><h1 className="title">{title}</h1><p className="dim">{sub}</p>
          <Actions tracks={tracks} extra={<>
            {kind !== 'mine' && <BubbleButton className="pill" onClick={toggleSave}>{saved ? '✓ In Library' : kind === 'artist' ? '+ Save Artist' : '+ Add to Library'}</BubbleButton>}
            {kind === 'mine' && <>
              <BubbleButton className="pill" onClick={async () => { const n = prompt('Rename playlist', title); if (n?.trim()) { await api.renamePlaylist(id, n.trim()); r.retry(); } }}>Rename</BubbleButton>
              <BubbleButton className="pill danger" onClick={async () => { if (confirm('Delete this playlist?')) { await api.deletePlaylist(id); go('/library'); } }}>Delete</BubbleButton></>}
          </>} />
        </div>
      </div>
      {kind === 'artist' && d.description && <p className="bio">{d.description.slice(0, 380)}{d.description.length > 380 ? '…' : ''}</p>}
      {tracks.length > 0 && <div className="results">{tracks.map((t, i) => <TrackRow key={t.videoId} t={t} i={i} list={tracks}
        onRemove={kind === 'mine' ? () => remove(t) : undefined} onMove={kind === 'mine' ? dir => move(i, dir) : undefined} />)}</div>}
      {kind === 'mine' && tracks.length === 0 && <p className="dim">This playlist is empty. Use “⋯ → Add to playlist” on any song.</p>}
      {kind === 'artist' && <>
        <Shelf title="Albums" items={d.albums} /><Shelf title="Singles" items={d.singles} /><Shelf title="Related Artists" items={d.related} />
      </>}
    </div>
  );
}

// ---------------- Library ----------------
export function Library() {
  const r = useAsync(api.library, []);
  const [name, setName] = useState('');
  const [view, setView] = useState<'overview' | 'liked' | 'playlists' | 'recent' | 'saved'>('overview');
  const [creating, setCreating] = useState(false);
  useEffect(() => { refreshLikes(); }, []);
  if (r.loading) return <div className="page"><h1 className="title">Your Library</h1><Skeleton n={4} /></div>;
  if (r.error || !r.data) return <div className="page"><h1 className="title">Your Library</h1><ErrorBox msg={r.error ?? 'Unavailable'} retry={r.retry} /></div>;
  const l = r.data;
  const savedAlbums = l.saved.album ?? [];
  const savedArtists = l.saved.artist ?? [];
  const savedPlaylists = l.saved.playlist ?? [];
  const create = async () => {
    if (!name.trim()) return;
    try { await api.createPlaylist(name.trim()); setName(''); setCreating(false); r.retry(); }
    catch (e) { window.alert((e as Error).message); }
  };
  const tabs = [
    ['overview', 'Overview'], ['liked', 'Liked Songs'], ['playlists', 'Playlists'], ['recent', 'Recently Played'], ['saved', 'Saved']
  ] as const;
  return (
    <div className="page library-page">
      <header className="library-header">
        <div><span className="section-kicker">REX MUSIC</span><h1 className="title">Your Library</h1><p className="dim">Everything you love, in one place.</p></div>
        <SoapBubbleButton
          className="library-create"
          radius={9999}
          onClick={() => setCreating(v => !v)}
          aria-expanded={creating}
          aria-label={creating ? 'Close new playlist form' : 'Create a new playlist'}
        ><span className="library-create-plus">＋</span><span className="library-create-label">New playlist</span></SoapBubbleButton>
      </header>
      {creating && <form className="library-create-form" onSubmit={e => { e.preventDefault(); void create(); }}>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Give your playlist a name" aria-label="Playlist name" />
        <BubbleButton className="pill primary" type="submit" disabled={!name.trim()}>Create playlist</BubbleButton>
        <BubbleButton className="pill ghost" type="button" onClick={() => { setCreating(false); setName(''); }}>Cancel</BubbleButton>
      </form>}
      <nav className="library-tabs" aria-label="Library sections">
        {tabs.map(([key, label]) => <BubbleButton key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</BubbleButton>)}
      </nav>

      {view === 'overview' && <>
        <section className="library-feature-grid">
          <button className="library-feature liked-feature" onClick={() => setView('liked')}>
            <div className="library-feature-art"><span>♥</span></div>
            <div><span className="section-kicker">YOUR FAVOURITES</span><b>Liked Songs</b><small>{l.likes.length} songs</small></div>
            <span className="feature-arrow">›</span>
          </button>
          <button className="library-feature recent-feature" onClick={() => setView('recent')}>
            <div className="library-feature-art"><span>◷</span></div>
            <div><span className="section-kicker">PICK UP WHERE YOU LEFT OFF</span><b>Recently Played</b><small>{l.recent.length} tracks</small></div>
            <span className="feature-arrow">›</span>
          </button>
        </section>
        <section className="shelf library-shelf">
          <div className="library-section-heading"><div><span className="section-kicker">MADE BY YOU</span><h2>Playlists</h2></div><BubbleButton className="text-action" onClick={() => setView('playlists')}>See all</BubbleButton></div>
          {l.playlists.length ? <div className="library-playlist-grid">{l.playlists.map((playlist, i) => <button key={playlist.id} className={`library-playlist-card tone-${i % 5}`} onClick={() => go(`/mine/${playlist.id}`)}>
            <span className="playlist-cover"><span>♫</span></span><b>{playlist.name}</b><small>{playlist.count} {playlist.count === 1 ? 'song' : 'songs'}</small>
          </button>)}</div> : <div className="library-empty"><span>♫</span><b>Your playlists start here</b><p>Create a collection for every mood, moment or memory.</p><BubbleButton className="pill" onClick={() => setCreating(true)}>Create your first playlist</BubbleButton></div>}
        </section>
        {l.recent.length > 0 && <Shelf title="Recently Played" items={l.recent} onPlayTrack={i => playQueue(l.recent, i)} />}
        {savedAlbums.length > 0 && <Shelf title="Saved Albums" items={savedAlbums} />}
        {savedArtists.length > 0 && <Shelf title="Saved Artists" items={savedArtists} />}
        {savedPlaylists.length > 0 && <Shelf title="Saved Playlists" items={savedPlaylists} />}
      </>}

      {view === 'liked' && <section className="library-content-section">
        <div className="library-list-hero liked-list-hero"><span>♥</span><div><span className="section-kicker">YOUR FAVOURITES</span><h2>Liked Songs</h2><p>{l.likes.length} songs saved for you</p></div></div>
        {l.likes.length ? <><Actions tracks={l.likes} /><div className="results">{l.likes.map((t, i) => <TrackRow key={t.videoId} t={t} i={i} list={l.likes} />)}</div></> : <div className="library-empty"><span>♡</span><b>No liked songs yet</b><p>Use the heart on any track to keep it close.</p></div>}
      </section>}

      {view === 'playlists' && <section className="library-content-section">
        <div className="library-section-heading"><div><span className="section-kicker">MADE BY YOU</span><h2>Your Playlists</h2></div><BubbleButton className="text-action" onClick={() => setCreating(true)}>＋ Create</BubbleButton></div>
        {l.playlists.length ? <div className="library-playlist-grid">{l.playlists.map((playlist, i) => <button key={playlist.id} className={`library-playlist-card tone-${i % 5}`} onClick={() => go(`/mine/${playlist.id}`)}><span className="playlist-cover"><span>♫</span></span><b>{playlist.name}</b><small>{playlist.count} {playlist.count === 1 ? 'song' : 'songs'}</small></button>)}</div> : <div className="library-empty"><span>♫</span><b>No playlists yet</b><p>Build your first collection.</p><BubbleButton className="pill" onClick={() => setCreating(true)}>Create playlist</BubbleButton></div>}
      </section>}

      {view === 'recent' && <section className="library-content-section"><div className="library-section-heading"><div><span className="section-kicker">BACK IN ROTATION</span><h2>Recently Played</h2></div></div>
        {l.recent.length ? <div className="results">{l.recent.map((t, i) => <TrackRow key={t.videoId} t={t} i={i} list={l.recent} />)}</div> : <div className="library-empty"><span>◷</span><b>Your listening history is empty</b><p>Tracks you play will appear here.</p></div>}
      </section>}

      {view === 'saved' && <section className="library-content-section"><div className="library-section-heading"><div><span className="section-kicker">BOOKMARKED</span><h2>Saved Collection</h2></div></div>
        {savedAlbums.length + savedArtists.length + savedPlaylists.length ? <>
          <Shelf title="Albums" items={savedAlbums} /><Shelf title="Artists" items={savedArtists} /><Shelf title="Playlists" items={savedPlaylists} />
        </> : <div className="library-empty"><span>⌑</span><b>Nothing saved yet</b><p>Save albums, artists and playlists to find them here.</p></div>}
      </section>}
    </div>
  );
}

// The slider keeps its transient drag value locally; Settings only persists once
// the gesture is committed, avoiding a full Settings rerender for every pointer move.
function LyricsSizeControl({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="settings-range">
      <SoapBubbleSlider
        className="rex-lyrics-size-slider"
        label="Lyrics font size"
        min={20}
        max={56}
        step={1}
        value={draft}
        onValueChange={setDraft}
        onValueCommit={next => { setDraft(next); onCommit(next); }}
        from="#E44765"
        to="#F08A9E"
        scale={0.86}
        iridescence={0.04}
        oilOpacity={0}
        oilCoverage={0}
        tint="rgba(255,255,255,0.12)"
        reflectivity={1.58}
        refraction={0.24}
        dispersion={0.78}
        windowIntensity={1.12}
        glintIntensity={0.16}
        bevel={8}
      />
      <em>{draft}px</em>
    </div>
  );
}

// ---------------- Settings ----------------
export function Settings() {
  const [saved, setSaved] = useState('');
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [audioQuality, setAudioQuality] = useState(() => {
    const value = safeGetItem('rex.audioQuality');
    return value === 'data-saver' || value === 'high' ? value : 'balanced';
  });
  const [lyr, setLyr] = useState(() => {
    const fallback = { mode: 'karaoke', autoScroll: true, fontSize: 34 };
    const raw = safeGetItem('lm.lyrics');
    if (!raw) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
      const value = parsed as Record<string, unknown>;
      return {
        mode: 'karaoke',
        autoScroll: typeof value.autoScroll === 'boolean' ? value.autoScroll : true,
        fontSize: typeof value.fontSize === 'number' && Number.isFinite(value.fontSize) ? Math.max(18, Math.min(64, value.fontSize)) : 34,
      };
    } catch { return fallback; }
  });
  useEffect(() => {
    const onFullscreen = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);
  const setL = (p: object) => {
    const n = { ...lyr, ...p };
    setLyr(n);
    safeSetItem('lm.lyrics', JSON.stringify(n));
    if ('autoScroll' in p) window.dispatchEvent(new CustomEvent('rex-lyrics-preferences', { detail: n }));
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setSaved('Display preference updated.');
    } catch {
      setSaved('Fullscreen is not available in this browser tab. Add the app to your home screen for an immersive app-like experience.');
    }
  };
  return (
    <div className="page settings-page">
      <header className="settings-header"><span className="section-kicker">REX MUSIC</span><h1 className="title">Settings</h1><p className="dim">Your listening preferences and app controls.</p></header>

      <section className="settings-section">
        <div className="settings-section-title"><span className="settings-icon">◉</span><div><h2>Display</h2><p>Choose how Rex Music appears on your device.</p></div></div>
        <div className="settings-row settings-bubble-toggle-row">
          <span className="settings-row-icon">⛶</span><span className="settings-row-copy"><b>Fullscreen</b><small>Hide browser chrome when your browser supports it</small></span>
          <SoapBubbleToggle checked={fullscreen} onCheckedChange={checked => { if (checked !== fullscreen) void toggleFullscreen(); }} aria-label="Fullscreen" color="#E44765" scale={0.88} />
        </div>
      </section>

      <section className="settings-section audio-quality-section">
        <div className="settings-section-title"><span className="settings-icon">♫</span><div><h2>Audio quality</h2><p>Choose the stream profile used for the next track.</p></div></div>
        {/* Plain settings surface: no liquid-glass or bubble layer on quality controls. */}
        <div className="quality-panel">
          <div className="quality-options" role="group" aria-label="Streaming quality">
            {([['data-saver','Data saver','Lower bitrate'],['balanced','Balanced','Everyday listening'],['high','High','Best available']] as const).map(([value,label,desc]) =>
              <BubbleButton key={value} className={`quality-option ${audioQuality === value ? 'active' : ''}`} onClick={() => { setAudioQuality(value); safeSetItem('rex.audioQuality', value); setSaved(`${label} quality will be used for the next track.`); }} aria-pressed={audioQuality === value}>
                <span className="quality-radio"/><span><b>{label}</b><small>{desc}</small></span>
              </BubbleButton>
            )}
          </div>
          <div className="quality-apply-row"><span>Changing quality reloads the current track at its present position.</span><BubbleButton className="quality-apply" onClick={() => { reloadCurrentStream(); setSaved('Re-resolving the current track with the selected audio profile.'); }}>Apply to current track</BubbleButton></div>
        </div>
        <div className="quality-lossless"><span><b>Lossless audio</b><small>This YouTube-derived source only supplies compressed audio. Rex won't label it lossless or upsample it.</small></span><span className="quality-unavailable">Unavailable</span></div>
        <p className="settings-note">High selects the best audio format the source exposes. Data saver prefers a lower-bitrate stream when available. Actual bitrate varies by track and provider.</p>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><span className="settings-icon">♫</span><div><h2>Lyrics &amp; karaoke</h2><p>Follow every word as the song plays.</p></div></div>
        <div className="settings-row"><span className="settings-row-icon">♫</span><span className="settings-row-copy"><b>Lyrics display</b><small>Word-by-word karaoke highlighting</small></span><span className="connection-state active">On</span></div>
        <div className="settings-field"><div><b>Lyrics size</b><small>Adjust the active line size</small></div><LyricsSizeControl value={lyr.fontSize} onCommit={v => setL({ fontSize: v })} /></div>
        <div className="settings-row settings-bubble-toggle-row"><span className="settings-row-icon">↕</span><span className="settings-row-copy"><b>Automatic lyric scrolling</b><small>Follow the currently sung line</small></span><SoapBubbleToggle checked={!!lyr.autoScroll} onCheckedChange={checked => setL({ autoScroll: checked })} aria-label="Automatic lyric scrolling" color="#E44765" scale={0.88} /></div>
        <p className="settings-note">Rex displays word-by-word karaoke. When a provider only supplies line timestamps, word timing is estimated across the line.</p>
      </section>


      <section className="settings-section">
        <div className="settings-section-title"><span className="settings-icon">ⓘ</span><div><h2>About Rex</h2><p>Your personal music space.</p></div></div>
        <div className="settings-row"><span className="settings-row-icon">♫</span><span className="settings-row-copy"><b>Rex Music</b><small>Personal listening experience</small></span><span className="connection-state active">Ready</span></div>
      </section>
      {saved && <p className="settings-feedback" role="status">{saved}</p>}
      <p className="settings-footer">REX MUSIC <span>·</span> Personal listening space</p>
    </div>
  );
}

