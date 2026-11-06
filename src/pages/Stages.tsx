import { Fragment, useMemo } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { scoreStageOf } from '../lib/scoring';
import { KIND_SHORT, dayDiff, fmtKm, fmtRange, sortStages, stageState } from '../lib/time';
import type { Stage, Tour, TourData, Profile } from '../lib/types';
import { Empty, ErrorBox, Link, Loading, PageTitle, cx, useTitle } from '../ui/kit';
import { TourPicker } from '../ui/Shell';
import { lastName, riderName, stageRoute, useRefreshAtStart } from '../ui/bits';
import { Icon } from '../ui/Icon';
import { MiniProfile } from '../ui/StageProfile';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { ProfilePoint } from '../lib/gpx';

const WD = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];

export function Stages() {
  useTitle('Etappen');
  const { me, tour, tours, data, loading, error, reload } = useTourContext();
  const now = useNow();
  useRefreshAtStart(data?.stages, now);

  if (!tour) return <><PageTitle title="Etappen" /><Empty title="Noch keine Rundfahrt" /></>;
  return (
    <>
      <PageTitle title="Etappen" subtitle={fmtRange(tour.start_date, tour.end_date)} />
      <div className="stack">
        <TourPicker tour={tour} tours={tours} />
        {tour.info?.overview && data ? <TourOverviewCard tour={tour} data={data} /> : null}
        {data ? <ExploreLinks data={data} /> : null}
        {error ? <ErrorBox error={error} onRetry={reload} /> : loading || !data ? <Loading /> : <StageList data={data} me={me} now={now} />}
      </div>
    </>
  );
}

function StageList({ data, me, now }: { data: TourData; me: Profile; now: number }) {
  const stages = sortStages(data.stages);
  const ids = stages.map((s) => s.id);
  const profiles = useQuery<Record<number, ProfilePoint[]>>(ids.length ? `profiles-mini:${ids.join(',')}` : null, () => source.loadProfilesFor(ids));
  const myPoints = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of stages) {
      const mine = scoreStageOf(data, s).find((x) => x.userId === me.id);
      if (mine) map.set(s.id, mine.total);
    }
    return map;
  }, [data, me.id, stages]);

  if (!stages.length) {
    return <Empty title="Etappenplan folgt">Die Etappen werden eingetragen, sobald die Strecke feststeht.</Empty>;
  }
  const done = stages.filter((s) => s.results_published).length;
  const total = [...myPoints.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="progress-head">
        <div className="progress-head__row">
          <span>{done} von&nbsp;{stages.length} ausgewertet</span>
          <span className="muted">{total} Punkte</span>
        </div>
        <div className="progress" role="progressbar" aria-label="Fortschritt der Rundfahrt" aria-valuemin={0} aria-valuemax={stages.length} aria-valuenow={done}>
          <div style={{ width: `${(done / stages.length) * 100}%` }} />
        </div>
      </div>
      <ul className="list stage-list">
        {stages.map((s, i) => {
          const prev = stages[i - 1];
          const gap = prev ? dayDiff(prev.starts_at, s.starts_at) - 1 : 0;
          return (
            <Fragment key={s.id}>
              {gap > 0 ? <li className="rest-day" aria-label="Ruhetag"><span>{gap === 1 ? 'Ruhetag' : `${gap} Ruhetage`}</span></li> : null}
              <StageRow stage={s} data={data} me={me} now={now} points={myPoints.get(s.id)} profile={profiles.data?.[s.id]} />
            </Fragment>
          );
        })}
      </ul>
    </>
  );
}

