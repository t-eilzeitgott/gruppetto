import { useMemo } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { leaderboard, jokerRemaining, bonusScoresFor, scoreStage, tipUsage, tourTipLimit } from '../lib/scoring';
import { bonusDeadline, fmtDay, lastPublishedStage, nextOpenStage, runningStages, tourPhase, dayDiff, fmtClock, fmtKm } from '../lib/time';
import { BONUS_CATEGORIES, type Stage, type TourData } from '../lib/types';
import { Avatar, Countdown, Empty, ErrorBox, Link, LinkButton, Loading, cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { KindChip, lastName, riderName, stageRoute, useRefreshAtStart } from '../ui/bits';
import { TourPicker, Wordmark } from '../ui/Shell';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import { GamesCard } from '../ui/GamesCard';
import { stageOfDay } from '../game/abfahrt/sprintRiders';
import { berlinDayKey } from '../game/abfahrt/rng';
import type { Profile } from '../lib/types';

export function Home() {
  useTitle('Heute');
  const { me, tour, tours, data, members, loading, error, reload } = useTourContext();
  const now = useNow();
  useRefreshAtStart(data?.stages, now);

  const header = (
    <header className="home-head">
      <Wordmark />
      <Link to="/profil" className="home-head__me" ariaLabel="Dein Profil">
        <Avatar name={me.display_name} color={me.avatar_color} size={36} />
      </Link>
    </header>
  );

  if (!tour) {
    return (
      <>
        {header}
        <div className="stack">
          <Empty title="Noch keine Rundfahrt">Sobald der Admin eine Rundfahrt anlegt, kannst du hier tippen.</Empty>
          <GamesCard />
        </div>
      </>
    );
  }
  if (error) return <>{header}<ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data || !members) return <>{header}<Loading /></>;

  return (
    <>
      {header}
      <div className="stack">
        <TourPicker tour={tour} tours={tours} />
        <HomeBody data={data} members={members} me={me} now={now} />
      </div>
    </>
  );
}

function HomeBody({ data, members, me, now }: { data: TourData; members: Profile[]; me: Profile; now: number }) {
  const phase = tourPhase(data.tour, data.stages, now);
  const todayStage = stageOfDay(data.stages, berlinDayKey());
  const board = useMemo(() => leaderboard(data, members), [data, members]);
  const myRow = board.find((r) => r.userId === me.id);
  const next = nextOpenStage(data.stages, now);
  const running = runningStages(data.stages, now);
  const last = lastPublishedStage(data.stages);
  const deadline = bonusDeadline(data.tour, data.stages);
  const myBonusCount = data.bonusTips.filter((b) => b.user_id === me.id).length;

  return (
    <>
      {phase === 'upcoming' ? null : myRow ? (
        <section className="hero" aria-label="Dein Stand">
          <span className="muted">{last ? `${data.tour.short_name} · nach Etappe\u00a0${last.number}` : data.tour.name}</span>
          <p className="hero__big">
            {myRow.total}
            <span className="hero__unit">Punkte</span>
          </p>
          <p className="hero__meta">
            {myRow.lastStagePoints !== null ? <span className="pos">+{myRow.lastStagePoints} zuletzt</span> : null}
            <span className="muted">
              Platz&nbsp;{myRow.rank} von&nbsp;{board.length}
              {myRow.prevRank !== null && myRow.prevRank !== myRow.rank
                ? ` · ${myRow.prevRank > myRow.rank ? '↑' : '↓'} ${Math.abs(myRow.prevRank - myRow.rank)}`
                : ''}
            </span>
          </p>
        </section>
      ) : null}

      {running.length ? <RunningCard stage={running[running.length - 1]} data={data} me={me} more={running.length - 1} /> : null}

      {next ? <NextStageCard stage={next} data={data} me={me} members={members} now={now} /> : null}

      {phase === 'upcoming' ? <BonusRow count={myBonusCount} deadline={deadline} now={now} /> : null}

      {!next && phase !== 'finished' && data.stages.length === 0 ? (
        <section className="card">
          <h2 className="card__title">Etappenplan folgt</h2>
          <p className="muted">Sobald die Etappen eingetragen sind, kannst du hier tippen.</p>
        </section>
      ) : null}

      {last ? <LastResultCard stage={last} data={data} me={me} /> : null}

      {phase === 'finished' ? <FinalCard data={data} board={board} /> : null}

      {phase !== 'upcoming' ? <Tiles data={data} me={me} next={next} /> : null}

      <GamesCard stageKind={todayStage?.kind ?? null} town={todayStage?.arrival ?? ''} />
    </>
  );
}

