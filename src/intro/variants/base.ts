import { rollOut, type Variant } from '../engine';

/** gewohnt: „g." – der Punkt rollt das Wort aus, ein Ring pulsiert, bis die App bereit ist */
export const base: Variant = (c) => rollOut(c);
