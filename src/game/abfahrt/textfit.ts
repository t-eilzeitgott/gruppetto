/**
 * Schriftgröße für einen Text, der in eine Breite passen muss.
 *
 * Wie die frühere Schleife (start, start − step, start − 2·step, …; höchstens bis zum ersten Wert ≤ floor) die größte
 * Größe, bei der text höchstens maxW breit ist. Die Breite wächst linear mit der Schriftgröße: Die Größe wird
 * ausgerechnet und nur noch geprüft – zwei bis drei Messungen statt bis zu zwanzig (jede kostet auf dem Handy
 * spürbar; Schriften auf Straße, Bögen und Tafeln entstehen unterwegs). Setzt c.font auf das Ergebnis.
 */
export function fitFont(c: CanvasRenderingContext2D, text: string, maxW: number, start: number, step: number, floor: number, font: (fs: number) => string): number {
  const at = (k: number) => start - k * step;
  c.font = font(start);
  const w0 = c.measureText(text).width;
  if (w0 <= maxW || !(start > floor)) return start;
  // so viele Schritte, bis die alte Schleife spätestens anhielt (erster Wert ≤ floor)
  const kMax = Math.max(1, Math.ceil((start - floor) / step - 1e-9));
  let k = Math.min(kMax, Math.max(1, Math.ceil((start - (start * maxW) / w0) / step - 1e-9)));
  c.font = font(at(k));
  while (k < kMax && c.measureText(text).width > maxW) { k += 1; c.font = font(at(k)); }
  // passt schon eine Stufe größer? (Rundung der Schrift)
  while (k > 1) {
    c.font = font(at(k - 1));
    if (c.measureText(text).width > maxW) break;
    k -= 1;
  }
  c.font = font(at(k));
  return at(k);
}
