/**
 * Menüs der Minispiele – Start, Pause und Ende in derselben Hülle: ein Blatt am unteren Rand über der 3D-Welt, im
 * Querformat und auf großen Bildschirmen eine Leiste links (die Welt bleibt zu sehen). Je Menü eine Hauptaktion,
 * sonst wenig Text.
 *  - Start: über der scharfen, lebendigen Welt (der Startkran zeigt dich am Start, menuView.ts) ein dunkler Verlauf
 *    mit dem Kopf des Spiels (Symbol, Name, Strecke), dem Nötigsten und unten dem Startknopf – in beiden
 *    Farbschemata dunkel wie das Spiel. Beim Losfahren beginnt sofort der Countdown, die Kamera fliegt hinter den
 *    Fahrer, das Menü gleitet dabei hinaus. Kommt man von der Startseite ohne Startanimation, fliegt der Kopf der
 *    Spielkarte hierher (handoff.ts).
 *  - Pause: Weiter, Beenden, Grafik.
 *  - Ende: das Ergebnis unter einem Band wie die Ziellinie.
 * Dazu der Countdown: ein Ring, der je Sekunde abläuft, die Zahl in der Mitte.
 */
import { LiveLine, LobbyResults } from '../ui/Live';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HANDOFF_EASE, HANDOFF_MS, SIDE_MQ, endHandoff, sheetIn, sheetOut } from '../app/handoff';
import { setMenuInset } from '../game/menuView';
import { veilThen } from '../app/veil';
import { markUiBusy } from '../game/uiBusy';
import { gameIntroActive, onGameIntroExit } from '../app/gameIntro';
import type { GameId } from '../data/source';
import type { GameBest } from '../data/source';
import type { Profile } from '../lib/types';
import { GameHead } from '../ui/GameHead';
import { Icon } from '../ui/Icon';
import { Avatar, cx } from '../ui/kit';
import { FpsSwitch, GfxSliders, PlayIcon } from './gameKit';
import { teamRadio } from '../game/teams';
import { berlinDayKey } from '../game/abfahrt/rng';

