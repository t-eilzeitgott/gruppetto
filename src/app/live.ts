/**
 * Live und Lobby in den Minispielen – Verbindung zur Datenbank (game_live, game_lobbies; supabase/schema.sql).
 *
 *  - liveHub: letzter Stand (wer gerade im Spiel ist, eigene Lobby, Serverzeit). Solange keine Spielseite meldet,
 *    fragt er nach – auf der Startseite alle 7 s, in einer Lobby alle 1,5 s (Rennstarts sollen schnell ankommen).
 *  - useLiveGame (je Spielseite): meldet den eigenen Stand (im Rennen ein- bis zweimal je Sekunde mit den letzten
 *    Proben der Fahrspur), baut aus den Meldungen der anderen auf derselben Strecke die Live-Geister (game/live.ts)
 *    und gibt sie der Engine; startet ein Lobby-Rennen pünktlich (Countdown endet für alle zur selben Serverzeit).
 *  - LobbyDirector (einmal in der App): ein neues Lobby-Rennen holt einen ins Spiel – außer man fährt gerade selbst,
 *    dann kommt die Frage „Mitfahren?“.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { source } from './config';
import { handOver, navigate } from './router';
import { gameIntroCovered, playGameIntro } from './gameIntro';
import { afterPaint } from '../lib/afterPaint';
import type { GameId, LiveLobby, LiveSnapshot } from '../data/source';
import type { Profile } from '../lib/types';
import { feedTime, liveTail, mergeTail, newFeed, type LiveFeed, type LiveOut } from '../game/live';
import { gameInfo } from '../game/games';

/** was eine Engine für Live können muss (Abfahrt, Sprint, Berg, Zeitfahren) */
export interface LiveEngine {
  liveOut(): LiveOut;
  setLive(feeds: LiveFeed[]): void;
}

/** Countdown bis „Los“ je Spiel (s): das Lobby-Rennen startet so viel vor der gemeinsamen Startzeit */
export const COUNT_S: Record<GameId, number> = { zeitfahren: 3, abfahrt: 2.25, sprint: 2.25, berg: 2.25 };

/** ein gestartetes Lobby-Rennen, das man noch nicht gefahren (oder abgelehnt) hat */
export interface LobbyRace {
  key: string;
  game: GameId;
  /** „Los“ in der eigenen Uhr (ms, Date.now) */
  at: number;
  by: string | null;
}

const DONE_KEY = 'gruppetto.lobby.done';

class LiveHub {
  snap: LiveSnapshot | null = null;
  /** Serverzeit − eigene Uhr (ms) */
  offset = 0;
  /** Live-Geister der offenen Spielseite (Anzeige im Rennen) */
  feeds: LiveFeed[] = [];
  /** man fährt gerade selbst ein Rennen */
  racing = false;
  /** eigenes Ergebnis des letzten Laufs (Lobby-Wertung) */
  myScore: number | null = null;
  /** offene Spielseiten (die melden selbst) */
  sessions = 0;
  private watchers = 0;
  private subs = new Set<() => void>();
  private timer = 0;
  private busy = false;
  private handled: string | null = null;
  private version = 0;

  constructor() {
    try { this.handled = sessionStorage.getItem(DONE_KEY); } catch { /* egal */ }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.schedule(0); });
    }
  }

  subscribe = (cb: () => void) => {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    for (const cb of [...this.subs]) cb();
  }

  /** neuer Stand vom Server (sent: Date.now beim Abschicken – für die Serverzeit) */
  apply(snap: LiveSnapshot | null, sent: number) {
    const recv = Date.now();
    if (snap) this.offset = snap.now - (sent + recv) / 2;
    this.snap = snap;
    this.emit();
    this.schedule();
  }

  get lobby(): LiveLobby | null {
    return this.snap?.lobby ?? null;
  }

  /** anstehendes Lobby-Rennen (bis 8 s nach „Los“ kann man noch nachkommen) */
  race(): LobbyRace | null {
    const l = this.lobby;
    if (!l || !l.seq || !l.game || !l.at) return null;
    const key = `${l.code}:${l.seq}`;
    if (key === this.handled) return null;
    const at = l.at - this.offset;
    if (Date.now() > at + 8000) return null;
    return { key, game: l.game, at, by: l.by };
  }

  /** Lobby-Rennen erledigt (gestartet oder abgelehnt) */
  done(key: string) {
    this.handled = key;
    try { sessionStorage.setItem(DONE_KEY, key); } catch { /* egal */ }
    this.emit();
  }

  /** Startseite (oder Lobby-Blatt) schaut zu: regelmäßig nachfragen */
  watch(): () => void {
    this.watchers++;
    this.schedule(0);
    return () => { this.watchers--; };
  }

  /** nächste Abfrage – nur, wenn keine Spielseite meldet und jemand zuschaut oder man in einer Lobby ist */
  schedule(delay?: number) {
    if (typeof window === 'undefined') return;
    window.clearTimeout(this.timer);
    if (this.sessions > 0) return;
    if (this.watchers <= 0 && !this.lobby) return;
    this.timer = window.setTimeout(() => void this.poll(), delay ?? (this.lobby ? 1500 : 7000));
  }

  async refresh() {
    const sent = Date.now();
    this.apply(await source.liveList(), sent);
  }

  private async poll() {
    if (this.sessions > 0 || this.busy) return;
    if (document.hidden || !source.currentUser()) { this.schedule(); return; }
    this.busy = true;
    try {
      await this.refresh();
    } catch {
      this.schedule();
    } finally {
      this.busy = false;
    }
  }
}

