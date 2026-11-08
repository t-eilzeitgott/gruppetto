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
  /** App-Symbol stammt noch von der alten Adresse (github.io) – einmal neu installieren */
  legacyInstall: boolean;
}

const SKIP_KEY = 'gruppetto.installSkip';
/** Die App ist von t-eilzeitgott.github.io/gruppetto nach gruppetto.talfahrt.dev umgezogen. */
export const APP_HOST = 'gruppetto.talfahrt.dev';
export const OLD_APP_HOST = 't-eilzeitgott.github.io/gruppetto';
/** Merker: Diese installierte App wurde schon einmal über die neue start_url (?app=2) geöffnet. */
const HOME_V2_KEY = 'gruppetto.homeV2';

/**
 * Alte Installationen starten mit der alten start_url und landen per Weiterleitung ohne `?app=2` hier.
 * Neue Installationen bringen den Marker beim ersten Start mit und merken sich das (eigener Speicher je App).
 * Kommt der Aufruf über einen Link von einer anderen Seite, ist es kein altes App-Symbol.
 * Zum Ansehen im Browser: ?moved=1
 */
function detectLegacyInstall(standalone: boolean): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('moved') === '1') return true;
    if (!standalone) return false;
    if (params.get('app') === '2') {
      localStorage.setItem(HOME_V2_KEY, '1');
      return false;
    }
    if (localStorage.getItem(HOME_V2_KEY) === '1') return false;
    // Über einen Link geöffnet (z. B. von talfahrt.dev in der Ansicht einer anderen Web-App) – kein altes App-Symbol
    const ref = document.referrer;
    return !ref || ref.includes('github.io');
  } catch {
    return false;
  }
}

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
let state: InstallState = { standalone: false, platform: 'desktop', iosNoShare: false, iosOtherBrowser: false, canPrompt: false, installed: false, legacyInstall: false };
const listeners = new Set<() => void>();

function update(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  const standalone = detectStandalone();
  state = { ...state, ...detectPlatform(), standalone, legacyInstall: detectLegacyInstall(standalone) };
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
