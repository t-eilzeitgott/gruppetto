import type { IntroId } from '../schedule';
import type { Variant } from '../engine';
import { base } from './base';
import { halloween } from './halloween';
import { laufrad, sprint, trikots, windschatten, zielfoto } from './alts';

/** alle Varianten (noch nicht gebaute zeigen das gewohnte Intro) */
export const VARIANTS: Record<IntroId, Variant> = {
  base,
  sprint, windschatten, zielfoto, laufrad, trikots,
  halloween,
  laub: base, laterne: base, nebel: base, frost: base, advent: base, weihnachten: base, winter: base, silvester: base, neujahr: base,
  valentin: base, karneval: base, ostern: base, renntag: base,
};
