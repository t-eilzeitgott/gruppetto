/**
 * Welt-Editor (Admin → Welt): frei durch die 3D-Welt eines Minispiels fliegen, Requisiten setzen oder
 * entfernen, Hügel und Mulden ins Gelände drücken, Notizen mit Kamerastand hinterlassen – und alles als
 * JSON exportieren (Vorlage für die Streckengeneratoren, siehe worldEdits.ts).
 *
 * Jede Tagesstrecke entsteht aus ihrem Seed, darum wählt man hier Spiel und Tag. Änderungen gelten
 * genau für diese Strecke und liegen in der Datenbank (world_edits) sowie als Kopie im Browser.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { acquireStage, releaseStage, type Stage } from '../../game/abfahrt/pool';
import { useApp } from '../../app/context';
import { useMembers, useTourData } from '../../app/hooks';
import { navigate } from '../../app/router';
import { source } from '../../app/config';
import type { Player, RaceView } from '../../game/abfahrt/engine';
import { Renderer3D } from '../../game/abfahrt/render3d';
import { FrameClock } from '../../game/frameClock';
import { storedQuality } from '../../game/abfahrt/quality';
import { EDGE, SEG, Track, type Section } from '../../game/abfahrt/track';
import { berlinDayKey } from '../../game/abfahrt/rng';
import { stageRef } from '../../game/abfahrt/stageRef';
import type { Marker } from '../../game/abfahrt/editor3d';
import {
  GAME_KIND, PLACEABLE, editsKey, emptyEdits, exportText, isEmptyEdits, newId, normalizeEdits, spriteName,
  type PlacedSprite, type TerrainBump, type WorldEdits, type WorldGame, type WorldNote,
} from '../../game/abfahrt/worldEdits';
import { Segmented, cx, toast, useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';

const readAccent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5fa2';

type Tool = 'fly' | 'place' | 'terrain' | 'note' | 'delete';
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'fly', label: 'Fliegen', hint: 'Links: Knüppel zum Bewegen · rechts ziehen: umsehen' },
  { id: 'place', label: 'Setzen', hint: 'Antippen setzt die gewählte Requisite' },
  { id: 'terrain', label: 'Gelände', hint: 'Antippen hebt oder senkt das Gelände dort' },
  { id: 'note', label: 'Notiz', hint: 'Antippen setzt eine Notiz mit deinem Blick' },
  { id: 'delete', label: 'Löschen', hint: 'Antippen entfernt die Requisite, Notiz oder Geländeänderung daneben' },
];
const GAME_LABEL: Record<WorldGame, string> = { abfahrt: 'Abfahrt', sprint: 'Sprint', berg: 'Berg' };
const SPEEDS = [0.5, 1, 2, 5, 12];
const LS = (key: string) => `gruppetto.world.${key}`;

interface Cam { x: number; y: number; z: number; yaw: number; pitch: number }
interface Pending { kind: 'note'; at: [number, number, number]; track: { z: number; x: number } }

/** Blick der Welt für den Renderer: kein Fahrer, keine Gegner – nur die Strecke (Phase „ready“: großzügig vorbauen) */
class WorldView implements RaceView {
  phase: RaceView['phase'] = 'ready';
  phaseT = 0;
  opps: RaceView['opps'] = [];
  popups: RaceView['popups'] = [];
  parts: RaceView['parts'] = [];
  friends: RaceView['friends'] = [];
  shake = 0;
  crashSpin = 0;
  p: Player;
  constructor(public track: Track, accent: string) {
    this.p = {
      z: 2, x: 0, vx: 0, v: 0, y: 0, vy: 0, air: false, airT: 0, lean: 0, pedal: 0, tuck: 0, brake: 0, wobble: 0, slip: 0, grip: 1, slick: 0,
      kit: { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '27', bike: 'start' },
    };
    this.p.y = track.heightAt(this.p.z);
  }
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (day: string) => {
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y.slice(2)}`;
};
const m = (v: number) => `${Math.round(v)} m`;

export function WorldEditorPage() {
  useTitle('Welt-Editor');
  const { tour } = useApp();
  const tourData = useTourData(tour);
  const members = useMembers();
  const [game, setGame] = useState<WorldGame>('abfahrt');
  const [day, setDay] = useState(() => berlinDayKey());
  const names = useMemo(() => (members.data ?? []).map((x) => x.display_name ?? '').filter(Boolean), [members.data]);
  const ref = useMemo(() => (game === 'abfahrt' ? null : stageRef(game === 'sprint' ? 'sprint' : 'mountain', tour?.name, tourData.data?.stages, day)), [game, tour?.name, tourData.data, day]);
  const track = useMemo(() => new Track(day, names, GAME_KIND[game], ref), [day, names, game, ref]);
  const key = editsKey(game, day);

  const [edits, setEditsState] = useState<WorldEdits>(() => emptyEdits(game, day, track.title));
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const [loaded, setLoaded] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'ok' | 'busy' | 'error' | 'local'>('ok');
  const [tool, setTool] = useState<Tool>('fly');
  const toolRef = useRef<Tool>('fly');
  toolRef.current = tool;
  const [kind, setKind] = useState(PLACEABLE[0].k);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const [brush, setBrush] = useState({ r: 14, dy: 4 });
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  speedRef.current = speed;
  const [holes, setHoles] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'track' | 'export' | 'jump'>('none');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [noteText, setNoteText] = useState('');
  const [camInfo, setCamInfo] = useState({ z: 0, x: 0, alt: 0, sec: '' });
  const [glError, setGlError] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const undo = useRef<WorldEdits[]>([]);
  const [undoN, setUndoN] = useState(0);

  const stageRefEl = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<Renderer3D | null>(null);
  const viewRef = useRef<WorldView | null>(null);
  const cam = useRef<Cam>({ x: 0, y: 6, z: 10, yaw: 0, pitch: -0.12 });
  /** Steuerung: Knüppel (−1…1), Höhe (−1/0/1), Tasten */
  const ctl = useRef({ jx: 0, jy: 0, up: 0, keys: new Set<string>() });

  // ---------------------------------------------------------------- Änderungen laden und speichern

  useEffect(() => {
    let alive = true;
    setLoaded(null);
    setSelected(null);
    undo.current = [];
    setUndoN(0);
    const local = (() => { try { const t = localStorage.getItem(LS(key)); return t ? JSON.parse(t) : null; } catch { return null; } })();
    const fromLocal = normalizeEdits(local, game, day, track.title);
    setEditsState(fromLocal);
    source.loadWorldEdits(key).then((remote) => {
      if (!alive) return;
      if (remote) {
        const r = normalizeEdits(remote, game, day, track.title);
        // die neuere Fassung gewinnt (Browser-Kopie kann jünger sein, wenn das Speichern fehlschlug)
        if (!fromLocal.updated || (r.updated && r.updated >= fromLocal.updated)) setEditsState(r);
      }
      setLoaded(key);
    }).catch(() => { if (alive) setLoaded(key); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const saveTimer = useRef(0);
  const persist = (e: WorldEdits) => {
    try { localStorage.setItem(LS(e.key), JSON.stringify(e)); } catch { /* egal */ }
    window.clearTimeout(saveTimer.current);
    setSaveState('busy');
    saveTimer.current = window.setTimeout(() => {
      source.saveWorldEdits(e.key, isEmptyEdits(e) ? null : e)
        .then(() => setSaveState(source.mode === 'demo' ? 'local' : 'ok'))
        .catch(() => setSaveState('error'));
    }, 1200);
  };

  /** Änderung übernehmen: anwenden, Szene erneuern, speichern (mit Rückgängig) */
  const commit = (next: WorldEdits, inv: { z?: [number, number]; bumps?: TerrainBump[] } = {}, keepUndo = true) => {
    const cur = editsRef.current;
    if (keepUndo) { undo.current = [...undo.current.slice(-39), cur]; setUndoN(undo.current.length); }
    next = { ...next, updated: new Date().toISOString(), title: track.title };
    editsRef.current = next;
    setEditsState(next);
    apply(next, inv);
    persist(next);
  };

  const apply = (e: WorldEdits, inv: { z?: [number, number]; bumps?: TerrainBump[] }) => {
    const r = rendererRef.current;
    track.edits = e;
    if (inv.z) { track.reapplyEdits(inv.z[0], inv.z[1]); r?.invalidateChunks(inv.z[0] - 10, inv.z[1] + 10); }
    r?.setBumps(e.terrain, inv.bumps ?? []);
  };

  // geladene Änderungen auf die Welt anwenden (alles neu)
  useEffect(() => {
    track.edits = edits;
    const r = rendererRef.current;
    if (!r) return;
    r.setBumps(edits.terrain);
    r.invalidateChunks(0, track.length * SEG);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, track]);

  const doUndo = () => {
    const prev = undo.current.pop();
    setUndoN(undo.current.length);
    if (!prev) return;
    const cur = editsRef.current;
    const zs = [...cur.sprites, ...prev.sprites, ...cur.removed, ...prev.removed].map((s) => s.z);
    const bumps = [...cur.terrain, ...prev.terrain];
    commit(prev, { z: zs.length ? [Math.min(...zs) - 4, Math.max(...zs) + 4] : undefined, bumps }, false);
    setSelected(null);
  };

  // ---------------------------------------------------------------- Marker

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const list: Marker[] = [];
    const w = { x: 0, y: 0, z: 0, th: 0 };
    for (const n of edits.notes) list.push({ id: n.id, kind: 'note', x: n.at[0], y: n.at[1], z: n.at[2], label: n.text.slice(0, 40), active: selected === n.id });
    for (const b of edits.terrain) {
      const y = r.groundY(b.x, b.z) ?? 0;
      list.push({ id: b.id, kind: 'bump', x: b.x, y, z: b.z, r: b.r, label: `${b.dy > 0 ? '+' : ''}${Math.round(b.dy)} m`, active: selected === b.id });
    }
    for (const s of edits.sprites) {
      if (s.z < track.first * SEG || s.z > track.length * SEG) continue;
      track.world(s.z, s.x, 0, w);
      const y = Math.abs(s.x) > EDGE ? (r.groundY(w.x, w.z) ?? w.y) : w.y;
      list.push({ id: s.id, kind: 'sprite', x: w.x, y: Math.max(y, w.y - 3), z: w.z, label: selected === s.id ? spriteName(s.k) : undefined, active: selected === s.id });
    }
    r.setMarkers(list);
  }, [edits, selected, track, loaded]);

  // ---------------------------------------------------------------- 3D-Bühne und Flug

  useLayoutEffect(() => {
    const stage = stageRefEl.current;
    if (!stage) return undefined;
    let st: Stage;
    try {
      st = acquireStage();
    } catch {
      setGlError(true);
      return undefined;
    }
    const { renderer, canvas, overlay } = st;
    stage.append(canvas, overlay);
    renderer.resize();
    renderer.setTheme(readAccent(), document.documentElement.dataset.theme === 'dark');
    // Testmodus (?lowgfx): winzige Auflösung, selten zeichnen – für automatische Prüfungen
    const low = /[?&]lowgfx\b/.test(window.location.search);
    // Prüfbilder (scripts/world-shots.mjs, ?shots): volle Auflösung, gezeichnet wird auf Abruf (__world.render)
    const shots = /[?&]shots\b/.test(window.location.search);
    if (low) { renderer.quality = 0.25; renderer.resize(); }
    else if (shots) { renderer.quality = 1; renderer.resize(); }
    else if (renderer.quality !== storedQuality()) { renderer.quality = storedQuality(); renderer.resize(); }
    renderer.hidePlayer = true;
    rendererRef.current = renderer;
    const view = new WorldView(track, readAccent());
    viewRef.current = view;
    track.edits = editsRef.current;
    renderer.setBumps(editsRef.current.terrain);
    // Kamera an den Start: hinter dem Startpunkt, Blick die Strecke entlang
    const w = { x: 0, y: 0, z: 0, th: 0 };
    track.world(0, 0, 0, w);
    const c = cam.current;
    c.x = w.x - Math.sin(w.th) * 9; c.z = w.z + Math.cos(w.th) * 9; c.y = w.y + 4; c.yaw = w.th; c.pitch = -0.14;

    const clock = new FrameClock();
    let raf = 0;
    let drawn = false;
    let secN = -1;
    let info = 0;
    let frames = 0;
    let floorY: number | null = null;
    const loop = (now: number) => {
      frames += 1;
      const dt = clock.tick(now);
      if (renderer.lost) { raf = requestAnimationFrame(loop); return; }
      fly(dt);
      // Fahrer (unsichtbar) der Kamera hinterher: der Renderer baut Straße und Landschaft um ihn herum
      const p = view.p;
      const i0 = Math.floor(p.z / SEG);
      const n = track.nearest(c.x, c.z, i0 - 350, i0 + 450);
      p.z = Math.max(1, n.z);
      p.y = track.heightAt(p.z);
      const fx = Math.sin(c.yaw) * Math.cos(c.pitch);
      const fy = Math.sin(c.pitch);
      const fz = -Math.cos(c.yaw) * Math.cos(c.pitch);
      renderer.debugCam = [c.x, c.y, c.z, c.x + fx, c.y + fy, c.z + fz];
      renderer.period = Math.max(1000 / 144, Math.min(1000 / 30, clock.period));
      if (!(low || shots) || (low && frames % 30 === 1) || (shots && frames === 1)) renderer.draw(view, dt, clock.raw);
      if (!drawn) { drawn = true; canvas.classList.add('is-drawn'); }
      info += dt;
      if (info > 0.25) {
        info = 0;
        const s = track.sectionOf(track.segAt(p.z));
        setCamInfo({ z: Math.max(0, n.z), x: n.x, alt: c.y, sec: s ? `${s.name}` : '' });
        if (track.sections.length !== secN) { secN = track.sections.length; setSections([...track.sections]); }
      }
      raf = requestAnimationFrame(loop);
    };
    const fly = (dt: number) => {
      const k = ctl.current;
      let jx = k.jx;
      let jy = k.jy;
      let up = k.up;
      const has = (...ks: string[]) => ks.some((x) => k.keys.has(x));
      if (has('KeyW', 'ArrowUp')) jy = 1;
      if (has('KeyS', 'ArrowDown')) jy = -1;
      if (has('KeyA', 'ArrowLeft')) jx = -1;
      if (has('KeyD', 'ArrowRight')) jx = 1;
      if (has('KeyE', 'Space')) up = 1;
      if (has('KeyQ', 'ShiftLeft', 'ShiftRight')) up = -1;
      const v = 12 * speedRef.current * (has('KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') && k.keys.has('ControlLeft') ? 3 : 1);
      const fx = Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      const rx = Math.cos(c.yaw);
      const rz = Math.sin(c.yaw);
      c.x += (fx * jy + rx * jx) * v * dt;
      c.z += (fz * jy + rz * jx) * v * dt;
      c.y += (up * v * 0.6 + jy * Math.sin(c.pitch) * v * 0.5) * dt;
      // nicht unter die Straße oder ins Gelände (Geländehöhe nur alle paar Bilder: die Abfrage ist nicht billig)
      if (frames % 6 === 0 || floorY === null) {
        const g = renderer.groundY(c.x, c.z);
        floorY = Math.max(g ?? -1e9, track.heightAt(track.nearest(c.x, c.z, Math.floor(view.p.z / SEG) - 60, Math.floor(view.p.z / SEG) + 60).z)) + 1.2;
      }
      if (c.y < floorY) c.y = floorY;
      if (c.y > 1600) c.y = 1600;
    };
    raf = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.type === 'keydown') ctl.current.keys.add(e.code); else ctl.current.keys.delete(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    };
    const onResize = () => renderer.requestResize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('resize', onResize);
    (window as unknown as { __world?: unknown }).__world = {
      track, view, renderer, cam: c,
      edits: () => editsRef.current,
      /** Prüfbilder: n Bilder am Stück zeichnen (baut Straße und Landschaft um die Kamera) */
      render: (n: number) => {
        for (let i = 0; i < n; i++) {
          const nn = track.nearest(c.x, c.z, Math.floor(view.p.z / SEG) - 350, Math.floor(view.p.z / SEG) + 450);
          view.p.z = Math.max(1, nn.z);
          view.p.y = track.heightAt(view.p.z);
          renderer.debugCam = [c.x, c.y, c.z, c.x + Math.sin(c.yaw) * Math.cos(c.pitch), c.y + Math.sin(c.pitch), c.z - Math.cos(c.yaw) * Math.cos(c.pitch)];
          renderer.draw(view, 1 / 60, 1 / 60);
        }
      },
      /**
       * Prüfbilder: n Bilder winzig zeichnen (baut Straße und Landschaft, kostet im Software-Rendering fast nichts),
       * dann eines in voller Größe – und das als Bild (Daten-URL) zurückgeben, ohne Bedienelemente
       */
      snapshot: (n: number) => {
        const w = (window as unknown as { __world: { render: (n: number) => void } }).__world;
        renderer.setQuality(0.1);
        w.render(n);
        renderer.setQuality(1);
        w.render(2);
        const gl = renderer.gl.getContext();
        const W = gl.drawingBufferWidth;
        const H = gl.drawingBufferHeight;
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d')!;
        const img = ctx.createImageData(W, H);
        // WebGL liefert die Zeilen von unten nach oben
        for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        ctx.putImageData(img, 0, 0);
        return cv.toDataURL('image/png');
      },
      open: (g: WorldGame, d: string) => { setGame(g); setDay(d); },
      holes: (on: boolean) => setHoles(on),
      setCam: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
        c.x = x; c.y = y; c.z = z;
        c.yaw = Math.atan2(tx - x, -(tz - z));
        c.pitch = Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      renderer.debugCam = null;
      renderer.debugHoles = false;
      renderer.hidePlayer = false;
      renderer.setMarkers([]);
      renderer.setBumps([]);
      track.edits = null;
      rendererRef.current = null;
      releaseStage(st);
      delete (window as unknown as { __world?: unknown }).__world;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  useEffect(() => { if (rendererRef.current) rendererRef.current.debugHoles = holes; }, [holes, track]);

  // ---------------------------------------------------------------- Umsehen und Antippen

  const look = useRef<{ id: number; x: number; y: number; moved: number; t: number } | null>(null);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (look.current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const l = look.current;
    if (!l || l.id !== e.pointerId) return;
    const dx = e.clientX - l.x;
    const dy = e.clientY - l.y;
    l.x = e.clientX; l.y = e.clientY; l.moved += Math.abs(dx) + Math.abs(dy);
    const c = cam.current;
    c.yaw += dx * 0.0042;
    c.pitch = Math.max(-1.45, Math.min(1.45, c.pitch - dy * 0.0042));
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const l = look.current;
    if (!l || l.id !== e.pointerId) return;
    look.current = null;
    if (l.moved < 9 && performance.now() - l.t < 500) tap(e.clientX, e.clientY);
  };

  const tap = (cx0: number, cy0: number) => {
    const r = rendererRef.current;
    const stage = stageRefEl.current;
    if (!r || !stage) return;
    const box = stage.getBoundingClientRect();
    const hit = r.pick((cx0 - box.left) / box.width, (cy0 - box.top) / box.height);
    if (!hit) { if (toolRef.current !== 'fly') toast('Da ist nichts (Himmel)'); return; }
    const n = track.nearest(hit.x, hit.z);
    const e = editsRef.current;
    switch (toolRef.current) {
      case 'fly':
        // Marker antippen = auswählen
        setSelected(nearestMarker(e, hit, 4)?.id ?? null);
        break;
      case 'place': {
        const onRoad = Math.abs(n.x) <= EDGE && n.d < 1;
        const sp: PlacedSprite = { id: newId(), z: Math.round(n.z * 10) / 10, x: Math.round(n.x * 10) / 10, k: kindRef.current, s: 1, v: Math.floor(Math.random() * 4), f: Math.random() < 0.5, h: onRoad ? Math.max(0, hit.y - track.heightAt(n.z)) : 0 };
        if (sp.k === 'crowd') sp.x = Math.sign(sp.x || 1) * Math.max(EDGE + 0.3, Math.abs(sp.x));
        commit({ ...e, sprites: [...e.sprites, sp] }, { z: [sp.z - 2, sp.z + 2] });
        setSelected(sp.id);
        break;
      }
      case 'terrain': {
        const b: TerrainBump = { id: newId(), x: Math.round(hit.x * 10) / 10, z: Math.round(hit.z * 10) / 10, r: brushRef.current.r, dy: brushRef.current.dy };
        commit({ ...e, terrain: [...e.terrain, b] }, { bumps: [b] });
        setSelected(b.id);
        break;
      }
      case 'note':
        setPending({ kind: 'note', at: [Math.round(hit.x * 10) / 10, Math.round(hit.y * 10) / 10, Math.round(hit.z * 10) / 10], track: { z: Math.round(n.z), x: Math.round(n.x * 10) / 10 } });
        setNoteText('');
        break;
      case 'delete': {
        const mk = nearestMarker(e, hit, 5);
        if (mk) { remove(mk.id); break; }
        // Requisite der Strecke selbst entfernen (nächste in der Draufsicht)
        const w = { x: 0, y: 0, z: 0, th: 0 };
        let best: { d: number; z: number; x: number; k: PlacedSprite['k'] } | null = null;
        const i0 = Math.floor(n.z / SEG);
        for (let i = Math.max(track.first, i0 - 6); i < Math.min(track.length, i0 + 7); i++) {
          const s = track.seg(i);
          for (const sp of s.sprites ?? []) {
            if (sp.eid) continue;
            track.world(i * SEG, sp.x, 0, w);
            const d = Math.hypot(w.x - hit.x, w.z - hit.z);
            if (d < 6 && (!best || d < best.d)) best = { d, z: i * SEG, x: sp.x, k: sp.k };
          }
        }
        if (!best) { toast('Keine Requisite in der Nähe'); break; }
        commit({ ...e, removed: [...e.removed, { id: newId(), z: best.z, x: best.x, k: best.k }] }, { z: [best.z - 2, best.z + 2] });
        toast(`${spriteName(best.k)} entfernt`);
        break;
      }
    }
  };

  /** nächster Marker (Notiz, Hügel, gesetzte Requisite) zu einem Weltpunkt */
  const nearestMarker = (e: WorldEdits, hit: { x: number; y: number; z: number }, maxD: number): { id: string; d: number } | null => {
    let best: { id: string; d: number } | null = null;
    const w = { x: 0, y: 0, z: 0, th: 0 };
    const take = (id: string, d: number) => { if (d < maxD && (!best || d < best.d)) best = { id, d }; };
    for (const n of e.notes) take(n.id, Math.hypot(n.at[0] - hit.x, n.at[2] - hit.z));
    for (const b of e.terrain) take(b.id, Math.max(0, Math.hypot(b.x - hit.x, b.z - hit.z) - b.r * 0.35));
    for (const s of e.sprites) { track.world(s.z, s.x, 0, w); take(s.id, Math.hypot(w.x - hit.x, w.z - hit.z)); }
    return best;
  };

  const remove = (id: string) => {
    const e = editsRef.current;
    const sp = e.sprites.find((s) => s.id === id);
    const rm = e.removed.find((s) => s.id === id);
    const b = e.terrain.find((s) => s.id === id);
    const next: WorldEdits = {
      ...e,
      sprites: e.sprites.filter((s) => s.id !== id),
      removed: e.removed.filter((s) => s.id !== id),
      terrain: e.terrain.filter((s) => s.id !== id),
      notes: e.notes.filter((s) => s.id !== id),
    };
    const z = sp ?? rm;
    commit(next, { z: z ? [z.z - 2, z.z + 2] : undefined, bumps: b ? [b] : [] });
    if (selected === id) setSelected(null);
  };

  const patchSprite = (id: string, patch: Partial<PlacedSprite>) => {
    const e = editsRef.current;
    const sp = e.sprites.find((s) => s.id === id);
    if (!sp) return;
    const n = { ...sp, ...patch };
    commit({ ...e, sprites: e.sprites.map((s) => (s.id === id ? n : s)) }, { z: [Math.min(sp.z, n.z) - 2, Math.max(sp.z, n.z) + 2] });
  };
  const patchBump = (id: string, patch: Partial<TerrainBump>) => {
    const e = editsRef.current;
    const b = e.terrain.find((s) => s.id === id);
    if (!b) return;
    const n = { ...b, ...patch };
    commit({ ...e, terrain: e.terrain.map((s) => (s.id === id ? n : s)) }, { bumps: [b, n] });
  };

  const addNote = () => {
    if (!pending) return;
    const r = rendererRef.current;
    const text = noteText.trim() || 'Hier';
    const n: WorldNote = { id: newId(), text, at: pending.at, track: pending.track, cam: r?.cameraPose() ?? [0, 0, 0, 0, 0, -1], created: new Date().toISOString() };
    commit({ ...editsRef.current, notes: [...editsRef.current.notes, n] });
    setPending(null);
    setSelected(n.id);
  };

  // ---------------------------------------------------------------- Springen

  const jumpTo = (z: number) => {
    const w = { x: 0, y: 0, z: 0, th: 0 };
    track.world(Math.max(0, z), 0, 0, w);
    const c = cam.current;
    c.x = w.x - Math.sin(w.th) * 9; c.z = w.z + Math.cos(w.th) * 9; c.y = w.y + 4; c.yaw = w.th; c.pitch = -0.14;
    viewRef.current!.p.z = Math.max(1, z);
    setSheet('none');
  };
  const toRoad = () => {
    const c = cam.current;
    const n = track.nearest(c.x, c.z);
    const w = { x: 0, y: 0, z: 0, th: 0 };
    track.world(n.z, 0, 0, w);
    c.x = w.x; c.z = w.z; c.y = w.y + 2.6; c.pitch = -0.08;
  };
  const flyToNote = (n: WorldNote) => {
    const c = cam.current;
    const [x, y, z, tx, ty, tz] = n.cam;
    c.x = x; c.y = y; c.z = z;
    c.yaw = Math.atan2(tx - x, -(tz - z));
    c.pitch = Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
    viewRef.current!.p.z = Math.max(1, n.track.z);
    setSelected(n.id);
    setSheet('none');
  };

  // ---------------------------------------------------------------- Export

  const exportJson = () => JSON.stringify({ ...edits, title: track.title }, null, 1);
  const copyExport = async () => {
    try { await navigator.clipboard.writeText(exportText({ ...edits, title: track.title })); toast('Export kopiert'); } catch { toast('Kopieren nicht möglich'); }
  };
  const shareExport = async () => {
    const file = new File([exportJson()], `welt-${key.replace(':', '-')}.json`, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (nav.share && nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: `Welt-Editor ${key}` }); return; }
      if (nav.share) { await nav.share({ title: `Welt-Editor ${key}`, text: exportText(edits) }); return; }
    } catch { return; }
    downloadExport();
  };
  const downloadExport = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' }));
    a.download = `welt-${key.replace(':', '-')}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const clearAll = () => {
    if (!window.confirm('Alle Änderungen dieser Strecke löschen?')) return;
    const zs = [...edits.sprites, ...edits.removed].map((s) => s.z);
    commit(emptyEdits(game, day, track.title), { z: zs.length ? [Math.min(...zs) - 4, Math.max(...zs) + 4] : undefined, bumps: edits.terrain });
    setSelected(null);
  };

