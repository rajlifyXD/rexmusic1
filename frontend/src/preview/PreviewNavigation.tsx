import { Component, memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Home as HomeIcon, Library as LibraryIcon, Search as SearchIcon, Settings as SettingsIcon } from 'lucide-react';
import { SoapBubbleSurface, type SoapBubbleRenderer } from '../components/soap-bubble';

type NavId = 'home' | 'library' | 'settings';
type NavItem = { id: NavId; label: string; icon: ReactNode };
type Props = { path: string; navigate: (path: string) => void };

// Restored from the original REX AppShell: three-tab pill plus a separate Search bubble.
const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: <span className="rex-nav-icon"><HomeIcon size={22} strokeWidth={1.9}/><i className="rex-nav-red-marker"/></span> },
  { id: 'library', label: 'Library', icon: <span className="rex-nav-icon"><LibraryIcon size={22} strokeWidth={1.9}/><i className="rex-nav-red-marker"/></span> },
  { id: 'settings', label: 'Settings', icon: <span className="rex-nav-icon"><SettingsIcon size={22} strokeWidth={1.9}/><i className="rex-nav-red-marker"/></span> },
];
const NAV_PATHS: Record<NavId, string> = { home: '/', library: '/library', settings: '/settings' };

function activeNavId(path: string): NavId {
  if (path.startsWith('/library')) return 'library';
  if (path.startsWith('/settings')) return 'settings';
  return 'home';
}

class NavGlassBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function NavFallback({ path, navigate }: Props) {
  const active = activeNavId(path);
  const searchActive = path.startsWith('/discover') || path.startsWith('/search');
  return <div className={`rex-nav-glass-fallback${searchActive ? ' search-active' : ''}`}><nav aria-label="Main navigation"><span className={`rex-nav-fallback-indicator active-${active}${searchActive ? ' is-hidden' : ''}`} aria-hidden="true"/>{NAV_ITEMS.map(item => <button className="rex-nav-button" key={item.id} type="button" aria-current={!searchActive && active === item.id ? 'page' : undefined} onClick={() => navigate(NAV_PATHS[item.id])}>{item.icon}<span>{item.label}</span></button>)}</nav><button className="fallback-search" type="button" aria-label="Search" aria-current={searchActive ? 'page' : undefined} onClick={() => navigate('/discover')}><SearchIcon size={23} strokeWidth={1.9}/></button></div>;
}

