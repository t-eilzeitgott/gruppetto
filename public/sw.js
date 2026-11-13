// gruppetto – Service Worker nur für Benachrichtigungen (Web Push). Kein Zwischenspeicher, kein Offline-Betrieb:
// Seiten und Dateien kommen wie bisher direkt vom Server.
//
// Nachricht (JSON, vom Workflow „Benachrichtigungen“, scripts/push): { title, body, url, tag }
// url = Pfad in der App (Hash-Route, z. B. /etappe/7).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data ? event.data.text() : '' }; }
  const scope = self.registration.scope;
  event.waitUntil(self.registration.showNotification(msg.title || 'gruppetto', {
    body: msg.body || '',
    tag: msg.tag || undefined,
    icon: `${scope}icons/icon-192.png?v=2`,
    badge: `${scope}icons/icon-192.png?v=2`,
    lang: 'de',
    data: { url: msg.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const path = (event.notification.data && event.notification.data.url) || '/';
  const target = `${scope}#${path}`;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(scope) && 'focus' in w) {
        await w.focus();
        if ('navigate' in w) { try { await w.navigate(target); } catch { /* fremde Seite: nur nach vorn holen */ } }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// Push-Dienst hat das Abo erneuert (selten, v. a. Firefox): neue Anmeldung an die App melden, sobald sie offen ist
self.addEventListener('pushsubscriptionchange', () => {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) w.postMessage({ type: 'push-renew' });
  });
});
