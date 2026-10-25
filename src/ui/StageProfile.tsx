import { useEffect, useRef, useState } from 'react';
import type { Climb, Sprint, Stage, Tour } from '../lib/types';
import { KIND_LABEL, fmtKm } from '../lib/time';
import { Icon } from './Icon';
import { cx, Link } from './kit';

/** Etappen mit Profildaten (Anstiege, Sprints oder Höhenmeter)? */
export function hasProfile(stage: Stage): boolean {
  return !!(stage.climbs?.length || stage.sprints?.length || stage.elevation_m);
}

export const CAT_LABEL: Record<string, string> = { CC: 'Cima Coppi', HC: 'Hors catégorie', '1': '1. Kategorie', '2': '2. Kategorie', '3': '3. Kategorie', '4': '4. Kategorie' };
export const CAT_SHORT: Record<string, string> = { CC: 'CC', HC: 'HC', '1': '1', '2': '2', '3': '3', '4': '4' };
// Ersatzwerte, wenn Länge/Steigung fehlen
const CAT_GAIN: Record<string, number> = { CC: 900, HC: 900, '1': 700, '2': 400, '3': 220, '4': 100 };
const CAT_LEN: Record<string, number> = { CC: 14, HC: 14, '1': 11, '2': 7, '3': 5, '4': 3 };

export function catClass(cat: string): string {
  return `cat cat--${cat.toLowerCase()}`;
}

const nf = (n: number, d = 1) => n.toLocaleString('de-DE', { maximumFractionDigits: d });

export interface ClimbMetrics {
  gain: number | null;      // Höhenmeter der Bergwertung
  foot: number | null;      // km am Fuß
  toGo: number | null;      // km vom Gipfel bis ins Ziel
  footAlt: number | null;   // Höhe am Fuß
  difficulty: number | null; // FIETS-Index
  finish: boolean;
}

/** Kennzahlen eines Anstiegs aus Länge, Steigung und Gipfelhöhe */
export function climbMetrics(c: Climb, stage?: Stage): ClimbMetrics {
  const gain = c.len && c.grad ? Math.round(c.len * c.grad * 10) : null;
  const foot = c.len ? Math.max(0, c.km - c.len) : null;
  const toGo = stage?.distance_km ? Math.max(0, stage.distance_km - c.km) : null;
  const footAlt = c.alt && gain ? c.alt - gain : null;
  // FIETS-Index: H² / (D · 10) + (T − 1000) / 1000  (H, D in m; T = Gipfelhöhe)
  const difficulty = gain && c.len ? gain * gain / (c.len * 1000 * 10) + (c.alt && c.alt > 1000 ? (c.alt - 1000) / 1000 : 0) : null;
  return { gain, foot, toGo, footAlt, difficulty, finish: toGo !== null && toGo < 0.5 };
}

const H = 176;
const PAD_L = 40;
const PAD_R = 12;
const TOP = 42;
const BOTTOM = 24;

