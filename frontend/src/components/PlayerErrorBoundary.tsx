import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; onClose: () => void; resetKey: boolean }
interface State { error: Error | null }

/** Keeps player-only rendering failures from blanking the rest of Rex. */
export default class PlayerErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    return (
      <section className="rex-player-error" role="alert">
        <div className="rex-player-error-mark">rex.</div>
        <h2>The player couldn't open</h2>
        <p>Your queue and the rest of Rex are still available.</p>
        <div className="rex-player-error-actions">
          <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="secondary" onClick={this.props.onClose}>Back to Rex</button>
        </div>
      </section>
    );
  }
}
