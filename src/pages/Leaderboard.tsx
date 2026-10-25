import { useMemo, useState } from 'react';
import { useApp } from '../app/context';
import { useMembers, useNow, useTourData } from '../app/hooks';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import { leaderboard, seasonLeaderboard, type LeaderRow, type SeasonRow } from '../lib/scoring';
import { fmtDayTime, lastPublishedStage, sortStages } from '../lib/time';
import type { Profile, Stage, Tour, TourData } from '../lib/types';
import { Avatar, ProBadge, Empty, ErrorBox, Link, Loading, PageTitle, Segmented, cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';

export function Leaderboard() {
  useTitle('Rangliste');
  const { me, tour, tours } = useApp();
  const [tab, setTab] = useState<string | null>(null);
  const year = tour?.year;
  const yearTours = tours.filter((t) => t.year === year);
  const active = tab ?? tour?.id ?? 'season';

  if (!tour) return <><PageTitle title="Rangliste" /><Empty title="Noch keine Rundfahrt" /></>;

  const options = [...yearTours.map((t) => ({ value: t.id, label: t.short_name })), { value: 'season', label: 'Saison' }];
  return (
    <>
      <PageTitle title="Rangliste" subtitle={active === 'season' ? `Saison ${year}` : yearTours.find((t) => t.id === active)?.name} />
      <div className="stack">
        {options.length > 1 ? <Segmented label="Wertung wählen" value={active} onChange={setTab} options={options} /> : null}
        {active === 'season'
          ? <SeasonBoard tours={yearTours} me={me} />
          : <TourBoard tour={yearTours.find((t) => t.id === active) ?? tour} me={me} />}
      </div>
    </>
  );
}

function TourBoard({ tour, me }: { tour: Tour; me: Profile }) {
  const tourQ = useTourData(tour);
  const membersQ = useMembers();
  const now = useNow(60000);
  const data = tourQ.data;
  const members = membersQ.data;
  const rows = useMemo(() => (data && members ? leaderboard(data, members) : []), [data, members]);
  const next: Stage | undefined = data ? sortStages(data.stages).find((s) => new Date(s.starts_at).getTime() > now) : undefined;
  const tipQ = useQuery<string[]>(next ? `tippers:${next.id}` : null, () => source.stageTippers(next!.id));
  const tipped = tipQ.data ? new Set(tipQ.data) : null;

  if (tourQ.error || membersQ.error) return <ErrorBox error={tourQ.error ?? membersQ.error} onRetry={() => { tourQ.reload(); membersQ.reload(); }} />;
  if (!data || !members) return <Loading />;

  const last = lastPublishedStage(data.stages);
  const started = data.stages.some((s) => new Date(s.starts_at).getTime() <= now);
  if (!last && !started) {
    return <PreStartBoard members={members} next={next} tipped={tipped} me={me} />;
  }

  return (
    <>
      <p className="muted small">
        {rows.length} Teilnehmer · {last ? `Stand nach Etappe\u00a0${last.number}` : 'noch kein Ergebnis'}
        {data.tour.bonus_final ? ' · inkl. Bonuspunkte' : ' · Bonuspunkte kommen am Ende dazu'}
      </p>
      <Podium rows={rows.slice(0, 3)} me={me} next={next} tipped={tipped} />
      <ul className="list board-list">
        {rows.slice(3).map((r) => <BoardRow key={r.userId} row={r} me={me} next={next} tipped={tipped} />)}
      </ul>
      <BoardTable data={data} rows={rows} me={me} />
    </>
  );
}

function Podium({ rows, me, next, tipped }: { rows: LeaderRow[]; me: Profile; next?: Stage; tipped: Set<string> | null }) {
  if (!rows.length) return null;
  const order = rows.length >= 3 ? [rows[1], rows[0], rows[2]] : rows;
  return (
    <ol className="podium" aria-label="Podium">
      {order.map((r) => {
        const first = r === rows[0];
        return (
          <li key={r.userId} className={cx('podium__item', first && 'podium__item--first')}>
            <Link to={`/spieler/${r.userId}`} className="podium__link">
              <Avatar name={r.name} color={r.color} size={first ? 72 : 56} ring={first ? 'accent' : 'line'} />
              <span className="podium__name">{r.name}{r.userId === me.id ? ' (du)' : ''}</span>
              {r.isPro ? <ProBadge /> : null}
              <span className={cx('podium__pts', first && 'accent')}>{r.total} · {r.rank}.</span>
              {next && tipped ? <TipState next={next} done={tipped.has(r.userId)} short /> : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function Delta({ row }: { row: LeaderRow }) {
  if (row.prevRank === null || row.prevRank === row.rank) return <span className="delta muted" aria-label="unverändert">–</span>;
  const up = row.prevRank > row.rank;
  const n = Math.abs(row.prevRank - row.rank);
  return <span className={cx('delta', up ? 'pos' : 'neg')} aria-label={`${up ? 'aufgestiegen' : 'abgerutscht'} um ${n}`}>{up ? '↑' : '↓'} {n}</span>;
}

function TipState({ next, done, short }: { next: Stage; done: boolean; short?: boolean }) {
  const label = short ? '' : <>Etappe&nbsp;{next.number} </>;
  return done
    ? <span className="tip-state is-done"><Icon name="check" size={14} stroke={2.4} />{label}getippt</span>
    : <span className="tip-state">{label}offen</span>;
}

function BoardRow({ row, me, next, tipped }: { row: LeaderRow; me: Profile; next?: Stage; tipped: Set<string> | null }) {
  return (
    <li>
      <Link to={`/spieler/${row.userId}`} className={cx('person-row', row.userId === me.id && 'is-me')}>
        <span className="rank">{row.rank}</span>
        <Avatar name={row.name} color={row.color} size={36} />
        <span className="person-row__main">
          <span className="person-row__name">
            {row.name}{row.userId === me.id ? ' (du)' : ''}
            {row.isPro ? <ProBadge /> : null}
          </span>
          <span className="person-row__sub segs">
            {row.lastStagePoints !== null ? <span>+{row.lastStagePoints} zuletzt</span> : null}
            {row.bonusProjection && !row.bonusPoints ? <span>Bonus-Prognose {row.bonusProjection}</span> : null}
            {next && tipped ? <TipState next={next} done={tipped.has(row.userId)} /> : null}
          </span>
        </span>
        <Delta row={row} />
        <span className="points points--lg">{row.total}</span>
      </Link>
    </li>
  );
}

/** Vor dem ersten Start: alle Teilnehmer mit Tippstand für Etappe 1 */
function PreStartBoard({ members, next, tipped, me }: { members: Profile[]; next?: Stage; tipped: Set<string> | null; me: Profile }) {
  const list = members
    .filter((m) => m.is_member && m.display_name)
    .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'de', { sensitivity: 'base' }));
  const done = tipped ? list.filter((m) => tipped.has(m.id)).length : null;
  return (
    <>
      <p className="muted small">
        {list.length} Teilnehmer · noch keine Punkte
        {next ? <> · Etappe&nbsp;{next.number} startet {fmtDayTime(next.starts_at)}</> : null}
      </p>
      {next && done !== null ? (
        <p className="pre-board__count"><strong>{done} von&nbsp;{list.length}</strong> haben für Etappe&nbsp;{next.number} getippt</p>
      ) : null}
      <ul className="list">
        {list.map((m) => {
          const ok = tipped?.has(m.id);
          return (
            <li key={m.id}>
              <Link to={`/spieler/${m.id}`} className={cx('person-row', m.id === me.id && 'is-me')}>
                <Avatar name={m.display_name} color={m.avatar_color} size={36} />
                <span className="person-row__main">
                  <span className="person-row__name">
                    {m.display_name}{m.id === me.id ? ' (du)' : ''}
                    {m.is_pro ? <ProBadge /> : null}
                  </span>
                </span>
                {next && tipped ? (
                  <span className={cx('chip', ok && 'chip--accent')}>
                    {ok ? <><Icon name="check" size={14} stroke={2.4} />Getippt</> : 'Noch offen'}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Tabelle mit Punkten je Etappe – nur auf breiten Bildschirmen. */
function BoardTable({ data, rows, me }: { data: TourData; rows: LeaderRow[]; me: Profile }) {
  const stages = sortStages(data.stages);
  return (
    <div className="board-table">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col" className="left">Spieler</th>
              {stages.map((s) => (
                <th key={s.id} scope="col" className={cx('num st', !s.results_published && 'muted')}>E{s.number}</th>
              ))}
              <th scope="col" className="num">Bonus</th>
              <th scope="col" className="num">Gesamt</th>
              <th scope="col" className="num">±</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className={cx(r.userId === me.id && 'is-me')}>
                <td className="num muted">{r.rank}</td>
                <th scope="row" className="left">
                  <Link to={`/spieler/${r.userId}`} className="table-person">
                    <Avatar name={r.name} color={r.color} size={28} />
                    <span>{r.name}</span>
                    {r.isPro ? <ProBadge /> : null}
                  </Link>
                </th>
                {stages.map((s) => {
                  const sc = r.perStage.get(s.id);
                  if (!s.results_published) return <td key={s.id} className="num st muted">·</td>;
                  return (
                    <td key={s.id} className={cx('num st', sc && sc.total >= 20 && 'accent strong', !sc?.total && 'muted')}>
                      {sc ? sc.total : 0}
                    </td>
                  );
                })}
                <td className="num muted">{data.tour.bonus_final ? r.bonusPoints : `(${r.bonusProjection})`}</td>
                <td className="num strong">{r.total}</td>
                <td className="num"><Delta row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Bonus in Klammern = Hochrechnung, zählt erst nach dem Endstand.</p>
    </div>
  );
}

function SeasonBoard({ tours, me }: { tours: Tour[]; me: Profile }) {
  const membersQ = useMembers();
  const key = `season:${tours.map((t) => t.id).join(',')}`;
  const q = useQuery<TourData[]>(key, () => Promise.all(tours.map((t) => source.loadTourData(t))));
  const rows: SeasonRow[] = useMemo(() => {
    if (!q.data || !membersQ.data) return [];
    const boards = q.data.map((d) => ({ tourId: d.tour.id, rows: leaderboard(d, membersQ.data!) }));
    return seasonLeaderboard(boards, membersQ.data);
  }, [q.data, membersQ.data]);

  if (q.error || membersQ.error) return <ErrorBox error={q.error ?? membersQ.error} onRetry={q.reload} />;
  if (!q.data || !membersQ.data) return <Loading />;
  if (rows.every((r) => r.total === 0)) return <Empty icon="podium" title="Noch keine Punkte">Die Saisonwertung zählt alle Rundfahrten des Jahres zusammen.</Empty>;

  return (
    <>
      <p className="muted small">Summe aus {tours.map((t) => t.short_name).join(', ')}</p>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.userId}>
            <Link to={`/spieler/${r.userId}`} className={cx('person-row', r.userId === me.id && 'is-me')}>
              <span className="rank">{r.rank}</span>
              <Avatar name={r.name} color={r.color} size={36} />
              <span className="person-row__main">
                <span className="person-row__name">{r.name}{r.userId === me.id ? ' (du)' : ''}</span>
                <span className="person-row__sub">{tours.map((t) => `${t.short_name} ${r.perTour.get(t.id) ?? 0}`).join(' · ')}</span>
              </span>
              <span className="points points--lg">{r.total}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
