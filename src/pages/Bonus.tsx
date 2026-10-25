import { useMemo, useState } from 'react';
import { useTourContext } from '../app/context';
import { useNow } from '../app/hooks';
import { source } from '../app/config';
import { invalidate } from '../app/query';
import { navigate } from '../app/router';
import { BONUS_POINTS, bonusScoresFor, bonusStandings } from '../lib/scoring';
import { CATEGORY_INFO, categoryTitle } from '../lib/categories';
import { normalize } from '../lib/pcsParse';
import { bonusDeadline, fmtDayTime } from '../lib/time';
import { BONUS_CATEGORIES, type BonusCategory, type Profile, type TourData } from '../lib/types';
import {
  Button, Countdown, Empty, ErrorBox, JerseyTile, Link, Loading, Notice, PageTitle, Segmented, TopBar, cx, toast,
  useAction, useTitle,
} from '../ui/kit';
import { Icon } from '../ui/Icon';
import { TourPicker } from '../ui/Shell';
import { lastName, riderName } from '../ui/bits';

function excludedNames(data: TourData): string {
  const names = data.riders.filter((r) => r.excluded_from_rest).map((r) => lastName(r.name));
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

function pickLabel(data: TourData, riderId: number | null, team: string | null): string {
  return team ?? riderName(data, riderId);
}

export function Bonus() {
  useTitle('Bonustipps');
  const { me, tour, tours, data, members, loading, error, reload } = useTourContext();
  const now = useNow();
  const [view, setView] = useState<'mine' | 'all'>('mine');

  if (!tour) return <><PageTitle title="Bonustipps" /><Empty title="Noch keine Rundfahrt" /></>;
  if (error) return <><PageTitle title="Bonustipps" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data || !members) return <><PageTitle title="Bonustipps" /><Loading /></>;

  const deadline = bonusDeadline(data.tour, data.stages);
  const open = now < deadline.getTime();
  const myTips = data.bonusTips.filter((b) => b.user_id === me.id);

  return (
    <>
      <PageTitle title="Bonustipps" subtitle={`${myTips.length} von ${BONUS_CATEGORIES.length} getippt`} />
      <div className="stack">
        <TourPicker tour={tour} tours={tours} />
        {open ? (
          <Notice icon="clock">
            <strong>Offen bis {fmtDayTime(deadline)}</strong>
            <span>Danach sind die Tipps gesperrt und für alle sichtbar · <Countdown to={deadline} now={now} /></span>
          </Notice>
        ) : (
          <>
            <Notice icon="lock">Gesperrt seit {fmtDayTime(deadline)} – dem Start von Etappe&nbsp;1.</Notice>
            <Segmented
              label="Ansicht"
              value={view}
              onChange={setView}
              options={[{ value: 'mine', label: 'Meine Tipps' }, { value: 'all', label: 'Alle Tipps' }]}
            />
          </>
        )}
        {open || view === 'mine' ? <MyBonus data={data} me={me} open={open} /> : <AllBonus data={data} members={members} me={me} />}
      </div>
    </>
  );
}

