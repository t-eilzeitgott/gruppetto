import { useMemo, useState } from 'react';
import { useTourContext } from '../app/context';
import { useFavorites, useNow } from '../app/hooks';
import { normalize } from '../lib/pcsParse';
import { countryName, flag } from '../lib/countries';
import { teamStats } from '../lib/riderStats';
import type { Rider, TourData } from '../lib/types';
import { Empty, ErrorBox, Loading, TopBar, cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { FavStar, RiderSheet } from '../ui/RiderSheet';

type Sort = 'team' | 'bib' | 'name' | 'age' | 'results';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'team', label: 'Nach Team' },
  { value: 'bib', label: 'Startnummer' },
  { value: 'name', label: 'Name' },
  { value: 'age', label: 'Alter (jung zuerst)' },
  { value: 'results', label: 'Top-10-Platzierungen' },
];

/** Übersicht aller Fahrer der Rundfahrt mit Steckbrief zum Aufklappen. */
export function RidersPage() {
  useTitle('Fahrer');
  const { me, data, loading, error, reload } = useTourContext();
  const now = useNow(60000);
  const fav = useFavorites();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('team');
  const [onlyFav, setOnlyFav] = useState(false);
  const [onlyYoung, setOnlyYoung] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  const top10 = useMemo(() => {
    const m = new Map<number, number>();
    if (!data) return m;
    const pub = new Set(data.stages.filter((s) => s.results_published).map((s) => s.id));
    for (const r of data.results) if (pub.has(r.stage_id)) m.set(r.rider_id, (m.get(r.rider_id) ?? 0) + 1);
    return m;
  }, [data]);

  if (error) return <><TopBar title="Fahrer" back="/etappen" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data) return <><TopBar title="Fahrer" back="/etappen" /><Loading /></>;

  const q = normalize(query);
  let list = data.riders.filter((r) => {
    if (onlyFav && !fav.has(r)) return false;
    if (onlyYoung && !r.young) return false;
    if (onlyActive && r.status !== 'active') return false;
    if (!q) return true;
    const hay = normalize(`${r.name} ${r.team} ${r.bib ?? ''} ${countryName(r.nationality) ?? ''} ${r.nationality ?? ''}`);
    return q.split(' ').every((part) => hay.includes(part));
  });
  const byName = (a: Rider, b: Rider) => a.name.localeCompare(b.name, 'de');
  if (sort === 'bib') list = [...list].sort((a, b) => (a.bib ?? 9999) - (b.bib ?? 9999));
  if (sort === 'name') list = [...list].sort(byName);
  if (sort === 'age') list = [...list].sort((a, b) => (a.age ?? 99) - (b.age ?? 99) || byName(a, b));
  if (sort === 'results') list = [...list].sort((a, b) => (top10.get(b.id) ?? 0) - (top10.get(a.id) ?? 0) || byName(a, b));
  if (sort === 'team') list = [...list].sort((a, b) => a.team.localeCompare(b.team, 'de') || (a.bib ?? 9999) - (b.bib ?? 9999));

  const toggle = (id: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const teams = sort === 'team' ? [...new Set(list.map((r) => r.team))] : [null];
  const total = data.riders.length;
  const active = data.riders.filter((r) => r.status === 'active').length;
  const nations = new Set(data.riders.map((r) => r.nationality).filter(Boolean)).size;

  return (
    <>
      <TopBar title="Fahrer" subtitle={data.tour.name} back="/etappen" />
      <div className="stack">
        <div className="stat-grid">
          <div className="stat"><strong>{total}</strong><span>Fahrer</span></div>
          <div className="stat"><strong>{active}</strong><span>im Rennen</span></div>
          <div className="stat"><strong>{nations || '–'}</strong><span>Nationen</span></div>
        </div>

        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr-only">Fahrer suchen</span>
          <input type="search" placeholder="Name, Team oder Nation" value={query} autoComplete="off" enterKeyHint="search"
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </label>

        <div className="filter-row" role="group" aria-label="Filter">
          <button type="button" className={cx('toggle', onlyFav && 'is-on')} aria-pressed={onlyFav} onClick={() => setOnlyFav(!onlyFav)}>★ Favoriten ({fav.count})</button>
          <button type="button" className={cx('toggle', onlyYoung && 'is-on')} aria-pressed={onlyYoung} onClick={() => setOnlyYoung(!onlyYoung)}>Nachwuchs</button>
          <button type="button" className={cx('toggle', onlyActive && 'is-on')} aria-pressed={onlyActive} onClick={() => setOnlyActive(!onlyActive)}>Im Rennen</button>
        </div>
        <div className="field">
          <label htmlFor="rider-sort">Sortierung</label>
          <select id="rider-sort" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {list.length === 0 ? (
          <Empty icon="users" title={onlyFav && !fav.count ? 'Noch keine Favoriten' : 'Kein Fahrer gefunden'}>
            {onlyFav && !fav.count ? 'Tippe bei einem Fahrer auf den Stern, um ihn dir zu merken.' : 'Versuch es mit einem anderen Suchbegriff oder Filter.'}
          </Empty>
        ) : teams.map((team) => {
          const rows = team === null ? list : list.filter((r) => r.team === team);
          return (
            <section key={team ?? 'all'} className={cx(team !== null && 'card team-card')}>
              {team !== null ? <TeamHead data={data} team={team} /> : null}
              <ul className="list rider-dir">
                {rows.map((r) => (
                  <li key={r.id}>
                    <div className={cx('rider-dir__row', r.status === 'out' && 'is-out')}>
                      <button type="button" className="rider-dir__main" aria-expanded={open.has(r.id)} onClick={() => toggle(r.id)}>
                        <span className="rider-dir__bib">{r.bib ?? ''}</span>
                        <span className="rider-dir__text">
                          <span className="rider-dir__name">
                            {r.nationality ? <span className="rider-option__flag" aria-hidden="true">{flag(r.nationality)}</span> : null}
                            {r.name}
                          </span>
                          <span className="rider-dir__sub">
                            {[team === null ? r.team : null, r.age ? `${r.age} J.` : null, r.young ? 'U25' : null,
                              top10.get(r.id) ? `${top10.get(r.id)}× Top 10` : null, r.status === 'out' ? 'ausgestiegen' : null]
                              .filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <Icon name="chevron" size={18} className={cx('rider-dir__chev', open.has(r.id) && 'is-open')} />
                      </button>
                      <FavStar rider={r} />
                    </div>
                    {open.has(r.id) ? <RiderSheet rider={r} data={data} now={now} meId={me.id} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function TeamHead({ data, team }: { data: TourData; team: string }) {
  const t = teamStats(data, team);
  return (
    <div className="team-head">
      <h2 className="card__h">{team}</h2>
      <p className="muted small">
        {[`${t.active}/${t.riders.length} im Rennen`, t.avgAge ? `Ø ${t.avgAge.toLocaleString('de-DE', { maximumFractionDigits: 1 })} J.` : null,
          t.nations ? `${t.nations} ${t.nations === 1 ? 'Nation' : 'Nationen'}` : null, t.young ? `${t.young} U25` : null,
          t.wins ? `${t.wins} ${t.wins === 1 ? 'Sieg' : 'Siege'}` : null, t.top10 ? `${t.top10}× Top 10` : null]
          .filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}
