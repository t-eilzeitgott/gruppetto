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
 *  - Echtzeit: wer in einer Lobby ist, hängt zusätzlich an ihrem WebSocket-Kanal (realtime.ts). Im Lobby-Rennen
 *    schickt jeder dort bis zu zehnmal je Sekunde Lage und Tempo (weit auseinander seltener) und Rempler; die
 *    anderen stehen dadurch genau dort, wo sie gerade sind, und sind im Sprint echte Gegner (game/live.ts).
 *    Ohne Kanal (kein Netz, Demo) bleibt alles wie zuvor: Live-Geister aus den Meldungen an die Datenbank.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { source } from './config';
import { handOver, navigate } from './router';
import { gameIntroCovered, playGameIntro } from './gameIntro';
import { afterPaint } from '../lib/afterPaint';
import type { GameId, LiveLobby, LiveSnapshot } from '../data/source';
import type { Profile } from '../lib/types';
import { feedTime, gridIndex, liveTail, mergeTail, newFeed, rtFresh, rtSet, type LiveFeed, type LiveOut, type RtHit, type RtState } from '../game/live';
import { gameInfo } from '../game/games';
import { RtChannel, type RtStatus } from './realtime';

/** was eine Engine für Live können muss (Abfahrt, Sprint, Berg, Zeitfahren) */
export interface LiveEngine {
  liveOut(): LiveOut;
  setLive(feeds: LiveFeed[]): void;
  /** Echtzeit (Lobby-Rennen): eigener Stand jetzt – null, wenn gerade kein Rennen läuft */
  rtOut?(): (RtState & { down: boolean }) | null;
  /** Echtzeit: selbst bemerkte Rempler für die Betroffenen */
  takeHits?(): RtHit[];
  /** Echtzeit: ein Mitspieler meldet einen Rempler mit einem selbst */
  rtHit?(from: string, h: { power: number; role: 'v' | 'a'; dir: -1 | 1 }): void;
}

/** Gruppe, wenn sie für Echtzeit-Rennen freigeschaltet ist (sonst '') – einmal je Sitzung gefragt */
let rtGroupP: Promise<string> | null = null;
function rtGroup(): Promise<string> {
  rtGroupP ??= source.loadGroup().then((g) => (g?.realtime ? g.id : ''), () => { rtGroupP = null; return ''; });
  return rtGroupP;
}

/** so oft (ms) geht die eigene Lage an die Lobby: dicht beieinander und weit auseinander */
const RT_NEAR_MS = 100;
const RT_FAR_MS = 400;
/** „dicht beieinander“: nächster Mitspieler näher als so viele Meter */
const RT_NEAR_M = 70;

