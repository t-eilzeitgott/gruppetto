import { useMemo } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { bonusScoresFor, jokerUsage, leaderboard } from '../lib/scoring';
import { categoryTitle } from '../lib/categories';
import { bonusDeadline, nextOpenStage, sortStages, fmtClock } from '../lib/time';
import { BONUS_CATEGORIES } from '../lib/types';
import { Avatar, ProBadge, Empty, ErrorBox, JerseyTile, Link, Loading, TopBar, cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { lastName, riderName } from '../ui/bits';

export function Player({ id }: { id: string }) {
  const { me, data, members, loading, error, reload } = useTourContext();
  const now = useNow(60000);
  const member = members?.find((m) => m.id === id);
  useTitle(member?.display_name ?? 'Spieler');
  const board = useMemo(() => (data && members ? leaderboard(data, members) : []), [data, members]);

  if (error) return <><TopBar title="Spielerprofil" back="/rangliste" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data || !members) return <><TopBar title="Spielerprofil" back="/rangliste" /><Loading /></>;
  if (!member) return <><TopBar title="Spielerprofil" back="/rangliste" /><Empty icon="user" title="Spieler nicht gefunden" /></>;

  const row = board.find((r) => r.userId === id);
  const isMe = id === me.id;
  const published = data.stages.filter((s) => s.results_published);
  const tipped = published.filter((s) => row?.perStage.has(s.id)).length;
  const avg = tipped ? (row!.stagePoints / tipped) : 0;
  const jokers = data.riders.filter((r) => r.tip_limit !== null);
  const usage = jokerUsage(data.tips, data.riders, id);
  const next = nextOpenStage(data.stages, now);
  const stages = sortStages(data.stages).reverse()
    .filter((s) => new Date(s.starts_at).getTime() <= now || (isMe && data.tips.some((t) => t.stage_id === s.id && t.user_id === id)));
  const bonusVisible = isMe || now >= bonusDeadline(data.tour, data.stages).getTime();
  const bonusScores = bonusScoresFor(data, id);

  return (
    <>
      <TopBar title="Spielerprofil" back="/rangliste" />
      <div className="stack">
        <section className="profile-hero">
          <Avatar name={member.display_name} color={member.avatar_color} size={80} ring="accent" />
          <h2 className="profile-hero__name">{member.display_name}{isMe ? ' (du)' : ''}</h2>
          {member.is_pro ? <ProBadge large /> : null}
          {row ? <p>Platz&nbsp;{row.rank} · {row.total} Punkte</p> : null}
          {row && row.lastStagePoints !== null ? <p className="muted small">+{row.lastStagePoints} auf der letzten Etappe</p> : null}
        </section>

        <div className="stat-grid">
          <div className="stat"><strong>{row?.winnersHit ?? 0}</strong><span>Sieger getippt</span></div>
          <div className="stat"><strong>{avg.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</strong><span>Ø pro Etappe</span></div>
          <div className="stat"><strong>{row?.underdogHits ?? 0}×</strong><span>Außenseiter-Bonus</span></div>
        </div>
        {jokers.length ? (
          <p className="muted small center">
            Joker genutzt: {jokers.map((r) => `${lastName(r.name)} ${usage.get(r.id) ?? 0}/${r.tip_limit}`).join(' · ')}
          </p>
        ) : null}

        <section aria-labelledby="player-tips">
          <h2 id="player-tips" className="section-title">Etappentipps</h2>
          <ul className="list">
            {next && !isMe ? (
              <li className="tip-row">
                <span className="tip-row__stage">E{next.number}</span>
                <span className="tip-row__main muted"><Icon name="eyeOff" size={18} /> Verdeckt bis {fmtClock(next.starts_at)}</span>
              </li>
            ) : null}
            {stages.length === 0 && !next ? <li className="muted">Noch keine Etappe gestartet.</li> : null}
            {stages.map((s) => {
              const tip = data.tips.find((t) => t.stage_id === s.id && t.user_id === id);
              const score = row?.perStage.get(s.id);
              return (
                <li key={s.id}>
                  <Link to={`/etappe/${s.id}`} className="tip-row">
                    <span className="tip-row__stage">E{s.number}</span>
                    <span className="tip-row__main">
                      {tip ? (
                        <>
                          <span>{riderName(data, tip.rider_id)}</span>
                          {score?.position ? <span className="muted"> · {score.position}.</span> : null}
                        </>
                      ) : <span className="muted">kein Tipp</span>}
                    </span>
                    {score?.bonus ? <span className="chip chip--accent">+{score.bonus}</span> : null}
                    <span className={cx('points', !score?.total && 'muted')}>
                      {s.results_published ? `+${score?.total ?? 0}` : new Date(s.starts_at).getTime() > now ? 'offen' : '…'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="player-bonus">
          <h2 id="player-bonus" className="section-title">Bonustipps</h2>
          {!bonusVisible ? (
            <p className="muted">Sichtbar ab dem Start von Etappe&nbsp;1.</p>
          ) : (
            <ul className="list">
              {BONUS_CATEGORIES.map((cat) => {
                const tip = data.bonusTips.find((b) => b.user_id === id && b.category === cat);
                const sc = bonusScores.find((b) => b.category === cat);
                return (
                  <li key={cat} className="bonus-row">
                    <JerseyTile category={cat} theme={data.tour.theme} size={32} />
                    <span className="bonus-row__main">
                      <span className="bonus-row__cat">{categoryTitle(cat, data.tour.theme)}</span>
                      <span className="bonus-row__pick">{tip ? tip.team ?? riderName(data, tip.rider_id) : '–'}</span>
                    </span>
                    {sc && sc.points > 0 ? <span className="chip chip--accent">+{sc.points}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
