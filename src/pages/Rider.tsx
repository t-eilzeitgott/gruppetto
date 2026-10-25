import { useMemo } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { countryName, flag } from '../lib/countries';
import { categoryTitle } from '../lib/categories';
import { leaderLabel, riderStats, teamStats } from '../lib/riderStats';
import { KIND_SHORT, sortStages } from '../lib/time';
import { Avatar, Empty, ErrorBox, Link, Loading, TopBar, cx, useTitle } from '../ui/kit';
import { FavStar, GcSpark } from '../ui/RiderSheet';

/** Fahrerprofil: Stammdaten, Rennverlauf, Wertungen, Team und Tipps der Runde. */
export function RiderPage({ id }: { id: number }) {
  const { me, data, members, loading, error, reload } = useTourContext();
  const now = useNow(60000);
  const rider = data?.riders.find((r) => r.id === id);
  useTitle(rider?.name ?? 'Fahrer');
  const st = useMemo(() => (data && rider ? riderStats(data, rider, now, me.id) : null), [data, rider, now, me.id]);

  if (error) return <><TopBar title="Fahrer" back="/fahrer" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data || !members) return <><TopBar title="Fahrer" back="/fahrer" /><Loading /></>;
  if (!rider || !st) return <><TopBar title="Fahrer" back="/fahrer" /><Empty icon="user" title="Fahrer nicht gefunden" /></>;

  const country = countryName(rider.nationality);
  const team = teamStats(data, rider.team);
  const mates = team.riders.filter((r) => r.id !== rider.id);
  const published = sortStages(data.stages).filter((s) => s.results_published);
  const gcByStage = new Map(st.gc.map((g) => [g.stage.id, g.pos]));
  const posByStage = new Map(st.placings.map((p) => [p.stage.id, p.pos]));
  const tippers = [...st.tippedBy.entries()]
    .map(([uid, n]) => ({ m: members.find((x) => x.id === uid), n }))
    .filter((x) => x.m)
    .sort((a, b) => b.n - a.n || (a.m!.display_name ?? '').localeCompare(b.m!.display_name ?? '', 'de'));
  const kinds = (Object.entries(st.byKind) as [keyof typeof KIND_SHORT, number][]).sort((a, b) => b[1] - a[1]);
  const q = encodeURIComponent(rider.name);

  return (
    <>
      <TopBar title="Fahrer" back="/fahrer" />
      <div className="stack">
        <section className="rider-hero">
          {rider.nationality ? <span className="rider-hero__flag" role="img" aria-label={country ?? ''}>{flag(rider.nationality)}</span> : null}
          <h2 className="rider-hero__name">{rider.name}</h2>
          <p className="muted">{rider.team}</p>
          <div className="rider-hero__chips">
            {rider.bib ? <span className="chip">Nr.&nbsp;{rider.bib}</span> : null}
            {country ? <span className="chip">{country}</span> : null}
            {rider.age ? <span className="chip">{rider.age}&nbsp;Jahre</span> : null}
            {rider.young ? <span className="chip chip--accent">Nachwuchs</span> : null}
            {rider.excluded_from_rest ? <span className="chip">Topfavorit</span> : null}
            {rider.status === 'out' ? <span className="chip chip--warn">ausgestiegen</span> : null}
          </div>
          <div className="rider-hero__fav"><FavStar rider={rider} size={24} /><span className="muted small">Favorit</span></div>
        </section>

        <div className="stat-grid rider-facts">
          <div className="stat"><strong>{st.wins}</strong><span>{st.wins === 1 ? 'Sieg' : 'Siege'}</span></div>
          <div className="stat"><strong>{st.podiums}</strong><span>Podium</span></div>
          <div className="stat"><strong>{st.placings.length}</strong><span>Top 10</span></div>
          <div className="stat"><strong>{st.gcNow ? `${st.gcNow}.` : '–'}</strong><span>Gesamt</span></div>
          <div className="stat"><strong>{st.bestGc ? `${st.bestGc}.` : '–'}</strong><span>Bestes Gesamt</span></div>
          <div className="stat"><strong>{st.leaderDays}</strong><span>{leaderLabel(data.tour.theme)}</span></div>
        </div>

        {st.gc.length > 1 && st.gc.some((g) => g.pos !== null) ? (
          <section className="card">
            <span className="eyebrow">Gesamtwertung im Verlauf</span>
            <GcSpark stats={st} height={90} />
            <p className="muted small">Lücken: außerhalb der Top 10. Oben = Platz 1.</p>
          </section>
        ) : null}

        {st.standings.length || st.youthLeaderDays || st.strength ? (
          <section className="card">
            <span className="eyebrow">{data.tour.bonus_final ? 'Endstand' : 'Aktuell'} in den Wertungen</span>
            <ul className="list">
              {st.standings.map((s, i) => (
                <li key={i} className="standing-row">
                  <span>{categoryTitle(s.category, data.tour.theme)}{s.team ? ' (Team)' : ''}</span>
                  <strong>{s.position}.</strong>
                </li>
              ))}
              {st.youthLeaderDays ? <li className="standing-row"><span>Tage als bester Jungprofi</span><strong>{st.youthLeaderDays}</strong></li> : null}
            </ul>
            {kinds.length ? (
              <div>
                <span className="muted small">Top 10 nach Terrain</span>
                <div className="terrain-pills">{kinds.map(([k, n]) => <span key={k} className="form-pill">{KIND_SHORT[k]}&nbsp;{n}×</span>)}</div>
              </div>
            ) : null}
          </section>
        ) : null}

        {published.length ? (
          <section aria-labelledby="rider-course">
            <h2 id="rider-course" className="section-title">Rennverlauf</h2>
            <div className="card table-scroll">
              <table className="course-table">
                <thead>
                  <tr><th scope="col">Etappe</th><th scope="col">Terrain</th><th scope="col" className="num">Platz</th><th scope="col" className="num">Gesamt</th></tr>
                </thead>
                <tbody>
                  {published.map((s) => {
                    const pos = posByStage.get(s.id);
                    const gc = gcByStage.get(s.id);
                    return (
                      <tr key={s.id} className={cx(pos === 1 && 'is-win')}>
                        <th scope="row"><Link to={`/etappe/${s.id}`} className="rider-link">E{s.number}</Link></th>
                        <td className="muted">{KIND_SHORT[s.kind]}</td>
                        <td className="num">{pos ? `${pos}.` : '–'}</td>
                        <td className="num">{gc ? `${gc}.` : gcByStage.has(s.id) ? '>10' : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">„–“ beim Platz: nicht unter den ersten 10. „&gt;10“: außerhalb der Top 10 der Gesamtwertung.</p>
          </section>
        ) : null}

        <section className="card">
          <span className="eyebrow">In eurer Runde</span>
          <p>{st.tipsTotal === 0 ? 'Bisher hat ihn niemand getippt.' : `In den gestarteten Etappen ${st.tipsTotal}× getippt.`}</p>
          {tippers.length ? (
            <ul className="list">
              {tippers.slice(0, 10).map(({ m, n }) => (
                <li key={m!.id}>
                  <Link to={`/spieler/${m!.id}`} className={cx('person-row', m!.id === me.id && 'is-me')}>
                    <Avatar name={m!.display_name} color={m!.avatar_color} size={30} />
                    <span className="person-row__main"><span className="person-row__name">{m!.display_name}{m!.id === me.id ? ' (du)' : ''}</span></span>
                    <span className="points">{n}×</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {st.limit !== null ? (
            <p className="muted small">
              Du hast ihn {st.mine}× getippt{rider.status === 'out' ? '.' : st.left === 0 ? ' – Limit erreicht.' : ` – noch ${st.left}× möglich.`}
            </p>
          ) : null}
        </section>

        <section className="card">
          <span className="eyebrow">Team {rider.team}</span>
          <p className="muted small">
            {[`${team.active}/${team.riders.length} im Rennen`, team.avgAge ? `Ø ${team.avgAge.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Jahre` : null,
              team.wins ? `${team.wins} ${team.wins === 1 ? 'Etappensieg' : 'Etappensiege'}` : null].filter(Boolean).join(' · ')}
          </p>
          <ul className="list">
            {mates.map((r) => (
              <li key={r.id}>
                <Link to={`/fahrer/${r.id}`} className={cx('person-row', r.status === 'out' && 'is-out')}>
                  <span className="rank">{r.bib ?? ''}</span>
                  <span className="person-row__main">
                    <span className="person-row__name">{r.nationality ? `${flag(r.nationality)} ` : ''}{r.name}</span>
                    <span className="person-row__sub">{[r.age ? `${r.age} J.` : null, r.young ? 'U25' : null, r.status === 'out' ? 'ausgestiegen' : null].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p className="hint center">
          Mehr zu {rider.name}:{' '}
          <a href={`https://www.procyclingstats.com/search.php?term=${q}`} target="_blank" rel="noopener noreferrer">ProCyclingStats</a>
          {' · '}
          <a href={`https://de.wikipedia.org/w/index.php?search=${q}`} target="_blank" rel="noopener noreferrer">Wikipedia</a>
        </p>
      </div>
    </>
  );
}