function StageRow({ stage, data, me, now, points, profile }: { stage: Stage; data: TourData; me: Profile; now: number; points?: number; profile?: ProfilePoint[] }) {
  const state = stageState(stage, now);
  const d = new Date(stage.starts_at);
  const myTip = data.tips.find((t) => t.stage_id === stage.id && t.user_id === me.id);
  const isToday = dayDiff(new Date(now), d) === 0;
  const winner = data.results.find((r) => r.stage_id === stage.id && r.position === 1);
  const route = stageRoute(stage);

  let detail: string;
  if (state === 'done') {
    detail = `Sieger ${winner ? lastName(riderName(data, winner.rider_id)) : '–'} · ${myTip ? `Tipp ${lastName(riderName(data, myTip.rider_id))}` : 'kein Tipp'}`;
  } else if (state === 'running') {
    detail = myTip ? `Läuft · Tipp ${lastName(riderName(data, myTip.rider_id))}` : 'Läuft · kein Tipp';
  } else {
    detail = myTip ? `Getippt: ${lastName(riderName(data, myTip.rider_id))}` : isToday ? 'Heute – noch nicht getippt' : 'Noch kein Tipp';
  }

  return (
    <li>
      <Link to={`/etappe/${stage.id}`} className={cx('stage-row', isToday && state === 'open' && 'stage-row--today')}>
        <span className="date-block" aria-hidden="true">
          <span>{WD[d.getDay()]}</span>
          <strong>{String(d.getDate()).padStart(2, '0')}</strong>
        </span>
        <span className="stage-row__main">
          <span className="stage-row__title">
            Etappe&nbsp;{stage.number}
            <span className="muted"> · {KIND_SHORT[stage.kind]}</span>
          </span>
          {route ? <span className="stage-row__route">{route}</span> : null}
          {stage.info?.climbs_note && !profile?.length ? (
            // vor dem Roadbook: Zahlen statt eines groben Profils
            <span className="stage-row__facts">
              {[stage.distance_km ? fmtKm(stage.distance_km) : null, stage.elevation_m ? `${stage.elevation_m.toLocaleString('de-DE')}\u00a0Hm` : null].filter(Boolean).join(' · ')}
              {stage.info.stars ? <Stars n={stage.info.stars} /> : null}
            </span>
          ) : <MiniProfile stage={stage} points={profile} />}
          <span className={cx('stage-row__detail', state === 'open' && !myTip && isToday && 'accent')}>{detail}</span>
        </span>
        <span className="stage-row__side">
          {state === 'done' ? (
            <span className={cx('points', (points ?? 0) > 0 ? 'pos' : 'muted')}>+{points ?? 0}</span>
          ) : state === 'running' ? (
            <Icon name="clock" size={18} className="muted" label="Ergebnis folgt" />
          ) : myTip ? (
            <Icon name="check" size={18} className="pos" label="Getippt" />
          ) : (
            <span className="muted">–</span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** Schwierigkeit laut Veranstalter: fünf Punkte, gefüllt nach Sternen */
function Stars({ n }: { n: number }) {
  return (
    <span className="stars" role="img" aria-label={`Schwierigkeit ${n} von 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : undefined} />)}
    </span>
  );
}

const nf1 = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });

/** Die Rundfahrt auf einen Blick (nach der Streckenpräsentation): Zahlen, Ruhetage, die schwersten Etappen */
function TourOverviewCard({ tour, data }: { tour: Tour; data: TourData }) {
  const o = tour.info?.overview;
  if (!o) return null;
  const stages = sortStages(data.stages);
  const rest = stages.flatMap((s, i) => {
    const prev = stages[i - 1];
    if (!prev || dayDiff(prev.starts_at, s.starts_at) < 2) return [];
    const d = new Date(new Date(prev.starts_at).getTime() + 864e5);
    return [d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })];
  });
  const hard = stages.filter((s) => (s.info?.stars ?? 0) >= 5);
  const tt = stages.filter((s) => s.kind === 'itt' || s.kind === 'ttt').length;
  const facts: [string, string][] = [];
  if (o.summit_finishes) facts.push(['Bergankünfte', String(o.summit_finishes)]);
  if (o.itt_km) facts.push([tt === 1 ? 'Zeitfahren' : `${tt || ''} Zeitfahren`.trim(), `${nf1(o.itt_km)}\u00a0km`]);
  if (o.highest) facts.push(['Höchster Punkt', `${o.highest.name} · ${o.highest.alt.toLocaleString('de-DE')}\u00a0m`]);
  if (o.start && o.finish) facts.push(['Start → Ziel', `${o.start} → ${o.finish}`]);
  if (rest.length) facts.push([rest.length === 1 ? 'Ruhetag' : 'Ruhetage', rest.join(' & ')]);
  return (
    <section className="card tour-ov" aria-labelledby="tour-ov">
      <h2 id="tour-ov" className="eyebrow">Die Strecke auf einen Blick</h2>
      <dl className="tour-ov__big">
        <div><dt>Etappen</dt><dd>{stages.length || '–'}</dd></div>
        <div><dt>Kilometer</dt><dd>{Math.round(o.km).toLocaleString('de-DE')}</dd></div>
        <div><dt>Höhenmeter</dt><dd>{o.elevation.toLocaleString('de-DE')}</dd></div>
      </dl>
      {facts.length ? <dl className="sheet-facts sheet-facts--wide">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
      {o.note ? <p className="tour-ov__note">{o.note}</p> : null}
      {hard.length ? (
        <div className="tour-ov__hard">
          <h3 className="eyebrow sheet-sub">Die schwersten Etappen</h3>
          <ul className="tour-ov__list">
            {hard.map((s) => (
              <li key={s.id}>
                <Link to={`/etappe/${s.id}`} className="tour-ov__stage">
                  <span className="tour-ov__n">{s.number}</span>
                  <span className="tour-ov__main">
                    <strong>{stageRoute(s)}</strong>
                    <span className="muted">{new Date(s.starts_at).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })}{s.elevation_m ? ` · ${s.elevation_m.toLocaleString('de-DE')}\u00a0Hm` : ''}</span>
                  </span>
                  <Stars n={s.info?.stars ?? 5} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {tour.info?.overview && stages[0]?.info?.source ? <p className="hint">Quelle: {stages[0].info.source}. Schwierigkeit (Punkte) laut Veranstalter.</p> : null}
    </section>
  );
}

function ExploreLinks({ data }: { data: TourData }) {
  const teams = new Set(data.riders.map((r) => r.team)).size;
  const climbs = data.stages.reduce((n, s) => n + (s.climbs?.length ?? 0), 0);
  if (!data.riders.length && !climbs) return null;
  return (
    <div className="explore-links">
      {data.riders.length ? (
        <Link to="/fahrer" className="card card--row explore-link">
          <Icon name="users" />
          <span className="card__main">
            <strong>Fahrer & Teams</strong>
            <span className="muted">{data.riders.length} Fahrer · {teams} Teams · Favoriten</span>
          </span>
          <Icon name="chevron" className="muted" />
        </Link>
      ) : null}
      {climbs ? (
        <Link to="/anstiege" className="card card--row explore-link">
          <Icon name="mountain" />
          <span className="card__main">
            <strong>Anstiege</strong>
            <span className="muted">{climbs} Bergwertungen mit Steckbrief</span>
          </span>
          <Icon name="chevron" className="muted" />
        </Link>
      ) : null}
    </div>
  );
}