function useWidth(initial = 340) {
  // Breite messen, damit 1 SVG-Einheit = 1 Pixel ist (Schrift bleibt überall gleich groß)
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    update();
    const RO = (window as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!RO) return undefined;
    const ro = new RO(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/**
 * Etappenprofil: jede Bergwertung mit ihren echten Höhenmetern (Länge × Steigung) über der Strecke.
 * Die Täler dazwischen sind vereinfacht – die Grafik zeigt, wo und wie hart geklettert wird.
 */
export function StageProfileChart({ stage }: { stage: Stage }) {
  const { ref, w: W } = useWidth();
  const climbs = [...(stage.climbs ?? [])].sort((a, b) => a.km - b.km);
  const sprints = stage.sprints ?? [];
  const km = stage.distance_km ?? Math.max(1, ...climbs.map((c) => c.km), ...sprints.map((s) => s.km));
  const peaks = climbs.map((c) => ({
    c,
    gain: climbMetrics(c).gain ?? CAT_GAIN[c.cat] ?? 200,
    len: Math.max(c.len ?? CAT_LEN[c.cat] ?? 5, km * 0.025),
  }));
  const maxGain = Math.max(0, ...peaks.map((p) => p.gain));
  const yMax = Math.max(1000, Math.ceil((maxGain * 1.08) / 250) * 250);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - TOP - BOTTOM;
  const x = (k: number) => PAD_L + (Math.min(Math.max(k, 0), km) / km) * plotW;
  const y = (m: number) => TOP + plotH * (1 - m / yMax);
  const base = stage.kind === 'flat' || stage.kind === 'itt' ? 15 : 40;
  const height = (k: number) => {
    let h = base;
    for (const p of peaks) {
      const up = (k - (p.c.km - p.len)) / p.len;
      const down = 1 - (k - p.c.km) / (p.len * 0.8);
      if (k <= p.c.km && up >= 0) h = Math.max(h, base + (p.gain) * up);
      else if (k > p.c.km && down >= 0) h = Math.max(h, base + p.gain * down);
    }
    return h;
  };
  const steps = Math.round(W / 2);
  const pts: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const k = (km * i) / steps;
    pts.push(`${x(k).toFixed(1)},${y(height(k)).toFixed(1)}`);
  }
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${x(km).toFixed(1)},${(H - BOTTOM).toFixed(1)} L${x(0).toFixed(1)},${(H - BOTTOM).toFixed(1)} Z`;

  const rowEnd = [-Infinity, -Infinity];
  const labels = peaks.map((p) => {
    const cx = x(p.c.km);
    const row = cx - rowEnd[0] >= 28 ? 0 : 1;
    rowEnd[row] = cx;
    return { ...p, cx, row };
  });
  const tickStep = km > 150 ? 50 : km > 60 ? 25 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= km; t += tickStep) if (x(km) - x(t) >= 34) ticks.push(t);
  const yStep = yMax > 1500 ? 500 : 250;
  const yTicks: number[] = [];
  for (let m = yStep; m < yMax; m += yStep) yTicks.push(m);

  return (
    <div ref={ref} className="profile-chart-wrap">
      <svg className="profile-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Profil, ${fmtKm(km)}, ${climbs.length} Bergwertungen, größter Anstieg ${maxGain} Höhenmeter`}>
        <defs>
          <linearGradient id={`pf-${stage.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {yTicks.map((m) => (
          <g key={`y${m}`} className="profile-chart__tick">
            <line x1={PAD_L} x2={W - PAD_R} y1={y(m)} y2={y(m)} className="profile-chart__hgrid" />
            <text x={PAD_L - 4} y={y(m) + 3.5} textAnchor="end">+{m}</text>
          </g>
        ))}
        <text x={PAD_L - 4} y={H - BOTTOM + 3.5} textAnchor="end" className="profile-chart__unit">Hm</text>
        {ticks.map((t) => (
          <g key={t} className="profile-chart__tick">
            <line x1={x(t)} x2={x(t)} y1={TOP - 4} y2={H - BOTTOM} />
            <text x={x(t)} y={H - 7} textAnchor={t === 0 ? 'start' : 'middle'}>{t}</text>
          </g>
        ))}
        <text x={x(km)} y={H - 7} textAnchor="end">{fmtKm(km)}</text>
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

/** Steigung als Balken auf einer Skala bis 20 % */
function GradeBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, (value / 20) * 100);
  const tone = value >= 12 ? 'g-4' : value >= 9 ? 'g-3' : value >= 6 ? 'g-2' : 'g-1';
  return (
    <div className="grade-bar">
      <span className="grade-bar__label">{label}</span>
      <span className="grade-bar__track"><span className={cx('grade-bar__fill', tone)} style={{ width: `${pct}%` }} /></span>
      <strong className="grade-bar__value">{nf(value)}&nbsp;%</strong>
    </div>
  );
}

/** Schnitt durch den Anstieg: Länge gegen Höhenmeter, maßstabsgetreu überhöht */
function ClimbSlope({ c, m }: { c: Climb; m: ClimbMetrics }) {
  if (!c.len || !m.gain) return null;
  const w = 220;
  const h = 70;
  const ex = 10; // Überhöhung
  const slopeH = Math.min(h - 14, ((m.gain / (c.len * 1000)) * ex) * (w - 20));
  return (
    <svg className="climb-slope" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${nf(c.len)} km mit ${m.gain} Höhenmetern`}>
      <path d={`M10,${h - 6} L${w - 10},${h - 6 - slopeH} L${w - 10},${h - 6} Z`} className="climb-slope__area" />
      <line x1="10" y1={h - 6} x2={w - 10} y2={h - 6 - slopeH} className="climb-slope__line" />
      <text x="10" y={h - 10 - 0} className="climb-slope__txt">{m.footAlt ? `${m.footAlt} m` : 'Fuß'}</text>
      <text x={w - 12} y={h - 10 - slopeH} textAnchor="end" className="climb-slope__txt">{c.alt ? `${c.alt} m` : `+${m.gain} m`}</text>
    </svg>
  );
}

