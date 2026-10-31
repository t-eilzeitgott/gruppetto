/**
 * „Die Oberfläche bewegt sich gerade“: Startblatt, Flug des Kopfs, Countdown, Einblenden des HUD. Solange das
 * gilt, tritt die Leerlauf-Arbeit der 3D-Welt (Vorbauen auf der Startkarte) fast ganz zurück, damit die Bewegung
 * flüssig bleibt – danach baut sie in Ruhe weiter.
 */
let until = 0;

/** für die nächsten ms (verlängert nur, kürzt nie) */
export function markUiBusy(ms: number) {
  until = Math.max(until, performance.now() + ms);
}

export function uiBusy(): boolean {
  return performance.now() < until;
}
