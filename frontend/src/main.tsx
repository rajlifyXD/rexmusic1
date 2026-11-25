import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import ConnectedApp from './ConnectedApp';
import './styles.css';
import './preview/preview.css';

type BoundaryState = { error: Error | null };
class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState { return { error }; }
  render() {
    if (this.state.error) return <main className="rex-crash-screen" role="alert"><div className="rex-crash-mark">rex.</div><h1>REX hit a snag</h1><p>The app could not finish loading this screen. Your local library remains on the device.</p><button type="button" onClick={() => window.location.reload()}>Reload REX</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('app')!).render(<StrictMode><AppErrorBoundary><ConnectedApp/></AppErrorBoundary></StrictMode>);
