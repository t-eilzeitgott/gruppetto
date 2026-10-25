/** Höhenprofil: Punkte [km, Höhe in m] */
export type ProfilePoint = [number, number];

export interface ParsedGpx {
  points: ProfilePoint[];
  distanceKm: number;
  gainM: number;
  minM: number;
  maxM: number;
  startM: number;
  finishM: number;
  name: string | null;
}

const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

function haversine(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Liest Track- oder Routenpunkte mit Höhe aus einer GPX-Datei. */
export function readGpxPoints(xml: string): { lat: number; lon: number; ele: number }[] {
  const out: { lat: number; lon: number; ele: number }[] = [];
  const re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[2];
    const lat = /lat\s*=\s*["']([-\d.eE+]+)["']/.exec(attrs);
    const lon = /lon\s*=\s*["']([-\d.eE+]+)["']/.exec(attrs);
    const ele = m[4] ? /<ele>\s*([-\d.eE+]+)\s*<\/ele>/.exec(m[4]) : null;
    if (!lat || !lon || !ele) continue;
    const p = { lat: Number(lat[1]), lon: Number(lon[1]), ele: Number(ele[1]) };
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.ele)) out.push(p);
  }
  return out;
}

/** Höhe bei km (lineare Interpolation) */
export function eleAt(points: ProfilePoint[], km: number): number {
  if (!points.length) return 0;
  if (km <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (km >= last[0]) return last[1];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= km) lo = mid; else hi = mid;
  }
  const [k0, e0] = points[lo];
  const [k1, e1] = points[hi];
  return k1 === k0 ? e0 : e0 + ((e1 - e0) * (km - k0)) / (k1 - k0);
}

/**
 * Wandelt eine GPX-Datei in ein geglättetes Höhenprofil um:
 * alle 100 m abtasten, über 500 m glätten, dann auf höchstens ~600 Punkte verdichten.
 */
export function parseGpx(xml: string): ParsedGpx | null {
  const raw = readGpxPoints(xml);
  if (raw.length < 2) return null;
  const nameMatch = /<(?:trk|rte|metadata)>[\s\S]*?<name>([^<]+)<\/name>/.exec(xml);

  // kumulierte Distanz
  const dist: number[] = [0];
  for (let i = 1; i < raw.length; i += 1) {
    dist.push(dist[i - 1] + haversine([raw[i - 1].lat, raw[i - 1].lon], [raw[i].lat, raw[i].lon]));
  }
  const total = dist[dist.length - 1];
  if (total < 0.5) return null;
  const rawProfile: ProfilePoint[] = raw.map((p, i) => [dist[i], p.ele]);

  // alle 100 m abtasten
  const step = 0.1;
  const sampled: number[] = [];
  for (let k = 0; k <= total + 1e-9; k += step) sampled.push(eleAt(rawProfile, k));
  // gleitender Mittelwert über ±250 m
  const win = 2;
  const smooth = sampled.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(sampled.length - 1, i + win); j += 1) { s += sampled[j]; n += 1; }
    return s / n;
  });
  let gain = 0;
  for (let i = 1; i < smooth.length; i += 1) if (smooth[i] > smooth[i - 1]) gain += smooth[i] - smooth[i - 1];

  // verdichten
  const every = Math.max(1, Math.round(total / step / 600));
  const points: ProfilePoint[] = [];
  for (let i = 0; i < smooth.length; i += every) points.push([Math.round(i * step * 100) / 100, Math.round(smooth[i])]);
  const lastKm = Math.round(total * 100) / 100;
  if (points[points.length - 1][0] < lastKm) points.push([lastKm, Math.round(smooth[smooth.length - 1])]);

  const eles = points.map((p) => p[1]);
  return {
    points,
    distanceKm: lastKm,
    gainM: Math.round(gain),
    minM: Math.min(...eles),
    maxM: Math.max(...eles),
    startM: points[0][1],
    finishM: points[points.length - 1][1],
    name: nameMatch ? nameMatch[1].trim() : null,
  };
}

/** Etappennummer aus einem Dateinamen raten („giro-2026-stage-7.gpx“, „Tappa 07.gpx“, „E7.gpx“) */
export function stageNumberFromName(name: string): number | null {
  const base = name.replace(/\.[^.]+$/, '');
  const m = /(?:stage|etappe|tappa|etapa|etape|étape|st|e|s)[\s_-]*0*(\d{1,2})(?!\d)/i.exec(base);
  if (m) return Number(m[1]);
  const nums = base.match(/(?<!\d)\d{1,2}(?!\d)/g);
  return nums ? Number(nums[nums.length - 1]) : null;
}

export interface KmSegment {
  from: number;
  to: number;
  grade: number;
}

/** Steigung je Kilometer zwischen zwei Punkten der Strecke (für Anstiegs-Steckbriefe) */
export function kmSegments(points: ProfilePoint[], fromKm: number, toKm: number): KmSegment[] {
  const segs: KmSegment[] = [];
  const len = toKm - fromKm;
  if (len <= 0) return segs;
  const n = Math.max(1, Math.round(len));
  const size = len / n;
  for (let i = 0; i < n; i += 1) {
    const a = fromKm + i * size;
    const b = a + size;
    const grade = ((eleAt(points, b) - eleAt(points, a)) / (size * 1000)) * 100;
    segs.push({ from: a, to: b, grade: Math.round(grade * 10) / 10 });
  }
  return segs;
}
