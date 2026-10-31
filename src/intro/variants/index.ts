import type { IntroId } from '../schedule';
import type { Variant } from '../engine';
import { base } from './base';
import { halloween } from './halloween';
import { laufrad, sprint, trikots, windschatten, zielfoto } from './alts';
import { advent, frost, laterne, laub, nebel, neujahr, silvester, weihnachten, winter } from './season';

/** alle Varianten (noch nicht gebaute zeigen das gewohnte Intro) */
export const VARIANTS: Record<IntroId, Variant> = {
  base,
  sprint, windschatten, zielfoto, laufrad, trikots,
  halloween,
  laub, laterne, nebel, frost, advent, weihnachten, winter, silvester, neujahr,
  valentin: base, karneval: base, ostern: base, renntag: base,
};
