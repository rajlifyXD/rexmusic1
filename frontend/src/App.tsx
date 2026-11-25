import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { AddToPlaylist, go } from './components/ui';
import AppShell from './components/AppShell';
import FullPlayer from './pages/FullPlayer';
import RexBubbleMaterial from './components/RexBubbleMaterial';
import PlayerErrorBoundary from './components/PlayerErrorBoundary';
import { Detail, Home, Library, Search, Settings } from './pages/Pages';
import { initPlayer, refreshLikes, toggle } from './player/store';

const parse = () => {
  const raw = window.location.hash.slice(1).split('?')[0] || '/';
  try { return raw.split('/').map((part, index) => index === 0 ? part : decodeURIComponent(part)).join('/'); }
  catch { return '/'; }
};

export default function App() {
  const [path, setPath] = useState(parse());
  const [full, setFull] = useState(false);
  useEffect(() => {
    document.title = 'Rex';
    if (!document.documentElement.hasAttribute('data-theme')) document.documentElement.setAttribute('data-theme', 'dark');
    const themeColor = document.querySelector('meta[name=theme-color]') as HTMLMetaElement | null;
    themeColor?.setAttribute('content', '#090a0d');
    const on = () => setPath(parse());
    window.addEventListener('hashchange', on);
    initPlayer(); refreshLikes();
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { document.querySelector('.scroller')?.scrollTo({ top: 0 }); }, [path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName) && t.getAttribute('role') !== 'slider') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const navigate = useCallback((p: string) => go(p), []);
  const seg = path.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });

  let page;
  if (path === '/') page = <Home />;
  else if (seg[0] === 'search') page = <Search />;
  else if (seg[0] === 'library') page = <Library />;
  else if (seg[0] === 'settings') page = <Settings />;
  else if (['album', 'artist', 'playlist', 'mood', 'mine'].includes(seg[0]) && seg[1]) page = <Detail kind={seg[0] as 'album'} id={seg[1]} />;
  else page = <div className="page"><h1 className="title">Not found</h1></div>;

  return (
    <RexBubbleMaterial>
      <AppShell path={path} navigate={navigate} openPlayer={() => setFull(true)}>
        <AnimatePresence mode="sync" initial={false}>
          <motion.div key={path} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14, ease: "easeOut" }}>{page}</motion.div>
        </AnimatePresence>
      </AppShell>
      <PlayerErrorBoundary resetKey={full} onClose={() => setFull(false)}><FullPlayer open={full} onClose={() => setFull(false)} /></PlayerErrorBoundary>
      <AddToPlaylist />
    </RexBubbleMaterial>
  );
}
