// „Zum Home-Bildschirm“: Erkennung, ob die App installiert läuft, und Installations-Dialog (Android/Chromium).
// iOS bietet keine Schnittstelle zum Auslösen – dort zeigt die App eine Anleitung.
// Das Ereignis `beforeinstallprompt` kommt oft schon beim Laden, darum wird es hier global abgefangen
// (Import in main.tsx), bevor eine Seite es braucht.
import { useSyncExternalStore } from 'react';

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** ios: Safari & Co. (Anleitung über „Teilen“), android: Handy/Tablet ohne iOS, desktop: alles andere */
export type InstallPlatform = 'ios' | 'android' | 'desktop';

export interface InstallState {
  /** läuft als installierte App (vom Home-Bildschirm gestartet) */
  standalone: boolean;
  platform: InstallPlatform;
  /** iOS in einem Browser ohne „Zum Home-Bildschirm“ (z. B. In-App-Browser von Instagram/Facebook) */
  iosNoShare: boolean;
  /** iOS-Browser außer Safari (Teilen-Knopf sitzt oben in der Adressleiste) */
  iosOtherBrowser: boolean;
  /** Installations-Dialog kann per Knopf geöffnet werden */
  canPrompt: boolean;
  /** gerade installiert (Android) – jetzt die App vom Home-Bildschirm öffnen */
  installed: boolean;
}

const SKIP_KEY = 'gruppetto.installSkip';

function detectPlatform(): Pick<InstallState, 'platform' | 'iosNoShare' | 'iosOtherBrowser'> {
  const ua = navigator.userAgent;
  // Zum Ausprobieren im Demo-Modus: ?install=ios|android
  const forced = new URLSearchParams(window.location.search).get('install');
  if (forced === 'ios' || forced === 'android') return { platform: forced, iosNoShare: false, iosOtherBrowser: false };
  // iPadOS meldet sich als Mac – am Touchscreen erkennbar
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    return {
      platform: 'ios',
      iosNoShare: /FBAN|FBAV|Instagram|Line\/|LinkedInApp|Snapchat|TikTok|GSA\//i.test(ua),
      iosOtherBrowser: /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua),
    };
  }
  return { platform: /android|mobile/i.test(ua) ? 'android' : 'desktop', iosNoShare: false, iosOtherBrowser: false };
}

function detectStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

let deferred: InstallPromptEvent | null = null;
let state: InstallState = { standalone: false, platform: 'desktop', iosNoShare: false, iosOtherBrowser: false, canPrompt: false, installed: false };
const listeners = new Set<() => void>();

function update(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  state = { ...state, ...detectPlatform(), standalone: detectStandalone() };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // eigener Knopf statt Mini-Leiste des Browsers
    deferred = e as InstallPromptEvent;
    update({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    update({ canPrompt: false, installed: true });
  });
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', () => update({ standalone: detectStandalone() }));
  } catch { /* ältere Browser */ }
}

/** Öffnet den Installations-Dialog (nur wenn canPrompt). Liefert true, wenn installiert wurde. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null; // der Dialog lässt sich je Ereignis nur einmal öffnen
  update({ canPrompt: false });
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') update({ installed: true });
  return outcome === 'accepted';
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Wurde der Hinweis vor der Anmeldung übersprungen („im Browser weiter“)? */
export function installSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function skipInstall(skip = true) {
  try {
    if (skip) localStorage.setItem(SKIP_KEY, '1');
    else localStorage.removeItem(SKIP_KEY);
  } catch { /* privates Fenster */ }
  update({}); // neu zeichnen
}

/** Vor der Anmeldung zuerst installieren lassen? Nur auf Handys im Browser. */
export function shouldGateLogin(s: InstallState): boolean {
  return !s.standalone && s.platform !== 'desktop' && !installSkipped();
}
