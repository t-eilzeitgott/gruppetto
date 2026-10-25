import { useEffect, useRef, useState } from 'react';
import type { Climb, Sprint, Stage, Tour } from '../lib/types';
import { KIND_LABEL, fmtKm } from '../lib/time';
import { Icon } from './Icon';

/** Etappen mit Profildaten (Anstiege, Sprints oder Höhenmeter)? */
export function hasProfile(stage: Stage): boolean {
  return !!(stage.climbs?.length || stage.sprints?.length || stage.elevation_m);
}

const CAT_LABEL: Record<string, string> = { CC: 'Cima Coppi', HC: 'HC', '1': '1. Kat.', '2': '2. Kat.', '3': '3. Kat.', '4': '4. Kat.' };
const CAT_SHORT: Record<string, string> = { CC: 'CC', HC: 'HC', '1': '1', '2': '2', '3': '3', '4': '4' };
// Schematische Höhe und Länge je Kategorie, falls die echte Länge fehlt
const CAT_HEIGHT: Record<string, number> = { CC: 1, HC: 0.94, '1': 0.8, '2': 0.58, '3': 0.4, '4': 0.26 };
const CAT_LEN: Record<string, number> = { CC: 14, HC: 14, '1': 11, '2': 7, '3': 5, '4': 3 };

const H = 168;
const PAD_L = 14;
const PAD_R = 14;
const TOP = 40;
const BOTTOM = 26;

function catClass(cat: string): string {
  return `cat cat--${cat.toLowerCase()}`;
}

