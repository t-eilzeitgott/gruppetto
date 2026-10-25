import { useMemo, useState } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { source } from '../app/config';
import { invalidate } from '../app/query';
import { navigate } from '../app/router';
import { jokerRemaining } from '../lib/scoring';
import { normalize } from '../lib/pcsParse';
import { KIND_SHORT, fmtDay, stageState, fmtClock } from '../lib/time';
import type { Rider } from '../lib/types';
import { Button, Countdown, Empty, ErrorBox, LinkButton, Loading, Notice, TopBar, cx, toast, useAction, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
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

  const limited = data.riders.filter((r) => r.tip_limit !== null);
  const pickedRider = data.riders.find((r) => r.id === selected) ?? null;
  const unchanged = selected !== null && selected === current?.rider_id;
  const remainingAfter = pickedRider ? jokerRemaining(pickedRider, data.tips, me.id, stage.id) : null;

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
    note = `Nutzt einen ${lastName(pickedRider.name)}-Joker · danach noch ${Math.max(0, remainingAfter - 1)} übrig`;
  }

  return (
    <>
      <TopBar title={`Etappe\u00a0${stage.number} tippen`} subtitle={`${fmtDay(stage.starts_at)} · ${KIND_SHORT[stage.kind]} · Start ${fmtClock(stage.starts_at)}`} back={back} />
      <div className="stack">
        <Notice icon="lock">
          <strong>Verdeckt bis {fmtClock(stage.starts_at)}</strong>
          <span>Die anderen sehen deinen Tipp erst ab dem Start · <Countdown to={stage.starts_at} now={now} /></span>
        </Notice>

        {limited.length ? (
          <div className="joker-row" aria-label="Joker-Limit">
            {limited.map((r) => {
              const left = jokerRemaining(r, data.tips, me.id, stage.id) ?? 0;
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
          <ul className="list rider-list" aria-label="Fahrer auswählen">
            {riders.map((r) => (
              <RiderOption
                key={r.id}
                rider={r}
                selected={r.id === selected}
                remaining={jokerRemaining(r, data.tips, me.id, stage.id)}
                onPick={() => setPicked(r.id)}
              />
            ))}
          </ul>
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

function RiderOption({ rider, selected, remaining, onPick }: {
  rider: Rider;
  selected: boolean;
  remaining: number | null;
  onPick: () => void;
}) {
  const out = rider.status === 'out';
  const exhausted = remaining === 0;
  const disabled = out || exhausted;
  let tag: string | null = null;
  if (out) tag = 'ausgestiegen';
  else if (exhausted) tag = 'Limit erreicht';
  else if (remaining !== null) tag = `Joker · noch ${remaining}`;
  return (
    <li>
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
          <span className="rider-option__team">{rider.team}</span>
          {tag ? <span className={cx('chip', !disabled && 'chip--accent')}>{tag}</span> : null}
        </span>
      </button>
    </li>
  );
}
