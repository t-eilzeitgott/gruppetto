/**
 * Das echte Finale einer Etappe aus dem Streckentext (stages.info.finale), wie ihn die Rennleitung
 * veröffentlicht: „Linkskurve 650 m vor dem Ziel in einen leichten Anstieg (4 %) über die gepflasterte
 * Via Acton, zwei Rechtskurven 400 m vor dem Ziel auf die 8 m breite, gepflasterte Zielgerade.“
 *
 * Daraus wird ein Bauplan für die letzten Kilometer des Sprintfinales: wo die letzte Kurve liegt, in
 * welche Richtung sie geht, wie lang und wie steil die Zielgerade ist, ob Pflaster liegt. Was der Text
 * nicht hergibt, bleibt null – die Strecke nimmt dann ihren Tageszufall.
 */

export interface Corner {
  /** Meter vor dem Ziel */
  at: number;
  dir: 'L' | 'R' | null;
  /** „zwei Rechtskurven“ */
  n: number;
}

export interface FinaleSpec {
  /** Kurven auf den letzten 3 km (nach Abstand zum Ziel absteigend) */
  corners: Corner[];
  /** letzte Kurve, Meter vor dem Ziel */
  lastCorner: number | null;
  /** Länge der Zielgeraden (m) */
  straight: number | null;
  /** Breite der Zielgeraden (m) */
  width: number | null;
  /** Steigung der Zielgeraden (Anteil, 0,037 = 3,7 %) */
  grade: number | null;
  /** Steigung des letzten Kilometers, wenn davon die Rede ist */
  lastKmGrade: number | null;
  /** Pflaster ab so vielen Metern vor dem Ziel (null = keins) */
  cobblesFrom: number | null;
  roundabouts: boolean;
  /** Zielgerade am Wasser (Hafen, Promenade, See) */
  waterfront: boolean;
  /** knapper Satz für die Startkarte */
  line: string;
}

const num = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.')) * 10000) / 10000;
/** „300 m“, „1 km“, „1,5 km“, „3.000 m“ → Meter */
const meters = (v: string, unit: string) => Math.round(num(v) * (unit.toLowerCase().startsWith('k') ? 1000 : 1));


function gradeWords(s: string): number | null {
  const t = s.toLowerCase();
  const pct = t.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (pct) return Math.round(num(pct[1]) * 100) / 10000;
  if (/leicht (an)?steigend|steigt leicht|leichter anstieg|leicht bergauf|leicht ansteigend/.test(t)) return 0.02;
  if (/ansteigend|steigend|bergauf|steigt|anstieg|rampe/.test(t)) return 0.035;
  if (/leicht (ab)?fallend|leicht abfallend|leicht bergab|ganz leicht abfallend/.test(t)) return -0.012;
  if (/fallend|abfallend|bergab/.test(t)) return -0.025;
  if (/flach|eben/.test(t)) return 0;
  return null;
}

