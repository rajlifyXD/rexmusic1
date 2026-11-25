/**
 * Small browser client for the supported Supabase Auth HTTP API.
 * It stores the public user's access/refresh tokens in localStorage, refreshes
 * them before expiry, and exposes only the few auth methods REX needs.
 * Database requests still go through FastAPI and PostgREST with RLS.
 */
const url = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const supabaseConfigured = Boolean(url && anonKey);
const storageKey = 'rex.supabase.session.v1';

type AuthUser = { id: string; email?: string; user_metadata?: Record<string, unknown> };
export type RexSession = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
  user: AuthUser;
};
type AuthResult<T> = { data: T; error: Error | null };
type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
type Listener = (event: AuthEvent, session: RexSession | null) => void;

let currentSession: RexSession | null = null;
let refreshPromise: Promise<RexSession | null> | null = null;
const listeners = new Set<Listener>();

function readSession(): RexSession | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as RexSession;
    if (!value?.access_token || !value?.refresh_token || !value?.user?.id) return null;
    return value;
  } catch { return null; }
}
function saveSession(session: RexSession | null) {
  currentSession = session;
  try {
    if (session) localStorage.setItem(storageKey, JSON.stringify(session));
    else localStorage.removeItem(storageKey);
  } catch { /* Private browsing may disable persistent storage. */ }
}
function emit(event: AuthEvent, session: RexSession | null) {
  for (const listener of listeners) listener(event, session);
}
async function authRequest(path: string, payload?: Record<string, unknown>, accessToken?: string) {
  const response = await fetch(`${url}${path}`, {
    method: payload ? 'POST' : 'GET',
    headers: {
      apikey: anonKey,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || data.error || 'Supabase Auth request failed.');
  return data;
}
async function refreshSession(session: RexSession): Promise<RexSession | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const data = await authRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token });
      const next = { ...data, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600) } as RexSession;
      saveSession(next); emit('TOKEN_REFRESHED', next); return next;
    } catch {
      saveSession(null); emit('SIGNED_OUT', null); return null;
    } finally { refreshPromise = null; }
  })();
  return refreshPromise;
}
async function getSession(): Promise<AuthResult<{ session: RexSession | null }>> {
  if (!supabaseConfigured) return { data: { session: null }, error: null };
  const stored = currentSession || readSession();
  if (!stored) return { data: { session: null }, error: null };
  currentSession = stored;
  if (stored.expires_at <= Math.floor(Date.now() / 1000) + 90) {
    const refreshed = await refreshSession(stored);
    return { data: { session: refreshed }, error: null };
  }
  return { data: { session: stored }, error: null };
}

const auth = {
  getSession,
  async signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResult<{ session: RexSession | null; user: AuthUser | null }>> {
    try {
      const data = await authRequest('/auth/v1/token?grant_type=password', credentials);
      const session = { ...data, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600) } as RexSession;
      saveSession(session); emit('SIGNED_IN', session);
      return { data: { session, user: session.user }, error: null };
    } catch (error) { return { data: { session: null, user: null }, error: error as Error }; }
  },
  async signOut(): Promise<{ error: Error | null }> {
    const session = currentSession || readSession();
    try { if (session?.access_token) await authRequest('/auth/v1/logout', {}, session.access_token); }
    catch { /* Always clear local session, even if the server logout endpoint is unavailable. */ }
    saveSession(null); emit('SIGNED_OUT', null);
    return { error: null };
  },
  onAuthStateChange(callback: Listener) {
    listeners.add(callback);
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
  },
};

if (typeof window !== 'undefined' && supabaseConfigured) {
  window.addEventListener('storage', event => {
    if (event.key !== storageKey) return;
    currentSession = readSession();
    emit(currentSession ? 'SIGNED_IN' : 'SIGNED_OUT', currentSession);
  });
  window.setInterval(() => {
    const session = currentSession || readSession();
    if (session && session.expires_at <= Math.floor(Date.now() / 1000) + 120) void refreshSession(session);
  }, 30_000);
}

export const supabase = supabaseConfigured ? { auth } : null;

export function usernameEmail(username: string) {
  return `${username.trim().toLowerCase()}@users.rex.invalid`;
}
