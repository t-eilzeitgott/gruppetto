/**
 * Europareise: alle Kilometer aus den Minispielen auf einer Route von Wuppertal nach Palermo.
 * Oben die stilisierte Karte mit der Strecke, dem eigenen Rad und dem Peloton (die ganze Runde),
 * darunter der Stand, die Etappenorte als Reisetagebuch und die Mitfahrer.
 */
import { useMemo } from 'react';
import { goBack } from '../app/router';
import { useApp } from '../app/context';
import { useMembers, useTourData } from '../app/hooks';
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameRun } from '../data/source';
import { GARAGE_START } from '../game/bikes';
import { passStamps, stampMeters } from '../game/passbook';
import { fmtKm, journeyAt, MAP, mapXY, ROUTE, ROUTE_KM, type JourneyPos } from '../game/journey';
import { useJourney } from '../ui/useJourney';
import { Avatar, cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';

const LAND: Record<string, string> = { DE: 'Deutschland', CH: 'Schweiz', IT: 'Italien' };
const fmtDate = (day: string) => { const [y, m, d] = day.split('-'); return `${Number(d)}.${Number(m)}.${y.slice(2)}`; };

export function JourneyPage() {
  useTitle('Europareise');
  const { me, tour } = useApp();
  const j = useJourney();
  const members = useMembers().data ?? [];
  const tourData = useTourData(tour);
  const runs = useQuery<GameRun[]>('game:runs:me', () => source.myRuns(GARAGE_START));
  const stamps = useMemo(() => (runs.data ? passStamps(runs.data, tour?.name, tourData.data?.stages) : null), [runs.data, tour?.name, tourData.data]);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? 'Jemand';
  const pos = j.me;
  const grp = j.group;
  const atStop = ROUTE[pos.at];
  const nextStop = ROUTE[pos.next];
  const done = pos.at === ROUTE.length - 1;
  const total = pos.meters / 1000;

  return (
    <div className="journey">
      <header className="journey__top">
        <button type="button" className="abf-round" onClick={() => goBack('/')} aria-label="Zurück"><Icon name="back" size={20} /></button>
        <div className="journey__head">
          <h1>Europareise</h1>
          <p>{j.loaded ? `Wuppertal → Palermo · ${fmtKm(ROUTE_KM)} · alle Kilometer aus allen Spielen` : 'Lade deine Kilometer …'}</p>
        </div>
      </header>

      <div className="journey__body">
        <section className="journey__map" aria-label="Karte der Reise">
          <RouteMap me={pos} group={grp} loaded={j.loaded} />
        </section>

        <section className="journey__status" aria-live="polite">
          {!j.loaded ? <p className="journey__muted">Einen Moment …</p> : (
            <>
              <div className="journey__big">
                <strong>{fmtKm(total)}</strong>
                <span>gefahren{pos.lap > 1 ? ` · ${pos.lap}. Reise` : ''}</span>
              </div>
              {done ? (
                <p className="journey__line">Du bist in <b>Palermo</b> angekommen – die nächste Reise beginnt mit dem nächsten Lauf wieder in Wuppertal.</p>
              ) : pos.meters === 0 ? (
                <p className="journey__line">Noch nicht losgefahren. Jeder Lauf in Abfahrt, Sprint- und Bergfinale bringt dich weiter – der erste Ort ist <b>{ROUTE[1].name}</b>, {fmtKm(ROUTE[1].km)} von hier.</p>
              ) : (
                <p className="journey__line">Zuletzt in <b>{atStop.name}</b>{atStop.alt ? ` (${atStop.alt.toLocaleString('de-DE')} m)` : ''} · noch <b>{fmtKm(pos.toNext)}</b> bis {nextStop.name}</p>
              )}
              <div className="journey__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((pos.km / ROUTE_KM) * 100)} aria-label="Anteil der Reise">
                <span style={{ width: `${Math.min(100, (pos.km / ROUTE_KM) * 100)}%` }} />
              </div>
              <p className="journey__group">
                <Icon name="users" size={15} />
                <span>Die Runde zusammen: <b>{fmtKm(grp.meters / 1000)}</b>{grp.lap > 1 ? ` – ${grp.lap}. Reise, gerade` : ' – gerade'} bei {ROUTE[grp.at].name}</span>
              </p>
            </>
          )}
        </section>

        <section className="journey__pass" aria-label="Passbuch">
          <h2>Passbuch</h2>
          {!stamps ? <p className="journey__muted">Lade deine Pässe …</p> : stamps.length === 0 ? (
            <p className="journey__muted">Noch kein Stempel. Jede Passhöhe in der Abfahrt und jeder Schlussanstieg im Bergfinale kommt hier hinein.</p>
          ) : (
            <>
              <p className="journey__pass-sum"><b>{stamps.length}</b> {stamps.length === 1 ? 'Pass' : 'Pässe'} · {stamps.reduce((a, s) => a + s.count, 0)} Überquerungen · {stampMeters(stamps).toLocaleString('de-DE')} Höhenmeter gestempelt</p>
              <ul className="journey__stamps">
                {stamps.map((s, i) => (
                  <li key={s.name} className={cx('journey__stampcard', s.real && 'is-real')} style={{ transform: `rotate(${((i * 7) % 5) - 2}deg)` }}>
                    <span className="journey__stampcard-name">{s.name}</span>
                    <span className="journey__stampcard-alt">{s.alt.toLocaleString('de-DE')} m</span>
                    <span className="journey__stampcard-meta">{s.count > 1 ? `${s.count}× · ` : ''}{s.real ? 'echte Etappe' : fmtDate(s.first)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="journey__diary" aria-label="Etappenorte">
          <h2>Reisetagebuch</h2>
          <ol className="journey__stops">
            {ROUTE.map((s, i) => {
              const reached = j.loaded && (pos.lap > 1 || i <= pos.at) && pos.meters > 0;
              const current = j.loaded && i === pos.at && pos.meters > 0 && !done;
              const isNext = j.loaded && i === pos.next && !done && pos.meters > 0;
              return (
                <li key={s.name} className={cx('journey__stop', reached && 'is-reached', current && 'is-current', isNext && 'is-next', !!s.alt && 'is-pass')}>
                  <span className="journey__dot" aria-hidden="true">{s.alt ? <Icon name="mountain" size={12} stroke={2.4} /> : reached ? <Icon name="check" size={12} stroke={2.6} /> : null}</span>
                  <span className="journey__stop-main">
                    <span className="journey__stop-name">{s.name}{s.alt ? <small> {s.alt.toLocaleString('de-DE')} m</small> : null}</span>
                    <span className="journey__stop-sub">{fmtKm(s.km)} · {LAND[s.land]}{reached ? ` · ${s.note}` : isNext ? ` · noch ${fmtKm(pos.toNext)}` : ''}</span>
                  </span>
                  {reached ? <span className="journey__stamp" aria-label="erreicht">Postkarte</span> : null}
                </li>
              );
            })}
          </ol>
        </section>

        {j.loaded && j.riders.length ? (
          <section className="journey__riders" aria-label="Mitfahrer">
            <h2>Wer ist wo?</h2>
            <ul>
              {j.riders.map((r) => {
                const p = journeyAt(r.meters);
                const m = members.find((x) => x.id === r.userId);
                return (
                  <li key={r.userId} className={cx(r.userId === me.id && 'is-me')}>
                    <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={28} />
                    <span className="journey__rider-name">{r.userId === me.id ? 'Du' : nameOf(r.userId)}</span>
                    <span className="journey__rider-at">{ROUTE[p.at].name}{p.lap > 1 ? ` · ${p.lap}. Reise` : ''}</span>
                    <strong>{fmtKm(r.meters / 1000)}</strong>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <p className="journey__note">Gezählt werden alle Läufe seit Eröffnung der Radgarage. Die Orte und Kilometer folgen einer echten Radreise-Route; die Streckenlängen sind gerundet.</p>
      </div>
    </div>
  );
}

/** Stilisierte Karte: Route als Linie, Etappenorte als Punkte, eigenes Rad und Peloton als Marker */
function RouteMap({ me, group, loaded }: { me: JourneyPos; group: JourneyPos; loaded: boolean }) {
  const pts = useMemo(() => ROUTE.map((s) => mapXY(s.lon, s.lat)), []);
  const path = useMemo(() => pts.map(([x, y]: [number, number], i: number) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '), [pts]);
  // gefahrener Teil der Linie: bis zum aktuellen Punkt
  const donePath = useMemo(() => {
    if (!loaded || me.meters === 0) return '';
    const upto = me.lap > 1 ? ROUTE.length - 1 : me.at;
    const parts = pts.slice(0, upto + 1).map(([x, y]: [number, number], i: number) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    if (me.lap === 1) { const [x, y] = mapXY(me.lon, me.lat); parts.push(`L${x.toFixed(1)} ${y.toFixed(1)}`); }
    return parts.join(' ');
  }, [pts, me, loaded]);
  const [mx, my] = mapXY(me.lon, me.lat);
  const [gx, gy] = mapXY(group.lon, group.lat);
  return (
    <svg className="journey__svg" viewBox={`0 0 ${MAP.w} ${MAP.h}`} role="img" aria-label="Route von Wuppertal nach Palermo">
      <defs>
        <linearGradient id="jy-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.06)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.0)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={MAP.w} height={MAP.h} fill="url(#jy-sea)" />
      {/* Alpen und Apennin als weiche Bänder */}
      <path className="journey__range" d="M40 205 C 110 170, 180 185, 300 150" />
      <path className="journey__range is-thin" d="M150 262 C 190 290, 220 330, 250 380 C 270 420, 290 470, 300 500" />
      <text className="journey__land" x="150" y="118">Deutschland</text>
      <text className="journey__land" x="150" y="214">Schweiz</text>
      <text className="journey__land" x="226" y="330">Italien</text>
      <text className="journey__land is-sea" x="40" y="470">Tyrrhenisches Meer</text>
      <text className="journey__land is-sea" x="262" y="455">Adria</text>
      <path className="journey__route" d={path} />
      {donePath ? <path className="journey__route is-done" d={donePath} /> : null}
      {ROUTE.map((s, i) => {
        const [x, y] = pts[i];
        const reached = loaded && me.meters > 0 && (me.lap > 1 || i <= me.at);
        return (
          <g key={s.name} className={cx('journey__pt', reached && 'is-reached', s.major && 'is-major', !!s.alt && 'is-pass')}>
            <circle cx={x} cy={y} r={s.major ? 4.2 : 2.6} />
            {s.major ? (
              <text
                x={x + (s.label === 'left' ? -7 : s.label === 'above' || s.label === 'below' ? 0 : 7)}
                y={y + (s.label === 'above' ? -8 : s.label === 'below' ? 14 : 3.5)}
                textAnchor={s.label === 'left' ? 'end' : s.label === 'above' || s.label === 'below' ? 'middle' : 'start'}
              >{s.name}</text>
            ) : null}
          </g>
        );
      })}
      {loaded && group.meters > 0 ? (
        <g className="journey__peloton" transform={`translate(${gx.toFixed(1)} ${gy.toFixed(1)})`}>
          <circle r="9" />
          <circle r="4" cx="-4" cy="1" /><circle r="4" cx="3" cy="-2" /><circle r="4" cx="2" cy="4" />
          <title>Die Runde zusammen</title>
        </g>
      ) : null}
      {loaded && me.meters > 0 ? (
        <g className="journey__me" transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)})`}>
          <circle r="11" className="journey__me-halo" />
          <circle r="6" />
          <title>Du</title>
        </g>
      ) : null}
    </svg>
  );
}