/** Steckbrief eines Anstiegs */
export function ClimbSheet({ c, stage, tour }: { c: Climb; stage?: Stage; tour?: Tour }) {
  const m = climbMetrics(c, stage);
  const points = tour?.info?.kom?.[c.cat];
  const facts: [string, string][] = [];
  facts.push(['Gipfel', `km\u00a0${nf(c.km)}${m.finish ? ' · Ziel' : m.toGo !== null ? ` · noch ${nf(m.toGo)}\u00a0km` : ''}`]);
  if (m.foot !== null) facts.push(['Fuß', `km\u00a0${nf(m.foot)}`]);
  if (c.len) facts.push(['Länge', `${nf(c.len)}\u00a0km`]);
  if (m.gain) facts.push(['Höhenmeter', `≈\u00a0${m.gain.toLocaleString('de-DE')}\u00a0m`]);
  if (c.alt) facts.push(['Gipfelhöhe', `${c.alt.toLocaleString('de-DE')}\u00a0m`]);
  if (m.footAlt) facts.push(['Höhe am Fuß', `≈\u00a0${m.footAlt.toLocaleString('de-DE')}\u00a0m`]);
  if (m.difficulty !== null) facts.push(['Härte (FIETS)', nf(m.difficulty, 1)]);
  return (
    <div className="climb-sheet">
      <dl className="sheet-facts">
        {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {c.grad || c.max ? (
        <div className="grade-bars">
          {c.grad ? <GradeBar label="Ø" value={c.grad} /> : null}
          {c.max ? <GradeBar label="Max." value={c.max} /> : null}
        </div>
      ) : null}
      <ClimbSlope c={c} m={m} />
      {points?.length ? (
        <p className="climb-sheet__points">
          <span className="muted">Bergpunkte:</span>{' '}
          {points.map((p, i) => <span key={i} className="form-pill">{i + 1}.&nbsp;{p}</span>)}
        </p>
      ) : null}
      {c.cat === 'CC' ? <p className="muted small">Cima Coppi: der höchste Punkt des Giro, zu Ehren von Fausto Coppi mit den meisten Bergpunkten.</p> : null}
    </div>
  );
}

type Point = { km: number; kind: 'climb'; c: Climb } | { km: number; kind: 'sprint'; s: Sprint };

/** Karte mit Profil und aufklappbarer Liste aller Wertungen. */
export function StageProfileCard({ stage, tour }: { stage: Stage; tour: Tour }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!hasProfile(stage) && stage.kind !== 'itt' && stage.kind !== 'ttt') return null;
  const climbs = stage.climbs ?? [];
  const points: Point[] = [
    ...climbs.map((c) => ({ km: c.km, kind: 'climb' as const, c })),
    ...(stage.sprints ?? []).map((s) => ({ km: s.km, kind: 'sprint' as const, s })),
  ].sort((a, b) => a.km - b.km);
  const summitFinish = climbs.some((c) => climbMetrics(c, stage).finish);
  const pcs = tour.pcs_slug ? `https://www.procyclingstats.com/race/${tour.pcs_slug}/stage-${stage.number}/info/profiles` : null;
  const sprintPts = tour.info?.sprint_points;

  return (
    <section className="card profile-card" aria-labelledby={`profile-${stage.id}`}>
      <div className="card__row">
        <h2 id={`profile-${stage.id}`} className="eyebrow">Profil & Wertungen</h2>
        {summitFinish ? <span className="chip chip--accent">Bergankunft</span> : null}
      </div>
      <StageProfileChart stage={stage} />
      {points.length ? (
        <ol className="profile-points" aria-label="Wertungen entlang der Strecke">
          {points.map((p, i) => (
            <li key={i}>
              <button type="button" className="profile-points__btn" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                <span className="profile-points__km">{nf(p.km)}</span>
                {p.kind === 'climb' ? (
                  <>
                    <span className={`badge ${catClass(p.c.cat)}`}>{CAT_SHORT[p.c.cat] ?? p.c.cat}</span>
                    <span className="profile-points__main">
                      <strong>{p.c.name}</strong>
                      <span className="muted">
                        {[CAT_LABEL[p.c.cat] ?? p.c.cat, p.c.len ? `${nf(p.c.len)}\u00a0km` : null, p.c.grad ? `Ø\u00a0${nf(p.c.grad)}\u00a0%` : null, p.c.max ? `max.\u00a0${nf(p.c.max)}\u00a0%` : null]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="badge badge--sprint">S</span>
                    <span className="profile-points__main">
                      <strong>{p.s.name ?? 'Zwischensprint'}</strong>
                      <span className="muted">Punktewertung{sprintPts ? ` · ${sprintPts.join('/')}` : ''}</span>
                    </span>
                  </>
                )}
                <Icon name="chevron" size={16} className={cx('profile-points__chev', open === i && 'is-open')} />
              </button>
              {open === i ? (
                p.kind === 'climb' ? <ClimbSheet c={p.c} stage={stage} tour={tour} /> : (
                  <div className="climb-sheet">
                    <p className="muted small">
                      Zwischensprint bei km {nf(p.km)}, noch {stage.distance_km ? nf(stage.distance_km - p.km) : '–'} km bis ins Ziel.
                      {sprintPts ? ` Punkte für die Punktewertung: ${sprintPts.join(', ')}.` : ''}
                    </p>
                  </div>
                )
              ) : null}
            </li>
          ))}
          <li>
            <div className="profile-points__btn is-static">
              <span className="profile-points__km">{stage.distance_km ? nf(stage.distance_km) : ''}</span>
              <span className="badge badge--finish"><Icon name="flag" size={13} stroke={2.2} /></span>
              <span className="profile-points__main">
                <strong>Ziel{stage.arrival ? ` in ${stage.arrival}` : ''}</strong>
                <span className="muted">{summitFinish ? 'Bergankunft' : stage.kind === 'itt' ? 'Zeitfahren' : 'Zielankunft'}</span>
              </span>
            </div>
          </li>
        </ol>
      ) : null}
      <p className="hint">
        Höhe je Anstieg aus Länge × Ø-Steigung, Täler vereinfacht. km-Angaben zum Gipfel. Tippe auf eine Wertung für den Steckbrief.
        {pcs ? <> <a href={pcs} target="_blank" rel="noopener noreferrer">Original-Profil bei ProCyclingStats</a></> : null}
      </p>
    </section>
  );
}

const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** „Etappe in Zahlen“: alle Kennzahlen und Regeln der Etappe */
export function StageFactsCard({ stage, tour }: { stage: Stage; tour: Tour }) {
  const climbs = stage.climbs ?? [];
  const ms = climbs.map((c) => ({ c, m: climbMetrics(c, stage) }));
  const gainSum = ms.reduce((s, x) => s + (x.m.gain ?? 0), 0);
  const lenSum = climbs.reduce((s, c) => s + (c.len ?? 0), 0);
  const steep = climbs.filter((c) => c.max).sort((a, b) => (b.max ?? 0) - (a.max ?? 0))[0];
  const high = climbs.filter((c) => c.alt).sort((a, b) => (b.alt ?? 0) - (a.alt ?? 0))[0];
  const hardest = ms.filter((x) => x.m.difficulty !== null).sort((a, b) => (b.m.difficulty ?? 0) - (a.m.difficulty ?? 0))[0];
  const last = [...climbs].sort((a, b) => b.km - a.km)[0];
  const info = stage.info ?? {};
  const kom = tour.info?.kom;
  const komTotal = kom ? climbs.reduce((s, c) => s + (kom[c.cat]?.[0] ?? 0), 0) : 0;

  const rows: [string, string][] = [];
  rows.push(['Typ', KIND_LABEL[stage.kind]]);
  if (stage.distance_km) rows.push(['Distanz', fmtKm(stage.distance_km)]);
  if (stage.elevation_m) rows.push(['Höhenmeter', `${stage.elevation_m.toLocaleString('de-DE')}\u00a0m`]);
  if (stage.elevation_m && stage.distance_km) rows.push(['Hm pro km', nf(stage.elevation_m / stage.distance_km, 1)]);
  rows.push(['Bergwertungen', String(climbs.length)]);
  if (lenSum) rows.push(['Kletter-km (gewertet)', `${nf(lenSum)}\u00a0km`]);
  if (gainSum) rows.push(['Hm in Bergwertungen', `≈\u00a0${gainSum.toLocaleString('de-DE')}\u00a0m`]);
  if (steep) rows.push(['Steilste Rampe', `${nf(steep.max ?? 0)}\u00a0% · ${steep.name}`]);
  if (high) rows.push(['Höchster Punkt', `${(high.alt ?? 0).toLocaleString('de-DE')}\u00a0m · ${high.name}`]);
  if (hardest) rows.push(['Härtester Anstieg', `${hardest.c.name} (${nf(hardest.m.difficulty ?? 0)})`]);
  if (last && stage.distance_km) rows.push(['Letzte Bergwertung', `${last.name} · ${climbMetrics(last, stage).finish ? 'im Ziel' : `${nf(stage.distance_km - last.km)} km vor dem Ziel`}`]);
  if (komTotal) rows.push(['Bergpunkte für Sieger', `${komTotal} Punkte`]);
  if (stage.sprints?.length) rows.push(['Zwischensprints', stage.sprints.map((s) => `km\u00a0${nf(s.km)}`).join(', ')]);

  const rules: [string, string][] = [];
  if (info.original_date) {
    const d = new Date(`${info.original_date}T12:00:00`);
    rules.push(['Original', `${WEEKDAY[d.getDay()]}, ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}`]);
  }
  if (info.start_real) rules.push(['Start damals', `${info.start_real} Uhr (km 0)`]);
  if (info.finish_real) rules.push(['Ziel damals', `${info.finish_real} Uhr`]);
  if (tour.info?.finish_bonus && stage.kind !== 'itt' && stage.kind !== 'ttt') rules.push(['Zeitbonus im Ziel', tour.info.finish_bonus.map((b) => `${b}″`).join(' / ')]);
  if (tour.info?.redbull_bonus && stage.kind !== 'itt' && stage.kind !== 'ttt') rules.push(['Red Bull KM', `${tour.info.redbull_bonus.map((b) => `${b}″`).join(' / ')} Bonus`]);
  if (info.neutral_km) rules.push(['Neutralisation', `letzte ${info.neutral_km} km (Sturz/Defekt = gleiche Zeit)`]);
  if (info.three_sec) rules.push(['3-Sekunden-Regel', 'Lücke erst ab 3 Sekunden']);

  if (rows.length <= 2 && !rules.length) return null;
  return (
    <section className="card" aria-labelledby={`facts-${stage.id}`}>
      <h2 id={`facts-${stage.id}`} className="eyebrow">Etappe in Zahlen</h2>
      <dl className="sheet-facts sheet-facts--wide">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {rules.length ? (
        <>
          <h3 className="eyebrow sheet-sub">Reglement & Geschichte</h3>
          <dl className="sheet-facts sheet-facts--wide">
            {rules.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </>
      ) : null}
      {climbs.length ? <Link to="/anstiege" className="text-link">Alle Anstiege der Rundfahrt</Link> : null}
    </section>
  );
}
