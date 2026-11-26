import { AnimatePresence, motion } from 'motion/react';
import { Check, Download, MoreHorizontal, Plus, Share, Smartphone, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './PwaInstallPrompt.css';

type DevicePlatform = 'android' | 'ios' | 'other';
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISSED_KEY = 'rex.pwa.install-dismissed.v1';

function detectPlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/.test(ua) || isIPadOS) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'other';
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches;
  return Boolean(displayMode || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

function wasDismissed() {
  try { return window.localStorage.getItem(DISMISSED_KEY) === '1'; }
  catch { return false; }
}

function rememberDismissal() {
  try { window.localStorage.setItem(DISMISSED_KEY, '1'); }
  catch { /* Keep the install guide available even when storage is restricted. */ }
}

export default function PwaInstallPrompt() {
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState<DevicePlatform>(detectPlatform);
  const [nativePromptAvailable, setNativePromptAvailable] = useState(false);
  const [installed, setInstalled] = useState(isStandalone);
  const [installing, setInstalling] = useState(false);
  const deferredPrompt = useRef<InstallPromptEvent | null>(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    dismissedRef.current = wasDismissed();
    const platform = detectPlatform();
    setDevice(platform);

    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    const onBeforeInstallPrompt = (rawEvent: Event) => {
      rawEvent.preventDefault();
      deferredPrompt.current = rawEvent as InstallPromptEvent;
      setNativePromptAvailable(true);
      if (!dismissedRef.current) setOpen(true);
    };
    const onAppInstalled = () => {
      deferredPrompt.current = null;
      setNativePromptAvailable(false);
      setInstalled(true);
      setOpen(false);
      try { window.localStorage.removeItem(DISMISSED_KEY); } catch { /* Ignore storage failures. */ }
    };
    const openGuide = () => {
      setDevice(detectPlatform());
      setOpen(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('rex:show-pwa-install', openGuide);

    // iOS has no beforeinstallprompt event. Android browsers that don't expose
    // it still get clear manual install steps from their first visit.
    const timer = window.setTimeout(() => {
      if (!dismissedRef.current && (platform === 'ios' || platform === 'android')) setOpen(true);
    }, 1800);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('rex:show-pwa-install', openGuide);
    };
  }, []);

  const dismiss = () => {
    dismissedRef.current = true;
    rememberDismissal();
    setOpen(false);
  };

  const install = async () => {
    const promptEvent = deferredPrompt.current;
    if (!promptEvent) return;
    setInstalling(true);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      deferredPrompt.current = null;
      setNativePromptAvailable(false);
      setOpen(false);
      dismissedRef.current = true;
      rememberDismissal();
    } catch {
      setInstalling(false);
      return;
    }
    setInstalling(false);
  };

  if (installed) return null;

  const hasNativePrompt = nativePromptAvailable && deferredPrompt.current !== null;
  const isIOS = device === 'ios';
  const isAndroid = device === 'android';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="rx-pwa-overlay"
          role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget) dismiss(); }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: .18 }}
        >
          <motion.section
            className="rx-pwa-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rx-pwa-title"
            initial={{ opacity: 0, y: 28, scale: .985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: .99 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            <button className="rx-pwa-close" type="button" onClick={dismiss} aria-label="Close install guide"><X size={18}/></button>
            <div className="rx-pwa-brand">
              <img src="/icons/rex-icon-192.png?v=2" alt="" />
              <span><b>REX</b><small>YOUR MUSIC, YOUR SPACE</small></span>
            </div>
            <div className="rx-pwa-intro">
              <span className="rx-pwa-eyebrow">TAKE REX WITH YOU</span>
              <h2 id="rx-pwa-title">{isIOS ? 'Add REX to your Home Screen.' : 'Make REX feel like an app.'}</h2>
              <p>Launch REX from your Home Screen in its own app window, without the browser address bar.</p>
            </div>

            {isIOS ? (
              <div className="rx-pwa-steps">
                <div className="rx-pwa-step"><span className="rx-pwa-step-icon"><Share size={19}/></span><span><b>1. Open Share</b><small>In Safari, tap the Share icon (the square with an arrow).</small></span></div>
                <div className="rx-pwa-step"><span className="rx-pwa-step-icon"><Plus size={20}/></span><span><b>2. Choose Add to Home Screen</b><small>Scroll through the Share sheet and tap “Add to Home Screen”.</small></span></div>
                <div className="rx-pwa-step"><span className="rx-pwa-step-icon"><Check size={19}/></span><span><b>3. Tap Add</b><small>Keep “Open as Web App” enabled when that option appears, then tap Add.</small></span></div>
              </div>
            ) : hasNativePrompt ? (
              <div className="rx-pwa-native-note"><Smartphone size={20}/><span><b>Ready to install</b><small>Your browser will show its native REX install sheet.</small></span></div>
            ) : isAndroid ? (
              <div className="rx-pwa-steps">
                <div className="rx-pwa-step"><span className="rx-pwa-step-icon"><MoreHorizontal size={20}/></span><span><b>1. Open the browser menu</b><small>In Chrome, tap ⋮ in the top-right corner.</small></span></div>
                <div className="rx-pwa-step"><span className="rx-pwa-step-icon"><Download size={19}/></span><span><b>2. Tap Install app</b><small>Or choose “Add to Home screen” if that is what your browser shows.</small></span></div>
                <div className="rx-pwa-step"><span className="rx-pwa-step-icon"><Check size={19}/></span><span><b>3. Confirm Install</b><small>REX will appear with your other apps.</small></span></div>
              </div>
            ) : hasNativePrompt ? (
              <div className="rx-pwa-native-note"><Download size={20}/><span><b>Ready to install</b><small>Your browser will show its native app-install sheet.</small></span></div>
            ) : (
              <div className="rx-pwa-steps">
                <div className="rx-pwa-step"><span className="rx-pwa-step-icon"><MoreHorizontal size={20}/></span><span><b>Open your browser menu</b><small>Look for “Install REX”, “Install app”, or “Add to Home Screen”.</small></span></div>
              </div>
            )}

            <div className="rx-pwa-actions">
              {hasNativePrompt ? (
                <button className="rx-pwa-primary" type="button" onClick={() => void install()} disabled={installing}>
                  <Download size={17}/>{installing ? 'Opening install sheet…' : 'Install REX'}
                </button>
              ) : (
                <button className="rx-pwa-primary" type="button" onClick={dismiss}>Got it <Check size={17}/></button>
              )}
              <button className="rx-pwa-later" type="button" onClick={dismiss}>Maybe later</button>
            </div>
            <p className="rx-pwa-footnote">You can open these instructions again from Settings.</p>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
