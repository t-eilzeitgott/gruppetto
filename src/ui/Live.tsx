/**
 * Live-Anzeige und Lobby der Minispiele (Daten: src/app/live.ts)
 *  - LiveLine im Startblatt: wer gerade dieses Spiel fährt, die Lobby und ein anstehendes Lobby-Rennen (Countdown)
 *  - LiveChip im Rennen: die Live-Geister mit Abstand zu einem selbst
 *  - LobbyButton und LobbySheet auf der Spielkarte: Lobby eröffnen, mit Code beitreten, Rennen für alle starten
 *  - LobbyResults beim Ergebnis: wie die anderen der Lobby gerade fahren
 *  - LobbyDirector (einmal in der App): holt einen zum Lobby-Rennen ins Spiel
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../app/context';
import { useMembers } from '../app/hooks';
import { useRoute } from '../app/router';
import { errorText, type GameId, type LivePeer } from '../data/source';
import { GAMES, fmtBest, gameInfo } from '../game/games';
import { liveAt, type LiveFeed } from '../game/live';
import {
  COUNT_S, liveHub, lobbyCreate, lobbyJoin, lobbyLeave, lobbyStart, openGame, useLive, useLiveWatch, useLobbyRace, useSecondsTo,
  type LiveEngine,
} from '../app/live';
import type { Profile } from '../lib/types';
import { Avatar, cx, toast } from './kit';
import { Icon } from './Icon';
import { GameBadge } from './GameIcon';

const first = (name: string | null | undefined) => (name ?? 'Jemand').split(/\s+/)[0];
const km = (m: number) => (m < 995 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`);
/** Streckenmeter der letzten Probe einer Meldung */
const peerZ = (p: LivePeer) => (p.tail && p.tail.length >= 3 ? p.tail[p.tail.length - 3] / 10 : 0);
/** Namen aufzählen: „Lena“, „Lena und Felix“, „Lena, Felix und Max“ */
export function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`;
}

function useMemberMap(): (id: string) => Profile | undefined {
  const members = useMembers().data;
  return (id: string) => members?.find((m) => m.id === id);
}

/** was jemand gerade tut (für Zeilen in Startblatt und Lobby) */
function peerText(p: LivePeer): string {
  const g = gameInfo(p.game);
  if (p.state === 'menu') return `im Startblatt · ${g.name}`;
  if (p.state === 'over') return p.score !== null ? `im Ziel · ${g.name}` : `fertig · ${g.name}`;
  const z = peerZ(p);
  return z > 0 ? `fährt ${g.name} · ${km(z)}` : `fährt ${g.name}`;
}

// ------------------------------------------------------------------ Startblatt

/** im Startblatt: anstehendes Lobby-Rennen, die Lobby, wer gerade dieses Spiel fährt */
export function LiveLine({ game }: { game: GameId }) {
  const snap = useLive();
  const { me } = useApp();
  const who = useMemberMap();
  const race = useLobbyRace();
  const mine = race && race.game === game ? race : null;
  const secs = useSecondsTo(mine ? mine.at : null);
  const [busy, setBusy] = useState(false);
  const lobby = snap?.lobby ?? null;
  const here = (snap?.peers ?? []).filter((p) => p.game === game);
  const racing = here.filter((p) => p.state === 'race');

  if (mine && lobby) {
    const others = lobby.members.filter((m) => m.user_id !== me.id && m.seen_ms < 30_000).map((m) => first(who(m.user_id)?.display_name));
    const by = mine.by && mine.by !== me.id ? first(who(mine.by)?.display_name) : null;
    const left = secs ?? 0;
    const go = left <= 0.05;
    return (
      <div className="live-line live-line--race" role="status">
        <div className="live-line__count" aria-hidden="true"><b key={Math.ceil(left)}>{go ? 'Los' : Math.ceil(left)}</b></div>
        <div className="live-line__text">
          <span className="live-line__eyebrow"><i className="live-dot" />Lobby {lobby.code}{by ? ` · ${by} hat gestartet` : ''}</span>
          <strong>{go ? 'Los geht’s!' : left > COUNT_S[game] ? 'Gleich geht’s los' : 'Countdown läuft'}</strong>
          <span>{others.length
            ? game === 'sprint' && liveHub.rt === 'open'
              ? `Du fährst mit ${names(others)} – ihr startet nebeneinander, in Echtzeit. Rempeln erlaubt.`
              : `Du fährst mit ${names(others)} – ihr seht euch als Live-Geister.`
            : 'Alle aus der Lobby fahren zusammen los.'}</span>
        </div>
        <button type="button" className="live-line__skip" onClick={() => liveHub.done(mine.key)}>Nicht mitfahren</button>
      </div>
    );
  }

  if (!lobby && !here.length) return null;
  return (
    <div className="live-line">
      {lobby ? (
        <div className="live-line__lobby">
          <span className="live-line__eyebrow"><Icon name="users" size={14} />Lobby <b>{lobby.code}</b> · {lobby.members.filter((m) => m.seen_ms < 30_000).length} da</span>
          <button
            type="button" className="btn btn--secondary btn--sm" disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await lobbyStart(game); toast('Rennen für die Lobby gestartet'); } catch (e) { toast(errorText(e)); } finally { setBusy(false); }
            }}
          >
            <Icon name="flag" size={16} /><span>Für alle starten</span>
          </button>
        </div>
      ) : null}
      {here.length ? (
        <ul className="live-line__list">
          {here.slice(0, 3).map((p) => {
            const m = who(p.user_id);
            return (
              <li key={p.user_id}>
                <Avatar name={m?.display_name ?? '?'} color={m?.avatar_color ?? '#888'} size={22} />
                <span className="live-line__who"><b>{first(m?.display_name)}</b> {p.state === 'race' ? <>fährt gerade{peerZ(p) > 0 ? ` · ${km(peerZ(p))}` : ''}</> : p.state === 'over' ? 'ist gerade im Ziel' : 'ist im Startblatt'}</span>
                {p.state === 'race' ? <i className="live-dot" aria-label="live" /> : null}
              </li>
            );
          })}
          {racing.length ? <li className="live-line__hint">{racing.length === 1 ? 'Sie fährt' : 'Sie fahren'} als Live-Geist mit, wenn du jetzt startest</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ im Rennen

interface ChipRow { id: string; name: string; color: string; text: string; ahead: boolean }

/** Live-Geister mit Abstand (oben im Rennen) */
export function LiveChip({ engineRef }: { engineRef: RefObject<LiveEngine | null> }) {
  const [rows, setRows] = useState<ChipRow[]>([]);
  useEffect(() => {
    const pos = { z: 0, x: 0, m: 0 };
    const iv = window.setInterval(() => {
      const out = engineRef.current?.liveOut();
      const tr = out?.trace ?? [];
      const myZ = tr.length >= 3 ? tr[tr.length - 3] / 10 : 0;
      const list: ChipRow[] = [];
      for (const f of liveHub.feeds as LiveFeed[]) {
        if (!f.started || f.shown <= 0) continue;
        liveAt(f, f.shown, pos);
        const dz = pos.z - myZ;
        const text = !f.racing ? 'im Ziel' : Math.abs(dz) < 6 ? 'neben dir' : `${km(Math.abs(dz))} ${dz > 0 ? 'vor dir' : 'hinter dir'}`;
        list.push({ id: f.userId, name: first(f.name), color: f.color, text, ahead: dz > 0 });
      }
      setRows((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
    }, 400);
    return () => window.clearInterval(iv);
  }, [engineRef]);
  if (!rows.length) return null;
  return (
    <div className="live-chip" aria-live="off">
      {rows.slice(0, 3).map((r) => (
        <span key={r.id} className={cx('live-chip__row', r.ahead && 'is-ahead')}>
          <i className="live-dot" style={{ background: r.color }} />
          <b>{r.name}</b>
          <span>{r.text}</span>
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Ergebnis

/** beim Ergebnis: wie die anderen der Lobby in diesem Spiel stehen */
export function LobbyResults({ game }: { game: GameId }) {
  const snap = useLive();
  const score = liveHub.myScore;
  const { me } = useApp();
  const who = useMemberMap();
  const lobby = snap?.lobby;
  if (!lobby) return null;
  const ids = new Set(lobby.members.map((m) => m.user_id));
  const peers = (snap?.peers ?? []).filter((p) => ids.has(p.user_id) && p.game === game && p.state !== 'menu');
  if (!peers.length) return null;
  const rows = [
    ...peers.map((p) => ({ id: p.user_id, name: first(who(p.user_id)?.display_name), color: who(p.user_id)?.avatar_color ?? '#888', score: p.state === 'over' ? p.score : null, z: peerZ(p) })),
    { id: me.id, name: 'Du', color: me.avatar_color, score, z: Infinity },
  ].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.z - a.z);
  return (
    <div className="lobby-results">
      <span className="live-line__eyebrow"><Icon name="users" size={14} />Lobby {lobby.code}</span>
      <ol>
        {rows.map((r, i) => (
          <li key={r.id} className={cx(r.id === me.id && 'is-me')}>
            <span className="lobby-results__n">{r.score !== null ? `${i + 1}.` : ''}</span>
            <Avatar name={r.name} color={r.color} size={22} />
            <span className="lobby-results__name">{r.name}</span>
            {r.score !== null ? <strong>{fmtBest(game, r.score)}</strong> : <span className="muted"><i className="live-dot" />fährt noch{r.z > 0 && r.z < Infinity ? ` · ${km(r.z)}` : ''}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ Lobby

/** Knopf auf der Spielkarte: „Zusammen“ – in einer Lobby mit Code und wer da ist */
export function LobbyButton() {
  const snap = useLive();
  const [open, setOpen] = useState(false);
  const lobby = snap?.lobby ?? null;
  const n = lobby ? lobby.members.filter((m) => m.seen_ms < 30_000).length : 0;
  return (
    <>
      <button type="button" className={cx('btn btn--secondary lobby-btn', lobby && 'is-on')} onClick={() => setOpen(true)} aria-label={lobby ? `Lobby ${lobby.code}, ${n} da` : 'Zusammen fahren – Lobby'}>
        <Icon name="users" size={18} />
        {lobby ? <span className="lobby-btn__code">{lobby.code}<small>{n}</small></span> : <span>Zusammen</span>}
      </button>
      {open ? <LobbySheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Lobby: eröffnen oder beitreten; drinnen Code, wer da ist, Rennen für alle starten, verlassen */
export function LobbySheet({ onClose, code: preset }: { onClose: () => void; code?: string }) {
  useLiveWatch();
  const snap = useLive();
  const { me } = useApp();
  const who = useMemberMap();
  const lobby = snap?.lobby ?? null;
  const [code, setCode] = useState(preset ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const close = () => { setLeaving(true); window.setTimeout(onClose, 220); };
  // Tastatur (iPhone): sie legt sich über den unteren Bildrand, ohne dass die Seite kleiner wird – das Blatt säße
  // dahinter. Die Ebene folgt deshalb dem wirklich sichtbaren Bereich (visualViewport): das Blatt steht über der Tastatur.
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const el = layer.current;
    if (!vv || !el) return undefined;
    const fit = () => {
      const covered = window.innerHeight - vv.height > 80;
      el.style.top = covered ? `${Math.max(0, vv.offsetTop)}px` : '';
      el.style.height = covered ? `${vv.height}px` : '';
      el.style.bottom = covered ? 'auto' : '';
      el.classList.toggle('is-typing', covered);
      // das Feld soll zu sehen sein, auch wenn das Blatt höher ist als der Platz über der Tastatur
      if (covered && document.activeElement === input.current) input.current?.scrollIntoView({ block: 'nearest' });
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const act = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try { await f(); } catch (e) { setErr(errorText(e)); } finally { setBusy(null); }
  };
  const share = async () => {
    if (!lobby) return;
    const url = `${location.origin}${location.pathname}#/?lobby=${lobby.code}`;
    const text = `Fahr mit mir bei gruppetto – Lobby-Code ${lobby.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'gruppetto Lobby', text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Code kopiert'); }
    } catch { /* abgebrochen */ }
  };
  const peers = new Map((snap?.peers ?? []).map((p) => [p.user_id, p]));
  const clean = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);

  return createPortal(
    <div ref={layer} className={cx('lobby-layer', leaving && 'is-leaving')} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="lobby-sheet" role="dialog" aria-modal="true" aria-labelledby="lobby-title">
        <div className="lobby-sheet__head">
          <span className="lobby-sheet__icon" aria-hidden="true"><Icon name="users" size={22} /></span>
          <div>
            <h2 id="lobby-title">{lobby ? 'Deine Lobby' : 'Zusammen fahren'}</h2>
            <p>{lobby ? 'Jeder hier kann ein Rennen starten – alle fahren gemeinsam los.' : 'Lobby eröffnen, Code teilen, gemeinsam starten.'}</p>
          </div>
          <button type="button" className="lobby-sheet__x" onClick={close} aria-label="Schließen"><Icon name="x" size={20} /></button>
        </div>

        {lobby ? (
          <>
            <div className="lobby-code">
              <span className="lobby-code__label">Code</span>
              <span className="lobby-code__chars" aria-label={`Code ${lobby.code.split('').join(' ')}`}>
                {lobby.code.split('').map((c, i) => <b key={i} style={{ animationDelay: `${i * 0.05}s` }}>{c}</b>)}
              </span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={share}><Icon name="share" size={16} /><span>Teilen</span></button>
            </div>
            <ul className="lobby-members">
              {lobby.members.map((m) => {
                const p = who(m.user_id);
                const peer = peers.get(m.user_id);
                const away = m.seen_ms >= 30_000 && !peer;
                const isMe = m.user_id === me.id;
                return (
                  <li key={m.user_id} className={cx(away && 'is-away')}>
                    <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color ?? '#888'} size={30} />
                    <span className="lobby-members__name"><b>{isMe ? 'Du' : first(p?.display_name)}</b>
                      <small>{isMe ? 'bist da' : peer ? peerText(peer) : away ? 'gerade nicht da' : 'ist da'}</small>
                    </span>
                    {peer?.state === 'race' ? <i className="live-dot" aria-label="fährt gerade" /> : null}
                  </li>
                );
              })}
            </ul>
            <h3 className="lobby-sheet__sub">Rennen für alle starten</h3>
            <div className="lobby-games">
              {GAMES.map((g) => (
                <button
                  key={g.id} type="button" className="lobby-game" disabled={!!busy}
                  onClick={() => act(`start:${g.id}`, async () => { await lobbyStart(g.id); close(); })}
                >
                  <GameBadge game={g.id} size={30} />
                  <span>{busy === `start:${g.id}` ? 'Startet …' : g.name}</span>
                </button>
              ))}
            </div>
            <p className="lobby-sheet__hint">Alle in der Lobby werden ins Spiel geholt, der Countdown endet für alle gleichzeitig. Im Rennen siehst du die anderen als Live-Geister.</p>
            {err ? <p className="lobby-sheet__err" role="alert">{err}</p> : null}
            <button type="button" className="btn btn--ghost btn--full" disabled={!!busy} onClick={() => act('leave', async () => { await lobbyLeave(); })}>
              <Icon name="logout" size={18} /><span>Lobby verlassen</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--full" disabled={!!busy} onClick={() => act('create', lobbyCreate)}>
              <Icon name="plus" size={18} /><span>{busy === 'create' ? 'Wird eröffnet …' : 'Lobby eröffnen'}</span>
            </button>
            <div className="lobby-or"><span>oder mit Code beitreten</span></div>
            <form className="lobby-join" onSubmit={(e) => { e.preventDefault(); if (clean.length === 4) void act('join', () => lobbyJoin(clean)); }}>
              <input
                ref={input} value={clean} onChange={(e) => setCode(e.target.value)} inputMode="text" autoCapitalize="characters" autoComplete="off"
                autoCorrect="off" spellCheck={false} maxLength={4} placeholder="CODE" aria-label="Lobby-Code" className="lobby-join__input"
              />
              <button type="submit" className="btn btn--secondary" disabled={clean.length !== 4 || !!busy}>{busy === 'join' ? 'Tritt bei …' : 'Beitreten'}</button>
            </form>
            {err ? <p className="lobby-sheet__err" role="alert">{err}</p> : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ Lobby-Rennen

const pathGame = (path: string): GameId | null => GAMES.find((g) => g.path === path)?.id ?? null;

/**
 * Einmal in der App: ein neues Lobby-Rennen holt einen ins Spiel (Startanimation, die Spielseite startet pünktlich).
 * Fährt man gerade selbst, kommt die Frage „Mitfahren?“. Ein Link mit ?lobby=CODE öffnet das Lobby-Blatt.
 */
export function LobbyDirector() {
  const route = useRoute();
  const race = useLobbyRace();
  const who = useMemberMap();
  const { me } = useApp();
  const directed = useRef<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const here = pathGame(route.path);
  const onPage = !!race && here === race.game;

  // Link mit Code: Lobby-Blatt mit dem Code öffnen
  const linkCode = route.query.get('lobby');
  useEffect(() => {
    if (linkCode && /^[A-Za-z0-9]{4}$/.test(linkCode)) setSheet(linkCode.toUpperCase());
  }, [linkCode]);

  useEffect(() => {
    if (!race || onPage || directed.current === race.key) return;
    directed.current = race.key;
    if (liveHub.racing) { setAsk(race.key); return; }
    const by = race.by && race.by !== me.id ? first(who(race.by)?.display_name) : null;
    toast(by ? `${by} startet ${gameInfo(race.game).name}` : `${gameInfo(race.game).name} startet`);
    openGame(race.game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race?.key, onPage]);

  const asking = race && ask === race.key && !onPage ? race : null;
  return (
    <>
      {asking ? (
        <div className="lobby-ask" role="alertdialog" aria-labelledby="lobby-ask-t">
          <GameBadge game={asking.game} size={28} />
          <span id="lobby-ask-t"><b>{asking.by && asking.by !== me.id ? first(who(asking.by)?.display_name) : 'Die Lobby'}</b> startet {gameInfo(asking.game).name}</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => { setAsk(null); openGame(asking.game); }}>Mitfahren</button>
          <button type="button" className="lobby-ask__x" aria-label="Nicht mitfahren" onClick={() => { setAsk(null); liveHub.done(asking.key); }}><Icon name="x" size={18} /></button>
        </div>
      ) : null}
      {sheet ? <LobbySheet code={sheet} onClose={() => setSheet(null)} /> : null}
    </>
  );
}
