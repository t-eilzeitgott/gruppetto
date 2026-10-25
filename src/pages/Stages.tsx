import { Fragment, useMemo } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { scoreStage } from '../lib/scoring';
import { KIND_SHORT, dayDiff, fmtRange, sortStages, stageState } from '../lib/time';
import type { Stage, TourData, Profile } from '../lib/types';
import { Empty, ErrorBox, Link, Loading, PageTitle, cx, useTitle } from '../ui/kit';
import { TourPicker } from '../ui/Shell';
import { lastName, riderName, stageRoute, useRefreshAtStart } from '../ui/bits';
import { Icon } from '../ui/Icon';

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
        {error ? <ErrorBox error={error} onRetry={reload} /> : loading || !data ? <Loading /> : <StageList data={data} me={me} now={now} />}
      </div>
    </>
  );
}

function StageList({ data, me, now }: { data: TourData; me: Profile; now: number }) {
  const stages = sortStages(data.stages);
  const myPoints = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of stages) {
      const mine = scoreStage(s, data.tips, data.results, data.scale).find((x) => x.userId === me.id);
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
              <StageRow stage={s} data={data} me={me} now={now} points={myPoints.get(s.id)} />
            </Fragment>
          );
        })}
      </ul>
    </>
  );
}

function StageRow({ stage, data, me, now, points }: { stage: Stage; data: TourData; me: Profile; now: number; points?: number }) {
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