function dayLabel(stage: Stage, now: number): string {
  const diff = dayDiff(new Date(now), stage.starts_at);
  if (diff === 0) return `Heute · ${fmtDay(stage.starts_at)}`;
  if (diff === 1) return `Morgen · ${fmtDay(stage.starts_at)}`;
  return fmtDay(stage.starts_at);
}

function NextStageCard({ stage, data, me, members, now }: {
  stage: Stage; data: TourData; me: Profile; members: Profile[]; now: number;
}) {
  const myTip = data.tips.find((t) => t.stage_id === stage.id && t.user_id === me.id);
  const route = stageRoute(stage);
  return (
    <section className={cx('card tip-card', !myTip && 'card--accent')} aria-labelledby={`next-${stage.id}`}>
      <div className="card__row">
        <span className="eyebrow">{dayLabel(stage, now)}</span>
        <span className="time-chip" title="Tippschluss"><Icon name="clock" size={15} /><Countdown to={stage.starts_at} now={now} prefix="" /></span>
      </div>
      <Link to={`/etappe/${stage.id}`} className="card__link">
        <h2 id={`next-${stage.id}`} className="card__title">Etappe&nbsp;{stage.number}</h2>
        {route ? <p className="card__sub">{route}</p> : null}
      </Link>
      <div className="tip-facts">
        <KindChip stage={stage} />
        {stage.distance_km ? <span className="fact"><Icon name="flag" size={14} />{fmtKm(stage.distance_km)}</span> : null}
        <span className="fact"><Icon name="clock" size={14} />{fmtClock(stage.starts_at)}</span>
        <TipCount stage={stage} members={members} />
      </div>
      {myTip ? (
        <Link to={`/tipp/${stage.id}`} className="my-tip" ariaLabel={`Dein Tipp: ${riderName(data, myTip.rider_id)} – ändern`}>
          <Icon name="check" size={18} />
          <strong className="my-tip__name">{riderName(data, myTip.rider_id)}</strong>
          <Icon name="pencil" size={17} className="muted" />
        </Link>
      ) : (
        <LinkButton to={`/tipp/${stage.id}`} full>Jetzt tippen</LinkButton>
      )}
    </section>
  );
}

/** Wer schon getippt hat: Avatare und „3/3“ – die Tipps selbst bleiben bis zum Start verdeckt */
function TipCount({ stage, members }: { stage: Stage; members: Profile[] }) {
  const q = useQuery<string[]>(`tippers:${stage.id}`, () => source.stageTippers(stage.id));
  if (q.loading || !q.data) return null;
  const ids = new Set(q.data);
  const tipped = members.filter((m) => ids.has(m.id));
  return (
    <span className="fact tip-count" title={`${tipped.length} von ${members.length} getippt, sichtbar ab ${fmtClock(stage.starts_at)}`}>
      <span className="avatar-stack avatar-stack--sm" aria-hidden="true">
        {tipped.slice(0, 3).map((m) => <Avatar key={m.id} name={m.display_name} color={m.avatar_color} size={20} />)}
      </span>
      <span>{tipped.length}/{members.length}</span>
      <span className="sr-only">getippt</span>
    </span>
  );
}

/** Bonustipps als kompakte Zeile mit Fortschrittsring */
function BonusRow({ count, deadline, now }: { count: number; deadline: Date | string; now: number }) {
  const total = BONUS_CATEGORIES.length;
  const done = count >= total;
  const t = Math.min(1, count / total);
  return (
    <Link to="/bonus" className={cx('card card--row home-bonus', !done && 'card--accent')} ariaLabel={`Bonustipps: ${count} von ${total}`}>
      <span className="ring" style={{ ['--t' as string]: t.toFixed(3) }} aria-hidden="true">
        <Icon name={done ? 'check' : 'star'} size={18} />
      </span>
      <span className="card__main">
        <strong>Bonustipps</strong>
        <span className="muted">{done ? 'Alle abgegeben' : <>{count}/{total} · noch <Countdown to={deadline} now={now} prefix="" /></>}</span>
      </span>
      <Icon name="chevron" className="muted" />
    </Link>
  );
}

