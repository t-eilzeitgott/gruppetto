/**
 * HUD der Minispiele, schlicht wie eine Radsport-Übertragung: eine Rennleiste (Platz, Abstand,
 * Restdistanz, Fortschritt), ein runder Kraftring mit dem Tempo, Ansagen darunter und ab und zu
 * eine Werbeeinblendung erfundener Marken unten. Leiste und Ring werden jedes Bild direkt über
 * Refs beschrieben (kein React-Render pro Bild).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { cx } from '../ui/kit';

type Bind = (key: string) => (el: HTMLElement | null) => void;
type Els = Record<string, HTMLElement | null>;

/** Nachname („Tadej Pogačar“ → „Pogačar“, „Mathieu van der Poel“ → „van der Poel“) */
export function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full.trim();
  let i = parts.length - 1;
  while (i > 1 && /^(van|von|de|der|den|del|da|di|le|la|du|dos|ten|ter)$/i.test(parts[i - 1])) i--;
  return parts.slice(i).join(' ');
}

/** Abstand wie im Fernsehen: +4,2″ · +1′05″ */
export function tvGap(s: number): string {
  if (s < 0.05) return '+0″';
  if (s < 60) return `+${s.toFixed(1).replace('.', ',')}″`;
  const m = Math.floor(s / 60);
  return `+${m}′${String(Math.round(s - m * 60)).padStart(2, '0')}″`;
}

const setText = (el: HTMLElement | null | undefined, v: string) => { if (el && el.textContent !== v) el.textContent = v; };

// ---------------------------------------------------------------- Rennleiste

export interface BarMark { at: number; kind: 'gpm' | 'flamme' | 'friend'; color?: string }

/** Rennleiste: Platz · Abstand · Restdistanz, unten eine feine Fortschrittslinie */
export function RaceBar({ bind, marks = [], wide = false }: { bind: Bind; marks?: BarMark[]; wide?: boolean }) {
  return (
    <div className={cx('hud-bar', wide && 'hud-bar--wide')} ref={bind('bar')} aria-hidden="true">
      <span className="hud-bar__seg hud-bar__place" ref={bind('barPlace')} />
      <span className="hud-bar__seg hud-bar__gap" ref={bind('barGapSeg')}>
        <b ref={bind('barGap')} />
        <small ref={bind('barLabel')} />
      </span>
      <span className="hud-bar__seg hud-bar__dist">
        <i className="hud-ico" ref={bind('barIcon')} />
        <b ref={bind('barDist')} />
      </span>
      <span className="hud-bar__prog">
        {marks.map((m, i) => (
          <span key={i} className={`hud-bar__mark is-${m.kind}`} style={{ left: `${Math.min(100, m.at * 100)}%`, background: m.color }} />
        ))}
        <i ref={bind('barFill')} />
      </span>
    </div>
  );
}

export interface BarState {
  /** „7.“ – leer: ohne Platz (Abfahrt ohne Mitspieler) */
  place: string;
  gap: string;
  label: string;
  dist: string;
  icon: 'flag' | 'gpm' | 'road';
  /** du führst */
  lead: boolean;
  /** 0 … 1 */
  progress: number;
}

export function writeBar(els: Els, last: Record<string, string>, s: BarState) {
  const bar = els.bar;
  if (!bar) return;
  const key = `${s.place}|${s.gap}|${s.label}|${s.dist}|${s.icon}|${s.lead ? 1 : 0}`;
  if (last.bar !== key) {
    const prevPlace = last.barPlace;
    last.bar = key;
    last.barPlace = s.place;
    setText(els.barPlace, s.place);
    els.barPlace?.classList.toggle('is-empty', !s.place);
    setText(els.barGap, s.gap);
    setText(els.barLabel, s.label);
    els.barGapSeg?.classList.toggle('is-empty', !s.gap);
    setText(els.barDist, s.dist);
    if (els.barIcon) els.barIcon.dataset.icon = s.icon;
    bar.classList.toggle('is-lead', s.lead);
    // Platz verbessert/verloren: kurz aufleuchten
    if (prevPlace && s.place && prevPlace !== s.place && els.barPlace) {
      const up = parseInt(s.place, 10) < parseInt(prevPlace, 10);
      const el = els.barPlace;
      el.classList.remove('is-up', 'is-down');
      void el.offsetWidth;
      el.classList.add(up ? 'is-up' : 'is-down');
    }
  }
  const p = Math.max(0, Math.min(1, s.progress)).toFixed(3);
  if (last.barP !== p) {
    last.barP = p;
    els.barFill?.style.setProperty('--p', p);
  }
}

// ---------------------------------------------------------------- Kraftring

/** runder Ring: außen die Kraft (oder in der Abfahrt das Tempo), innen km/h; kleines Windschatten-Zeichen */
export function PowerRing({ bind, badge = false }: { bind: Bind; badge?: boolean }) {
  return (
    <div className="hud-ring" ref={bind('ring')} aria-hidden="true">
      <span className="hud-ring__in">
        <b ref={bind('ringSpeed')}>0</b>
        <small>km/h</small>
      </span>
      <span className="hud-ring__wind" title="Windschatten">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M3 8h11a3 3 0 1 0-3-3" />
          <path d="M3 13h15a3 3 0 1 1-3 3" />
          <path d="M3 18h7" />
        </svg>
      </span>
      {badge ? <span className="hud-ring__badge" ref={bind('ringBadge')} /> : null}
    </div>
  );
}

