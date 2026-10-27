/**
 * Schwere Arbeit (3D aufbauen, Shader übersetzen) erst nach dem nächsten gezeichneten Bild starten:
 * so steht die neue Seite sofort da (und der Übergang dorthin läuft flüssig), die 3D-Szene blendet danach ein.
 * Gibt eine Funktion zum Abbrechen zurück.
 */
export function afterPaint(fn: () => void): () => void {
  let t = 0;
  const r = requestAnimationFrame(() => { t = window.setTimeout(fn, 0); });
  return () => { cancelAnimationFrame(r); window.clearTimeout(t); };
}
