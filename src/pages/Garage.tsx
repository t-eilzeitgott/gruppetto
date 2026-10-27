import { useEffect, useMemo, useRef, useState } from 'react';
import { afterPaint } from '../lib/afterPaint';
import { goBack } from '../app/router';
import { BIKES, bikeById } from '../game/bikes';
import { GarageView } from '../game/abfahrt/garage3d';
import type { Kit } from '../game/abfahrt/rider';
import { useBikes } from '../ui/useBikes';
import { cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';

/** Trikot des Spielers (wie in den Spielen) – das Teamrad wird darin lackiert */
function playerKit(): Kit {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5fa2';
  return { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '27' };
}

/** Radgarage: alle Räder im Überblick, das gewählte auf der Drehscheibe, Freischalt-Fortschritt */
export function GaragePage() {
  useTitle('Radgarage');
  const bikes = useBikes();
  const [view, setView] = useState(bikes.current);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [glError, setGlError] = useState(false);
  const [hint, setHint] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<GarageView | null>(null);
  // gewähltes Rad auch für den verzögerten Aufbau der 3D-Ansicht
  const viewRef2 = useRef(view);
  viewRef2.current = view;
  const kit = useMemo(playerKit, []);
  // „Neu“: beim ersten vollständigen Laden merken, dann als gesehen speichern
  const [fresh, setFresh] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!bikes.loaded || fresh) return;
    setFresh(new Set(bikes.fresh));
    bikes.markSeen();
  }, [bikes.loaded, bikes.fresh, bikes.markSeen, fresh]);

  // 3D: ein Kontext für Drehscheibe und Vorschaubilder
  useEffect(() => {
    const canvas = canvasRef.current;
    // Testmodus ohne 3D (?nogl): nur die Oberfläche – für schnelle automatische Layout-Checks
    if (!canvas || /[?&]nogl\b/.test(window.location.search)) return undefined;
    // 3D erst nach dem ersten Bild: die Garage steht sofort, das Rad blendet ein
    const start = () => {
      let v: GarageView;
      try {
        v = new GarageView(canvas);
      } catch {
        setGlError(true);
        return undefined;
      }
      viewRef.current = v;
      v.setBike(viewRef2.current, kit);
      for (const b of BIKES) v.thumb(b.id, kit, 360, 220, (url) => setThumbs((t) => ({ ...t, [b.id]: url })));
      v.start();
      const shown = afterPaint(() => canvas.classList.add('is-drawn'));
      const onResize = () => v.resize();
      window.addEventListener('resize', onResize);
      const onVis = () => (document.hidden ? v.stop() : v.start());
      document.addEventListener('visibilitychange', onVis);
      return () => {
        shown();
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
        v.dispose(bikes.current);
        viewRef.current = null;
      };
    };
    let stop: (() => void) | undefined;
    const cancel = afterPaint(() => { stop = start(); });
    const t = window.setTimeout(() => setHint(false), 3200);
    return () => {
      window.clearTimeout(t);
      cancel();
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { viewRef.current?.setBike(view, kit); }, [view, kit]);

  // gewähltes Rad in der Leiste sichtbar halten
  const listRef = useRef<HTMLElement | null>(null);
  const firstScroll = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('.garage__item.is-active');
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    const left = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: firstScroll.current ? 'auto' : 'smooth' });
    firstScroll.current = false;
  }, [view]);

  const spec = bikeById(view);
  const prog = bikes.progress[view];
  const unlocked = !!prog?.done;
  const chosen = bikes.current === view;
  const count = bikes.unlocked.length;

  return (
    <div className="garage">
      <header className="garage__top">
        <button type="button" className="abf-round" onClick={() => goBack('/')} aria-label="Zurück"><Icon name="back" size={20} /></button>
        <div className="garage__head">
          <h1>Radgarage</h1>
          <p>{bikes.loaded ? `${count} von ${BIKES.length} Rädern freigeschaltet` : 'Lade deine Ergebnisse …'}</p>
        </div>
      </header>

      <div className="garage__body">
        <div className="garage__stage">
          {glError ? (
            <div className="garage__nogl"><Icon name="bike" size={40} /><span>3D ist auf diesem Gerät nicht verfügbar</span></div>
          ) : (
            <canvas ref={canvasRef} className="garage__canvas" aria-label={`${spec.name} in 3D – zum Drehen wischen`} />
          )}
          <div className="garage__plate">
            <span className="garage__era">{spec.era}</span>
            <h2 className="garage__name">{spec.name}</h2>
          </div>
          {!unlocked && bikes.loaded ? <span className="garage__lock"><Icon name="lock" size={14} />Gesperrt</span> : null}
          {chosen && unlocked ? <span className="garage__lock is-mine"><Icon name="check" size={14} />Dein Rad</span> : null}
          <span className={cx('garage__hint', !hint && 'is-off')}>Wischen zum Drehen</span>
        </div>

        <div className="garage__side">
          <nav className="garage__list" aria-label="Alle Räder" ref={listRef}>
            {BIKES.map((b) => {
              const p = bikes.progress[b.id];
              const open = !!p?.done;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={cx('garage__item', b.id === view && 'is-active', !open && bikes.loaded && 'is-locked')}
                  aria-pressed={b.id === view}
                  onClick={() => setView(b.id)}
                >
                  <span className="garage__thumb">
                    {thumbs[b.id] ? <img src={thumbs[b.id]} alt="" draggable={false} /> : <span className="garage__skel" />}
                  </span>
                  <span className="garage__item-name">{b.name}</span>
                  {open && bikes.current === b.id ? <span className="garage__tag is-mine" aria-label="gewählt"><Icon name="check" size={12} stroke={2.6} /></span> : null}
                  {!open && bikes.loaded ? <span className="garage__tag" aria-label="gesperrt"><Icon name="lock" size={12} stroke={2.2} /></span> : null}
                  {fresh?.has(b.id) ? <span className="garage__new">Neu</span> : null}
                </button>
              );
            })}
          </nav>

          <section className="garage__info" aria-live="polite">
            {!bikes.loaded ? null : unlocked ? (
              <button type="button" className={cx('btn btn--full garage__go', chosen ? 'btn--secondary' : 'btn--primary')} disabled={chosen} onClick={() => bikes.select(view)}>
                <Icon name={chosen ? 'check' : 'bike'} size={18} />
                <span>{chosen ? 'Damit fährst du' : 'Dieses Rad fahren'}</span>
              </button>
            ) : (
              <div className={cx('garage__unlock', prog?.after && 'is-queued')}>
                <p className="garage__task"><Icon name="lock" size={15} /><span>{prog?.text}</span></p>
                {prog?.after ? <p className="garage__after">Zählt erst, wenn {prog.after} freigeschaltet ist</p> : null}
                <div className="garage__bar" role="progressbar" aria-valuemin={0} aria-valuemax={prog?.target ?? 1} aria-valuenow={prog?.value ?? 0} aria-label="Fortschritt">
                  <span style={{ width: `${Math.round(Math.min(1, (prog?.value ?? 0) / (prog?.target || 1)) * 100)}%` }} />
                </div>
                <p className="garage__count">{prog?.label}</p>
              </div>
            )}
            <p className="garage__blurb">{spec.blurb}</p>
            <dl className="garage__specs">
              {spec.specs.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="garage__note">Alle Räder fahren gleich schnell – es geht nur ums Aussehen. Marken und Modelle sind erfunden.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
