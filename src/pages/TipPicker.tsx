import { useMemo, useState } from 'react';
import { useTourContext } from '../app/context';
import { useFavorites, useNow } from '../app/hooks';
import { FavStar, RiderSheet } from '../ui/RiderSheet';
import type { ReactNode } from 'react';
import { source } from '../app/config';
import { invalidate } from '../app/query';
import { navigate } from '../app/router';
import { jokerRemaining, tipLimit, tipUsage, tourTipLimit } from '../lib/scoring';
import { normalize } from '../lib/pcsParse';
import { KIND_SHORT, fmtDay, stageState, fmtClock } from '../lib/time';
import type { Rider } from '../lib/types';
import { Button, Countdown, Empty, ErrorBox, LinkButton, Loading, Notice, TopBar, cx, toast, useAction, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { ProfileDetails } from '../ui/StageProfile';
import { flag } from '../lib/countries';
import { lastName } from '../ui/bits';

export function TipPicker({ id }: { id: number }) {
  const { me, data, loading, error, reload } = useTourContext();
  const now = useNow(5000);
  const stage = data?.stages.find((s) => s.id === id);
  useTitle(stage ? `Etappe\u00a0${stage.number} tippen` : 'Tippen');
  const current = data?.tips.find((t) => t.stage_id === id && t.user_id === me.id) ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const save = useAction();
  const fav = useFavorites();
  const [openSheet, setOpenSheet] = useState<number | null>(null);

  const selected = picked ?? current?.rider_id ?? null;

  const riders = useMemo(() => {
    if (!data) return [];
    const q = normalize(query);
    const list = data.riders.filter((r) => {
      if (!q) return true;
      const hay = normalize(`${r.name} ${r.team} ${r.bib ?? ''}`);
      return q.split(' ').every((part) => hay.includes(part));
    });
    return list.sort((a, b) => (a.status === b.status ? 0 : a.status === 'out' ? 1 : -1));
  }, [data, query]);

  if (error) return <><TopBar title="Tippen" back="/etappen" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data) return <><TopBar title="Tippen" back="/etappen" /><Loading /></>;
  if (!stage) return <><TopBar title="Tippen" back="/etappen" /><Empty title="Etappe nicht gefunden" /></>;

  const back = `/etappe/${stage.id}`;
  if (stageState(stage, now) !== 'open') {
    return (
      <>
        <TopBar title={`Etappe\u00a0${stage.number}`} back={back} />
        <Empty icon="lock" title="Tippschluss ist vorbei">
          <p>Die Etappe ist um {fmtClock(stage.starts_at)} gestartet.</p>
          <LinkButton to={back} variant="secondary">Zur Etappe</LinkButton>
        </Empty>
      </>
    );
  }

  const usage = tipUsage(data.tips, me.id, stage.id);
  const favRiders = query.trim() ? [] : riders.filter((r) => fav.has(r));
  // Nur Fahrer zeigen, bei denen es knapp wird (höchstens noch 1 Tipp übrig)
  const used = data.riders
    .filter((r) => (usage.get(r.id) ?? 0) > 0 && (jokerRemaining(data.tour, r, data.tips, me.id, stage.id) ?? 99) <= 1)
    .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'de'))
    .slice(0, 6);
  const defaultLimit = tourTipLimit(data.tour);
  const pickedRider = data.riders.find((r) => r.id === selected) ?? null;
  const unchanged = selected !== null && selected === current?.rider_id;
  const remainingAfter = pickedRider ? jokerRemaining(data.tour, pickedRider, data.tips, me.id, stage.id) : null;

  const onSave = () => {
    if (selected === null) return;
    save.run(async () => {
      await source.saveStageTip(stage.id, selected);
      invalidate(`tour:${stage.tour_id}`);
      invalidate(`tippers:${stage.id}`);
      toast(`Tipp gespeichert: ${pickedRider ? lastName(pickedRider.name) : ''}`);
      navigate(back, { replace: true });
    });
  };

  let note = `Bis ${fmtClock(stage.starts_at)} jederzeit änderbar`;
  if (pickedRider && remainingAfter !== null && !unchanged) {
    const left = Math.max(0, remainingAfter - 1);
    note = left === 0
      ? `Dein letzter Tipp auf ${lastName(pickedRider.name)} in dieser Rundfahrt`
      : `Danach kannst du ${lastName(pickedRider.name)} noch ${left}× tippen`;
  }

  return (
    <>
      <TopBar title={`Etappe\u00a0${stage.number} tippen`} subtitle={`${fmtDay(stage.starts_at)} · ${KIND_SHORT[stage.kind]} · Start ${fmtClock(stage.starts_at)}`} back={back} />
      <div className="stack">
        <Notice icon="lock">
          <strong>Verdeckt bis {fmtClock(stage.starts_at)}</strong>
          <span>Die anderen sehen deinen Tipp erst ab dem Start · <Countdown to={stage.starts_at} now={now} /></span>
        </Notice>

        <ProfileDetails stage={stage} />

        {defaultLimit !== null ? (
          <p className="muted small">Jeden Fahrer darfst du höchstens {defaultLimit}× pro Rundfahrt tippen.</p>
        ) : null}
        {used.length ? (
          <div className="joker-row" aria-label="Schon getippte Fahrer">
            {used.map((r) => {
              const left = jokerRemaining(data.tour, r, data.tips, me.id, stage.id) ?? 0;
              return (
                <span key={r.id} className={cx('joker', left === 0 && 'joker--empty')}>
                  <span className="joker__name">{lastName(r.name)}</span>
                  <span className="joker__left">{left === 0 ? 'aufgebraucht' : `noch ${left}`}</span>
                </span>
              );
            })}
          </div>
        ) : null}

        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr-only">Fahrer suchen</span>
          <input
            type="search"
            placeholder="Fahrer oder Team suchen"
            value={query}
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            autoComplete="off"
            enterKeyHint="search"
          />
        </label>

        {data.riders.length === 0 ? (
          <Empty title="Startliste fehlt">Der Admin muss die Startliste noch eintragen.</Empty>
        ) : riders.length === 0 ? (
          <p className="muted center">Kein Fahrer gefunden.</p>
        ) : (
          <>
            {[{ title: 'Deine Favoriten', list: favRiders }, { title: favRiders.length ? 'Alle Fahrer' : null, list: riders }]
              .filter((g) => g.list.length)
              .map((g) => (
                <section key={g.title ?? 'all'} aria-label={g.title ?? 'Fahrer auswählen'}>
                  {g.title ? <h2 className="section-title">{g.title === 'Deine Favoriten' ? '★ ' : ''}{g.title}</h2> : null}
                  <ul className="list rider-list">
                    {g.list.map((r) => (
                      <RiderOption
                        key={r.id}
                        rider={r}
                        selected={r.id === selected}
                        remaining={jokerRemaining(data.tour, r, data.tips, me.id, stage.id)}
                        limit={tipLimit(data.tour, r)}
                        onPick={() => setPicked(r.id)}
                        expanded={openSheet === r.id}
                        onToggleSheet={() => setOpenSheet(openSheet === r.id ? null : r.id)}
                        sheet={openSheet === r.id ? <RiderSheet rider={r} data={data} now={now} meId={me.id} /> : null}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </>
        )}
      </div>

      {data.riders.length === 0 ? null : <div className="cta-bar">
        <div className="cta-bar__inner">
          {save.error ? <ErrorBox error={save.error} /> : <p className="cta-bar__note">{selected === null ? 'Wähle einen Fahrer aus der Liste' : note}</p>}
          <Button full onClick={onSave} busy={save.busy} disabled={selected === null || unchanged}>
            {selected === null ? 'Fahrer wählen' : unchanged ? `${lastName(pickedRider?.name ?? '')} ist getippt` : `${lastName(pickedRider?.name ?? '')} tippen`}
          </Button>
        </div>
      </div>}
    </>
  );
}

function RiderOption({ rider, selected, remaining, limit, onPick, expanded, onToggleSheet, sheet }: {
  rider: Rider;
  selected: boolean;
  remaining: number | null;
  limit: number | null;
  onPick: () => void;
  expanded: boolean;
  onToggleSheet: () => void;
  sheet: ReactNode;
}) {
  const out = rider.status === 'out';
  const exhausted = remaining === 0;
  const disabled = out || exhausted;
  let tag: string | null = null;
  if (out) tag = 'ausgestiegen';
  else if (exhausted) tag = 'Limit erreicht';
  else if (remaining !== null && limit !== null && remaining < limit) tag = `noch ${remaining}× tippbar`;
  return (
    <li>
    <div className="rider-row">
      <button
        type="button"
        className={cx('rider-option', selected && 'is-selected')}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onPick}
      >
        <span className="radio" aria-hidden="true"><span /></span>
        <span className="rider-option__bib">{rider.bib ?? ''}</span>
        <span className="rider-option__main">
          <span className="rider-option__name">{rider.name}</span>
          <span className="rider-option__team">
            {rider.nationality ? <span className="rider-option__flag" aria-hidden="true">{flag(rider.nationality)}</span> : null}
            {rider.team}{rider.young ? ' · Nachwuchs' : ''}
          </span>
          {tag ? <span className={cx('chip', !disabled && 'chip--accent')}>{tag}</span> : null}
        </span>
      </button>
      <div className="rider-row__side">
        <FavStar rider={rider} />
        <button type="button" className={cx('rider-info', expanded && 'is-open')} aria-expanded={expanded}
          aria-label={`Steckbrief von ${rider.name}`} onClick={onToggleSheet}>
          <Icon name="info" size={20} />
        </button>
      </div>
    </div>
    {sheet}
    </li>
  );
}
