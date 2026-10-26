/**
 * HUD der Minispiele im Stil einer Radsport-Übertragung: Positionstafel (Spitze, Verfolger, du)
 * mit Abständen, ein Sponsor-Logo daneben und ab und zu eine eingeblendete Werbung –
 * alles mit erfundenen Marken. Die Tafel wird jedes Bild direkt über Refs beschrieben (kein React-Render).
 */
import { useEffect, useState } from 'react';
import { cx } from '../ui/kit';

export interface TvItem { head: string; value: string; icon: 'flag' | 'gap' | 'gpm'; me?: boolean }

type Bind = (key: string) => (el: HTMLElement | null) => void;

/** „Tadej Pogačar“ → „T. Pogačar“, lange Namen nur mit Nachnamen */
export function tvName(full: string): string {
  const n = full.trim();
  if (!n || n === 'Du' || /^Fahrer \d+$/.test(n)) return n;
  const parts = n.split(/\s+/);
  if (parts.length < 2) return n;
  // Namenszusätze (van, de, del …) gehören zum Nachnamen
  let i = parts.length - 1;
  while (i > 1 && /^(van|von|de|der|den|del|da|di|le|la|du|dos|ten|ter)$/i.test(parts[i - 1])) i--;
  const last = parts.slice(i).join(' ');
  const short = `${parts[0][0]}. ${last}`;
  return short.length > 15 ? last : short;
}

/** Abstand wie im Fernsehen: +4,2″ · +1′05″ */
export function tvGap(s: number): string {
  if (s < 0.05) return '+0″';
  if (s < 60) return `+${s.toFixed(1).replace('.', ',')}″`;
  const m = Math.floor(s / 60);
  return `+${m}′${String(Math.round(s - m * 60)).padStart(2, '0')}″`;
}

/** Positionstafel: bis zu drei Kästen (Spitze mit Restdistanz, dann Abstände) */
export function TvBoard({ bind }: { bind: Bind }) {
  return (
    <div className="tv" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="tv-box is-off" ref={bind(`tv${i}`)} style={{ animationDelay: `${i * 0.08}s` }}>
          <span className="tv-box__icon" />
          <span className="tv-box__head" ref={bind(`tv${i}h`)} />
          <strong className="tv-box__val" ref={bind(`tv${i}v`)} />
        </div>
      ))}
    </div>
  );
}

function flash(el: HTMLElement) {
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
}

/** Tafel aktualisieren; wechselt in einem Kasten der Fahrer (Überholt!), blinkt er kurz auf */
export function writeTv(hud: Record<string, HTMLElement | null>, last: Record<string, string>, items: TvItem[]) {
  for (let i = 0; i < 3; i++) {
    const box = hud[`tv${i}`];
    if (!box) continue;
    const it = items[i];
    const key = it ? `${it.icon}|${it.head}|${it.value}|${it.me ? 1 : 0}` : '-';
    if (last[`tv${i}`] === key) continue;
    last[`tv${i}`] = key;
    if (!it) { box.classList.add('is-off'); continue; }
    const wasOff = box.classList.contains('is-off');
    box.classList.remove('is-off');
    box.classList.toggle('is-me', !!it.me);
    box.dataset.icon = it.icon;
    const h = hud[`tv${i}h`];
    const v = hud[`tv${i}v`];
    if (h && h.textContent !== it.head) {
      const changed = !!h.textContent && !wasOff;
      h.textContent = it.head;
      if (changed) flash(box);
    }
    if (v && v.textContent !== it.value) v.textContent = it.value;
  }
}

/** Tafel aus einer Rennwertung (Spitze, Zweiter, du) */
export function boardItems(board: { pos: number; name: string; gap: number; me: boolean }[], leaderValue: string, leaderIcon: TvItem['icon'] = 'flag'): TvItem[] {
  return board.map((b, i) => ({
    head: `${b.pos} ${tvName(b.name)}`,
    value: i === 0 ? leaderValue : tvGap(b.gap),
    icon: i === 0 ? leaderIcon : 'gap',
    me: b.me,
  }));
}

// ---------------------------------------------------------------- erfundene Sponsoren