const PreviewNavigation = memo(function PreviewNavigation({ path, navigate }: Props) {
  const activeItem = activeNavId(path);
  const searchActive = path.startsWith('/discover') || path.startsWith('/search');
  const suppressNavClick = useRef(false);
  const [navBackdrop, setNavBackdrop] = useState<HTMLElement | null>(null);
  const lensRenderer = useRef<SoapBubbleRenderer | null>(null);
  const [lensMoving, setLensMoving] = useState(false);
  const activeIndex = Math.max(0, NAV_ITEMS.findIndex(item => item.id === activeItem));

  useEffect(() => {
    if (searchActive) { setLensMoving(false); return; }
    setLensMoving(true);
    const timer = window.setTimeout(() => setLensMoving(false), 700);
    return () => window.clearTimeout(timer);
  }, [activeItem, searchActive]);

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
    let dragged = false;
    const positionLens = (clientX: number) => {
      const rect = nav.getBoundingClientRect();
      if (!rect.width) return;
      const segment = rect.width / NAV_ITEMS.length;
      const lensWidth = lens.getBoundingClientRect().width;
      const relativeX = Math.min(rect.width - 1, Math.max(0, clientX - rect.left));
      // The lens follows the finger, while selection is resolved from the
      // pointer's segment on release (rather than rounding the lens offset).
      const offset = Math.min(rect.width - lensWidth - 8, Math.max(0, relativeX - lensWidth / 2 - 4));
      lens.style.setProperty('--rex-nav-drag-x', `${offset.toFixed(2)}px`);
      lensRenderer.current?.invalidate();
    };
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      if (!dragged && Math.abs(move.clientX - startX) < 6) return;
      dragged = true; setLensMoving(true); nav.classList.add('is-dragging'); positionLens(move.clientX);
    };
    const onFinish = (finish: PointerEvent) => {
      if (finish.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onFinish); window.removeEventListener('pointercancel', onFinish);
      if (!dragged) return;
      const rect = nav.getBoundingClientRect();
      const segment = rect.width / NAV_ITEMS.length;
      const pointerX = Math.min(rect.width - 1, Math.max(0, finish.clientX - rect.left));
      const targetIndex = finish.type === 'pointerup'
        ? Math.min(NAV_ITEMS.length - 1, Math.max(0, Math.floor(pointerX / segment)))
        : sourceIndex;
      lens.style.setProperty('--rex-nav-drag-x', `${segment * targetIndex}px`);
      if (finish.type === 'pointerup') navigate(NAV_PATHS[NAV_ITEMS[targetIndex].id]);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => nav.classList.remove('is-dragging')));
      window.setTimeout(() => { lens.style.removeProperty('--rex-nav-drag-x'); setLensMoving(false); }, 760);
      suppressNavClick.current = true;
      window.setTimeout(() => { suppressNavClick.current = false; }, 260);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onFinish); window.addEventListener('pointercancel', onFinish);
  };

  const handleNavClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressNavClick.current) return;
    event.preventDefault(); event.stopPropagation(); suppressNavClick.current = false;
  };

  const handleNavKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.rex-liquid-nav > button.rex-nav-button, .rex-nav-glass-fallback nav > button.rex-nav-button');
    if (!button) return;
    const buttons = Array.from(button.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? []);
    const currentIndex = buttons.indexOf(button);
    if (currentIndex < 0) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(NAV_PATHS[NAV_ITEMS[currentIndex].id]); return; }
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % NAV_ITEMS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = NAV_ITEMS.length - 1;
    else return;
    event.preventDefault(); buttons[nextIndex]?.focus();
  };

  return <div className={`rex-nav-dock${searchActive ? ' search-active' : ''}`} onKeyDown={handleNavKeyDown}>
    <NavGlassBoundary fallback={<NavFallback path={path} navigate={navigate}/> }>
      <div className="rex-nav-bubble-shell">
        <nav ref={setNavBackdrop} className="rex-liquid-nav" aria-label="Main navigation" onPointerDown={handleNavPointerDown} onClickCapture={handleNavClickCapture}>
          <SoapBubbleSurface as="div" className={`rex-nav-active-lens active-${activeItem}${searchActive ? ' is-hidden' : ''}`} reboundKey={activeItem} backdrop={navBackdrop} radius={9999} glass={1.08} tint="rgba(255,255,255,.018)" opacity={-1} iridescence={0.008} oilOpacity={0} oilCoverage={0} clearCenter={1} reflectivity={1.9} refraction={0.56} dispersion={1.34} seeThrough={0} seeThroughBend={0} bevel={11} maxDpr={1.2} paused={!lensMoving} rendererRef={lensRenderer} aria-hidden="true"/>
          {NAV_ITEMS.map(item => <button className="rex-nav-button" key={item.id} type="button" aria-label={item.label} aria-current={!searchActive && activeItem === item.id ? 'page' : undefined} onClick={() => navigate(NAV_PATHS[item.id])}>{item.icon}<span>{item.label}</span></button>)}
        </nav>
      </div>
      <button className="rex-search-nav" type="button" aria-label="Search" aria-current={searchActive ? 'page' : undefined} title="Search" onClick={() => navigate('/discover')}><span className="rex-search-nav-content"><SearchIcon size={23} strokeWidth={1.9}/><i className="rex-nav-red-marker"/></span></button>
    </NavGlassBoundary>
  </div>;
});

export default PreviewNavigation;
