import { useMemo } from 'react';
import { TopBar, useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { berlinDayKey } from '../../game/abfahrt/rng';
import { ALTS, BUILT, INTRO_INFO, plan, type IntroId } from '../../intro/schedule';

/** Start-Animation ansehen: Seite mit ?intro=… neu laden (die App nimmt den Parameter danach wieder heraus) */
function preview(id: string) {
  const u = new URL(location.href);
  u.searchParams.set('intro', id);
  u.hash = '#/';
  location.href = u.toString();
}

const fmt = (key: string) => {
  const [, m, d] = key.split('-').map(Number);
  return `${d}.${m}.`;
};

const RACE_KINDS: [string, string][] = [
  ['mountain', 'Bergetappe'], ['hilly', 'Hügelig'], ['flat', 'Flach'], ['itt', 'Einzelzeitfahren'], ['ttt', 'Mannschaftszeitfahren'],
  ['start', '1. Etappe'], ['last', 'Schlussetappe'],
];

export function AdminIntro() {
  useTitle('Start-Animationen');
  const today = berlinDayKey();
  const upcoming = useMemo(() => plan(today, 190), [today]);
  const when = (id: IntroId): string => {
    if (id === 'base') return 'Normalfall';
    if (ALTS.includes(id)) return 'Jedes dritte Öffnen, reihum';
    if (id === 'renntag') return 'An Tagen mit Etappe';
    const p = upcoming.filter((s) => s.id === id);
    if (!p.length) return '';
    if (id === 'advent') return p.map((s) => `${s.p}. Advent ${fmt(s.from)}–${fmt(s.to)}`).join(' · ');
    return p.map((s) => (s.from === s.to ? fmt(s.from) : `${fmt(s.from)}–${fmt(s.to)}`)).join(' · ');
  };
  const order: IntroId[] = ['base', ...ALTS, 'renntag', ...upcoming.map((s) => s.id).filter((v, i, a) => a.indexOf(v) === i)];
  return (
    <>
      <TopBar title="Start-Animationen" back="/admin" />
      <div className="stack">
        <p className="hint">
          Beim Öffnen der App rollt der Punkt das Wort aus. Jedes dritte Öffnen kommt eine andere Animation, in
          Themenwochen und an Feiertagen eine passende, an Renntagen eine mit der Etappe. Am ersten Start eines
          Tages läuft immer das Thema des Tages. Tippe auf eine Animation, um sie anzusehen.
        </p>
        <ul className="list admin-list">
          {order.map((id) => (
            <li key={id}>
              {id === 'advent' ? (
                <div className="card">
                  <span className="card__main">
                    <strong>{INTRO_INFO[id].name}</strong>
                    <span className="muted">{INTRO_INFO[id].desc}</span>
                    <span className="small accent">{when(id)}</span>
                  </span>
                  <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    {[1, 2, 3, 4].map((n) => (
                      <button key={n} type="button" className="chip chip--accent" onClick={() => preview(`advent:${n}`)}>{n}. Advent</button>
                    ))}
                  </div>
                </div>
              ) : id === 'renntag' ? (
                <div className="card">
                  <span className="card__main">
                    <strong>{INTRO_INFO[id].name}</strong>
                    <span className="muted">{INTRO_INFO[id].desc}</span>
                    <span className="small accent">{when(id)}</span>
                  </span>
                  <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    {RACE_KINDS.map(([k, label]) => (
                      <button key={k} type="button" className="chip chip--accent" onClick={() => preview(`renntag:${k}`)}>{label}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <button type="button" className="card card--row" style={{ width: '100%', textAlign: 'left' }} onClick={() => preview(id)}>
                  <span className="card__main">
                    <strong>{INTRO_INFO[id].name}</strong>
                    <span className="muted">{INTRO_INFO[id].desc}</span>
                    {when(id) ? <span className="small accent">{when(id)}</span> : null}
                    {BUILT.includes(id) ? null : <span className="small muted">kommt noch – bis dahin das gewohnte Intro</span>}
                  </span>
                  <Icon name="chevron" className="muted" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
