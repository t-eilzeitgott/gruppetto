/**
 * Wie oft und wie groß die Schattenkarte gezeichnet wird – eingestellt von der Automatik (autoGfx.ts) und den
 * Wechseltests der Messfahrt, gelesen von weather.ts je Bild. Ohne Three.js (die Automatik lädt auch im Menü).
 */

/** Schattenkarte jedes n-te Bild (1 = jedes) */
let shadowEvery = 1;
export function setShadowEvery(n: number) { shadowEvery = Math.max(1, Math.round(n)); }
export function shadowEveryN(): number { return shadowEvery; }
/** Schattenkarte probeweise klein (Wechseltest): 0 = wie eingestellt, sonst Kantenlänge in Texeln */
let shadowSizeOverride = 0;
export function setShadowSizeOverride(px: number) { shadowSizeOverride = px; }
export function shadowSizeOverrideN(): number { return shadowSizeOverride; }
