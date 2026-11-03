/**
 * Aus einem Spiel zurück in die App ohne harten Schnitt: Ein dunkler Schleier legt sich weich über das Spiel, erst
 * dann wechselt die Seite (Spiel abbauen, Startseite aufbauen – das hält den Hauptfaden an, ist aber verdeckt), und
 * sobald die neue Seite gezeichnet ist, hebt er sich wieder. Beide Bewegungen laufen nur über opacity (Compositor).
 */
import { handOver } from './router';
import { markUiBusy } from '../game/uiBusy';

let busy = false;

const calm = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** fn wechselt die Seite (z. B. navigate('/')) – unter dem Schleier, ohne zweites Einblenden des Routers */
export function veilThen(fn: () => void) {
  if (busy) return;
  if (calm() || typeof document === 'undefined') { fn(); return; }
  busy = true;
  const v = document.createElement('div');
  v.className = 'veil';
  v.setAttribute('aria-hidden', 'true');
  document.body.append(v);
  // (die Startseite baut ihren 3D-Vorrat erst weiter, wenn der Schleier weg ist)
  markUiBusy(1100);
  let done = false;
  const swap = () => {
    if (done) return;
    done = true;
    try {
      handOver();
      fn();
    } catch (e) {
      console.error(e);
    }
    // aufdecken, sobald das Spiel weg ist und die neue Seite ihr erstes Bild hat (zur Startseite geht der Router
    // erst im Verlauf zurück – das kommt einen Moment später)
    const t0 = performance.now();
    const reveal = () => {
      const end = () => { v.remove(); busy = false; };
      try {
        v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'forwards' }).finished.then(end, end);
      } catch { end(); }
      window.setTimeout(end, 900);
    };
    const wait = () => {
      const gone = !document.querySelector('.abf:not(.abf--ghost)');
      if (gone || performance.now() - t0 > 1500) requestAnimationFrame(() => requestAnimationFrame(reveal));
      else requestAnimationFrame(wait);
    };
    wait();
  };
  try {
    v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(0.4, 0, 0.9, 0.6)', fill: 'forwards' }).finished.then(swap, swap);
  } catch { swap(); }
  // Sicherheitsnetz (Animation hängt im Hintergrund)
  window.setTimeout(swap, 480);
}