  const sel = {
    sprite: edits.sprites.find((s) => s.id === selected),
    bump: edits.terrain.find((s) => s.id === selected),
    note: edits.notes.find((s) => s.id === selected),
  };
  const count = edits.sprites.length + edits.removed.length + edits.terrain.length + edits.notes.length;
  const groups = useMemo(() => [...new Set(PLACEABLE.map((p) => p.group))], []);

  return (
    <div className="abf wed">
      <div ref={stageRefEl} className="abf__stage" role="application" aria-label="Welt: ziehen zum Umsehen, antippen für das gewählte Werkzeug" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      {glError ? (
        <div className="abf-layer"><div className="abf-card abf-card--small"><h2 className="abf-title">3D nicht verfügbar</h2><p className="abf-muted">Dein Browser kann gerade keine 3D-Grafik anzeigen.</p><button type="button" className="btn btn--secondary btn--full" onClick={() => navigate('/admin')}><span>Zurück</span></button></div></div>
      ) : null}

      {/* Kopfleiste */}
      <div className="wed-top">
        <button type="button" className="abf-round" onClick={() => navigate('/admin')} aria-label="Zurück"><Icon name="back" /></button>
        <button type="button" className="wed-chip wed-chip--main" onClick={() => setSheet(sheet === 'track' ? 'none' : 'track')}>
          <strong>{GAME_LABEL[game]} · {fmtDay(day)}</strong>
          <span>{track.title}</span>
        </button>
        <button type="button" className={cx('wed-chip', holes && 'is-on')} onClick={() => setHoles((h) => !h)} aria-pressed={holes} title="Löcher-Prüfmodus: Himmel unter dem Horizont wird magenta">Löcher</button>
        <button type="button" className="wed-chip" onClick={() => setSheet(sheet === 'export' ? 'none' : 'export')}><Icon name="share" size={16} />{count ? <b>{count}</b> : null}</button>
      </div>
      <div className="wed-info" aria-live="polite">
        <span>{m(camInfo.z)}{camInfo.x ? ` · ${camInfo.x > 0 ? 'rechts' : 'links'} ${m(Math.abs(camInfo.x))}` : ''}</span>
        <span>{camInfo.sec}</span>
        <span className="wed-info__save">{saveState === 'busy' ? 'speichert …' : saveState === 'error' ? 'nicht gespeichert' : saveState === 'local' ? 'nur hier gespeichert' : loaded === key ? 'gespeichert' : 'lädt …'}</span>
      </div>

      {/* Werkzeuge */}
      <div className="wed-tools" role="group" aria-label="Werkzeug">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={cx('wed-tool', tool === t.id && 'is-on')} aria-pressed={tool === t.id} onClick={() => { setTool(t.id); setPending(null); }}>
            <ToolIcon id={t.id} />
            <span>{t.label}</span>
          </button>
        ))}
        <button type="button" className="wed-tool" disabled={!undoN} onClick={doUndo}><Icon name="refresh" size={18} /><span>Zurück</span></button>
      </div>

      {/* Werkzeugleiste unten */}
      <div className="wed-bottom">
        {pending ? (
          <form className="wed-panel wed-note" onSubmit={(e) => { e.preventDefault(); addNote(); }}>
            <input autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={`Notiz bei ${m(pending.track.z)} – z. B. „Loch in der Wand“`} />
            <button type="submit" className="btn">Setzen</button>
            <button type="button" className="abf-round" onClick={() => setPending(null)} aria-label="Abbrechen"><Icon name="x" /></button>
          </form>
        ) : tool === 'place' ? (
          <div className="wed-panel">
            <div className="wed-kinds">
              {groups.map((g) => (
                <div key={g} className="wed-kinds__group">
                  <span className="wed-kinds__name">{g}</span>
                  {PLACEABLE.filter((p) => p.group === g).map((p) => (
                    <button key={p.k} type="button" className={cx('wed-chip', kind === p.k && 'is-on')} onClick={() => setKind(p.k)}>{p.name}</button>
                  ))}
                </div>
              ))}
            </div>
            {sel.sprite ? (
              <div className="wed-row">
                <span className="wed-row__name">{spriteName(sel.sprite.k)} · {m(sel.sprite.z)}</span>
                <button type="button" className="wed-chip" onClick={() => patchSprite(sel.sprite!.id, { s: Math.max(0.3, Math.round((sel.sprite!.s - 0.1) * 10) / 10) })}>−</button>
                <span className="wed-row__val">{sel.sprite.s.toFixed(1)}×</span>
                <button type="button" className="wed-chip" onClick={() => patchSprite(sel.sprite!.id, { s: Math.min(4, Math.round((sel.sprite!.s + 0.1) * 10) / 10) })}>+</button>
                <button type="button" className="wed-chip" onClick={() => patchSprite(sel.sprite!.id, { v: (sel.sprite!.v + 1) % 4 })}>Variante {sel.sprite.v + 1}</button>
                <button type="button" className={cx('wed-chip', sel.sprite.f && 'is-on')} onClick={() => patchSprite(sel.sprite!.id, { f: !sel.sprite!.f })}>Spiegeln</button>
                <button type="button" className="wed-chip" onClick={() => patchSprite(sel.sprite!.id, { x: Math.round((sel.sprite!.x - 0.5) * 10) / 10 })}>◀</button>
                <button type="button" className="wed-chip" onClick={() => patchSprite(sel.sprite!.id, { x: Math.round((sel.sprite!.x + 0.5) * 10) / 10 })}>▶</button>
                <button type="button" className="wed-chip wed-chip--danger" onClick={() => remove(sel.sprite!.id)}><Icon name="trash" size={16} /></button>
              </div>
            ) : <p className="wed-hint">{TOOLS[1].hint}</p>}
          </div>
        ) : tool === 'terrain' ? (
          <div className="wed-panel">
            <div className="wed-row">
              <span className="wed-row__name">Radius</span>
              <input type="range" min={3} max={80} step={1} value={brush.r} onChange={(e) => setBrush({ ...brush, r: Number(e.target.value) })} />
              <span className="wed-row__val">{brush.r} m</span>
            </div>
            <div className="wed-row">
              <span className="wed-row__name">Höhe</span>
              <input type="range" min={-30} max={30} step={1} value={brush.dy} onChange={(e) => setBrush({ ...brush, dy: Number(e.target.value) })} />
              <span className="wed-row__val">{brush.dy > 0 ? '+' : ''}{brush.dy} m</span>
            </div>
            {sel.bump ? (
              <div className="wed-row">
                <span className="wed-row__name">Gewählt: {sel.bump.dy > 0 ? 'Hügel' : 'Mulde'} {sel.bump.r} m</span>
                <button type="button" className="wed-chip" onClick={() => patchBump(sel.bump!.id, { dy: sel.bump!.dy - 2 })}>tiefer</button>
                <button type="button" className="wed-chip" onClick={() => patchBump(sel.bump!.id, { dy: sel.bump!.dy + 2 })}>höher</button>
                <button type="button" className="wed-chip" onClick={() => patchBump(sel.bump!.id, { r: Math.max(2, sel.bump!.r - 3) })}>enger</button>
                <button type="button" className="wed-chip" onClick={() => patchBump(sel.bump!.id, { r: Math.min(150, sel.bump!.r + 3) })}>weiter</button>
                <button type="button" className="wed-chip wed-chip--danger" onClick={() => remove(sel.bump!.id)}><Icon name="trash" size={16} /></button>
              </div>
            ) : <p className="wed-hint">{TOOLS[2].hint} – negative Höhe = Mulde. Die Straße selbst bleibt frei.</p>}
          </div>
        ) : tool === 'note' ? (
          <div className="wed-panel">
            {sel.note ? (
              <div className="wed-row">
                <span className="wed-row__name">„{sel.note.text}“ · {m(sel.note.track.z)}</span>
                <button type="button" className="wed-chip" onClick={() => flyToNote(sel.note!)}>Hinfliegen</button>
                <button type="button" className="wed-chip wed-chip--danger" onClick={() => remove(sel.note!.id)}><Icon name="trash" size={16} /></button>
              </div>
            ) : <p className="wed-hint">{TOOLS[3].hint} – die Kamera wird mitgespeichert, Claude kann den Blick exakt nachstellen.</p>}
          </div>
        ) : tool === 'delete' ? (
          <div className="wed-panel"><p className="wed-hint">{TOOLS[4].hint}</p></div>
        ) : (
          <div className="wed-panel wed-panel--fly">
            <Stick onChange={(x, y) => { ctl.current.jx = x; ctl.current.jy = y; }} />
            <div className="wed-fly">
              <div className="wed-speed" role="group" aria-label="Tempo">
                {SPEEDS.map((s) => <button key={s} type="button" className={cx('wed-chip', speed === s && 'is-on')} onClick={() => setSpeed(s)}>{s}×</button>)}
              </div>
              <div className="wed-fly__row">
                <button type="button" className="wed-chip" onClick={toRoad}>Zur Straße</button>
                <button type="button" className="wed-chip" onClick={() => setSheet('jump')}>Springen …</button>
                {sel.note ? <button type="button" className="wed-chip" onClick={() => flyToNote(sel.note!)}>Zur Notiz</button> : null}
              </div>
            </div>
            <div className="wed-updown">
              <button type="button" className="wed-tool" onPointerDown={(e: RPointerEvent<HTMLButtonElement>) => { e.preventDefault(); ctl.current.up = 1; }} onPointerUp={() => { ctl.current.up = 0; }} onPointerCancel={() => { ctl.current.up = 0; }} onPointerLeave={() => { ctl.current.up = 0; }} aria-label="Höher">▲</button>
              <button type="button" className="wed-tool" onPointerDown={(e: RPointerEvent<HTMLButtonElement>) => { e.preventDefault(); ctl.current.up = -1; }} onPointerUp={() => { ctl.current.up = 0; }} onPointerCancel={() => { ctl.current.up = 0; }} onPointerLeave={() => { ctl.current.up = 0; }} aria-label="Tiefer">▼</button>
            </div>
          </div>
        )}
      </div>

      {/* Streckenwahl */}
      {sheet === 'track' ? (
        <div className="abf-layer" onClick={() => setSheet('none')}>
          <div className="abf-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="abf-title">Strecke</h2>
            <Segmented label="Spiel" value={game} options={[{ value: 'abfahrt', label: 'Abfahrt' }, { value: 'sprint', label: 'Sprint' }, { value: 'berg', label: 'Berg' }]} onChange={(g) => setGame(g)} />
            <div className="wed-row wed-dayrow">
              <button type="button" className="wed-chip" onClick={() => setDay(addDays(day, -1))} aria-label="Vortag">◀</button>
              <input type="date" value={day} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} className="wed-date" />
              <button type="button" className="wed-chip" onClick={() => setDay(addDays(day, 1))} aria-label="Folgetag">▶</button>
              <button type="button" className="wed-chip" onClick={() => setDay(berlinDayKey())}>Heute</button>
            </div>
            <p className="abf-sub">{track.title}{ref ? ` · ${ref.tour}, Etappe ${ref.stage}${ref.preview ? ' (Vorschau)' : ''}` : ''}. Jede Tagesstrecke entsteht aus ihrem Seed – Änderungen gelten für genau diese.</p>
            <SavedList current={key} onPick={(k) => { const [g, d] = k.split(':'); if (g in GAME_LABEL && d) { setGame(g as WorldGame); setDay(d); } setSheet('none'); }} />
            <button type="button" className="btn btn--secondary btn--full" onClick={() => setSheet('none')}><span>Schließen</span></button>
          </div>
        </div>
      ) : null}

      {/* Springen */}
      {sheet === 'jump' ? (
        <div className="abf-layer" onClick={() => setSheet('none')}>
          <div className="abf-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="abf-title">Springen</h2>
            <form className="wed-row" onSubmit={(e) => { e.preventDefault(); const v = Number((e.currentTarget.elements.namedItem('z') as HTMLInputElement).value); if (Number.isFinite(v)) jumpTo(v); }}>
              <input name="z" type="number" inputMode="numeric" placeholder="Streckenmeter" className="wed-date" defaultValue={Math.round(camInfo.z)} />
              <button type="submit" className="btn">Los</button>
            </form>
            <ul className="list wed-list">
              {sections.map((s, i) => (
                <li key={i}><button type="button" className="card card--row" onClick={() => jumpTo(s.start * SEG)}><span className="card__main"><strong>{s.name}</strong><span className="muted">{s.biome} · ab {m(s.start * SEG)} · {s.alt} m ü. NN</span></span></button></li>
              ))}
              <li><button type="button" className="card card--row" onClick={() => jumpTo(track.length * SEG - 40)}><span className="card__main"><strong>Ende des Gebauten</strong><span className="muted">{m(track.length * SEG)} – beim Weiterfliegen entsteht mehr</span></span></button></li>
            </ul>
            {edits.notes.length ? (
              <>
                <h3 className="abf-eyebrow">Notizen</h3>
                <ul className="list wed-list">
                  {edits.notes.map((n) => (
                    <li key={n.id}><button type="button" className="card card--row" onClick={() => flyToNote(n)}><span className="card__main"><strong>{n.text}</strong><span className="muted">{m(n.track.z)}</span></span></button></li>
                  ))}
                </ul>
              </>
            ) : null}
            <button type="button" className="btn btn--secondary btn--full" onClick={() => setSheet('none')}><span>Schließen</span></button>
          </div>
        </div>
      ) : null}

      {/* Export */}
      {sheet === 'export' ? (
        <div className="abf-layer" onClick={() => setSheet('none')}>
          <div className="abf-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="abf-title">Export für Claude</h2>
            <p className="abf-sub">{edits.notes.length} Notizen · {edits.sprites.length} gesetzt · {edits.removed.length} entfernt · {edits.terrain.length} Gelände. Gespeichert in der Datenbank (world_edits, Schlüssel {key}) – Claude kann sie direkt lesen oder du schickst ihm den Text.</p>
            <textarea className="wed-export" readOnly value={exportText({ ...edits, title: track.title })} onFocus={(e: { currentTarget: HTMLTextAreaElement }) => e.currentTarget.select()} />
            <div className="wed-row">
              <button type="button" className="btn" onClick={copyExport}>Kopieren</button>
              <button type="button" className="btn btn--secondary" onClick={shareExport}>Teilen</button>
              <button type="button" className="btn btn--secondary" onClick={downloadExport}>Datei</button>
            </div>
            <button type="button" className="wed-chip wed-chip--danger" onClick={clearAll} disabled={!count}>Alle Änderungen dieser Strecke löschen</button>
            <button type="button" className="btn btn--secondary btn--full" onClick={() => setSheet('none')}><span>Schließen</span></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** gespeicherte Strecken (aus der Datenbank bzw. dem Browser) */
function SavedList({ current, onPick }: { current: string; onPick: (key: string) => void }) {
  const [list, setList] = useState<{ key: string; updated_at: string }[] | null>(null);
  useEffect(() => { source.listWorldEdits().then(setList).catch(() => setList([])); }, []);
  if (!list?.length) return null;
  return (
    <>
      <h3 className="abf-eyebrow">Mit Änderungen</h3>
      <ul className="list wed-list">
        {list.map((e) => {
          const [g, d] = e.key.split(':');
          return (
            <li key={e.key}>
              <button type="button" className={cx('card card--row', e.key === current && 'is-active')} onClick={() => onPick(e.key)}>
                <span className="card__main"><strong>{GAME_LABEL[g as WorldGame] ?? g} · {d ? fmtDay(d) : ''}</strong>{e.updated_at ? <span className="muted">{new Date(e.updated_at).toLocaleString('de-DE')}</span> : null}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** virtueller Knüppel (links unten): −1…1 in beiden Achsen, oben = vorwärts */
function Stick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const id = useRef<number | null>(null);
  const R = 42;
  const set = (e: RPointerEvent<HTMLDivElement>) => {
    const b = ref.current!.getBoundingClientRect();
    let dx = e.clientX - (b.left + b.width / 2);
    let dy = e.clientY - (b.top + b.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    setKnob({ x: dx, y: dy });
    const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    onChange(dead(dx / R), dead(-dy / R));
  };
  return (
    <div
      ref={ref}
      className="wed-stick"
      role="slider"
      aria-label="Bewegen"
      aria-valuenow={0}
      onPointerDown={(e: RPointerEvent<HTMLDivElement>) => { if (id.current !== null) return; id.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); set(e); }}
      onPointerMove={(e: RPointerEvent<HTMLDivElement>) => { if (id.current === e.pointerId) set(e); }}
      onPointerUp={(e: RPointerEvent<HTMLDivElement>) => { if (id.current === e.pointerId) { id.current = null; setKnob({ x: 0, y: 0 }); onChange(0, 0); } }}
      onPointerCancel={(e: RPointerEvent<HTMLDivElement>) => { if (id.current === e.pointerId) { id.current = null; setKnob({ x: 0, y: 0 }); onChange(0, 0); } }}
    >
      <span className="wed-stick__knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

function ToolIcon({ id }: { id: Tool }) {
  switch (id) {
    case 'fly': return <Icon name="external" size={18} />;
    case 'place': return <Icon name="plus" size={18} />;
    case 'terrain': return <Icon name="mountain" size={18} />;
    case 'note': return <Icon name="flag" size={18} />;
    case 'delete': return <Icon name="trash" size={18} />;
  }
}
