// Benachrichtigungen (Web Push): dieses Gerät an- und abmelden. Verschickt wird vom Workflow „Benachrichtigungen“
// (scripts/push) – wenn das Ergebnis einer Etappe da ist und wenn kurz vor dem Tippschluss noch kein Tipp abgegeben ist.
// Der Service Worker (public/sw.js) zeigt die Nachricht und öffnet beim Antippen die passende Seite.
//
// iPhone/iPad: nur in der App vom Home-Bildschirm (ab iOS 16.4), nicht in Safari.
import { source } from './config';

/** öffentlicher VAPID-Schlüssel (der private liegt nur als Secret beim Workflow) */
export const VAPID_PUBLIC_KEY = 'BFVkrEd6Ow4HUXfWStsBfJDiS25c7Ekw2XzrRib6WdKQ5PiY3dMpFt5GmLCKahUOc_BfCWsyS_4R3Jgq8TZq_Qs';

/** ok: geht; install: erst auf den Home-Bildschirm (iOS); denied: im System blockiert; unsupported: Browser kann es nicht */
export type PushSupport = 'ok' | 'install' | 'denied' | 'unsupported';

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  const api = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!api) return isIos() && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('./');
  const reg = existing ?? await navigator.serviceWorker.register('sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  return reg;
}

function toData(sub: PushSubscription) {
  const j = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' };
}

/** Ist dieses Gerät für mich angemeldet? */
export async function pushEnabled(): Promise<boolean> {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration('./');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return false;
  return source.pushStatus(sub.endpoint);
}

/** Einschalten (aus einem Tipp/Klick heraus aufrufen – iOS fragt nur dann nach der Erlaubnis) */
export async function enablePush(): Promise<void> {
  // zuerst fragen: iOS erlaubt die Abfrage nur direkt nach dem Antippen
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied'
    ? 'Benachrichtigungen sind blockiert – erlaube sie in den Einstellungen (iPhone: Einstellungen → Mitteilungen → gruppetto).'
    : 'Ohne deine Erlaubnis geht es nicht.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // altes Abo mit anderem Schlüssel (z. B. nach Schlüsselwechsel) ersetzen
  const key = sub?.options.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== VAPID_PUBLIC_KEY) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  await source.pushSubscribe(toData(sub));
}

/** Ausschalten: beim Push-Dienst und bei uns abmelden */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('./');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await source.pushUnsubscribe(sub.endpoint);
  await sub.unsubscribe().catch(() => false);
}

/** Der Push-Dienst hat das Abo erneuert (Nachricht vom Service Worker): neu anmelden */
export function watchPushRenew() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type !== 'push-renew') return;
    void (async () => {
      if (Notification.permission !== 'granted') return;
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription()
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
      await source.pushSubscribe(toData(sub));
    })().catch(() => { /* beim nächsten Einschalten */ });
  });
}
