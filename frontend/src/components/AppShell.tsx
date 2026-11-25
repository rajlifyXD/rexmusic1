import { type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, memo, useRef } from 'react';
import { Home as HomeIcon, Library as LibraryIcon, Settings as SettingsIcon, Search as SearchIcon } from 'lucide-react';
import BubbleButton from './BubbleButton';
import { img } from '../api';
import { next, toggle, usePlayerSel } from '../player/store';

type NavId = 'home' | 'library' | 'settings';
type NavItem = { id: NavId; label: string; icon: ReactNode };

// Keep navigation descriptors at module scope so the icon elements and order
// stay stable across route and player updates.
const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: <span className="rex-nav-icon"><HomeIcon size={22} strokeWidth={1.9} /><i className="rex-nav-red-marker" /></span>,
  },
  {
    id: 'library',
    label: 'Library',
    icon: <span className="rex-nav-icon"><LibraryIcon size={22} strokeWidth={1.9} /><i className="rex-nav-red-marker" /></span>,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <span className="rex-nav-icon"><SettingsIcon size={22} strokeWidth={1.9} /><i className="rex-nav-red-marker" /></span>,
  },
];

const NAV_PATHS: Record<NavId, string> = {
  home: '/',
  library: '/library',
  settings: '/settings',
};

function activeNavId(path: string): NavId {
  if (path.startsWith('/library')) return 'library';
  if (path.startsWith('/settings')) return 'settings';
  return 'home';
}

