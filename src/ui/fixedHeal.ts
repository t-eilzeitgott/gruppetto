/**
 * iPhone (WebKit): feste Leisten (position: fixed mit unscharfem Hintergrund) bleiben manchmal an einer falschen
 * Stelle hängen – die Statusleisten-Abdeckung stand dann als schwarzer Balken mitten auf der Seite und blieb dort
 * auch beim Scrollen. Auslöser sind Momente, in denen sich der Ansichtsbereich umbaut: Spiel verlassen
 * (Seitensperre weg), Seitenwechsel mit Überblendung, Rückkehr aus dem Hintergrund, Drehen.
 *
 * Heilung: die Leisten kurz aus- und wieder einhängen (display none → Layout → zurück). WebKit legt ihre Ebene
 * dann mit den aktuellen Maßen neu an. Passiert innerhalb eines Bildes – sichtbar ist davon nichts.
 */
const SEL = '.status-shade, .tabbar';

export function healFixed() {
  try {
    const els = Array.from(document.querySelectorAll<HTMLElement>(SEL));
    if (!els.length) return;
    for (const el of els) el.style.display = 'none';
    void document.documentElement.offsetHeight;
    for (const el of els) el.style.display = '';
  } catch { /* egal */ }
}

/** nach dem nächsten Zeichnen heilen (die neue Seite muss schon stehen) – und zur Sicherheit noch einmal etwas später */
export function healFixedSoon() {
  requestAnimationFrame(() => requestAnimationFrame(healFixed));
  window.setTimeout(healFixed, 400);
}

let installed = false;

/** einmal beim Start: bei Rückkehr in die App, beim Wiederherstellen aus dem Verlauf und beim Drehen heilen */
export function installFixedHeal() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') healFixedSoon(); });
  window.addEventListener('pageshow', healFixedSoon);
  window.addEventListener('orientationchange', healFixedSoon);
  healFixedSoon();
}
