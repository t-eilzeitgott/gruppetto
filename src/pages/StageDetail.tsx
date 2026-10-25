import { useMemo } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { scoreStage, underdog, DEFAULT_SCALE } from '../lib/scoring';
import { KIND_LABEL, fmtDay, stageState, fmtClock, fmtKm, sortStages } from '../lib/time';
import type { Profile, Stage, TourData } from '../lib/types';
import { Avatar, ProBadge, Countdown, Empty, ErrorBox, LinkButton, Loading, Notice, TopBar, cx, useTitle, Link } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { Tippers, lastName, riderName, stageRoute, useRefreshAtStart } from '../ui/bits';
import { StageFactsCard, StageProfileCard } from '../ui/StageProfile';
import { flag } from '../lib/countries';

export function StageDetail({ id }: { id: number }) {
  const { me, data, members, loading, error, reload } = useTourContext();
  const now = useNow();
  useRefreshAtStart(data?.stages, now);
  const stage = data?.stages.find((s) => s.id === id);
  useTitle(stage ? `Etappe\u00a0${stage.number}` : 'Etappe');

  if (error) return <><TopBar title="Etappe" back="/etappen" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data || !members) return <><TopBar title="Etappe" back="/etappen" /><Loading /></>;
  if (!stage) {
    return (
      <>
        <TopBar title="Etappe" back="/etappen" />
        <Empty title="Etappe nicht gefunden">Vielleicht gehört sie zu einer anderen Rundfahrt.</Empty>
      </>
    );
  }

  const state = stageState(stage, now);
  const route = stageRoute(stage);
  const facts = [KIND_LABEL[stage.kind], stage.distance_km ? `${fmtKm(stage.distance_km)}` : null]
    .filter(Boolean).join(' · ');

  return (
    <>
      <TopBar title={`Etappe\u00a0${stage.number}`} subtitle={`${fmtDay(stage.starts_at)} · Start ${fmtClock(stage.starts_at)}`} back="/etappen" />
      <div className="stack">
        {route || facts ? (
          <section className="stage-hero">
            {route ? <p className="stage-hero__route">{route}</p> : null}
            {facts ? <p className="muted">{facts}</p> : null}
          </section>
        ) : null}
        {state === 'open' ? <OpenStage stage={stage} data={data} me={me} members={members} now={now} /> : null}
        {state === 'running' ? <RunningStage stage={stage} data={data} me={me} members={members} /> : null}
        {state === 'done' ? <DoneStage stage={stage} data={data} me={me} members={members} /> : null}
        <StageProfileCard stage={stage} tour={data.tour} />
        <StageFactsCard stage={stage} tour={data.tour} />
      </div>
    </>
  );
}

function OpenStage({ stage, data, me, members, now }: { stage: Stage; data: TourData; me: Profile; members: Profile[]; now: number }) {
  const myTip = data.tips.find((t) => t.stage_id === stage.id && t.user_id === me.id);
  const rider = data.riders.find((r) => r.id === myTip?.rider_id);
  return (
    <>
      <section className="card">
        <div className="card__row">
          <span className="eyebrow">Dein Tipp</span>
          <span className="chip chip--accent"><Icon name="clock" size={14} /> <Countdown to={stage.starts_at} now={now} /></span>
        </div>
        {myTip ? (
          <>
            <p className="card__title">{riderName(data, myTip.rider_id)}</p>
            {rider ? <p className="muted">{rider.team}</p> : null}
            {rider?.status === 'out' ? <Notice tone="error">Dieser Fahrer ist ausgestiegen – bitte tippe neu.</Notice> : null}
            <LinkButton to={`/tipp/${stage.id}`} variant="secondary" full>Tipp ändern</LinkButton>
          </>
        ) : (
          <>
            <p className="muted">Du hast noch nicht getippt. Tippschluss ist der Etappenstart um {fmtClock(stage.starts_at)}.</p>
            <LinkButton to={`/tipp/${stage.id}`} full>Jetzt tippen</LinkButton>
          </>
        )}
      </section>
      <section className="card">
        <p className="inline-note"><Icon name="lock" size={18} /><span>Die Tipps der anderen siehst du ab dem Start. Bis dahin sieht auch niemand deinen.</span></p>
        <Tippers stage={stage} members={members} />
      </section>
    </>
  );
}

