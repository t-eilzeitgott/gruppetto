/**
 * Echtzeit-Kanal über Supabase Realtime (WebSocket, „Broadcast“) – schlank, ohne Zusatzpaket.
 *
 * Protokoll (Phoenix, Version 1.0.0): JSON-Textnachrichten { topic, event, payload, ref, join_ref }. Nach dem Öffnen
 * tritt man dem Kanal bei (phx_join), schickt Meldungen als „broadcast“ an alle anderen im Kanal und hält die
 * Verbindung mit einem Herzschlag (alle 20 s) offen. Reißt sie ab, wird neu verbunden (mit wachsender Pause).
 * Meldungen sind flüchtig: was nicht ankommt, ist weg – für Lage und Tempo im Rennen genau richtig.
 */

export interface RtConfig {
  /** Adresse des Projekts (https://….supabase.co) */
  url: string;
  /** öffentlicher Schlüssel */
  key: string;
  /** Anmeldung des Mitglieds (wird beim Beitritt mitgeschickt) */
  token: () => Promise<string | null>;
}

export type RtStatus = 'connecting' | 'open' | 'closed';

interface Frame { topic: string; event: string; payload: unknown; ref: string | null; join_ref?: string | null }

/** WebSocket-Adresse zum Projekt */
export function rtUrl(url: string, key: string): string {
  return `${url.replace(/^http/, 'ws').replace(/\/+$/, '')}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;
}

/** Nachricht zum Beitritt: nur Broadcast, eigene Meldungen nicht zurück, öffentlicher Kanal */
export function joinFrame(topic: string, token: string | null, ref: string): Frame {
  return {
    topic, event: 'phx_join', ref, join_ref: ref,
    payload: { config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, private: false }, ...(token ? { access_token: token } : {}) },
  };
}

/** Meldung an alle anderen im Kanal */
export function castFrame(topic: string, event: string, payload: unknown, ref: string, joinRef: string): Frame {
  return { topic, event: 'broadcast', ref, join_ref: joinRef, payload: { type: 'broadcast', event, payload } };
}

/** eingehende Nachricht lesen: Broadcast eines anderen → { event, payload }, sonst null */
export function readCast(raw: unknown, topic: string): { event: string; payload: unknown } | null {
  const f = raw as Partial<Frame> | null;
  if (!f || f.topic !== topic || f.event !== 'broadcast') return null;
  const p = f.payload as { event?: unknown; payload?: unknown } | null;
  return p && typeof p.event === 'string' ? { event: p.event, payload: p.payload } : null;
}

export class RtChannel {
  status: RtStatus = 'connecting';
  private ws: WebSocket | null = null;
  private ref = 0;
  private joinRef = '';
  private beat = 0;
  private retry = 0;
  private tries = 0;
  private closed = false;
  private readonly topic: string;

  /**
   * name: Name des Kanals (ohne „realtime:“); onCast: Meldung eines anderen; onStatus: verbunden / getrennt
   */
  constructor(private cfg: RtConfig, name: string, private onCast: (event: string, payload: unknown) => void, private onStatus?: (s: RtStatus) => void) {
    this.topic = `realtime:${name}`;
    void this.connect();
  }

  private set(s: RtStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  private async connect() {
    if (this.closed || typeof WebSocket === 'undefined') return;
    let token: string | null = null;
    try { token = await this.cfg.token(); } catch { /* ohne Anmeldung beitreten */ }
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(rtUrl(this.cfg.url, this.cfg.key));
    } catch {
      this.again();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.joinRef = String(++this.ref);
      ws.send(JSON.stringify(joinFrame(this.topic, token, this.joinRef)));
      window.clearInterval(this.beat);
      this.beat = window.setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) }));
      }, 20_000);
    };
    ws.onmessage = (m) => {
      if (typeof m.data !== 'string') return;
      let f: Frame;
      try { f = JSON.parse(m.data) as Frame; } catch { return; }
      if (f.event === 'phx_reply' && f.topic === this.topic && f.ref === this.joinRef) {
        const ok = (f.payload as { status?: string } | null)?.status === 'ok';
        if (ok) { this.tries = 0; this.set('open'); } else ws.close();
        return;
      }
      if ((f.event === 'phx_error' || f.event === 'phx_close') && f.topic === this.topic) { ws.close(); return; }
      const c = readCast(f, this.topic);
      if (c) this.onCast(c.event, c.payload);
    };
    ws.onclose = () => {
      if (this.ws === ws) { this.ws = null; this.again(); }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* egal */ } };
  }

  /** nach einem Abriss neu verbinden: 0,5 s, 1 s, 2 s … höchstens 8 s */
  private again() {
    window.clearInterval(this.beat);
    if (this.closed) return;
    this.set('connecting');
    window.clearTimeout(this.retry);
    this.retry = window.setTimeout(() => void this.connect(), Math.min(8000, 500 * 2 ** this.tries++));
  }

  /** Meldung an alle anderen (nur, wenn verbunden – sonst verfällt sie) */
  send(event: string, payload: unknown): boolean {
    const ws = this.ws;
    if (this.status !== 'open' || !ws || ws.readyState !== 1) return false;
    // staut sich die Leitung (schlechtes Netz), lieber auslassen als hinterherschicken
    if (ws.bufferedAmount > 4096) return false;
    ws.send(JSON.stringify(castFrame(this.topic, event, payload, String(++this.ref), this.joinRef)));
    return true;
  }

  close() {
    this.closed = true;
    window.clearInterval(this.beat);
    window.clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    this.set('closed');
    if (ws) {
      try {
        if (ws.readyState === 1) ws.send(JSON.stringify({ topic: this.topic, event: 'phx_leave', payload: {}, ref: String(++this.ref), join_ref: this.joinRef }));
        ws.close();
      } catch { /* egal */ }
    }
  }
}
