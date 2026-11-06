/**
 * Zielfoto im Ergebnis, wenn es knapp war (game/photo.ts): wie das Bild einer Zielkamera – die Zeit läuft nach
 * rechts, jeder Fahrer steht dort, wo sein Vorderrad die Linie berührt hat; darunter die Abstände in Sekunden und
 * Zentimetern.
 */
import { photoGap, type PhotoResult, type PhotoRider } from '../game/photo';
import { cx } from '../ui/kit';

const W = 320;
const ROW = 32;
const AXIS = 22;
const L = 10;
const R = 10;
/** Breite der Figur (Vorderrad vorn links bis Hinterrad) */
const BIKE = 40;

/** Namen nach „vor“ und „hinter“: „deinem Bestlauf“, „dem Tempomacher“, sonst wie er ist */
const dat = (name: string) => name.replace(/^Dein /, 'deinem ').replace(/^Tempomacher$/, 'dem Tempomacher');

const fmtS = (t: number) => `${t > 0 ? '+' : t < 0 ? '−' : '±'}${Math.abs(t).toFixed(2).replace('.', ',')} s`;

/** Fahrer mit Rad von der Seite, fährt nach links; Vorderrad berührt bei x = 0 die Linie, Boden bei y = 0 */
function Rider({ x, y, color, me }: { x: number; y: number; color: string; me?: boolean }) {
  const w = me ? 2 : 1.6;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y})`}>
      <circle cx="7" cy="-7" r="6.4" className="photo__wheel" />
      <circle cx="33" cy="-7" r="6.4" className="photo__wheel" />
      <path d="M33 -7 L21 -8 L25 -19 L11 -19 L7 -7 M21 -8 L11 -19 M25 -19 L33 -7" className="photo__frame" />
      <path d="M25 -21 L13 -27 M13 -27 L10 -19 M25 -21 L19 -14 L21 -8" stroke={color} strokeWidth={w + 1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="9" cy="-29.5" r="3.4" fill={color} />
    </g>
  );
}

export function PhotoFinish({ photo }: { photo: PhotoResult }) {
  const list = photo.riders;
  const others = list.filter((r) => !r.me);
  if (!others.length) return null;
  const close = [...others].sort((a, b) => Math.abs(a.t) - Math.abs(b.t))[0];
  const gap = photoGap(close.t, photo.v);
  const head = Math.abs(close.t) < 0.005
    ? `Zeitgleich mit ${dat(close.name)}`
    : close.t > 0 ? `Um ${gap} vor ${dat(close.name)}` : `${gap} hinter ${dat(close.name)}`;
  // Zeitachse: alle aufs Bild, mit etwas Rand; mindestens 0,12 s breit
  const lo0 = Math.min(...list.map((r) => r.t));
  const hi0 = Math.max(...list.map((r) => r.t));
  const span = Math.max(0.12, hi0 - lo0);
  const lo = lo0 - span * 0.08;
  const hi = lo0 + span * 1.08;
  const inner = W - L - R - BIKE;
  const xOf = (t: number) => L + ((t - lo) / (hi - lo)) * inner;
  const H = list.length * ROW + AXIS + 6;
  const step = span > 0.8 ? 0.2 : span > 0.35 ? 0.1 : 0.05;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  const meX = xOf(0);
  return (
    <figure className="photo" aria-label={`Zielfoto: ${head}`}>
      <figcaption className="photo__head">
        <span className="photo__eyebrow">Fotofinish</span>
        <strong>{head}</strong>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="photo__strip" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="photo-bg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#2a251d" />
            <stop offset="1" stopColor="#15130f" />
          </linearGradient>
          <pattern id="photo-streak" width="6" height="10" patternUnits="userSpaceOnUse">
            <rect width="1" height="10" fill="#fff" opacity="0.05" />
            <rect x="3" width="0.6" height="10" fill="#fff" opacity="0.03" />
          </pattern>
        </defs>
        <rect width={W} height={H} rx="10" fill="url(#photo-bg)" />
        <rect width={W} height={H - AXIS} fill="url(#photo-streak)" />
        {/* eigene Zeit als Linie */}
        <line x1={meX} x2={meX} y1="4" y2={H - AXIS} className="photo__me-line" />
        {list.map((r, i) => {
          const y = 8 + (i + 1) * ROW - 4;
          const x = xOf(r.t);
          const labelRight = x + BIKE + 6 + r.name.length * 6 < W - 4;
          return (
            <g key={r.id} className={cx('photo__row', r.me && 'is-me')} style={{ animationDelay: `${0.15 + i * 0.08}s` }}>
              <line x1="0" x2={W} y1={y + 0.5} y2={y + 0.5} className="photo__ground" />
              <Rider x={x} y={y} color={r.me ? 'var(--photo-me)' : r.color} me={r.me} />
              <text x={labelRight ? x + BIKE + 4 : x - 4} y={y - 9} textAnchor={labelRight ? 'start' : 'end'} className="photo__name">{r.name}</text>
            </g>
          );
        })}
        <g className="photo__axis">
          <line x1="0" x2={W} y1={H - AXIS + 0.5} y2={H - AXIS + 0.5} />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={xOf(t)} x2={xOf(t)} y1={H - AXIS} y2={H - AXIS + 4} />
              <text x={xOf(t)} y={H - 6} textAnchor="middle">{t === 0 ? '0' : fmtS(t).replace(' s', '')}</text>
            </g>
          ))}
        </g>
      </svg>
      <ol className="photo__list">
        {list.map((r: PhotoRider, i) => (
          <li key={r.id} className={cx(r.me && 'is-me')}>
            <span className="photo__n">{i + 1}.</span>
            <i className="photo__dot" style={{ background: r.me ? 'var(--photo-me)' : r.color }} />
            <span className="photo__who">{r.me ? 'Du' : r.name}{r.live ? <em className="photo__tag is-live">live</em> : r.ghost ? <em className="photo__tag">Geist</em> : null}</span>
            <span className="photo__gap">{r.me ? '' : `${fmtS(r.t)} · ${photoGap(r.t, photo.v)}`}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
