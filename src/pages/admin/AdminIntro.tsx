import { TopBar, useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { ALTS, INTRO_INFO, type IntroId } from '../../intro/schedule';

/** Start-Animation ansehen: Seite mit ?intro=… neu laden (die App nimmt den Parameter danach wieder heraus) */
function preview(id: string) {
  const u = new URL(location.href);
  u.searchParams.set('intro', id);
  u.hash = '#/';
  location.href = u.toString();
}

const RACE_KINDS: [string, string][] = [
  ['mountain', 'Bergetappe'], ['hilly', 'Hügelig'], ['flat', 'Flach'], ['itt', 'Einzelzeitfahren'], ['ttt', 'Mannschaftszeitfahren'],
  ['start', '1. Etappe'], ['last', 'Schlussetappe'],
];

export function AdminIntro() {
  useTitle('Start-Animationen');
  const when = (id: IntroId): string => (id === 'base' ? 'Normalfall' : id === 'renntag' ? 'An Tagen mit Etappe' : 'Jedes dritte Öffnen, reihum');
  const order: IntroId[] = ['base', ...ALTS];
  return (
    <>
      <TopBar title="Start-Animationen" back="/admin" />
      <div className="stack">
        <p className="hint">
          Beim Öffnen der App rollt der Punkt das Wort aus. Jedes dritte Öffnen kommt reihum eine andere Animation,
          an Renntagen eine mit der Etappe. Tippe auf eine Animation, um sie anzusehen.
        </p>
        <ul className="list admin-list">
          {order.map((id) => (
            <li key={id}>
              <button type="button" className="card card--row" style={{ width: '100%', textAlign: 'left' }} onClick={() => preview(id)}>
                <span className="card__main">
                  <strong>{INTRO_INFO[id].name}</strong>
                  <span className="muted">{INTRO_INFO[id].desc}</span>
                  <span className="small accent">{when(id)}</span>
                </span>
                <Icon name="chevron" className="muted" />
              </button>
            </li>
          ))}
          <li>
            <div className="card">
              <span className="card__main">
                <strong>{INTRO_INFO.renntag.name}</strong>
                <span className="muted">{INTRO_INFO.renntag.desc}</span>
                <span className="small accent">{when('renntag')}</span>
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {RACE_KINDS.map(([k, label]) => (
                  <button key={k} type="button" className="chip chip--accent" onClick={() => preview(`renntag:${k}`)}>{label}</button>
                ))}
              </div>
            </div>
          </li>
        </ul>
      </div>
    </>
  );
}