const BUGS: { k: string; b: string; s?: string; style: string }[] = [
  { k: 'Zeitnahme', b: 'TICKTACK', s: '& SPEICHE', style: 'serif' },
  { k: 'Live-Abstände', b: 'Schaltwerk', s: 'Uhren', style: 'script' },
  { k: 'Präsentiert von', b: 'HUNGERAST', s: 'Riegel', style: 'bold' },
  { k: 'Zeitnahme', b: 'LANTERNE ROUGE', s: 'Chronographen', style: 'serif' },
  { k: 'Datenservice', b: 'Wadenglanz', s: 'Rasiergel', style: 'script' },
  { k: 'Präsentiert von', b: 'BIDON-BRÄU', s: '0,0 %', style: 'bold' },
  { k: 'Partner', b: 'KETTENFETT', s: 'Deluxe', style: 'bold' },
  { k: 'Versichert von', b: 'Sattelfest', s: 'Versicherung', style: 'script' },
];

const ADS: { b: string; s: string; c: string }[] = [
  { b: 'SITZCREME DELUXE', s: 'Für den Hintern, der alles gibt', c: '#ff5fa2' },
  { b: 'HUNGERAST', s: 'Der Riegel für Kilometer 180', c: '#ffb020' },
  { b: 'TICKTACK & SPEICHE', s: 'Offizieller Zeitnehmer · auf die Hundertstel geschätzt', c: '#e8c46a' },
  { b: 'DOMESTIK-DIENSTE', s: 'Wir holen Ihre Flaschen. Auch bergauf.', c: '#3ecf6e' },
  { b: 'WADENGLANZ', s: 'Rasiert. Geölt. Fotogen.', c: '#8ccaff' },
  { b: 'GRUPPETTO-REISEN', s: 'Ankommen ist alles – Karenzzeit inklusive', c: '#ffd23f' },
  { b: 'BIDON-BRÄU', s: 'Alkoholfrei bis zum Zielstrich', c: '#f2994a' },
  { b: 'LANTERNE ROUGE', s: 'Licht für die Letzten', c: '#ff6b6b' },
  { b: 'KETTENFETT DELUXE', s: 'Damit es läuft wie geschmiert', c: '#b8b8c8' },
];

/** kleines Sponsor-Logo unter der Tafel, wechselt alle paar Sekunden */
export function TvSponsor({ seed = 0 }: { seed?: number }) {
  const [i, setI] = useState(seed % BUGS.length);
  useEffect(() => {
    const t = window.setInterval(() => setI((x) => (x + 1) % BUGS.length), 9000);
    return () => window.clearInterval(t);
  }, []);
  const s = BUGS[i];
  return (
    <div className="tv-sponsor" aria-hidden="true">
      <span key={i} className="tv-sponsor__in">
        <span className="tv-sponsor__k">{s.k}</span>
        <span className={cx('tv-sponsor__b', `is-${s.style}`)}>{s.b}</span>
        {s.s ? <span className="tv-sponsor__s">{s.s}</span> : null}
      </span>
    </div>
  );
}

/** ab und zu eine eingeblendete Werbung unten links (nicht während der Spielhilfe) */
export function TvAd({ hidden, seed = 0 }: { hidden: boolean; seed?: number }) {
  const [ad, setAd] = useState<number | null>(null);
  useEffect(() => {
    let n = seed;
    let hide = 0;
    const show = () => {
      setAd(n % ADS.length);
      n += 1;
      hide = window.setTimeout(() => setAd(null), 5200);
    };
    const first = window.setTimeout(show, 14000);
    const every = window.setInterval(show, 32000);
    return () => { window.clearTimeout(first); window.clearTimeout(hide); window.clearInterval(every); };
  }, [seed]);
  if (ad === null || hidden) return null;
  const a = ADS[ad];
  return (
    <div key={ad} className="tv-ad" aria-hidden="true" style={{ ['--ad' as string]: a.c }}>
      <span className="tv-ad__tag">Werbung</span>
      <strong>{a.b}</strong>
      <span>{a.s}</span>
    </div>
  );
}

/** Pfeile für den Führungswechsel */
export function SwapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4v14M3 14l4 4 4-4" />
      <path d="M17 20V6M13 10l4-4 4 4" />
    </svg>
  );
}