/** Echtzeit-Meldung im Lobby-Kanal: Lage (cm), Tempo (cm/s), Haltung, Stand (1 fährt, 2 fertig), Serverzeit */
interface PosMsg { u: string; c: string; r: string; k: string | null; s: number; z: number; x: number; v: number; vx: number; m: number; w: number; b: string; t: number }
interface HitMsg { u: string; to: string; k: string | null; p: number; r: 'v' | 'a'; d: -1 | 1 }
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);



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
  /** Serverzeit − eigene Uhr (ms) – aus den Abfragen mit der kürzesten Laufzeit (die genauesten) */
  offset = 0;
  private bestRtt = Infinity;
  /** Echtzeit-Kanal der Lobby: verbunden? (null: kein Kanal) */
  rt: RtStatus | null = null;
  /** Lobby-Rennen, zu dem der nächste eigene Lauf gehört (gesetzt beim pünktlichen Start) */
  pendingRace: string | null = null;
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
    if (snap) {
      // die Uhr nur aus schnellen Abfragen stellen: je kürzer der Weg, desto genauer die Mitte
      const rtt = recv - sent;
      if (rtt >= 0 && rtt <= this.bestRtt + 40) this.offset = snap.now - (sent + recv) / 2;
      this.bestRtt = rtt >= 0 ? Math.min(this.bestRtt + 2, Math.max(rtt, 20)) : this.bestRtt;
    }
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
  /** grid: Startplatz im Lobby-Rennen (nebeneinander), sonst nicht gesetzt */
  start: (grid?: number) => void;
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
    /** Lobby-Rennen, zu dem der laufende Lauf gehört (dann Echtzeit mit den anderen daraus) */
    let myRace: string | null = null;
    const meId = source.currentUser()?.id ?? '';
    const courseKey = `${game}|${course}`;

    /** Stand der Engine; ein neuer Lauf bekommt eine neue Kennung (die anderen fangen eine neue Spur an) */
    const current = (): { out: LiveOut; n: number } => {
      const eng = opts.current.engineRef.current;
      const out: LiveOut = eng?.liveOut ? eng.liveOut() : { state: 'menu', trace: [] };
      const n = Math.floor(out.trace.length / 3);
      if (out.state !== 'menu' && (lastState === 'menu' || n < lastN || !run)) {
        run = Math.random().toString(36).slice(2, 10);
        myRace = liveHub.pendingRace;
        liveHub.pendingRace = null;
      }
      if (out.state === 'menu') myRace = null;
      lastState = out.state;
      lastN = n;
      return { out, n };
    };
    const publish = () => {
      liveHub.feeds = [...feeds.values()];
      opts.current.engineRef.current?.setLive?.(liveHub.feeds);
    };
    const feedFor = (userId: string, runId: string, bike: string): LiveFeed => {
      let f = feeds.get(userId);
      if (!f || f.run !== runId) {
        const m = opts.current.members?.find((x) => x.id === userId);
        f = newFeed({ userId, name: m?.display_name ?? 'Jemand', color: m?.avatar_color ?? '#888888', bike, run: runId });
        feeds.set(userId, f);
      }
      return f;
    };

    // ---- Echtzeit: Kanal der Lobby
    let chan: RtChannel | null = null;
    let chanName = '';
    let lastSent = 0;
    let wasRacing = false;
    let runStart = 0;
    const onCast = (event: string, payload: unknown) => {
      if (!on) return;
      if (event === 'pos') {
        const m = payload as Partial<PosMsg> | null;
        if (!m || typeof m.u !== 'string' || m.u === meId || m.c !== courseKey || typeof m.r !== 'string' || !m.r) return;
        if (!isNum(m.z) || !isNum(m.x) || !isNum(m.v) || !isNum(m.vx) || !isNum(m.t)) return;
        const fresh = !feeds.has(m.u) || feeds.get(m.u)!.run !== m.r;
        const f = feedFor(m.u, m.r, typeof m.b === 'string' ? m.b : '');
        // Alter der Meldung über die Serverzeit; ist die Uhr daneben, ein üblicher Wert
        let age = Date.now() + liveHub.offset - m.t;
        if (!(age > -200 && age < 1500)) age = 60;
        rtSet(f, { z: m.z / 100, x: m.x / 100, v: Math.max(0, m.v / 100), vx: m.vx / 100, m: isNum(m.m) ? m.m : 0 }, Math.max(0, age), performance.now());
        f.solid = !!m.k && m.k === myRace;
        f.racing = m.s === 1;
        f.down = m.w === 1;
        if (fresh) publish();
      } else if (event === 'hit') {
        const h = payload as Partial<HitMsg> | null;
        if (!h || h.to !== meId || typeof h.u !== 'string' || !h.k || h.k !== myRace || !isNum(h.p)) return;
        opts.current.engineRef.current?.rtHit?.(h.u, { power: h.p, role: h.r === 'a' ? 'a' : 'v', dir: h.d === -1 ? -1 : 1 });
      }
    };
    /** am Kanal der eigenen Lobby hängen (nur dort – und nur, wenn die Gruppe für Echtzeit-Rennen freigeschaltet ist) */
    let group = '';
    const syncChannel = () => {
      const code = liveHub.lobby?.code ?? '';
      const cfg = source.rtConfig();
      const name = on && code && group && cfg ? `gruppetto:lobby:${group}:${code}` : '';
      if (name === chanName) return;
      chan?.close();
      chan = null;
      chanName = name;
      liveHub.rt = null;
      if (name && cfg) chan = new RtChannel(cfg, name, onCast, (s) => { liveHub.rt = s === 'closed' ? null : s; liveHub.emit(); });
      liveHub.emit();
    };
    const unsub = liveHub.subscribe(syncChannel);
    if (source.rtConfig()) {
      void rtGroup().then((g) => { group = g; if (on) syncChannel(); });
    }

    const sendPos = (st: RtState & { down: boolean }, s: number) => chan?.send('pos', {
      u: meId, c: courseKey, r: run, k: myRace, s, z: Math.round(st.z * 100), x: Math.round(st.x * 100), v: Math.round(st.v * 100),
      vx: Math.round(st.vx * 100), m: st.m, w: st.down ? 1 : 0, b: opts.current.bike, t: Math.round(Date.now() + liveHub.offset),
    } satisfies PosMsg);
    let lastSt: (RtState & { down: boolean }) | null = null;
    const rtTick = () => {
      if (!on || !chan || chan.status !== 'open' || document.hidden) return;
      const eng = opts.current.engineRef.current;
      const st = eng?.rtOut?.() ?? null;
      const now = performance.now();
      if (st) {
        current();
        if (!myRace) return;
        if (!wasRacing) { wasRacing = true; runStart = now; }
        for (const h of eng?.takeHits?.() ?? []) chan.send('hit', { u: meId, to: h.to, k: myRace, p: Math.round(h.power * 100) / 100, r: h.role, d: h.dir } satisfies HitMsg);
        // dicht beieinander oft, weit auseinander selten (schont das Kontingent an Nachrichten)
        let near = Infinity;
        for (const f of feeds.values()) if (f.rt && rtFresh(f, now)) near = Math.min(near, Math.abs(f.rt.z - st.z));
        const every = near < RT_NEAR_M || now - runStart < 6000 ? RT_NEAR_MS : RT_FAR_MS;
        if (now - lastSent >= every - 8) { lastSent = now; sendPos(st, 1); }
        lastSt = st;
      } else if (wasRacing) {
        // fertig (Ziel, abgebrochen): einmal sagen, damit die anderen einen nicht weiter fortschreiben
        wasRacing = false;
        eng?.takeHits?.();
        if (lastSt && myRace) sendPos(lastSt, 2);
      }
    };
    const rtTimer = window.setInterval(rtTick, 50);

    const tick = async () => {
      if (!on || running) return;
      if (document.hidden) { timer = window.setTimeout(tick, 1000); return; }
      running = true;
      const { out, n } = current();
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
          // die Echtzeit kennt schon einen neueren Lauf: die ältere Meldung der Datenbank nicht darüberlegen
          const cur = feeds.get(p.user_id);
          if (cur && cur.run !== p.run && rtFresh(cur, t1)) continue;
          const f = feedFor(p.user_id, p.run, p.bike);
          mergeTail(f, p.n, p.tail);
          feedTime(f, p.age_ms + half, t1);
          if (!rtFresh(f, t1)) f.racing = p.state === 'race';
        }
        for (const [id, f] of feeds) if (!seen.has(id) && !rtFresh(f, t1)) { f.gone = true; feeds.delete(id); }
        publish();
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
      window.clearInterval(rtTimer);
      unsub();
      chan?.close();
      chan = null;
      liveHub.rt = null;
      liveHub.pendingRace = null;
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
        // alle aus der Lobby starten nebeneinander: fester Platz je Mitglied, der Lauf gehört zu diesem Rennen
        liveHub.pendingRace = mine.key;
        opts.current.start(gridIndex(liveHub.lobby?.members ?? [], source.currentUser()?.id ?? ''));
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