function RunningCard({ stage, data, me, more }: { stage: Stage; data: TourData; me: Profile; more: number }) {
  const myTip = data.tips.find((t) => t.stage_id === stage.id && t.user_id === me.id);
  return (
    <Link to={`/etappe/${stage.id}`} className="card card--row">
      <div className="card__main">
        <span className="eyebrow">Etappe&nbsp;{stage.number} · Ergebnis folgt</span>
        <strong>Tipps sind aufgedeckt</strong>
        <span className="muted">{myTip ? `Dein Tipp: ${riderName(data, myTip.rider_id)}` : 'Du hast nicht getippt'}</span>
        {more > 0 ? <span className="muted small">{more === 1 ? 'Eine weitere Etappe wartet' : `${more} weitere Etappen warten`} auf das Ergebnis.</span> : null}
      </div>
      <Icon name="chevron" className="muted" />
    </Link>
  );
}

function LastResultCard({ stage, data, me }: { stage: Stage; data: TourData; me: Profile }) {
  const scores = scoreStage(stage, data.tips, data.results, data.scale);
  const mine = scores.find((s) => s.userId === me.id);
  const winner = data.results.find((r) => r.stage_id === stage.id && r.position === 1);
  return (
    <Link to={`/etappe/${stage.id}`} className="card card--row">
      <div className="card__main">
        <span className="eyebrow">Zuletzt · Etappe&nbsp;{stage.number}</span>
        <strong>{winner ? `${lastName(riderName(data, winner.rider_id))} gewinnt` : 'Ergebnis veröffentlicht'}</strong>
        <span className="muted">
          {mine ? `Dein Tipp: ${lastName(riderName(data, mine.riderId))} · ${mine.position ? `${mine.position}. Platz` : 'nicht in den Top 10'}` : 'Kein Tipp abgegeben'}
        </span>
      </div>
      <span className={mine && mine.total > 0 ? 'points pos' : 'points muted'}>+{mine?.total ?? 0}</span>
      <Icon name="chevron" className="muted" />
    </Link>
  );
}

function Tiles({ data, me, next }: { data: TourData; me: Profile; next: Stage | null }) {
  const limit = tourTipLimit(data.tour);
  const usage = tipUsage(data.tips, me.id, next?.id);
  const near = data.riders
    .map((r) => ({ r, left: jokerRemaining(data.tour, r, data.tips, me.id, next?.id ?? -1), used: usage.get(r.id) ?? 0 }))
    .filter((x) => x.used > 0 && x.left !== null && x.left <= 1)
    .sort((a, b) => (a.left ?? 0) - (b.left ?? 0) || b.used - a.used)
    .slice(0, 3);
  const bonus = bonusScoresFor(data, me.id).reduce((s, b) => s + b.points, 0);
  return (
    <div className="tiles">
      {near.length ? (
        <div className="tile-card">
          <span className="muted">Noch tippbar</span>
          {near.map(({ r, left }) => (
            <span key={r.id} className="tile-card__line">
              <span>{lastName(r.name)}</span>
              <strong>{left}×</strong>
            </span>
          ))}
        </div>
      ) : limit !== null ? (
        <div className="tile-card">
          <span className="muted">Pro Fahrer</span>
          <span className="tile-card__big">{limit}×</span>
          <span className="muted">pro Rundfahrt</span>
        </div>
      ) : null}
      <Link to="/bonus" className="tile-card">
        <span className="muted">{data.tour.bonus_final ? 'Bonuspunkte' : 'Bonus-Hochrechnung'}</span>
        <span className="tile-card__big">{bonus}</span>
        <span className="muted">{data.tour.bonus_final ? 'Endstand' : 'wenn es so bleibt'}</span>
      </Link>
    </div>
  );
}

function FinalCard({ data, board }: { data: TourData; board: ReturnType<typeof leaderboard> }) {
  const top = board.slice(0, 3);
  return (
    <section className="card">
      <span className="eyebrow">{data.tour.name} · beendet</span>
      <h2 className="card__title">Endstand</h2>
      <ol className="mini-board">
        {top.map((r) => (
          <li key={r.userId}>
            <span className="mini-board__rank">{r.rank}.</span>
            <Avatar name={r.name} color={r.color} size={28} />
            <span className="mini-board__name">{r.name}</span>
            <strong>{r.total}</strong>
          </li>
        ))}
      </ol>
      <LinkButton to="/rangliste" variant="secondary" full>Zur Rangliste</LinkButton>
      {!data.tour.bonus_final ? <p className="hint">Die Bonuspunkte kommen dazu, sobald der Endstand eingetragen ist.</p> : null}
    </section>
  );
}