export function parseFinale(text: string | null | undefined): FinaleSpec | null {
  if (!text || !text.trim()) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  const low = t.toLowerCase();
  const corners: Corner[] = [];

  // „Linkskurve 650 m vor dem Ziel“, „zwei Rechtskurven 400 m vor dem Ziel“, „letzte Kurve 300 m vor dem Ziel“,
  // „die letzte etwa 2 km vor dem Ziel“, „rechts auf die Uferpromenade 1 km vor dem Ziel“
  const re = /(zwei|drei|\d)?\s*(links|rechts|letzte|l\.|r\.)?\s*(?:kurven?|kurve|ecke)?[^.;,]{0,40}?(\d+(?:[.,]\d+)?)\s*(m|km)\s+vor dem ziel/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 30), m.index + m[0].length).toLowerCase();
    // „500 m vor dem Ziel ein kurzes Flachstück“ ist keine Kurve
    if (!/kurve|rechts|links|ecke/.test(before)) continue;
    const dir: Corner['dir'] = /links/.test(before) ? 'L' : /rechts/.test(before) ? 'R' : null;
    const n = /zwei/.test(before) ? 2 : /drei/.test(before) ? 3 : 1;
    const at = meters(m[3], m[4]);
    if (at >= 60 && at <= 3200 && !corners.some((c) => c.at === at)) corners.push({ at, dir, n });
  }
  corners.sort((a, b) => b.at - a.at);
  let lastCorner = corners.length ? corners[corners.length - 1].at : null;

  // Zielgerade: „Zielgerade 700 m, 7 m breit, leicht ansteigend“, „Zielgerade (450 m, 3,7 % Steigung), 8 m breit“,
  // „die Zielgerade ist 2.800 m lang“, „die letzten 500 m schnurgerade, 8 m breit“
  let straight: number | null = null;
  let width: number | null = null;
  let grade: number | null = null;
  const zg = low.match(/zielgerade(?:[^.;]|\.(?=\d))*/) ?? low.match(/letzten (\d+(?:[.,]\d+)?)\s*m schnurgerade(?:[^.;]|\.(?=\d))*/);
  if (zg) {
    const part = zg[0];
    const lens = [...part.matchAll(/(\d+(?:[.,]\d+)?)\s*(m|km)\b(?!\s*breit)/g)];
    const first = lens.find((x) => !/breit/.test(part.slice(x.index!, x.index! + x[0].length + 8)));
    if (first) {
      const v = meters(first[1], first[2]);
      if (v >= 80 && v <= 4000) straight = v;
    }
    const w = part.match(/(\d+(?:[.,]\d+)?)\s*m\s*breit/);
    if (w) width = num(w[1]);
    grade = gradeWords(part);
  }
  if (width === null) {
    const w = low.match(/(\d+(?:[.,]\d+)?)\s*m\s*breit/);
    if (w) width = num(w[1]);
  }
  if (lastCorner === null && straight !== null && straight <= 1500) lastCorner = straight;
  if (straight === null && lastCorner !== null) straight = lastCorner;

  // letzter Kilometer: „der letzte Kilometer steigt leicht an“, „der letzte Kilometer flach“
  let lastKmGrade: number | null = null;
  const lk = low.match(/letzten? kilometer[^.;]*/);
  if (lk) lastKmGrade = gradeWords(lk[0]);
  // Steigung ohne Zielgeraden-Satz: „leichten Anstieg (4 %)“ auf der Zielgeraden
  if (grade === null && corners.length) {
    // ab der ersten genannten Kurve: „Linkskurve 650 m vor dem Ziel in einen leichten Anstieg (4 %) …“
    const at = low.indexOf('vor dem ziel');
    grade = (at >= 0 ? gradeWords(low.slice(at)) : null) ?? lastKmGrade;
  }

  // Pflaster: ab der zugehörigen Kurve, sonst auf der Zielgeraden
  let cobblesFrom: number | null = null;
  if (/pflaster|gepflastert|porphyr/.test(low)) {
    const idx = low.search(/pflaster|gepflastert|porphyr/);
    const ahead = low.slice(0, idx);
    const dm = [...ahead.matchAll(/(\d+(?:[.,]\d+)?)\s*(m|km)\s+vor dem ziel/g)].pop();
    cobblesFrom = dm ? meters(dm[1], dm[2]) : lastCorner ?? 400;
    cobblesFrom = Math.min(cobblesFrom, 1200);
  }

  const roundabouts = /kreisverkehr/.test(low);
  const waterfront = /hafen|promenade|ufer|see\b|meer|strand|lungomare/.test(low);

  const bits: string[] = [];
  if (lastCorner !== null) bits.push(`letzte Kurve ${fmtM(lastCorner)} vor dem Ziel`);
  if (straight !== null && straight !== lastCorner) bits.push(`Zielgerade ${fmtM(straight)}`);
  const gw = grade === null ? '' : grade >= 0.03 ? `${fmtPct(grade)} Steigung` : grade > 0.005 ? 'leicht ansteigend' : grade < -0.005 ? 'leicht abfallend' : 'flach';
  if (gw) bits.push(gw);
  if (width !== null) bits.push(`${width.toLocaleString('de-DE')} m breit`);
  if (cobblesFrom !== null) bits.push('Pflaster');
  const line = bits.join(' · ');

  return { corners, lastCorner, straight, width, grade, lastKmGrade, cobblesFrom, roundabouts, waterfront, line };
}

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km` : `${m} m`);
const fmtPct = (g: number) => `${(g * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

/**
 * Steigung an einer Stelle (Meter vor dem Ziel) nach dem Bauplan: Zielgerade mit ihrer Steigung,
 * davor der letzte Kilometer, sonst null (Tageszufall). Weich geblendet, damit nichts knickt.
 */
export function finaleGrade(spec: FinaleSpec, distToFinish: number): number | null {
  const s = spec.straight ?? spec.lastCorner;
  if (spec.grade !== null && s !== null && distToFinish <= s) return spec.grade;
  if (spec.lastKmGrade !== null && distToFinish <= 1000) return spec.lastKmGrade;
  if (spec.grade !== null && s === null && distToFinish <= 400) return spec.grade;
  return null;
}