export interface RingState {
  kmh: number;
  /** 0 … 1: Kraft (oder Tempoanteil) */
  fill: number;
  tone: 'energy' | 'speed';
  mode: 'sit' | 'go' | 'ease';
  draft: number;
  badge?: string;
}

export function writeRing(els: Els, last: Record<string, string>, s: RingState) {
  const ring = els.ring;
  if (!ring) return;
  setText(els.ringSpeed, String(s.kmh));
  const f = Math.max(0, Math.min(1, s.fill));
  const fk = f.toFixed(3);
  if (last.ringF !== fk) {
    last.ringF = fk;
    ring.style.setProperty('--e', fk);
    // grün → gelb → rot mit sinkender Kraft
    if (s.tone === 'energy') ring.style.setProperty('--ring-c', `hsl(${Math.round(4 + 128 * Math.pow(f, 0.85))} 78% 54%)`);
  }
  const key = `${s.tone}|${s.mode}|${s.draft > 0.15 ? 1 : 0}|${s.tone === 'energy' && f < 0.18 ? 1 : 0}`;
  if (last.ring !== key) {
    last.ring = key;
    ring.classList.toggle('is-speed', s.tone === 'speed');
    ring.classList.toggle('is-go', s.mode === 'go');
    ring.classList.toggle('is-ease', s.mode === 'ease');
    ring.classList.toggle('is-wind', s.draft > 0.15);
    ring.classList.toggle('is-low', s.tone === 'energy' && f < 0.18);
  }
  if (s.badge !== undefined) setText(els.ringBadge, s.badge);
}

// ---------------------------------------------------------------- Ansagen

/** einzelne Momente „präsentiert von …“ – wie in der Übertragung */
function sponsorFor(title: string): string | null {
  if (/flamme rouge|letzter kilometer/i.test(title)) return 'LANTERNE ROUGE';
  if (/^zwischenzeit/i.test(title)) return 'TICKTACK & SPEICHE';
  if (/^gipfel|bergwertung/i.test(title)) return 'HUNGERAST';
  if (/zielsprint|jetzt antreten/i.test(title)) return 'TICKTACK & SPEICHE';
  if (/^abfahrt/i.test(title)) return 'KETTENFETT';
  return null;
}

export interface HudBannerData { key: number; title: string; sub?: string; tone?: 'gold' | 'accent' | 'red' }

