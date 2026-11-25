import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, Copy, KeyRound, LockKeyhole, Music2, UserRound } from 'lucide-react';
import { api } from '../api';
import { supabase, supabaseConfigured, usernameEmail } from '../lib/supabase';
import './auth.css';

type Mode = 'login' | 'signup' | 'recover';

export default function AuthScreen({ onAuthenticated }: { onAuthenticated: (recoveryCode?: string) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const normalized = username.trim().toLowerCase();
  const resetForm = (next: Mode) => {
    setMode(next); setError(''); setInfo(''); setPassword(''); setConfirmPassword('');
    setRecoveryCode(''); setNewPassword('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) { setError('Supabase is not configured. Add the Supabase URL and publishable/anon key to the project .env file, then restart REX.'); return; }
    setBusy(true); setError(''); setInfo('');
    try {
      if (mode === 'login') {
        if (!/^[a-z0-9_]{3,24}$/.test(normalized)) throw new Error('Username must be 3–24 characters: lowercase letters, numbers, or underscores.');
        const { error: authError } = await supabase.auth.signInWithPassword({ email: usernameEmail(normalized), password });
        if (authError) throw new Error('Username or password is incorrect.');
        onAuthenticated();
      } else if (mode === 'signup') {
        if (!/^[a-z0-9_]{3,24}$/.test(normalized)) throw new Error('Username must be 3–24 characters: lowercase letters, numbers, or underscores.');
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        if (password !== confirmPassword) throw new Error('The passwords do not match.');
        const created = await api.auth.register(normalized, password);
        const { error: authError } = await supabase.auth.signInWithPassword({ email: created.email, password });
        if (authError) throw new Error('Your account was created, but automatic sign-in failed. Please return to Log in and sign in with your new username and password. Keep the recovery code below safe: ' + created.recoveryCode);
        onAuthenticated(created.recoveryCode);
      } else {
        if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
        const recovered = await api.auth.recover(normalized, recoveryCode, newPassword);
        const { error: authError } = await supabase.auth.signInWithPassword({ email: recovered.email, password: newPassword });
        if (authError) throw new Error('Password reset worked, but automatic sign-in failed. Please log in with your new password. Your new recovery code is: ' + recovered.recoveryCode);
        onAuthenticated(recovered.recoveryCode);
      }
    } catch (cause) {
      setError((cause as Error).message || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return <main className="rex-auth-screen">
    <div className="rex-auth-ambient" aria-hidden="true"/>
    <motion.section className="rex-auth-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45, ease: [.2, .8, .2, 1] }}>
      <div className="rex-auth-brand"><span className="rex-auth-mark">REX<span>.</span></span><span className="rex-auth-brand-note">YOUR MUSIC. YOUR SPACE.</span></div>
      <div className="rex-auth-emblem"><Music2 size={22}/></div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={mode} className="rex-auth-copy" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .16 }}>
          <p className="rex-auth-eyebrow">{mode === 'login' ? 'WELCOME BACK' : mode === 'signup' ? 'MAKE IT YOURS' : 'ACCOUNT RECOVERY'}</p>
          <h1>{mode === 'login' ? 'Come back to the music.' : mode === 'signup' ? 'Your space starts here.' : 'Get back into REX.'}</h1>
          <p>{mode === 'login' ? 'Sign in to pick up where you left off.' : mode === 'signup' ? 'Create a private library with just a username and password.' : 'Use the recovery code you saved when you created your account.'}</p>
        </motion.div>
      </AnimatePresence>
      {!supabaseConfigured && <div className="rex-auth-alert">Supabase is not configured yet. Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the matching `VITE_` values to the root `.env` file, then rebuild REX.</div>}
      <form className="rex-auth-form" onSubmit={submit}>
        <label className="rex-auth-label" htmlFor="rex-auth-username">Username</label>
        <div className="rex-auth-input-wrap"><UserRound size={17}/><input id="rex-auth-username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} placeholder="your_username" required disabled={!supabaseConfigured}/></div>
        {mode !== 'recover' ? <>
          <label className="rex-auth-label" htmlFor="rex-auth-password">Password</label>
          <div className="rex-auth-input-wrap"><LockKeyhole size={17}/><input id="rex-auth-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} maxLength={72} placeholder="At least 8 characters" required disabled={!supabaseConfigured}/></div>
          {mode === 'signup' && <><label className="rex-auth-label" htmlFor="rex-auth-confirm">Confirm password</label><div className="rex-auth-input-wrap"><LockKeyhole size={17}/><input id="rex-auth-confirm" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={72} placeholder="Enter it again" required disabled={!supabaseConfigured}/></div></>}
        </> : <>
          <label className="rex-auth-label" htmlFor="rex-auth-recovery">Recovery code</label>
          <div className="rex-auth-input-wrap"><KeyRound size={17}/><input id="rex-auth-recovery" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} maxLength={80} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" required disabled={!supabaseConfigured}/></div>
          <label className="rex-auth-label" htmlFor="rex-auth-new-password">New password</label>
          <div className="rex-auth-input-wrap"><LockKeyhole size={17}/><input id="rex-auth-new-password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={72} placeholder="At least 8 characters" required disabled={!supabaseConfigured}/></div>
        </>}
        {error && <p className="rex-auth-message error" role="alert">{error}</p>}
        {info && <p className="rex-auth-message" role="status">{info}</p>}
        <button className="rex-auth-submit" type="submit" disabled={busy || !supabaseConfigured}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}<ArrowRight size={17}/></button>
      </form>
      <div className="rex-auth-links">
        {mode === 'login' && <><button onClick={() => resetForm('recover')}>Forgot password? Use recovery code</button><span>New to REX? <button onClick={() => resetForm('signup')}>Create account</button></span></>}
        {mode === 'signup' && <span>Already have an account? <button onClick={() => resetForm('login')}>Sign in</button></span>}
        {mode === 'recover' && <button onClick={() => resetForm('login')}><ArrowLeft size={14}/> Back to sign in</button>}
      </div>
      <p className="rex-auth-footnote"><LockKeyhole size={12}/> Your library is private to your account.</p>
    </motion.section>
  </main>;
}

export function RecoveryCodeNotice({ code, onClose }: { code: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  };
  return <div className="rex-auth-overlay" role="presentation"><motion.section className="rex-recovery-card" role="dialog" aria-modal="true" aria-labelledby="rex-recovery-title" initial={{ opacity: 0, y: 14, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
    <div className="rex-auth-emblem"><KeyRound size={21}/></div><p className="rex-auth-eyebrow">SAVE THIS NOW</p><h2 id="rex-recovery-title">Your recovery code</h2><p>This code is shown only once. Save it somewhere private. It is the only way to reset your password without email.</p>
    <code className="rex-recovery-code">{code}</code>
    <button className="rex-auth-submit" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy recovery code'} {copied ? <Check size={17}/> : <Copy size={17}/>}</button>
    <button className="rex-recovery-done" onClick={onClose}>I've saved it — continue to REX</button>
  </motion.section></div>;
}
