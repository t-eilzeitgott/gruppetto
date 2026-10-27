/**
 * Minispiel „Akku leer!“ (Prototyp, vorerst nur im Admin-Bereich): Rennradler aus der Gabel-Schleuder auf
 * E-Biker schießen. 2D-Physik auf einer Leinwand statt 3D – lädt schnell, läuft mit hoher Bildrate.
 * Bestwert vorerst nur auf dem Gerät (keine Bestenliste in der Datenbank).
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useMembers } from '../app/hooks';
import { navigate } from '../app/router';
import { cx, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { AkkuIcon } from '../ui/GameIcon';
import { AkkuGame, RIDERS, type AkkuResult, type GameEvents } from '../game/akku/game';
import { AkkuRenderer } from '../game/akku/render';
import { LEVEL, type RiderType } from '../game/akku/level';
import { drawRider } from '../game/akku/chars';
import { PauseIcon, PlayIcon, lsGet, lsSet, useCountUp, useGameLock } from './gameKit';

type Ui = 'ready' | 'playing' | 'paused' | 'over';

const LS_BEST = 'gruppetto.akku.best';
const LS_RUNS = 'gruppetto.akku.runs';
const nf = (n: number) => Math.round(n).toLocaleString('de-DE');
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7ab8ff';
const isDark = () => document.documentElement.dataset.theme === 'dark';

export function AkkuPage() {
  useTitle('Akku leer!');
  useGameLock();
  const members = useMembers();
  const [ui, setUi] = useState<Ui>('ready');
  const uiRef = useRef<Ui>('ready');
  uiRef.current = ui;
  const [result, setResult] = useState<AkkuResult | null>(null);
  const [bats, setBats] = useState({ alive: LEVEL.enemies.length, total: LEVEL.enemies.length });
  const [best, setBest] = useState(() => Number(lsGet(LS_BEST)) || 0);
  const [record, setRecord] = useState(false);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<AkkuGame | null>(null);
  const rendRef = useRef<AkkuRenderer | null>(null);
  const scoreRef = useRef<HTMLElement | null>(null);
  const namesRef = useRef<string[]>([]);

  const names = (members.data ?? []).map((m) => (m.display_name ?? '').trim().split(/\s+/)[0]).filter(Boolean);
  namesRef.current = names;

  const events: GameEvents = {
    score: (s) => {
      const el = scoreRef.current;
      if (!el) return;
      el.textContent = nf(s);
      el.classList.remove('is-bump');
      void el.offsetWidth;
      el.classList.add('is-bump');
    },
    enemies: (alive, total) => setBats({ alive, total }),
    over: (r) => {
      const prev = Number(lsGet(LS_BEST)) || 0;
      lsSet(LS_RUNS, String((Number(lsGet(LS_RUNS)) || 0) + 1));
      setRecord(r.score > prev && r.score > 0);
      if (r.score > prev) { lsSet(LS_BEST, String(r.score)); setBest(r.score); }
      setResult(r);
      setUi('over');
    },
    bump: (k) => { if (k >= 0.8) navigator.vibrate?.(14); },
  };
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const makeGame = (skipIntro: boolean) => {
    const proxy: GameEvents = {
      score: (s) => eventsRef.current.score?.(s),
      enemies: (a, t) => eventsRef.current.enemies?.(a, t),
      over: (r) => eventsRef.current.over?.(r),
      bump: (k) => eventsRef.current.bump?.(k),
    };
    const g = new AkkuGame({ events: proxy, names: namesRef.current, team: accent(), skipIntro, hints: (Number(lsGet(LS_RUNS)) || 0) < 2 });
    gameRef.current = g;
    rendRef.current?.prewarm(g);
    setBats({ alive: g.enemiesAlive, total: g.totalEnemies });
    if (scoreRef.current) scoreRef.current.textContent = '0';
    return g;
  };

  // Leinwand, Spiel und Schleife
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return undefined;
    let r: AkkuRenderer;
    try {
      r = new AkkuRenderer(canvas);
    } catch {
      setFailed(true);
      return undefined;
    }
    rendRef.current = r;
    // Testmodus (UI-Check): winzige Auflösung, die Seite bleibt dieselbe
    if (/[?&]lowgfx\b/.test(window.location.search)) r.maxDpr = 0.35;
    let w = 0;
    let h = 0;
    /** neu zeichnen, auch wenn gerade nichts läuft (Größe oder Thema geändert) */
    let dirty = true;
    const size = (force = false) => {
      const rect = canvas.getBoundingClientRect();
      if (!force && Math.abs(rect.width - w) < 1 && Math.abs(rect.height - h) < 1) return;
      w = rect.width;
      h = rect.height;
      r.setup(LEVEL, w, h, window.devicePixelRatio || 1, namesRef.current, isDark());
      if (gameRef.current) r.prewarm(gameRef.current);
      dirty = true;
    };
    makeGame(false);
    size(true);
    let raf = 0;
    let prev = performance.now();
    let idleAcc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const g = gameRef.current;
      if (g) {
        const u = uiRef.current;
        if (u === 'playing') {
          g.update(dt);
          r.draw(g, dt);
        } else {
          // Karte im Vordergrund: Szene dahinter nur 10-mal pro Sekunde (spart Akku), in der Pause gar nicht
          idleAcc += dt;
          if (dirty || (u !== 'paused' && idleAcc >= 0.1)) {
            if (u !== 'paused') g.idle(idleAcc);
            r.draw(g, u === 'paused' ? 0 : Math.min(0.1, idleAcc));
            idleAcc = 0;
            dirty = false;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => size()) : null;
    ro?.observe(canvas);
    const onResize = () => size();
    window.addEventListener('resize', onResize);
    const onVis = () => { if (document.hidden && uiRef.current === 'playing') setUi('paused'); };
    document.addEventListener('visibilitychange', onVis);
    const obs = new MutationObserver(() => window.setTimeout(() => size(true), 30));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // Homescreen-App auf iOS: 100vh ist dort zu kurz, darum die echte Bildschirmhöhe nehmen
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    const fit = () => {
      if (!standalone) return;
      const portrait = window.innerHeight >= window.innerWidth;
      const hh = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
      root.style.height = `${Math.max(window.innerHeight, hh)}px`;
    };
    fit();
    window.addEventListener('orientationchange', fit);
    (window as unknown as { __akku?: unknown }).__akku = { game: () => gameRef.current, renderer: r };
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      obs.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', fit);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Namen der Runde kommen nach: Straße neu bemalen
  const nameKey = names.join('|');
  useEffect(() => {
    rendRef.current?.setNames(namesRef.current);
    if (gameRef.current) gameRef.current.names = namesRef.current;
  }, [nameKey]);

  // Tastatur: Leertaste = Fähigkeit bzw. Start, Escape = Pause
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'p') { togglePause(); return; }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (uiRef.current === 'ready') start();
        else if (uiRef.current === 'over') again();
        else if (uiRef.current === 'playing') gameRef.current?.useAbility();
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  });

  const start = () => setUi('playing');
  const again = () => {
    makeGame(true);
    setResult(null);
    setRecord(false);
    setUi('playing');
  };
  const togglePause = () => {
    if (uiRef.current === 'playing') setUi('paused');
    else if (uiRef.current === 'paused') setUi('playing');
  };

  const local = (e: RPointerEvent<HTMLElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (uiRef.current !== 'playing' || !e.isPrimary) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = local(e);
    gameRef.current?.pointerDown(p.x, p.y);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) return;
    const p = local(e);
    gameRef.current?.pointerMove(p.x, p.y);
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    gameRef.current?.pointerUp();
  };

  const close = () => navigate('/admin');

  return (
    <div ref={rootRef} className={cx('abf', 'akku', `abf--${ui}`)}>
      <div
        className="abf__stage akku__stage"
        role="application"
        aria-label="Spielfeld: Rennradler in der Schleuder zurückziehen und loslassen, im Flug tippen für die Spezialfähigkeit"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <canvas ref={canvasRef} className="akku__canvas" />
      </div>

      {failed ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small">
            <h2 className="abf-title">Grafik nicht verfügbar</h2>
            <p className="abf-muted">Dein Browser kann die Spielfläche gerade nicht zeichnen.</p>
            <button type="button" className="btn btn--secondary btn--full" onClick={close}><span>Zurück</span></button>
          </div>
        </div>
      ) : null}

      {ui === 'playing' || ui === 'paused' ? (
        <div className="abf-hud akku-hud">
          <div className="akku-hud__top">
            <button type="button" className="abf-round" onClick={togglePause} aria-label={ui === 'paused' ? 'Weiter' : 'Pause'}>
              {ui === 'paused' ? <PlayIcon /> : <PauseIcon />}
            </button>
            <div className="akku-score" aria-live="polite">
              <strong ref={scoreRef}>{nf(gameRef.current?.score ?? 0)}</strong>
            </div>
            <div className="akku-bats" role="img" aria-label={`${bats.alive} von ${bats.total} E-Bikern noch geladen`}>
              {Array.from({ length: bats.total }, (_, i) => <i key={i} className={cx('akku-bat', i >= bats.alive && 'is-empty')} />)}
            </div>
          </div>
        </div>
      ) : null}

      {ui === 'paused' ? (
        <div className="abf-layer">
          <div className="abf-card abf-card--small">
            <h2 className="abf-title">Pause</h2>
            <button type="button" className="btn btn--primary btn--full" onClick={() => setUi('playing')}><span>Weiter</span></button>
            <button type="button" className="btn btn--secondary btn--full" onClick={again}><span>Neu starten</span></button>
            <button type="button" className="btn btn--secondary btn--full" onClick={close}><span>Aufhören</span></button>
          </div>
        </div>
      ) : null}

      {ui === 'ready' && !failed ? (
        <div className="abf-layer akku-layer">
          <button type="button" className="abf-round abf-close" onClick={close} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll akku-card">
            <div className="abf-head">
              <AkkuIcon size={44} />
              <div>
                <h1 className="abf-title">Akku leer!</h1>
                <p className="abf-sub">Kaffeepause am Col du Watt · Prototyp</p>
              </div>
            </div>
            <Lineup team={accent()} />
            <ul className="spr-keys akku-keys" aria-label="Steuerung">
              <li><b aria-hidden="true">↶</b>Zurückziehen und loslassen</li>
              <li><b aria-hidden="true"><TapGlyph /></b>Im Flug tippen</li>
            </ul>
            <button type="button" className="btn btn--primary btn--full abf-go" onClick={start}><span>Los geht’s</span></button>
            {best > 0 ? <p className="akku-best">Dein Bestwert <strong>{nf(best)}</strong></p> : null}
          </div>
        </div>
      ) : null}

      {ui === 'over' && result ? (
        <div className="abf-layer akku-layer">
          <button type="button" className="abf-round abf-close" onClick={close} aria-label="Schließen"><Icon name="x" size={20} /></button>
          <div className="abf-card abf-scroll akku-card">
            <Summary result={result} record={record} best={best} onAgain={again} onClose={close} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Tipp-Symbol: Punkt mit Ring */
function TapGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="2.6" fill="currentColor" />
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

const ORDER: RiderType[] = ['sprinter', 'floh', 'wasser', 'zeit', 'gelb'];

/** Die fünf Rennradler mit ihrer Fähigkeit */
function Lineup({ team }: { team: string }) {
  return (
    <ul className="akku-lineup" aria-label="Deine Rennradler">
      {ORDER.map((t) => (
        <li key={t}>
          <RiderPortrait type={t} team={team} />
          <span className="akku-lineup__name">{RIDERS[t].ability}</span>
        </li>
      ))}
    </ul>
  );
}

function RiderPortrait({ type, team }: { type: RiderType; team: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const size = 52;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const r = RIDERS[type].r;
    const s = (size * dpr * 0.36) / 0.62;
    ctx.setTransform(s, 0, 0, s, (size * dpr) / 2 + (type === 'zeit' ? s * 0.25 : 0), (size * dpr) * 0.45);
    drawRider(ctx, type, r, { mood: 'idle', blink: false, pedal: null, standing: true, glasses: true, team, lookX: 1, lookY: 0.1, t: 0 });
  }, [type, team]);
  return <canvas ref={ref} className="akku-portrait" aria-label={RIDERS[type].name} />;
}

function Summary({ result, record, best, onAgain, onClose }: { result: AkkuResult; record: boolean; best: number; onAgain: () => void; onClose: () => void }) {
  const shown = useCountUp(result.score);
  const parts: [string, number][] = [
    ['E-Biker', result.parts.enemies],
    ['Zerstört', result.parts.blocks],
    ['Kuchen', result.parts.cake],
    ['Übrige Fahrer', result.parts.bonus],
  ];
  return (
    <section className="abf-summary" aria-label="Ergebnis">
      <div className="abf-sum-top">
        <div className="akku-stars" aria-label={`${result.stars} von 3 Sternen`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cx('akku-star', i < result.stars && 'is-on', i === 1 && 'is-mid')} style={{ animationDelay: `${0.2 + i * 0.25}s` }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.85 5.9 6.45.85-4.7 4.5 1.2 6.4L12 17.2l-5.8 3.05 1.2-6.4-4.7-4.5 6.45-.85z" /></svg>
            </span>
          ))}
        </div>
        <h2 className="akku-result">{result.won ? 'Akku leer!' : 'Akkus noch voll'}</h2>
        <p className="abf-muted">
          {result.won
            ? result.ridersLeft > 0 ? `Alle E-Biker abgehängt – ${result.ridersLeft === 1 ? 'ein Rennradler' : `${result.ridersLeft} Rennradler`} übrig` : 'Alle E-Biker abgehängt'
            : `${result.enemiesLeft === 1 ? 'Ein E-Biker lädt' : `${result.enemiesLeft} E-Biker laden`} weiter`}
        </p>
        <p className="abf-score"><strong>{nf(shown)}</strong><span className="sr-only"> Punkte</span></p>
        {record || best > 0 ? (
          <div className="abf-badges">
            <span className={cx('abf-badge', record && 'is-gold')}>
              <Icon name={record ? 'star' : 'trophy'} size={14} />
              {record ? 'Neuer Bestwert' : `Bestwert ${nf(best)}`}
            </span>
          </div>
        ) : null}
      </div>
      <dl className="abf-parts akku-parts">
        {parts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{nf(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="abf-actions">
        <button type="button" className="btn btn--primary btn--full" onClick={onAgain}><Icon name="refresh" size={18} /><span>Nochmal</span></button>
      </div>
      <button type="button" className="abf-link akku-back" onClick={onClose}>Zurück zum Admin-Bereich<Icon name="chevron" size={14} /></button>
    </section>
  );
}