/** Lightweight navigation: the active tab is a CSS-only spring indicator. */
const BottomNavigation = memo(function BottomNavigation({
  path,
  navigate,
}: {
  path: string;
  navigate: (p: string) => void;
}) {
  const searchActive = path.startsWith('/search');
  const activeItem = activeNavId(path);
  const suppressNavClick = useRef(false);
  const activeIndex = Math.max(0, NAV_ITEMS.findIndex(item => item.id === activeItem));

  // Drag the selected tab indicator with a compositor transform; route selection
  // on release so React does not rerender on every pointer move.
  const handleNavPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || searchActive) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.rex-nav-button');
    if (!button || button.getAttribute('aria-current') !== 'page') return;
    const nav = event.currentTarget;
    const lens = nav.querySelector<HTMLElement>('.rex-nav-active-lens');
    if (!lens) return;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const sourceIndex = activeIndex;
    let lastPointerX = startX;
    let dragged = false;

    const positionLens = (clientX: number) => {
      const rect = nav.getBoundingClientRect();
      if (!rect.width) return;
      const lensWidth = lens.getBoundingClientRect().width;
      const maxOffset = Math.max(0, rect.width - lensWidth - 8);
      const offset = Math.min(maxOffset, Math.max(0, clientX - rect.left - lensWidth / 2 - 4));
      const velocity = Math.abs(clientX - lastPointerX);
      lastPointerX = clientX;
      const stretch = Math.min(1.18, 1 + velocity / 95);
      lens.style.setProperty('--rex-nav-drag-x', `${offset.toFixed(2)}px`);
      lens.style.setProperty('--rex-nav-stretch-x', stretch.toFixed(3));
      lens.style.setProperty('--rex-nav-squash-y', (1 - (stretch - 1) * .48).toFixed(3));
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      if (!dragged && Math.abs(move.clientX - startX) < 6) return;
      dragged = true;
      nav.classList.add('is-dragging');
      positionLens(move.clientX);
    };
    const onFinish = (finish: PointerEvent) => {
      if (finish.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onFinish);
      window.removeEventListener('pointercancel', onFinish);
      if (!dragged) return;
      const navRect = nav.getBoundingClientRect();
      const pointerX = Math.min(navRect.width - 1, Math.max(0, finish.clientX - navRect.left));
      const targetIndex = finish.type === 'pointerup'
        ? Math.min(NAV_ITEMS.length - 1, Math.max(0, Math.floor(pointerX / (navRect.width / NAV_ITEMS.length))))
        : sourceIndex;
      const targetOffset = (navRect.width / NAV_ITEMS.length) * targetIndex;
      lens.style.setProperty('--rex-nav-drag-x', `${targetOffset.toFixed(2)}px`);
      if (finish.type === 'pointerup') navigate(NAV_PATHS[NAV_ITEMS[targetIndex].id]);
      // Keep the capsule visually under the pointer through the route commit,
      // then release it into the spring transition toward the selected tab.
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => nav.classList.remove('is-dragging')));
      window.setTimeout(() => {
        lens.style.removeProperty('--rex-nav-drag-x');
        lens.style.removeProperty('--rex-nav-stretch-x');
        lens.style.removeProperty('--rex-nav-squash-y');
      }, 760);
      suppressNavClick.current = true;
      window.setTimeout(() => { suppressNavClick.current = false; }, 260);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onFinish);
    window.addEventListener('pointercancel', onFinish);
  };

  const handleNavClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressNavClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNavClick.current = false;
  };

  const handleNavKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.rex-liquid-nav > button.rex-nav-button');
    if (!button) return;
    const buttons = Array.from(button.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? []);
    const currentIndex = buttons.indexOf(button);
    if (currentIndex < 0) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      navigate(NAV_PATHS[NAV_ITEMS[currentIndex].id]);
      return;
    }

    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % NAV_ITEMS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = NAV_ITEMS.length - 1;
    else return;

    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  return (
    <div className={`rex-nav-dock${searchActive ? ' search-active' : ''}`} onKeyDown={handleNavKeyDown}>
      <div className="rex-nav-bubble-shell">
        <nav className="rex-liquid-nav" aria-label="Main navigation" onPointerDown={handleNavPointerDown} onClickCapture={handleNavClickCapture}>
          <div className={`rex-nav-active-lens active-${activeItem}${searchActive ? ' is-hidden' : ''}`} aria-hidden="true" />
          {NAV_ITEMS.map(item => (
              <button
                className="rex-nav-button"
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-current={!searchActive && activeItem === item.id ? 'page' : undefined}
                onClick={() => navigate(NAV_PATHS[item.id])}
              >
                {item.icon}<span>{item.label}</span>
              </button>
          ))}
        </nav>
      </div>
      <button
        className="rex-search-nav"
        type="button"
        aria-label="Search"
        aria-current={searchActive ? 'page' : undefined}
        title="Search"
        onClick={() => navigate('/search')}
      >
        <span className="rex-search-nav-content">
          <SearchIcon size={23} strokeWidth={1.9} />
          <i className="rex-nav-red-marker" />
        </span>
      </button>
    </div>
  );
});

interface Props { path: string; navigate: (p: string) => void; openPlayer: () => void; children: ReactNode }

export default function AppShell({ path, navigate, openPlayer, children }: Props) {
  const scrollBackdrop = useRef<HTMLDivElement>(null);
  const track = usePlayerSel(s => s.queue[s.index] ?? null);
  const playing = usePlayerSel(s => s.playing);

  return <div id="rex-root" className="rex-preview-root">
    <div className="scroller" ref={scrollBackdrop}>{children}</div>
    {track && <div className="mini mini-player" onClick={openPlayer} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openPlayer(); }} aria-label="Open now playing">
      {track.thumb ? <img crossOrigin="anonymous" className="mini-art" src={img(track.thumb)} alt="" /> : <span className="mini-art empty" />}
      <span className="mini-meta"><b>{track.title}</b><small>{track.artist}</small></span>
      <span className="mini-actions">
        <BubbleButton className="ico mini-control" aria-label={playing ? 'Pause' : 'Play'} onClick={e => { e.stopPropagation(); toggle(); }}>{playing ? 'Ⅱ' : '▶'}</BubbleButton>
        <BubbleButton className="ico mini-control" aria-label="Next" onClick={e => { e.stopPropagation(); next(); }}>»</BubbleButton>
      </span>
    </div>}
    <BottomNavigation path={path} navigate={navigate} />
  </div>;
}
