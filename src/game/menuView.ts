/**
 * Wo ein Spielmenü (Startmenü) die 3D-Welt verdeckt – für die Kamera: Sie verschiebt ihr Bild (wie ein Shift-Objektiv,
 * ohne zu kippen), damit der Fahrer mitten im freien Teil steht. Schließt das Menü, gleitet das Bild zurück.
 *  - top: Oberkante des Menüs (px von oben; hochkant liegt es unten)
 *  - left: rechte Kante des Menüs (px von links; quer liegt es als Leiste links)
 */
export interface MenuInset { top: number; left: number }

let cur: MenuInset | null = null;

export function setMenuInset(v: MenuInset | null) {
  cur = v;
}

export function menuInset(): MenuInset | null {
  return cur;
}
