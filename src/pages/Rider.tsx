import { useMemo } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { bonusStandings, jokerRemaining, tipLimit } from '../lib/scoring';
import { countryName, flag } from '../lib/countries';
import { categoryTitle } from '../lib/categories';
import { sortStages } from '../lib/time';
import { Avatar, Empty, ErrorBox, Link, Loading, TopBar, cx, useTitle } from '../ui/kit';
import { stageRoute } from '../ui/bits';

/** Fahrerprofil: Stammdaten, Ergebnisse in dieser Rundfahrt, Tipps der Runde. */
export function RiderPage({ id }: { id: number }) {
  const { me, data, members, loading, error, reload } = useTourContext();
  const now = useNow(60000);
  const rider = data?.riders.find((r) => r.id === id);
  useTitle(rider?.name ?? 'Fahrer');

  const stats = useMemo(() => {
    if (!data || !rider) return null;
    const published = sortStages(data.stages).filter((s) => s.results_published);
    const placings = published
      .map((s) => ({ stage: s, pos: data.results.find((r) => r.stage_id === s.id && r.rider_id === rider.id)?.position ?? null }))
      .filter((p) => p.pos !== null) as { stage: (typeof published)[number]; pos: number }[];
    const started = new Set(data.stages.filter((s) => new Date(s.starts_at).getTime() <= now).map((s) => s.id));
    const tips = data.tips.filter((t) => t.rider_id === rider.id && started.has(t.stage_id));
    const byMember = new Map<string, number>();
    for (const t of tips) byMember.set(t.user_id, (byMember.get(t.user_id) ?? 0) + 1);
    const mine = data.tips.filter((t) => t.rider_id === rider.id && t.user_id === me.id).length;
    const standings = bonusStandings(data).filter((s) => s.riderId === rider.id || (s.team !== null && s.team === rider.team));
    return { placings, tips, byMember, mine, standings };
  }, [data, rider, now, me.id]);

  if (error) return <><TopBar title="Fahrer" back="/etappen" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data || !members) return <><TopBar title="Fahrer" back="/etappen" /><Loading /></>;
  if (!rider || !stats) return <><TopBar title="Fahrer" back="/etappen" /><Empty icon="user" title="Fahrer nicht gefunden" /></>;

  const wins = stats.placings.filter((p) => p.pos === 1).length;
  const podiums = stats.placings.filter((p) => p.pos <= 3).length;
  const limit = tipLimit(data.tour, rider);
  const left = jokerRemaining(data.tour, rider, data.tips, me.id, -1);
  const country = countryName(rider.nationality);
  const tippers = [...stats.byMember.entries()]
    .map(([uid, n]) => ({ m: members.find((x) => x.id === uid), n }))
    .filter((x) => x.m)
    .sort((a, b) => b.n - a.n || (a.m!.display_name ?? '').localeCompare(b.m!.display_name ?? '', 'de'));

  return (
    <>
      <TopBar title="Fahrer" back="/etappen" />
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
            {rider.status === 'out' ? <span className="chip">ausgestiegen</span> : null}
          </div>
        </section>

        <div className="stat-grid rider-facts">
          <div className="stat"><strong>{wins}</strong><span>{wins === 1 ? 'Sieg' : 'Siege'}</span></div>
          <div className="stat"><strong>{podiums}</strong><span>Podium</span></div>
          <div className="stat"><strong>{stats.placings.length}</strong><span>Top 10</span></div>
        </div>

        {stats.standings.length ? (
          <section className="card">
            <span className="eyebrow">{data.tour.bonus_final ? 'Endstand' : 'Aktuell'} in den Wertungen</span>
            <ul className="list">
              {stats.standings.map((s, i) => (
                <li key={i} className="standing-row">
                  <span>{categoryTitle(s.category, data.tour.theme)}{s.team ? ' (Team)' : ''}</span>
                  <strong>{s.position}.</strong>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card">
          <span className="eyebrow">In eurer Runde</span>
          <p>
            {stats.tips.length === 0
              ? 'Bisher hat ihn niemand getippt.'
              : `In den gestarteten Etappen ${stats.tips.length}× getippt.`}
          </p>
          {tippers.length ? (
            <ul className="list">
              {tippers.slice(0, 8).map(({ m, n }) => (
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
          {limit !== null ? (
            <p className="muted small">
              Du hast ihn {stats.mine}× getippt
              {rider.status === 'out' ? '.' : left === 0 ? ' – Limit erreicht.' : ` – noch ${left}× möglich.`}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="rider-results">
          <h2 id="rider-results" className="section-title">Ergebnisse</h2>
          {stats.placings.length === 0 ? (
            <p className="muted">Noch keine Top-10-Platzierung in dieser Rundfahrt.</p>
          ) : (
            <ul className="list">
              {stats.placings.map(({ stage, pos }) => (
                <li key={stage.id}>
                  <Link to={`/etappe/${stage.id}`} className="person-row">
                    <span className={cx('rank', pos === 1 && 'accent')}>{pos}.</span>
                    <span className="person-row__main">
                      <span className="person-row__name">Etappe&nbsp;{stage.number}</span>
                      <span className="person-row__sub">{stageRoute(stage) ?? ''}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