function MyBonus({ data, me, open }: { data: TourData; me: Profile; open: boolean }) {
  const standings = useMemo(() => bonusStandings(data), [data]);
  const scores = useMemo(() => bonusScoresFor(data, me.id, standings), [data, me.id, standings]);
  const total = scores.reduce((s, b) => s + b.points, 0);
  const theme = data.tour.theme;
  const excluded = excludedNames(data);

  return (
    <>
      {!open ? (
        <section className="card">
          <div className="card__row">
            <span className="eyebrow">{data.tour.bonus_final ? 'Endstand' : 'Hochrechnung'}</span>
            <span className="muted small">1. = 15 · 2. = 10 · 3. = 5</span>
          </div>
          <p className="hero__big">{total}<span className="hero__unit">von {BONUS_CATEGORIES.length * 15}</span></p>
          <p className="muted">{data.tour.bonus_final ? 'Diese Punkte zählen in der Rangliste.' : 'Zählt erst am Ende – wenn die Wertungen so bleiben wie jetzt.'}</p>
        </section>
      ) : null}
      <ul className="list bonus-list">
        {BONUS_CATEGORIES.map((cat) => {
          const tip = data.bonusTips.find((b) => b.user_id === me.id && b.category === cat);
          const score = scores.find((s) => s.category === cat);
          const hasStanding = standings.some((s) => s.category === cat);
          const content = (
            <>
              <JerseyTile category={cat} theme={theme} />
              <span className="bonus-row__main">
                <span className="bonus-row__cat">{categoryTitle(cat, theme)}</span>
                <span className={cx('bonus-row__pick', !tip && 'accent')}>{tip ? pickLabel(data, tip.rider_id, tip.team) : open ? 'Noch nicht getippt' : 'Kein Tipp'}</span>
                {cat === 'rest' && excluded ? <span className="bonus-row__hint">ohne {excluded}</span> : null}
              </span>
              {open ? (
                <Icon name="chevron" className="muted" />
              ) : (
                <span className="bonus-row__side">
                  <span className="muted small">{!tip ? '' : score?.position ? `aktuell ${score.position}.` : hasStanding ? 'nicht Top 3' : 'offen'}</span>
                  {tip ? <span className={cx('chip', score && score.points > 0 && 'chip--accent')}>{score && score.points > 0 ? `+${score.points}` : hasStanding ? '0' : '–'}</span> : null}
                </span>
              )}
            </>
          );
          return (
            <li key={cat}>
              {open ? <Link to={`/bonus/${cat}`} className="bonus-row">{content}</Link> : <div className="bonus-row">{content}</div>}
            </li>
          );
        })}
      </ul>
      <p className="hint">„Meiste Etappensiege“ berechnet die App selbst. Beim „Kämpferischsten Fahrer“ gibt es meist nur einen Preisträger.</p>
    </>
  );
}

