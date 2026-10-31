/**
 * App-Intro (in index.html, läuft schon vor dem Skript): Die App sagt Bescheid, wann es weitergeht – sobald die
 * Startseite mit Inhalt steht und das erste Spiel vorgewärmt ist. Spätestens nach CAP ms reicht der Inhalt
 * (das Vorwärmen läuft dann im Hintergrund weiter).
 */
type IntroApi = { finish: (target: Element | null) => void };

const CAP = 2600;
const ready = new Set<'content' | 'warm'>();
let ended = false;

function api(): IntroApi | undefined {
  return (window as unknown as { __intro?: IntroApi }).__intro;
}

/** läuft das Intro (noch)? */
export function introActive(): boolean {
  return !ended && !!api() && !!document.getElementById('intro');
}

export function introReady(part: 'content' | 'warm') {
  if (ended) return;
  ready.add(part);
  if (ready.has('content') && (ready.has('warm') || performance.now() > CAP)) endIntro();
}

if (typeof window !== 'undefined') {
  window.setTimeout(() => { if (ready.has('content')) endIntro(); }, Math.max(0, CAP - performance.now()));
}

/** Intro beenden: die Wortmarke fliegt an ihren Platz in der App */
export function endIntro() {
  if (ended) return;
  ended = true;
  dropPreview();
  const a = api();
  if (!a) return;
  // ein Bild abwarten: die Seite ist gezeichnet, die Wortmarke steht an ihrem Platz
  requestAnimationFrame(() => requestAnimationFrame(() => a.finish(findMark())));
}

/** sichtbare Wortmarke der App (Kopf der Startseite oder Seitenleiste) */
function findMark(): Element | null {
  for (const el of Array.from(document.querySelectorAll('#root .wordmark'))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** Vorschau-Parameter (?intro=…, ?introdate=…) nach dem Start aus der Adresse nehmen – neu laden zeigt wieder das normale Intro */
function dropPreview() {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has('intro') && !u.searchParams.has('introdate')) return;
    u.searchParams.delete('intro');
    u.searchParams.delete('introdate');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  } catch { /* egal */ }
}