export function HudBanner({ banner, onEnd }: { banner: HudBannerData; onEnd: () => void }) {
  const sp = sponsorFor(banner.title);
  return (
    <div key={banner.key} className={cx('hud-banner', banner.tone && `hud-banner--${banner.tone}`)} onAnimationEnd={(e: { target: EventTarget; currentTarget: EventTarget }) => { if (e.target === e.currentTarget) onEnd(); }}>
      <strong>{banner.title}</strong>
      {banner.sub ? <span>{banner.sub}</span> : null}
      {sp ? <em>präsentiert von <b>{sp}</b></em> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Werbung (erfundene Marken)

const I = (d: ReactNode) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

interface Ad { brand: string; line: string; c: string; ink: string; font: 'serif' | 'heavy' | 'script' | 'round'; icon: ReactNode }

const ADS: Ad[] = [
  {
    brand: 'TICKTACK & SPEICHE', line: 'Offizieller Zeitnehmer – auf die Hundertstel geschätzt', c: '#e8c46a', ink: '#1a1408', font: 'serif',
    icon: I(<><circle cx="12" cy="13" r="7.5" /><path d="M12 13V9.5M12 13l2.6 1.6M10 2.5h4M12 2.5v3" /></>),
  },
  {
    brand: 'HUNGERAST', line: 'Der Riegel für Kilometer 180', c: '#ff9f1a', ink: '#2a1500', font: 'heavy',
    icon: I(<><path d="M4 9.5 15 4l5 3.5-11 9.5z" /><path d="M15 4c-.6 1.6.4 3 2 3.2" /><path d="M7.5 11.5l3 2.2M10.5 9.8l3 2.2" /></>),
  },
  {
    brand: 'Sitzcreme Deluxe', line: 'Für den Hintern, der alles gibt', c: '#ff5fa2', ink: '#2a0716', font: 'script',
    icon: I(<><path d="M6 20h12l-1.5-11h-9z" /><path d="M9 9V6.5a3 3 0 0 1 6 0V9" /><path d="M10 14.5c1.2 1 2.8 1 4 0" /></>),
  },
  {
    brand: 'BIDON-BRÄU', line: '0,0 % – alkoholfrei bis zum Zielstrich', c: '#f2994a', ink: '#2a1204', font: 'round',
    icon: I(<><path d="M9 3h6v3l1.5 2.5V20a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 20V8.5L9 6z" /><path d="M7.5 12h9M7.5 16h9" /></>),
  },
  {
    brand: 'DOMESTIK-DIENSTE', line: 'Wir holen Ihre Flaschen. Auch bergauf.', c: '#3ecf6e', ink: '#062612', font: 'heavy',
    icon: I(<><circle cx="6" cy="17" r="3.5" /><circle cx="18" cy="17" r="3.5" /><path d="M6 17l4-7h5l3 7M10 10 8.5 6.5H6M15 10l1-3h2.5" /></>),
  },
  {
    brand: 'Wadenglanz', line: 'Rasiert. Geölt. Fotogen.', c: '#8ccaff', ink: '#06203a', font: 'script',
    icon: I(<><path d="M12 3s5.5 6.2 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9.2 12 3 12 3z" /><path d="M9.5 13.5a2.5 2.5 0 0 0 2.5 2.5" /></>),
  },
  {
    brand: 'GRUPPETTO-REISEN', line: 'Ankommen ist alles – Karenzzeit inklusive', c: '#ffd23f', ink: '#2a2100', font: 'round',
    icon: I(<><rect x="3" y="5" width="18" height="12" rx="2.5" /><path d="M3 11h18M7.5 17v2.5M16.5 17v2.5M8 5V3.5h8V5" /></>),
  },
  {
    brand: 'KETTENFETT', line: 'Läuft wie geschmiert – auch im Regen von Roubaix', c: '#c9cbd6', ink: '#14151a', font: 'heavy',
    icon: I(<><rect x="2.5" y="8.5" width="9" height="7" rx="3.5" /><rect x="12.5" y="8.5" width="9" height="7" rx="3.5" /><path d="M9 12h6" /></>),
  },
  {
    brand: 'LANTERNE ROUGE', line: 'Licht für die Letzten', c: '#ff6b6b', ink: '#2a0606', font: 'serif',
    icon: I(<><path d="M9 6h6l1.5 3v8L15 20H9l-1.5-3V9z" /><path d="M12 2.5V6M9 9h6M12 12.5v2.5" /></>),
  },
  {
    brand: 'SATTELFEST', line: 'Versichert bis zur Karenzzeit', c: '#7d9bff', ink: '#081436', font: 'round',
    icon: I(<><path d="M12 3 4.5 6v5.5c0 4.3 3.1 7.7 7.5 9.5 4.4-1.8 7.5-5.2 7.5-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>),
  },
  {
    brand: 'PAVÉ-PFLASTER', line: 'Hält auch auf Kopfsteinpflaster', c: '#e7b97c', ink: '#2a1a06', font: 'heavy',
    icon: I(<><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-30 12 12)" /><path d="M10.5 10.6v.1M13.5 13.3v.1M10.6 13.4v.1M13.4 10.5v.1" /></>),
  },
];

/**
 * Werbeeinblendung wie im Fernsehen: unten als runde Leiste mit Logo, Marke und Spruch – Wischblende
 * hinein und hinaus, dünne Laufzeitlinie. Nie während der Spielhilfe; immer im sichtbaren Bereich.
 */
export function TvAd({ hidden, seed = 0 }: { hidden: boolean; seed?: number }) {
  const [ad, setAd] = useState<number | null>(null);
  useEffect(() => {
    let n = seed;
    let hide = 0;
    const show = () => {
      setAd(n % ADS.length);
      n += 1;
      hide = window.setTimeout(() => setAd(null), 5600);
    };
    const first = window.setTimeout(show, 12000);
    const every = window.setInterval(show, 30000);
    return () => { window.clearTimeout(first); window.clearTimeout(hide); window.clearInterval(every); };
  }, [seed]);
  if (ad === null || hidden) return null;
  const a = ADS[ad];
  return (
    <div key={ad} className="tv-ad" aria-hidden="true" style={{ ['--ad' as string]: a.c, ['--ad-ink' as string]: a.ink }}>
      <span className="tv-ad__logo">{a.icon}</span>
      <span className="tv-ad__text">
        <span className="tv-ad__tag">Anzeige</span>
        <strong className={`is-${a.font}`}>{a.brand}</strong>
        <span>{a.line}</span>
      </span>
      <i className="tv-ad__time" />
    </div>
  );
}

/** Pfeile für den Führungswechsel */
export function SwapIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v14M3 14l4 4 4-4" />
      <path d="M17 20V6M13 10l4-4 4 4" />
    </svg>
  );
}

/** Leiste aus der Rennwertung (Spitze, Zweiter, du) */
export function raceBar(board: { pos: number; gap: number; me: boolean }[], distText: string, icon: BarState['icon'], progress: number): BarState {
  const me = board.find((b) => b.me);
  const lead = me?.pos === 1;
  const second = board.find((b) => b.pos === 2);
  return {
    place: me ? `${me.pos}.` : '',
    gap: lead ? (second ? tvGap(second.gap) : '') : tvGap(me?.gap ?? 0),
    label: lead ? 'Vorsprung' : 'zur Spitze',
    dist: distText,
    icon,
    lead,
    progress,
  };
}