function AllBonus({ data, members, me }: { data: TourData; members: Profile[]; me: Profile }) {
  const theme = data.tour.theme;
  return (
    <div className="stack">
      {BONUS_CATEGORIES.map((cat) => {
        const tips = data.bonusTips.filter((b) => b.category === cat);
        const groups = new Map<string, string[]>();
        for (const t of tips) {
          const label = pickLabel(data, t.rider_id, t.team);
          const m = members.find((x) => x.id === t.user_id);
          if (!m) continue;
          groups.set(label, [...(groups.get(label) ?? []), m.id === me.id ? `${m.display_name} (du)` : m.display_name!]);
        }
        const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'de'));
        return (
          <section key={cat} className="card">
            <div className="card__head">
              <JerseyTile category={cat} theme={theme} size={32} />
              <h2 className="card__h">{categoryTitle(cat, theme)}</h2>
            </div>
            {sorted.length === 0 ? <p className="muted">Keine Tipps.</p> : (
              <ul className="group-list">
                {sorted.map(([label, names]) => (
                  <li key={label}>
                    <div className="group-row__head"><strong>{label}</strong><span className="chip">{names.length}×</span></div>
                    <p className="group-row__names muted">{names.join(', ')}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Auswahl für eine Bonuswertung (Fahrer oder Team). */
export function BonusPicker({ category }: { category: BonusCategory }) {
  const { me, data, loading, error, reload } = useTourContext();
  const now = useNow();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const save = useAction();
  const remove = useAction();
  const info = CATEGORY_INFO[category];
  useTitle(info ? info.label : 'Bonustipp');

  if (!info) return <><TopBar title="Bonustipp" back="/bonus" /><Empty title="Unbekannte Wertung" /></>;
  if (error) return <><TopBar title={info.label} back="/bonus" /><ErrorBox error={error} onRetry={reload} /></>;
  if (loading || !data) return <><TopBar title={info.label} back="/bonus" /><Loading /></>;

  const deadline = bonusDeadline(data.tour, data.stages);
  if (now >= deadline.getTime()) {
    return <><TopBar title={info.label} back="/bonus" /><Empty icon="lock" title="Bonustipps sind gesperrt">Seit dem Start von Etappe&nbsp;1 kann nichts mehr geändert werden.</Empty></>;
  }

  const current = data.bonusTips.find((b) => b.user_id === me.id && b.category === category);
  const currentKey = current ? (current.team ? `t:${current.team}` : `r:${current.rider_id}`) : null;
  const selected = picked ?? currentKey;
  const q = normalize(query);
  const isTeam = category === 'team';

  const options: { key: string; title: string; sub: string; disabled?: string }[] = isTeam
    ? [...new Set(data.riders.map((r) => r.team))].sort((a, b) => a.localeCompare(b, 'de'))
      .map((team) => ({ key: `t:${team}`, title: team, sub: `${data.riders.filter((r) => r.team === team).length} Fahrer` }))
    : data.riders.map((r) => ({
      key: `r:${r.id}`,
      title: r.name,
      sub: r.team,
      disabled: category === 'rest' && r.excluded_from_rest ? 'ausgeklammert' : undefined,
    }));
  const filtered = options.filter((o) => !q || q.split(' ').every((part) => normalize(`${o.title} ${o.sub}`).includes(part)));
  const selectedOption = options.find((o) => o.key === selected);

  const onSave = () => {
    if (!selected) return;
    save.run(async () => {
      const [kind, value] = [selected.slice(0, 1), selected.slice(2)];
      await source.saveBonusTip(data.tour.id, category, kind === 'r' ? Number(value) : null, kind === 't' ? value : null);
      invalidate(`tour:${data.tour.id}`);
      toast('Bonustipp gespeichert');
      navigate('/bonus', { replace: true });
    });
  };

  const onRemove = () => remove.run(async () => {
    await source.deleteBonusTip(data.tour.id, category);
    invalidate(`tour:${data.tour.id}`);
    toast('Bonustipp entfernt');
    navigate('/bonus', { replace: true });
  });

  return (
    <>
      <TopBar
        title={info.label}
        subtitle={info.jersey?.[data.tour.theme] ?? data.tour.name}
        back="/bonus"
        action={current ? <button type="button" className="text-btn" onClick={onRemove} disabled={remove.busy}>Entfernen</button> : undefined}
      />
      <div className="stack">
        <p className="muted">
          Platz 1, 2 oder 3 am Ende der Rundfahrt bringt {BONUS_POINTS[1]}, {BONUS_POINTS[2]} oder {BONUS_POINTS[3]} Punkte.
          {category === 'rest' && excludedNames(data) ? ` Gewertet wird die Gesamtwertung ohne ${excludedNames(data)}.` : ''}
          {info.hint && category !== 'rest' ? ` ${info.hint}.` : ''}
        </p>
        {remove.error ? <ErrorBox error={remove.error} /> : null}
        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr-only">{isTeam ? 'Team suchen' : 'Fahrer suchen'}</span>
          <input type="search" placeholder={isTeam ? 'Team suchen' : 'Fahrer oder Team suchen'} value={query}
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)} autoComplete="off" />
        </label>
        {options.length === 0 ? <Empty title="Startliste fehlt">Der Admin muss die Startliste noch eintragen.</Empty> : (
          <ul className="list rider-list">
            {filtered.map((o) => (
              <li key={o.key}>
                <button type="button" className={cx('rider-option', o.key === selected && 'is-selected')} aria-pressed={o.key === selected}
                  disabled={!!o.disabled} onClick={() => setPicked(o.key)}>
                  <span className="radio" aria-hidden="true"><span /></span>
                  <span className="rider-option__main">
                    <span className="rider-option__name">{o.title}</span>
                    <span className="rider-option__team">{o.sub}</span>
                  </span>
                  {o.disabled ? <span className="chip">{o.disabled}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {options.length === 0 ? null : <div className="cta-bar">
        <div className="cta-bar__inner">
          {save.error ? <ErrorBox error={save.error} /> : <p className="cta-bar__note">Änderbar bis {fmtDayTime(deadline)}</p>}
          <Button full onClick={onSave} busy={save.busy} disabled={!selected || selected === currentKey}>
            {!selectedOption ? 'Auswahl treffen' : selected === currentKey ? 'Gespeichert' : `${isTeam ? selectedOption.title : lastName(selectedOption.title)} speichern`}
          </Button>
        </div>
      </div>}
    </>
  );
}