export function StartSheet({ game, title, sub, tag, extra, children, cta = 'Losfahren', onStart, onClose, plain, after, rival }: {
  /** dein Rivale (rival.tsx), unten über dem Start */
  rival?: ReactNode;
  game: GameId;
  title: string;
  sub: ReactNode;
  tag?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  cta?: string;
  onStart: () => void;
  onClose: () => void;
  /** nur der Inhalt (Bestenliste, Fehler) – ohne Kopf und Startknopf */
  plain?: boolean;
  /** unter dem Startknopf (Testfahrt, Messfahrt) */
  after?: ReactNode;
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const head = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const firstRef = useRef(true);
  const stopInset = useRef<() => void>(() => undefined);
  // Kamera: wo das Menü die Welt verdeckt – der Fahrer steht im freien Teil darüber (menuView.ts, render3d applyShift)
  useLayoutEffect(() => {
    const s = sheet.current;
    if (!s) return;
    let off = false;
    const measure = () => {
      if (off) return;
      // (Lage im Layout, ohne die Verschiebung der Einblendung; der Verlauf über dem Menü zählt halb mit)
      setMenuInset(side() ? { top: 0, left: s.offsetLeft + s.offsetWidth } : { top: Math.max(0, s.offsetTop - 28), left: 0 });
    };
    measure();
    let ro: ResizeObserver | null = null;
    try { ro = new ResizeObserver(measure); ro.observe(s); } catch { /* dann nur bei Größenänderung des Fensters */ }
    window.addEventListener('resize', measure);
    stopInset.current = () => { off = true; setMenuInset(null); };
    return () => { off = true; ro?.disconnect(); window.removeEventListener('resize', measure); setMenuInset(null); };
  }, []);
  useLayoutEffect(() => {
    const s = sheet.current;
    if (!s || !firstRef.current) return;
    firstRef.current = false;
    // Startanimation läuft (gameIntro.ts): das Menü steigt herauf, sobald sie aufgeht – darunter wird vorbereitet
    if (gameIntroActive(game)) {
      s.style.opacity = '0';
      onGameIntroExit(() => {
        s.style.opacity = '';
        markUiBusy(HANDOFF_MS + 450);
        menuIn(s);
      });
      return;
    }
    // solange das Menü hereinkommt, baut die 3D-Welt nur in kleinen Portionen weiter
    markUiBusy(HANDOFF_MS + 450);
    const h = head.current;
    if (!(h && endHandoff(h, s))) menuIn(s);
  }, []);
  const go = () => {
    if (leaving) return;
    setLeaving(true);
    // Countdown, Kameraflug und Menü weg – alles im selben Augenblick (das Menü gleitet als Abbild hinaus, das Spiel
    // beginnt sofort); Bewegung vor Vorbauen
    markUiBusy(3800);
    stopInset.current();
    if (layer.current) menuAway(layer.current);
    onStart();
  };
  return (
    <div ref={layer} className={cx('abf-layer abf-layer--sheet abf-layer--start', `hue-${game}`, leaving && 'is-leaving')}>
      <button type="button" className="abf-round abf-close" onClick={() => veilThen(onClose)} aria-label="Schließen"><Icon name="x" size={20} /></button>
      <div className={cx('abf-sheet', !plain && 'abf-sheet--start')} ref={sheet}>
        {plain ? (
          <div className="abf-sheet__body abf-scroll">{children}</div>
        ) : (
          <>
            <div className="abf-sheet__head">
              <GameHead ref={head} as="h1" game={game} title={title} sub={sub} tag={tag} extra={extra} />
            </div>
            {children ? <div className="abf-sheet__body abf-scroll">{children}</div> : null}
            <div className="abf-sheet__foot">
              {rival}
              <LiveLine game={game} />
              <TeamRadio game={game} />
              <button type="button" className="btn btn--primary btn--full abf-go" onClick={go} disabled={leaving}><span>{cta}</span></button>
              {/* Testfahrt, Messfahrt (Admins): eingeklappt – das Startmenü bleibt ruhig */}
              {after ? (
                <details className="abf-more abf-more--start">
                  <summary>Test und Messung<Icon name="chevron" size={14} /></summary>
                  <div className="abf-more__body">{after}</div>
                </details>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const calm = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const side = () => { try { return window.matchMedia(SIDE_MQ).matches; } catch { return false; } };

/** Startmenü erscheint: der Verlauf blendet auf, Kopf, Inhalt und Startknopf steigen gestaffelt herauf */
function menuIn(s: HTMLElement) {
  if (calm()) return;
  try {
    s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out', fill: 'backwards' });
    const from = side() ? 'translateX(-24px)' : 'translateY(30px)';
    const parts = ['.abf-sheet__head', '.abf-sheet__body', '.abf-sheet__foot'].map((q) => s.querySelector<HTMLElement>(`:scope > ${q}`)).filter((x): x is HTMLElement => !!x);
    parts.forEach((p, i) => p.animate([{ transform: from, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 40 + i * 70, easing: HANDOFF_EASE, fill: 'backwards' }));
  } catch { /* ohne Animation */ }
}

/**
 * Startmenü geht (Losfahren): als Abbild über dem Spiel hinausgleiten, während darunter schon Countdown und
 * Kameraflug laufen – das echte Menü ist im selben Augenblick weg (die Seite wechselt in den Countdown)
 */
function menuAway(l: HTMLElement) {
  if (calm()) return;
  try {
    const host = l.closest('.abf');
    const wrap = document.createElement('div');
    wrap.className = `${host?.className ?? 'abf'} abf--ghost`;
    // (dieselbe Höhe wie das Spiel – als Web-App setzt es sie selbst, sonst stünde das Abbild um die Statusleiste höher)
    if (host instanceof HTMLElement) wrap.style.cssText = host.style.cssText;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.inert = true;
    const c = l.cloneNode(true) as HTMLElement;
    c.classList.add('is-leaving');
    c.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    wrap.append(c);
    document.body.append(wrap);
    const sb = l.querySelector('.abf-sheet__body');
    const cb = c.querySelector('.abf-sheet__body');
    if (sb && cb) cb.scrollTop = sb.scrollTop;
    const sh = c.querySelector('.abf-sheet');
    const to = side() ? 'translateX(-56px)' : 'translateY(84px)';
    const a = sh?.animate([{ transform: 'none', opacity: 1 }, { transform: to, opacity: 0 }], { duration: 340, easing: 'cubic-bezier(0.45, 0, 0.6, 1)', fill: 'forwards' });
    c.querySelector('.abf-close')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
    let gone = false;
    const end = () => { if (!gone) { gone = true; wrap.remove(); } };
    if (a) a.finished.then(end, end);
    else end();
    window.setTimeout(end, 900);
  } catch { /* ohne Abbild */ }
}

/** Teamfunk vor dem Start: ein Satz vom sportlichen Leiter von Team gruppetto (je Tag und Spiel ein anderer) */
function TeamRadio({ game }: { game: string }) {
  const r = teamRadio(berlinDayKey(), game);
  return (
    <p className="team-radio">
      <span className="team-radio__badge" aria-hidden="true">g<i>.</i></span>
      <span className="team-radio__text"><b>Teamfunk · {r.ds}<span className="team-radio__bars" aria-hidden="true"><i /><i /><i /></span></b> „{r.line}“</span>
    </p>
  );
}

/** ein Satz unter „Pause“ – jedes Mal ein anderer */
const PAUSE_QUIPS = [
  'Kurz durchschnaufen.',
  'Trinkflasche auffüllen, dann weiter.',
  'Der Mechaniker zieht die Schrauben nach.',
  'Das Feld wartet. Ausnahmsweise.',
  'Beppe hält das Funkgerät bereit.',
  'Ein Riegel geht immer.',
];

/** Pause: Weiter (Hauptaktion), Beenden, Grafik; extra: Messmodus (eingeklappt) */
export function PauseSheet({ game, id, status, onResume, onQuit, extra }: {
  game: string;
  /** Spiel (Farbe) */
  id?: GameId;
  /** Stand im Rennen: Platz, Reststrecke, Kraft */
  status?: ReactNode[];
  onResume: () => void;
  onQuit: () => void;
  extra?: ReactNode;
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [quip] = useState(() => PAUSE_QUIPS[Math.floor(Math.random() * PAUSE_QUIPS.length)]);
  useLayoutEffect(() => { if (sheet.current) sheetIn(sheet.current); }, []);
  const resume = () => {
    if (leaving) return;
    setLeaving(true);
    const s = sheet.current;
    (s ? sheetOut(s, layer.current) : Promise.resolve()).then(onResume);
  };
  return (
    <div ref={layer} className={cx('abf-layer abf-layer--sheet abf-layer--pause', id && `hue-${id}`, leaving && 'is-leaving')}>
      <div className="abf-sheet abf-sheet--pause" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="abf-pause-title">
        <div className="abf-pause__head">
          <div className="abf-pause__titles">
            <h2 id="abf-pause-title" className="abf-pause__title">Pause</h2>
            <p className="abf-pause__quip">{quip}</p>
          </div>
          <span className="abf-pause__game">{game}</span>
        </div>
        {status?.length ? <div className="abf-pause__status" aria-label="Stand im Rennen">{status.map((x, i) => <span key={i}>{x}</span>)}</div> : null}
        <div className="abf-pause__actions">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="button" className="btn btn--primary abf-pause__go" onClick={resume} disabled={leaving} autoFocus><PlayIcon /><span>Weiter</span></button>
          <button type="button" className="btn btn--secondary abf-pause__quit" onClick={() => veilThen(onQuit)}><span>Beenden</span></button>
        </div>
        <div className="abf-sheet__body abf-scroll">
          <div className="abf-set">
            <GfxSliders />
            <FpsSwitch />
          </div>
          {extra ? (
            <details className="abf-more">
              <summary>Messmodus<Icon name="chevron" size={14} /></summary>
              <div className="abf-more__body">{extra}</div>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Ende: das Ergebnis (Inhalt je Spiel) unter dem Zielband; Schließen oben rechts */
export function OverSheet({ game, onClose, children, plain }: { game?: GameId; onClose: () => void; children: ReactNode; plain?: boolean }) {
  const sheet = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => { if (sheet.current) sheetIn(sheet.current); }, []);
  return (
    <div className={cx('abf-layer abf-layer--sheet abf-layer--over', game && `hue-${game}`)}>
      <button type="button" className="abf-round abf-close" onClick={() => veilThen(onClose)} aria-label="Schließen"><Icon name="x" size={20} /></button>
      <div className={cx('abf-sheet abf-sheet--over', plain && 'is-plain')} ref={sheet} role="dialog" aria-modal="true" aria-label="Ergebnis">
        <div className="abf-sheet__body abf-scroll">{game && !plain ? <LobbyResults game={game} /> : null}{children}</div>
      </div>
    </div>
  );
}

/**
 * Countdown über dem Spiel: ein Ring läuft je Zahl ab, dann „Los“. step = Sekunden je Zahl (Abfahrt 0,75;
 * Zeitfahren 0,6). Vibriert leise, wo das Gerät es kann.
 */
export function Countdown({ count, step = 0.75 }: { count: number; step?: number }) {
  useEffect(() => {
    try { navigator.vibrate?.(count > 0 ? 10 : 24); } catch { /* egal */ }
  }, [count]);
  const R = 38;
  const C = 2 * Math.PI * R;
  const go = count <= 0;
  return (
    <div className="abf-count" aria-live="assertive">
      <div key={count} className={cx('abf-count__wrap', go && 'is-go')} style={{ '--step': `${step}s` } as CSSProperties}>
        <svg className="abf-count__ring" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r={R} className="abf-count__track" />
          <circle cx="42" cy="42" r={R} className="abf-count__arc" style={{ strokeDasharray: C }} />
        </svg>
        <span className="abf-count__n">{go ? 'Los' : count}</span>
      </div>
    </div>
  );
}

/**
 * Eine Zeile zur Bestenliste: die ersten drei als Köpfe, der eigene Platz, Pfeil – die ganze Liste öffnet sich
 * darüber (die Startseite zeigt die Liste schon ausführlich)
 */
export function BoardLink({ rows, label, members, meId, onOpen, fmt }: {
  rows: GameBest[]; label: string; members: Profile[]; meId: string; onOpen: () => void; fmt: (best: number) => string;
}) {
  const top = rows.slice(0, 3);
  const myIdx = rows.findIndex((r) => r.user_id === meId);
  const mine = myIdx >= 0 ? rows[myIdx] : null;
  return (
    <button type="button" className="abf-boardlink" onClick={onOpen} aria-label={`Bestenliste ${label} öffnen`}>
      <span className="abf-boardlink__avs" aria-hidden="true">
        {top.map((r) => { const m = members.find((x) => x.id === r.user_id); return <Avatar key={r.user_id} name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={22} />; })}
      </span>
      <span className="abf-boardlink__text">Bestenliste<small>{label}</small></span>
      {mine ? <span className="abf-boardlink__me">{myIdx + 1}. · {fmt(mine.best)}</span> : top.length ? null : <span className="abf-boardlink__me">noch leer</span>}
      <Icon name="chevron" size={16} className="muted" />
    </button>
  );
}