export const liveHub = new LiveHub();

/** letzter Stand (zeichnet bei jeder Meldung neu) */
export function useLive(): LiveSnapshot | null {
  useSyncExternalStore(liveHub.subscribe, liveHub.getVersion);
  return liveHub.snap;
}

/** solange die Komponente steht, regelmäßig nachfragen (Startseite, Lobby-Blatt) */
export function useLiveWatch() {
  useEffect(() => liveHub.watch(), []);
}

// ------------------------------------------------------------------ Lobby

export async function lobbyCreate(): Promise<string> {
  const code = await source.lobbyCreate();
  await liveHub.refresh();
  return code;
}

export async function lobbyJoin(code: string): Promise<string> {
  const c = await source.lobbyJoin(code);
  // ein schon laufendes Rennen der Lobby nicht nachträglich anspringen
  await liveHub.refresh();
  const l = liveHub.lobby;
  if (l?.seq) liveHub.done(`${l.code}:${l.seq}`);
  return c;
}

export async function lobbyLeave(): Promise<void> {
  await source.lobbyLeave();
  if (liveHub.snap) liveHub.apply({ ...liveHub.snap, lobby: null }, Date.now() - liveHub.offset);
}

export async function lobbyStart(game: GameId): Promise<void> {
  const sent = Date.now();
  liveHub.apply(await source.lobbyStart(game), sent);
}

/** Spiel öffnen wie von der Spielkarte: Startanimation, dann die Seite */
export function openGame(game: GameId, sub = 'Lobby-Rennen') {
  const g = gameInfo(game);
  playGameIntro(g.id, { title: g.name, sub });
  handOver();
  void gameIntroCovered().then(() => afterPaint(() => navigate(g.path)));
}

// ------------------------------------------------------------------ Spielseite

export interface LiveGameOpts {
  game: GameId;
  /** Strecke (Tag und Vorlage): Live-Geister nur von denen auf derselben */
  course: string;
  bike: string;
  engineRef: RefObject<LiveEngine | null>;
  /** im Startblatt oder beim Ergebnis (ein Lobby-Rennen darf starten) */
  canStart: () => boolean;
  start: () => void;
  /** eigenes Ergebnis, wenn fertig (wie in game_scores) */
  score: number | null;
  members: Profile[] | undefined;
}

/**
 * Live auf der Spielseite: eigenen Stand melden, Live-Geister bauen, Lobby-Rennen pünktlich starten. Gibt das
 * anstehende Lobby-Rennen für dieses Spiel zurück (für die Anzeige im Startblatt).
 */
