import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { source } from '../app/config';
import { useQuery } from '../app/query';
import { RtChannel } from '../app/realtime';
import { errorText } from '../data/source';
import {
  REACTIONS, REACTION_LABEL, arrivals, isReaction, recentPeople, summarize, toggle,
  type ReactionEmoji, type StageReaction,
} from '../lib/reactions';
import type { Group, Profile, Stage } from '../lib/types';
import { Avatar, cx, toast } from './kit';

/** so oft wird nachgeladen (ms): ohne bzw. mit Echtzeit-Kanal */
const POLL_MS = 20_000;
const POLL_RT_MS = 60_000;
/** höchstens so viele schwebende Reaktionen anderer gleichzeitig */
const MAX_FLOATS = 6;

interface Burst { id: number; emoji: ReactionEmoji }
interface Float { id: number; emoji: ReactionEmoji; name: string; color: string; x: number }

let seq = 0;
const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Emoji-Reaktionen der Runde zu einer Etappe – mit Animation beim Setzen und wenn andere reagieren */
export function StageReactions({ stage, me, members }: { stage: Stage; me: Profile; members: Profile[] }) {
  const [rows, setRows] = useState<StageReaction[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [bursts, setBursts] = useState<Record<string, Burst | undefined>>({});
  const [floats, setFloats] = useState<Float[]>([]);
  const [live, setLive] = useState(false);
  const rowsRef = useRef<StageReaction[] | null>(null);
  rowsRef.current = rows;
  const busy = useRef(new Set<ReactionEmoji>());
  const chan = useRef<RtChannel | null>(null);
  const group = useQuery<Group | null>('group', () => source.loadGroup()).data;
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  /** andere haben reagiert: kurz von unten aufsteigen lassen */
  const showArrivals = useCallback((list: StageReaction[]) => {
    if (!list.length || reduceMotion() || document.visibilityState !== 'visible') return;
    const add = list.slice(-MAX_FLOATS).map((r, i) => {
      const m = byId.get(r.user_id);
      return { id: ++seq, emoji: r.emoji, name: m?.display_name ?? '?', color: m?.avatar_color ?? '#888', x: 8 + ((seq * 37 + i * 23) % 70) };
    });
    setFloats((f) => [...f, ...add].slice(-MAX_FLOATS));
    for (const f of add) window.setTimeout(() => setFloats((all) => all.filter((x) => x.id !== f.id)), 3200);
  }, [byId]);

  const refresh = useCallback(async (animate: boolean) => {
    try {
      const next = await source.loadReactions(stage.id);
      const prev = rowsRef.current;
      // eigene, noch unterwegs befindliche Änderungen nicht überschreiben
      const merged = busy.current.size && prev
        ? [...next.filter((r) => r.user_id !== me.id || !busy.current.has(r.emoji)), ...prev.filter((r) => r.user_id === me.id && busy.current.has(r.emoji))]
        : next;
      if (animate && prev) showArrivals(arrivals(prev, merged, me.id).filter((r) => memberIds.has(r.user_id)));
      setRows(merged);
      setFailed(false);
    } catch {
      if (!rowsRef.current) setFailed(true);
    }
  }, [stage.id, me.id, memberIds, showArrivals]);

  // laden und regelmäßig nachladen, solange die Seite sichtbar ist
  useEffect(() => {
    setRows(null);
    void refresh(false);
    let t = 0;
    const loop = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void refresh(true);
        loop();
      }, chan.current?.status === 'open' ? POLL_RT_MS : POLL_MS);
    };
    loop();
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);

  // Echtzeit: nur für Gruppen mit freigeschaltetem Kanal (Kontingent des Projekts)
  useEffect(() => {
    const cfg = source.rtConfig();
    if (!cfg || !group?.realtime || !group.id) return;
    const ch = new RtChannel(cfg, `gruppetto:react:${group.id}:${stage.id}`, (event, payload) => {
      if (event !== 'r') return;
      const p = payload as { u?: unknown; e?: unknown; on?: unknown } | null;
      if (!p || typeof p.u !== 'string' || !memberIds.has(p.u) || p.u === me.id || !isReaction(p.e)) return;
      const r: StageReaction = { stage_id: stage.id, user_id: p.u, emoji: p.e, created_at: new Date(source.now()).toISOString() };
      const prev = rowsRef.current ?? [];
      const exists = prev.some((x) => x.user_id === r.user_id && x.emoji === r.emoji);
      if (p.on === true && !exists) showArrivals([r]);
      setRows((cur) => toggle(cur ?? [], r, p.on === true));
    }, (s) => setLive(s === 'open'));
    chan.current = ch;
    return () => { ch.close(); chan.current = null; setLive(false); };
  }, [group?.realtime, group?.id, stage.id, me.id, memberIds, showArrivals]);

  const press = async (emoji: ReactionEmoji, mine: boolean) => {
    if (busy.current.has(emoji) || !rows) return;
    const on = !mine;
    const r: StageReaction = { stage_id: stage.id, user_id: me.id, emoji, created_at: new Date(source.now()).toISOString() };
    busy.current.add(emoji);
    setRows((cur) => toggle(cur ?? [], r, on));
    if (on) {
      const id = ++seq;
      setBursts((b) => ({ ...b, [emoji]: { id, emoji } }));
      window.setTimeout(() => setBursts((b) => (b[emoji]?.id === id ? { ...b, [emoji]: undefined } : b)), 900);
      try { navigator.vibrate?.(8); } catch { /* egal */ }
    }
    chan.current?.send('r', { u: me.id, e: emoji, on });
    try {
      await source.setReaction(stage.id, emoji, on);
    } catch (err) {
      setRows((cur) => toggle(cur ?? [], r, !on));
      toast(errorText(err));
    } finally {
      busy.current.delete(emoji);
    }
  };

  if (failed) return null;
  const summary = rows ? summarize(rows, me.id, memberIds) : null;
  const total = summary?.reduce((n, s) => n + s.count, 0) ?? 0;
  const people = rows ? recentPeople(rows.filter((r) => memberIds.has(r.user_id)), 5) : [];
  const allPeople = rows ? new Set(rows.filter((r) => memberIds.has(r.user_id)).map((r) => r.user_id)).size : 0;
  const names = people.slice(0, 2).map((p) => (p.user_id === me.id ? 'du' : byId.get(p.user_id)?.display_name ?? '?'));

  return (
    <section className="card reactions" aria-labelledby={`react-${stage.id}`}>
      <div className="card__row">
        <span id={`react-${stage.id}`} className="eyebrow">Stimmung der Runde</span>
        <span className="reactions__meta muted">
          {live ? <span className="reactions__live" title="Live verbunden" /> : null}
          {total ? `${total} ${total === 1 ? 'Reaktion' : 'Reaktionen'}` : 'Noch still'}
        </span>
      </div>

      <div className="reactions__bar" role="group" aria-label="Reagieren">
        {(summary ?? REACTIONS.map((emoji) => ({ emoji, count: 0, mine: false, users: [] as string[] }))).map((s) => {
          const burst = bursts[s.emoji];
          return (
            <button
              key={s.emoji}
              type="button"
              className={cx('react-btn', s.mine && 'is-mine', burst && 'is-pop', !summary && 'is-loading')}
              aria-pressed={s.mine}
              aria-label={`${REACTION_LABEL[s.emoji]}${s.count ? `, ${s.count}` : ''}`}
              disabled={!summary}
              onClick={() => void press(s.emoji, s.mine)}
            >
              <span className="react-btn__emoji" key={`e${burst?.id ?? 0}`}>{s.emoji}</span>
              <span className="react-btn__count" key={`c${s.count}`}>{s.count || ' '}</span>
              {burst ? (
                <span className="react-burst" key={`b${burst.id}`} aria-hidden="true">
                  <span className="react-burst__ring" />
                  <span className="react-burst__rise">{burst.emoji}</span>
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <span key={i} className="react-burst__dot" style={{ '--a': `${i * (360 / 7) + 12}deg` } as CSSProperties} />
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {people.length ? (
        <div className="reactions__people">
          <span className="reactions__faces">
            {people.map((p) => {
              const m = byId.get(p.user_id);
              return (
                <span key={p.user_id} className="reactions__face" title={`${m?.display_name ?? ''} ${p.emojis.join(' ')}`}>
                  <Avatar name={m?.display_name} color={m?.avatar_color ?? '#888'} size={26} />
                  <span className="reactions__badge" key={p.emojis[0]}>{p.emojis[0]}</span>
                </span>
              );
            })}
          </span>
          <span className="reactions__names muted">
            {names.join(', ')}{allPeople > names.length ? ` und ${allPeople - names.length} weitere` : ''}
          </span>
        </div>
      ) : summary ? <p className="hint">Sei die erste Stimme zu dieser Etappe.</p> : null}

      {floats.length ? (
        <div className="react-floats" aria-hidden="true">
          {floats.map((f) => (
            <span key={f.id} className="react-float" style={{ left: `${f.x}%` }}>
              <span className="react-float__emoji">{f.emoji}</span>
              <span className="react-float__name" style={{ '--c': f.color } as CSSProperties}>{f.name}</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