function profileShape(stage: Stage, km: number, W: number) {
  // Anstieg leicht gewölbt statt als gerade Linie
  const ease = (u: number) => u * u * (3 - 2 * u) * 0.35 + u * 0.65;
  const climbs = stage.climbs ?? [];
  const base = stage.kind === 'mountain' ? 0.1 : stage.kind === 'hilly' ? 0.08 : 0.05;
  const steps = Math.round(W / 2.5);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - TOP - BOTTOM;
  const y = (h: number) => TOP + plotH * (1 - h);
  const x = (k: number) => PAD_L + (Math.min(Math.max(k, 0), km) / km) * plotW;
  const height = (k: number) => {
    let h = base;
    for (const c of climbs) {
      const top = CAT_HEIGHT[c.cat] ?? 0.4;
      // Mindestbreite, damit kurze Anstiege nicht als Nadel erscheinen
      const len = Math.max(c.len ?? CAT_LEN[c.cat] ?? 5, km * 0.05);
      const up = (k - (c.km - len)) / len;
      const down = 1 - (k - c.km) / (len * 0.75);
      let v = 0;
      if (k <= c.km && up >= 0) v = base + (top - base) * ease(up);
      else if (k > c.km && down >= 0) v = base + (top - base) * ease(down);
      h = Math.max(h, v);
    }
    return h;
  };
  const pts: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const k = (km * i) / steps;
    pts.push(`${x(k).toFixed(1)},${y(height(k)).toFixed(1)}`);
  }
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${x(km).toFixed(1)},${(H - BOTTOM).toFixed(1)} L${x(0).toFixed(1)},${(H - BOTTOM).toFixed(1)} Z`;
  return { line, area, x, y, height, plotW };
}

/** Schematisches Etappenprofil mit Bergwertungen und Zwischensprints. */
export function StageProfileChart({ stage }: { stage: Stage }) {
  // Breite messen, damit 1 SVG-Einheit = 1 Pixel ist (Schrift bleibt überall gleich groß)
  const wrap = useRef<HTMLDivElement | null>(null);
  const [W, setW] = useState(340);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const update = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    update();
    const RO = (window as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!RO) return undefined;
    const ro = new RO(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const km = stage.distance_km ?? Math.max(1, ...(stage.climbs ?? []).map((c) => c.km), ...(stage.sprints ?? []).map((s) => s.km));
  const { line, area, x, y, height } = profileShape(stage, km, W);
  const climbs = [...(stage.climbs ?? [])].sort((a, b) => a.km - b.km);
  const sprints = stage.sprints ?? [];

  // Beschriftungen auf zwei Reihen verteilen, damit sie sich nicht überdecken
  const rowEnd = [-Infinity, -Infinity];
  const labels = climbs.map((c) => {
    const cx = x(c.km);
    const row = cx - rowEnd[0] >= 28 ? 0 : 1;
    rowEnd[row] = cx;
    return { c, cx, row };
  });

  const tickStep = km > 150 ? 50 : km > 60 ? 25 : 10;
  const minGap = 34; // px zwischen zwei Achsenbeschriftungen
  const ticks: number[] = [];
  for (let t = 0; t <= km; t += tickStep) {
    if (x(km) - x(t) >= minGap) ticks.push(t);
  }

  return (
    <div ref={wrap} className="profile-chart-wrap">
    <svg className="profile-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Schematisches Profil, ${fmtKm(km)}, ${climbs.length} Bergwertungen`}>
      <defs>
        <linearGradient id={`pf-${stage.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t} className="profile-chart__tick">
          <line x1={x(t)} x2={x(t)} y1={TOP - 6} y2={H - BOTTOM} />
          <text x={x(t)} y={H - 8} textAnchor={t === 0 ? 'start' : 'middle'}>{t}</text>
        </g>
      ))}
      <text className="profile-chart__end" x={x(km)} y={H - 8} textAnchor="end">{fmtKm(km)}</text>
      <path d={area} fill={`url(#pf-${stage.id})`} />
      <path d={line} className="profile-chart__line" />
      {sprints.map((s, i) => {
        const sx = x(s.km);
        const sy = y(height(s.km));
        return (
          <g key={`s${i}`} className="profile-chart__sprint">
            <line x1={sx} x2={sx} y1={sy} y2={H - BOTTOM} />
            <rect x={sx - 9} y={sy - 24} width="18" height="16" rx="5" />
            <text x={sx} y={sy - 12.5} textAnchor="middle">S</text>
          </g>
        );
      })}
      {labels.map(({ c, cx, row }, i) => {
        const cy = y(height(c.km));
        const ly = 4 + row * 19;
        const label = CAT_SHORT[c.cat] ?? c.cat;
        const wPill = label.length > 1 ? 24 : 18;
        const px = Math.min(Math.max(cx - wPill / 2, 2), W - wPill - 2);
        return (
          <g key={`c${i}`}>
            <line className="profile-chart__lead" x1={cx} x2={cx} y1={ly + 16} y2={cy - 3} />
            <circle className="profile-chart__dot" cx={cx} cy={cy} r="3.2" />
            <rect className={catClass(c.cat)} x={px} y={ly} width={wPill} height="16" rx="5" />
            <text className={`${catClass(c.cat)}-text`} x={px + wPill / 2} y={ly + 11.5} textAnchor="middle">{label}</text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

function climbFacts(c: Climb): string {
  const parts: string[] = [];
  if (c.len) parts.push(`${c.len.toLocaleString('de-DE')} km`);
  if (c.grad) parts.push(`${c.grad.toLocaleString('de-DE')} %`);
  return parts.join(' · ');
}

type Point = { km: number; kind: 'climb'; c: Climb } | { km: number; kind: 'sprint'; s: Sprint };

/** Karte mit Profil, Kennzahlen und Liste der Wertungen. */
export function StageProfileCard({ stage, tour }: { stage: Stage; tour: Tour }) {
  if (!hasProfile(stage) && stage.kind !== 'itt' && stage.kind !== 'ttt') return null;
  const climbs = stage.climbs ?? [];
  const points: Point[] = [
    ...climbs.map((c) => ({ km: c.km, kind: 'climb' as const, c })),
    ...(stage.sprints ?? []).map((s) => ({ km: s.km, kind: 'sprint' as const, s })),
  ].sort((a, b) => a.km - b.km);
  const summitFinish = climbs.some((c) => stage.distance_km !== null && c.km >= stage.distance_km - 0.5);
  const pcs = tour.pcs_slug ? `https://www.procyclingstats.com/race/${tour.pcs_slug}/stage-${stage.number}/info/profiles` : null;

  return (
    <section className="card profile-card" aria-labelledby={`profile-${stage.id}`}>
      <div className="card__row">
        <h2 id={`profile-${stage.id}`} className="eyebrow">Profil</h2>
        {summitFinish ? <span className="chip chip--accent">Bergankunft</span> : null}
      </div>
      <dl className="profile-facts">
        <div><dt>Distanz</dt><dd>{stage.distance_km ? fmtKm(stage.distance_km) : '–'}</dd></div>
        <div><dt>Höhenmeter</dt><dd>{stage.elevation_m ? `${stage.elevation_m.toLocaleString('de-DE')} m` : '–'}</dd></div>
        <div><dt>Bergwertungen</dt><dd>{climbs.length}</dd></div>
        <div><dt>Typ</dt><dd>{KIND_LABEL[stage.kind]}</dd></div>
      </dl>
      <StageProfileChart stage={stage} />
      {points.length ? (
        <ol className="profile-points" aria-label="Wertungen entlang der Strecke">
          {points.map((p, i) => (
            <li key={i}>
              <span className="profile-points__km">{p.km.toLocaleString('de-DE')}</span>
              {p.kind === 'climb' ? (
                <>
                  <span className={`badge ${catClass(p.c.cat)}`}>{CAT_SHORT[p.c.cat] ?? p.c.cat}</span>
                  <span className="profile-points__main">
                    <strong>{p.c.name}</strong>
                    <span className="muted">{[CAT_LABEL[p.c.cat] ?? p.c.cat, climbFacts(p.c)].filter(Boolean).join(' · ')}</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="badge badge--sprint">S</span>
                  <span className="profile-points__main">
                    <strong>{p.s.name ?? 'Zwischensprint'}</strong>
                    <span className="muted">Punkte für die Punktewertung</span>
                  </span>
                </>
              )}
            </li>
          ))}
          <li>
            <span className="profile-points__km">{stage.distance_km ? stage.distance_km.toLocaleString('de-DE') : ''}</span>
            <span className="badge badge--finish"><Icon name="flag" size={13} stroke={2.2} /></span>
            <span className="profile-points__main">
              <strong>Ziel{stage.arrival ? ` in ${stage.arrival}` : ''}</strong>
              <span className="muted">{summitFinish ? 'Bergankunft' : stage.kind === 'itt' ? 'Zeitfahren' : 'Zielankunft'}</span>
            </span>
          </li>
        </ol>
      ) : null}
      <p className="hint">
        Schematisch aus den Bergwertungen gezeichnet, km-Angaben zum Gipfel.
        {pcs ? <> <a href={pcs} target="_blank" rel="noopener noreferrer">Original-Profil bei ProCyclingStats</a></> : null}
      </p>
    </section>
  );
}
