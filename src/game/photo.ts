/**
 * Fotofinish: Wer im Ziel weniger als PHOTO_CLOSE Sekunden vor oder hinter einem war, kommt aufs Zielfoto – Fahrer
 * im Feld (genaue Zielzeit), Geister und Live-Mitspieler (aus der Lage im Moment, in dem man selbst die Linie
 * überquert, und ihrem Tempo). Die Zeiten sind relativ zur eigenen: negativ = vor einem im Ziel.
 */

export interface PhotoRider {
  id: string;
  name: string;
  color: string;
  /** Zielzeit relativ zur eigenen (s): negativ = früher im Ziel */
  t: number;
  me?: boolean;
  /** Mitspieler, der gerade live mitfährt */
  live?: boolean;
  /** Geist eines Mitspielers */
  ghost?: boolean;
}

export interface PhotoResult {
  riders: PhotoRider[];
  /** eigenes Tempo auf der Linie (m/s): Zeitabstand → Abstand in Metern */
  v: number;
}

/** so knapp muss es sein (s) */
export const PHOTO_CLOSE = 0.6;
/** so weit (s) kommt noch jemand mit aufs Bild */
const PHOTO_SPAN = 1.2;

/** Zielzeit eines anderen relativ zur eigenen aus der Lage im Moment des eigenen Zieldurchgangs (Meter, m/s) */
export function crossOffset(finishZ: number, z: number, v: number, myZ: number, myV: number): number {
  return (finishZ - z) / Math.max(1, v) + (myZ - finishZ) / Math.max(1, myV);
}

/**
 * Zielfoto, wenn es knapp war: die nächsten zwei vor und hinter einem (nur wer höchstens PHOTO_SPAN entfernt ist),
 * sonst null
 */
export function photoFinish(others: PhotoRider[], me: { name: string; color: string }, v: number): PhotoResult | null {
  const near = others.filter((o) => Number.isFinite(o.t) && Math.abs(o.t) <= PHOTO_SPAN).sort((a, b) => Math.abs(a.t) - Math.abs(b.t));
  if (!near.length || Math.abs(near[0].t) > PHOTO_CLOSE) return null;
  const ahead = near.filter((o) => o.t < 0).slice(0, 2);
  const behind = near.filter((o) => o.t >= 0).slice(0, 2);
  const riders = [...ahead, { id: 'me', name: me.name, color: me.color, t: 0, me: true }, ...behind].sort((a, b) => a.t - b.t);
  return { riders, v: Math.max(1, v) };
}

/** Abstand als Text: „14 cm“, „1,2 m“ (aus Zeitabstand und Tempo) */
export function photoGap(dt: number, v: number): string {
  const m = Math.abs(dt) * v;
  if (m < 1) return `${Math.max(1, Math.round(m * 100))} cm`;
  return `${m.toLocaleString('de-DE', { maximumFractionDigits: 1 })} m`;
}
