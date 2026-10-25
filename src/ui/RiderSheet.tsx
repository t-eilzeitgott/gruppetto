import type { Rider, TourData } from '../lib/types';
import { useFavorites } from '../app/hooks';
import { riderStats, leaderLabel, type RiderStats } from '../lib/riderStats';
import { countryName, flag } from '../lib/countries';
import { categoryTitle } from '../lib/categories';
import { cx, Link } from './kit';

/** Stern zum Merken eines Fahrers */
export function FavStar({ rider, size = 20 }: { rider: Rider; size?: number }) {
  const fav = useFavorites();
  const on = fav.has(rider);
  return (
    <button
      type="button"
      className={cx('fav-star', on && 'is-on')}
      aria-pressed={on}
      aria-label={on ? `${rider.name} aus den Favoriten entfernen` : `${rider.name} als Favorit merken`}
      onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); fav.toggle(rider); }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.4l-5.7 3 1.1-6.4-4.6-4.5 6.4-.9z"
          fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Verlauf der Gesamtwertung (Top 10) als kleine Linie */
export function GcSpark({ stats, height = 64 }: { stats: RiderStats; height?: number }) {
  const pts = stats.gc;
  if (pts.length < 2 || !pts.some((p) => p.pos !== null)) return null;
  const w = 100;
  const x = (i: number) => (i / (pts.length - 1)) * (w - 4) + 2;
  const y = (pos: number) => 4 + ((pos - 1) / 9) * (height - 8);
  const segs: string[] = [];
  let cur = '';
  pts.forEach((p, i) => {
    if (p.pos === null) { if (cur) segs.push(cur); cur = ''; return; }
    cur += `${cur ? ' L' : 'M'}${x(i).toFixed(2)},${y(p.pos).toFixed(2)}`;
  });
  if (cur) segs.push(cur);
  return (
    <svg className="gc-spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img"
      aria-label={`Gesamtwertung: zuletzt ${stats.gcNow ? `Platz ${stats.gcNow}` : 'nicht in den Top 10'}`}>
      <line x1="0" x2={w} y1={y(1)} y2={y(1)} className="gc-spark__lead" />
      {segs.map((d, i) => <path key={i} d={d} className="gc-spark__line" vectorEffect="non-scaling-stroke" />)}
      {pts.map((p, i) => (p.pos !== null ? <circle key={i} cx={x(i)} cy={y(p.pos)} r="1.6" className={cx('gc-spark__dot', p.pos === 1 && 'is-lead')} vectorEffect="non-scaling-stroke" /> : null))}
    </svg>
  );
}

/** Kompakter Steckbrief, z. B. aufgeklappt in einer Fahrerliste */
export function RiderSheet({ rider, data, now, meId, showProfileLink = true }: {
  rider: Rider; data: TourData; now: number; meId: string; showProfileLink?: boolean;
}) {
  const st = riderStats(data, rider, now, meId);
  const country = countryName(rider.nationality);
  const recent = st.placings.slice(-5);
  const facts: { label: string; value: string }[] = [
    { label: 'Nation', value: country ? `${flag(rider.nationality)} ${country}` : '–' },
    { label: 'Alter', value: rider.age ? `${rider.age} Jahre` : '–' },
    { label: 'Startnummer', value: rider.bib ? String(rider.bib) : '–' },
    { label: 'Etappensiege', value: String(st.wins) },
    { label: 'Top 10', value: String(st.placings.length) },
    { label: 'Gesamtwertung', value: st.gcNow ? `${st.gcNow}.` : st.gc.length ? 'nicht Top 10' : '–' },
  ];
  if (st.leaderDays) facts.push({ label: leaderLabel(data.tour.theme), value: String(st.leaderDays) });
  if (st.youthLeaderDays) facts.push({ label: 'Bester Jungprofi', value: `${st.youthLeaderDays}×` });
  if (st.strength) facts.push({ label: 'Stärke (Ergebnisse)', value: st.strength });

  return (
    <div className="rider-sheet">
      <div className="rider-sheet__chips">
        {rider.young ? <span className="chip chip--accent">Nachwuchs</span> : null}
        {rider.excluded_from_rest ? <span className="chip">Topfavorit</span> : null}
        {rider.status === 'out' ? <span className="chip chip--warn">ausgestiegen</span> : <span className="chip">im Rennen</span>}
        {st.standings.map((s, i) => (
          <span key={i} className="chip chip--accent">{categoryTitle(s.category, data.tour.theme).split(' · ')[0]} {s.position}.</span>
        ))}
      </div>
      <dl className="rider-sheet__facts">
        {facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
      </dl>
      {recent.length ? (
        <p className="rider-sheet__form">
          <span className="muted">Letzte Top-10:</span>{' '}
          {recent.map((p) => <span key={p.stage.id} className={cx('form-pill', p.pos === 1 && 'is-win')}>E{p.stage.number}&nbsp;·&nbsp;{p.pos}.</span>)}
        </p>
      ) : null}
      <GcSpark stats={st} height={48} />
      <p className="muted small">
        In eurer Runde {st.tipsTotal}× getippt
        {st.limit !== null ? ` · du ${st.mine}/${st.limit}` : st.mine ? ` · du ${st.mine}×` : ''}
      </p>
      <div className="rider-sheet__actions">
        <FavStar rider={rider} />
        {showProfileLink ? <Link to={`/fahrer/${rider.id}`} className="text-link">Ganzes Profil</Link> : null}
      </div>
    </div>
  );
}