export function useLiveGame(o: LiveGameOpts): LobbyRace | null {
  const opts = useRef(o);
  opts.current = o;
  const { game, course } = o;
  useEffect(() => {
    liveHub.myScore = o.score;
    liveHub.emit();
  }, [o.score]);

  useEffect(() => {
    liveHub.sessions++;
    liveHub.schedule();
    const feeds = new Map<string, LiveFeed>();
    let on = true;
    let timer = 0;
    let running = false;
    let run = '';
    let lastN = 0;
    let lastState: LiveOut['state'] = 'menu';

    const tick = async () => {
      if (!on || running) return;
      if (document.hidden) { timer = window.setTimeout(tick, 1000); return; }
      running = true;
      const eng = opts.current.engineRef.current;
      const out: LiveOut = eng?.liveOut ? eng.liveOut() : { state: 'menu', trace: [] };
      const n = Math.floor(out.trace.length / 3);
      // neuer Lauf: neue Kennung (die anderen fangen eine neue Spur an)
      if (out.state !== 'menu' && (lastState === 'menu' || n < lastN || !run)) run = Math.random().toString(36).slice(2, 10);
      lastState = out.state;
      lastN = n;
      liveHub.racing = out.state === 'race';
      const sent = Date.now();
      const t0 = performance.now();
      try {
        const snap = await source.livePing({
          game, course, state: out.state, run: out.state === 'menu' ? '' : run, n: out.state === 'menu' ? 0 : n,
          tail: out.state === 'menu' ? [] : liveTail(out.trace), bike: opts.current.bike,
          score: out.state === 'over' ? opts.current.score : null,
        });
        if (!on) return;
        const t1 = performance.now();
        const half = (t1 - t0) / 2;
        const seen = new Set<string>();
        for (const p of snap?.peers ?? []) {
          if (p.game !== game || p.course !== course || p.state === 'menu' || !p.tail || p.tail.length < 3 || p.n < 1) continue;
          seen.add(p.user_id);
          let f = feeds.get(p.user_id);
          if (!f || f.run !== p.run) {
            const m = opts.current.members?.find((x) => x.id === p.user_id);
            f = newFeed({ userId: p.user_id, name: m?.display_name ?? 'Jemand', color: m?.avatar_color ?? '#888888', bike: p.bike, run: p.run });
            feeds.set(p.user_id, f);
          }
          mergeTail(f, p.n, p.tail);
          feedTime(f, p.age_ms + half, t1);
          f.racing = p.state === 'race';
        }
        for (const [id, f] of feeds) if (!seen.has(id)) { f.gone = true; feeds.delete(id); }
        liveHub.feeds = [...feeds.values()];
        opts.current.engineRef.current?.setLive?.(liveHub.feeds);
        liveHub.apply(snap, sent);
      } catch {
        /* Netz weg: die Geister fahren noch kurz weiter und bleiben dann stehen */
      } finally {
        running = false;
      }
      if (!on) return;
      const racingPeers = liveHub.feeds.some((f) => f.racing);
      const ms = out.state === 'race' ? (racingPeers ? 500 : 1000) : liveHub.race() ? 1000 : out.state === 'over' ? 2000 : 2500;
      timer = window.setTimeout(tick, ms);
    };
    void tick();

    const onVis = () => {
      if (document.hidden) void source.liveLeave(true).catch(() => undefined);
      else { window.clearTimeout(timer); void tick(); }
    };
    const onHide = () => { void source.liveLeave(true).catch(() => undefined); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      on = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      liveHub.sessions--;
      liveHub.feeds = [];
      liveHub.racing = false;
      liveHub.myScore = null;
      void source.liveLeave().catch(() => undefined);
      liveHub.schedule(0);
    };
  }, [game, course]);

  // Lobby-Rennen für dieses Spiel: pünktlich starten (der Countdown endet zur gemeinsamen Startzeit)
  const race = useLobbyRace();
  const mine = race && race.game === game ? race : null;
  useEffect(() => {
    if (!mine) return undefined;
    const fire = () => {
      if (liveHub.race()?.key !== mine.key) return;
      liveHub.done(mine.key);
      if (opts.current.canStart()) {
        opts.current.start();
        // die Live-Geister gleich in die frische Engine (nicht erst mit der nächsten Meldung)
        window.setTimeout(() => opts.current.engineRef.current?.setLive?.(liveHub.feeds), 0);
      }
    };
    const t = window.setTimeout(fire, Math.max(0, mine.at - COUNT_S[game] * 1000 - Date.now()));
    return () => window.clearTimeout(t);
  }, [mine?.key, game]);
  return mine;
}

/** anstehendes Lobby-Rennen (zeichnet neu, wenn sich der Stand ändert) */
export function useLobbyRace(): LobbyRace | null {
  useSyncExternalStore(liveHub.subscribe, liveHub.getVersion);
  return liveHub.race();
}

/** Sekunden bis zu einem Zeitpunkt (ms, Date.now), viermal je Sekunde neu */
export function useSecondsTo(at: number | null): number | null {
  const [, setN] = useState(0);
  useEffect(() => {
    if (at === null) return undefined;
    const iv = window.setInterval(() => setN((x) => x + 1), 250);
    return () => window.clearInterval(iv);
  }, [at]);
  return at === null ? null : Math.max(0, (at - Date.now()) / 1000);
}
