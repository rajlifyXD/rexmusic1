import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import ConnectedApp from './ConnectedApp';
import './styles.css';
import './preview/preview.css';
import PwaInstallPrompt from './components/PwaInstallPrompt';

function syncStandaloneDisplayMode() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  document.documentElement.classList.toggle('rex-standalone', Boolean(standalone));
}

syncStandaloneDisplayMode();
window.addEventListener('pageshow', syncStandaloneDisplayMode);
document.addEventListener('visibilitychange', syncStandaloneDisplayMode);
window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', syncStandaloneDisplayMode);
window.matchMedia?.('(display-mode: fullscreen)').addEventListener?.('change', syncStandaloneDisplayMode);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(error => {
      console.warn('REX service worker registration failed:', error);
    });
  }, { once: true });
}

type BoundaryState = { error: Error | null };
class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState { return { error }; }
  render() {
    if (this.state.error) return <main className="rex-crash-screen" role="alert"><div className="rex-crash-mark">rex.</div><h1>REX hit a snag</h1><p>The app could not finish loading this screen. Your local library remains on the device.</p><button type="button" onClick={() => window.location.reload()}>Reload REX</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('app')!).render(<StrictMode><AppErrorBoundary><><ConnectedApp/><PwaInstallPrompt/></></AppErrorBoundary></StrictMode>);
