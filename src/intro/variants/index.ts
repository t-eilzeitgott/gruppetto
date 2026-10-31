import type { IntroId } from '../schedule';
import type { Variant } from '../engine';
import { base } from './base';
import { fall, fokus, laufrad, sprint, trikots, welle, windschatten, zielfoto } from './alts';
import { renntag } from './race';

/** alle Varianten */
export const VARIANTS: Record<IntroId, Variant> = {
  base,
  sprint, fokus, windschatten, zielfoto, welle, laufrad, fall, trikots,
  renntag,
};