function RunningStage({ stage, data, me, members }: { stage: Stage; data: TourData; me: Profile; members: Profile[] }) {
  const tips = data.tips.filter((t) => t.stage_id === stage.id);
  const groups = useMemo(() => {
    const map = new Map<number, Profile[]>();
    for (const t of tips) {
      const m = members.find((x) => x.id === t.user_id);
      if (!m) continue;
      map.set(t.rider_id, [...(map.get(t.rider_id) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || riderName(data, a[0]).localeCompare(riderName(data, b[0]), 'de'));
  }, [tips, members, data]);
  const withoutTip = members.filter((m) => !tips.some((t) => t.user_id === m.id));

  return (
    <>
      <Notice icon="clock">Die Etappe läuft. Punkte gibt es, sobald das Ergebnis eingetragen ist.</Notice>
      <section aria-labelledby="round-tips">
        <h2 id="round-tips" className="section-title">Tipps der Runde</h2>
        {groups.length === 0 ? <p className="muted">Niemand hat getippt.</p> : (
          <ul className="list">
            {groups.map(([riderId, people]) => (
              <li key={riderId} className="group-row">
                <div className="group-row__head">
                  <strong>{riderName(data, riderId)}</strong>
                  <span className="chip">{people.length}×</span>
                </div>
                <p className="group-row__names muted">
                  {people.map((p) => (p.id === me.id ? `${p.display_name} (du)` : p.display_name)).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}
        {withoutTip.length ? <p className="hint">Ohne Tipp: {withoutTip.map((m) => m.display_name).join(', ')}</p> : null}
      </section>
    </>
  );
}

function DoneStage({ stage, data, me, members }: { stage: Stage; data: TourData; me: Profile; members: Profile[] }) {
  const scores = useMemo(() => scoreStage(stage, data.tips, data.results, data.scale), [stage, data]);
  const results = data.results.filter((r) => r.stage_id === stage.id).sort((a, b) => a.position - b.position);
  const winner = results.find((r) => r.position === 1);
  const winnerRider = data.riders.find((r) => r.id === winner?.rider_id);
  const mine = scores.find((s) => s.userId === me.id);
  const underdogs = scores.filter((s) => s.bonus > 0);
  const fav = underdogs.length ? underdog(data.tips.filter((t) => t.stage_id === stage.id), winner?.rider_id ?? null) : null;
  const pointsByPos = new Map((data.scale.length ? data.scale : DEFAULT_SCALE).map((s) => [s.position, s.points]));
  const rows = scores
    .map((s) => ({ score: s, member: members.find((m) => m.id === s.userId) }))
    .filter((r) => r.member)
    .sort((a, b) => b.score.total - a.score.total || a.member!.display_name!.localeCompare(b.member!.display_name!, 'de'));
  const withoutTip = members.filter((m) => !scores.some((s) => s.userId === m.id));

  return (
    <>
      <section className="winner">
        <span className="muted">Etappensieger</span>
        <p className="winner__name">
          {winnerRider ? <Link to={`/fahrer/${winnerRider.id}`} className="rider-link">{winnerRider.nationality ? `${flag(winnerRider.nationality)} ` : ''}{winnerRider.name}</Link> : '–'}
        </p>
        {winnerRider ? <span className="muted">{winnerRider.team}</span> : null}
      </section>

      <section className="card card--row">
        <div className="card__main">
          <span className="eyebrow">Dein Tipp</span>
          {mine ? (
            <>
              <strong>{riderName(data, mine.riderId)}</strong>
              <span className="muted">{mine.position ? `${mine.position}. Platz` : 'nicht in den Top 10'}{mine.bonus ? ` · +${mine.bonus} Außenseiter-Bonus` : ''}</span>
            </>
          ) : <strong>Kein Tipp abgegeben</strong>}
        </div>
        <span className={cx('points points--lg', mine && mine.total > 0 ? 'pos' : 'muted')}>+{mine?.total ?? 0}</span>
      </section>

      {underdogs.length ? (
        <Notice icon="zap" tone="accent">
          <strong>Außenseiter-Bonus +{underdogs[0].bonus}</strong>
          <span>
            Nur {underdogs.map((u) => members.find((m) => m.id === u.userId)?.display_name).join(', ')} hat {lastName(riderName(data, underdogs[0].riderId))} getippt.
            {fav?.favoriteId !== null && fav?.favoriteId !== undefined
              ? ` Auf den Favoriten ${lastName(riderName(data, fav.favoriteId))} gingen ${underdogs[0].bonus} ${underdogs[0].bonus === 1 ? 'Tipp' : 'Tipps'} – so viele Extrapunkte gibt es.`
              : ''}
          </span>
        </Notice>
      ) : null}

      <section aria-labelledby="round-tips">
        <h2 id="round-tips" className="section-title">Tipps der Runde</h2>
        <ul className="list">
          {rows.map(({ score, member }) => (
            <li key={score.userId}>
              <Link to={`/spieler/${member!.id}`} className={cx('person-row', member!.id === me.id && 'is-me')}>
                <Avatar name={member!.display_name} color={member!.avatar_color} size={36} />
                <span className="person-row__main">
                  <span className="person-row__name">{member!.display_name}{member!.id === me.id ? ' (du)' : ''}{member!.is_pro ? <ProBadge /> : null}</span>
                  <span className="person-row__sub">
                    {lastName(riderName(data, score.riderId))} · {score.position ? `${score.position}.` : 'außerhalb Top 10'}
                  </span>
                </span>
                {score.bonus ? <span className="chip chip--accent">+{score.bonus}</span> : null}
                <span className={cx('points', score.total > 0 ? '' : 'muted')}>{score.total}</span>
              </Link>
            </li>
          ))}
        </ul>
        {withoutTip.length ? <p className="hint">Ohne Tipp: {withoutTip.map((m) => m.display_name).join(', ')}</p> : null}
      </section>

      <section aria-labelledby="top10">
        <h2 id="top10" className="section-title">Ergebnis</h2>
        <ol className="card result-list">
          {results.map((r) => {
            const rider = data.riders.find((x) => x.id === r.rider_id);
            return (
              <li key={r.position} className="result-row">
                <span className="result-row__pos">{r.position}</span>
                <span className="result-row__main">
                  {rider ? (
                    <Link to={`/fahrer/${rider.id}`} className="result-row__name rider-link">
                      {rider.nationality ? <span className="rider-option__flag" aria-hidden="true">{flag(rider.nationality)}</span> : null}{rider.name}
                    </Link>
                  ) : <span className="result-row__name">–</span>}
                  <span className="result-row__team">{rider?.team}</span>
                </span>
                <span className="result-row__pts">{pointsByPos.get(r.position) ?? 0}</span>
              </li>
            );
          })}
        </ol>
        <p className="hint">Rechts: Punkte für einen Tipp auf diesen Platz.</p>
      </section>

      <GcAfter stage={stage} data={data} />
    </>
  );
}

/** Gesamtwertung (Top 10) nach dieser Etappe, falls eingetragen */
function GcAfter({ stage, data }: { stage: Stage; data: TourData }) {
  const list = (data.standings ?? []).filter((x) => x.stage_id === stage.id && x.category === 'gc').sort((a, b) => a.position - b.position);
  if (!list.length) return null;
  const prev = sortStages(data.stages).filter((s) => s.number < stage.number && s.results_published).pop();
  const prevPos = new Map((data.standings ?? []).filter((x) => prev && x.stage_id === prev.id && x.category === 'gc').map((x) => [x.rider_id, x.position]));
  const jersey = data.tour.theme === 'giro' ? 'Maglia rosa' : data.tour.theme === 'tour' ? 'Maillot jaune' : data.tour.theme === 'vuelta' ? 'Maillot rojo' : 'Führender';
  return (
    <section aria-labelledby={`gc-${stage.id}`}>
      <h2 id={`gc-${stage.id}`} className="section-title">Gesamtwertung nach Etappe&nbsp;{stage.number}</h2>
      <ol className="card result-list">
        {list.map((x) => {
          const rider = data.riders.find((r) => r.id === x.rider_id);
          const before = prevPos.get(x.rider_id);
          const delta = prev ? (before === undefined ? 'neu' : before - x.position) : null;
          return (
            <li key={x.position} className="result-row">
              <span className="result-row__pos">{x.position}</span>
              <span className="result-row__main">
                {rider ? (
                  <Link to={`/fahrer/${rider.id}`} className="result-row__name rider-link">
                    {rider.nationality ? <span className="rider-option__flag" aria-hidden="true">{flag(rider.nationality)}</span> : null}{rider.name}
                  </Link>
                ) : <span className="result-row__name">–</span>}
                <span className="result-row__team">{x.position === 1 ? `${jersey} · ` : ''}{rider?.team}</span>
              </span>
              {delta === null ? null : delta === 'neu'
                ? <span className="delta muted">neu</span>
                : delta === 0 ? <span className="delta muted">–</span>
                  : <span className={cx('delta', delta > 0 ? 'pos' : 'neg')}>{delta > 0 ? '↑' : '↓'} {Math.abs(delta)}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
