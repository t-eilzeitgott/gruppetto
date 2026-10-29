/**
 * WebGPU-Test (Admin): ein Stück Passabfahrt mit dem WebGPU-Renderer von three.js – zum Vergleich mit dem Spiel.
 * Vollbild, Fahrer fährt von selbst; Tippen wechselt die Kamera. Oben links Bildrate, Auflösung und Technik.
 */
import React, { useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { useMembers } from '../../app/hooks';
import { useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { useGameLock } from '../gameKit';
import type { CamMode, DriveMode, Showcase, ShowcaseStats } from '../../game/gpu/showcase';
import type { HudState } from '../../game/abfahrt/engine';
import type { Kit } from '../../game/abfahrt/rider';
import { useBikes } from '../../ui/useBikes';
import { BUILD_ID } from '../../app/config';
import type { Report } from '../../game/gpu/perf';

const LS_REPORT = 'gruppetto.gpu.lastReport';
const lsRead = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsWrite = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* voll oder gesperrt */ } };

/** Text in die Zwischenablage (Fallback: Auswahl-Dialog) */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { prompt('Bericht (alles markieren und kopieren)', text.slice(0, 20000)); return false; }
}

/** Datei teilen (iPhone: Teilen-Blatt) oder herunterladen */
async function shareFile(text: string, name: string) {
  const file = new File([text], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return; } catch { /* abgebrochen: herunterladen */ }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
import { DEFAULT_SETTINGS, loadSettings, MOOD_IDS, MOODS, type Settings } from '../../game/gpu/mood';

/** feste Tagesstrecke: Dolomiten, vier Kehren, kein Tunnel – die schönsten 2,5 km zum Vergleichen */
const DAY = '2026-10-15';

const TOGGLES: { k: keyof Settings; label: string }[] = [
  { k: 'cycle', label: 'Wetterwechsel (alle 16 s)' },
  { k: 'shadows', label: 'Sonnenschatten' },
  { k: 'bloom', label: 'Leuchten (Bloom)' },
  { k: 'grade', label: 'Farbfilter (Wärme, Kontrast, Split)' },
  { k: 'vignette', label: 'Vignette' },
  { k: 'grain', label: 'Filmkorn' },
  { k: 'fog', label: 'Dunst' },
  { k: 'rain', label: 'Regenstreifen (bei Regen)' },
  { k: 'crowd', label: 'Zuschauer' },
  { k: 'life', label: 'Blumen, Sträucher, Tiere' },
  { k: 'grass', label: 'Grashalme' },
  { k: 'cinema', label: 'Kinoformat (Balken)' },
];
type Tab = 'look' | 'light' | 'tech';
const TABS: { id: Tab; label: string }[] = [
  { id: 'look', label: 'Stimmung' },
  { id: 'light', label: 'Licht & Farbe' },
  { id: 'tech', label: 'Technik' },
];
/** welche Regler auf welchem Reiter stehen (der Rest: Licht & Farbe) */
const TECH: (keyof Settings)[] = ['oppMax', 'maxDpr', 'minDpr', 'shadowRes', 'shadowRange', 'msaa', 'rainK', 'wetK'];
const SLIDERS: { k: keyof Settings; label: string; min: number; max: number; step: number }[] = [
  { k: 'exposure', label: 'Belichtung', min: 0.5, max: 1.6, step: 0.02 },
  { k: 'warm', label: 'Wärme', min: -1, max: 1, step: 0.05 },
  { k: 'sat', label: 'Sättigung', min: 0.5, max: 1.5, step: 0.02 },
  { k: 'contrast', label: 'Kontrast', min: 0.8, max: 1.4, step: 0.02 },
  { k: 'sun', label: 'Sonne', min: 0, max: 2, step: 0.05 },
  { k: 'env', label: 'Himmelslicht', min: 0, max: 2.5, step: 0.05 },
  { k: 'fogK', label: 'Dunst', min: 0, max: 3, step: 0.05 },
  { k: 'bloomK', label: 'Leuchten', min: 0, max: 3, step: 0.05 },
  { k: 'vignetteK', label: 'Vignette', min: 0, max: 2, step: 0.05 },
  { k: 'grainK', label: 'Korn', min: 0, max: 3, step: 0.05 },
  { k: 'maxDpr', label: 'Auflösung höchstens', min: 0.7, max: 3, step: 0.05 },
  { k: 'minDpr', label: 'Auflösung mindestens (Automatik geht nicht darunter)', min: 0.5, max: 2, step: 0.05 },
  { k: 'splitK', label: 'Split-Toning (kühle Schatten, warme Lichter)', min: 0, max: 2, step: 0.05 },
  { k: 'bthrK', label: 'Leuchten-Schwelle', min: 0.3, max: 2, step: 0.05 },
  { k: 'hemiK', label: 'Streulicht des Himmels', min: 0, max: 3, step: 0.05 },
  { k: 'sunElev', label: 'Sonnenhöhe (±°, Licht und Schatten)', min: -30, max: 40, step: 1 },
  { k: 'sunAzim', label: 'Sonnenrichtung (±°)', min: -180, max: 180, step: 5 },
  { k: 'rainK', label: 'Regen (Streifen)', min: 0, max: 2, step: 0.05 },
  { k: 'wetK', label: 'Nasse Straße', min: 0, max: 1.5, step: 0.05 },
  { k: 'shadowRes', label: 'Schattenauflösung (1024 / 2048 / 4096)', min: 1024, max: 4096, step: 1024 },
  { k: 'shadowRange', label: 'Schattenweite (m um den Fahrer)', min: 30, max: 120, step: 5 },
  { k: 'msaa', label: 'Kantenglättung (0 / 4 – wirkt nach Neuladen)', min: 0, max: 4, step: 4 },
  { k: 'oppMax', label: 'Gegner im Bild (höchstens)', min: 0, max: 20, step: 1 },
];

const CAMS: { id: CamMode; label: string }[] = [
  { id: 'chase', label: 'Verfolger' },
  { id: 'low', label: 'Tief' },
  { id: 'side', label: 'Seite' },
  { id: 'drone', label: 'Drohne' },
];

export function GpuTestPage() {
  useTitle('WebGPU-Test');
  useGameLock();
  const members = useMembers();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const showRef = useRef<Showcase | null>(null);
  const [stats, setStats] = useState<ShowcaseStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cam, setCam] = useState<CamMode>('chase');
  const [hud, setHud] = useState(true);
  const [hint60, setHint60] = useState(false);
  // Ladeschirm nach dem Laden noch kurz zum Ausblenden stehen lassen
  const [veil, setVeil] = useState(true);
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<Tab>('look');
  // Fahren: Autopilot oder selbst (Steuerung wie im Spiel)
  const [drive, setDrive] = useState<DriveMode>('auto');
  const driveRef = useRef<DriveMode>('auto');
  const [ride, setRide] = useState<HudState | null>(null);
  const [thumb, setThumb] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [help, setHelp] = useState(false);
  const bikes = useBikes();
  // Messfahrt
  const [measuring, setMeasuring] = useState(false);
  const [recInfo, setRecInfo] = useState({ s: 0, hitches: 0 });
  const [report, setReport] = useState<Report | null>(null);
  const [lastReport, setLastReport] = useState<string | null>(() => lsRead(LS_REPORT));
  const [reportCopied, setReportCopied] = useState(false);
  const [graph, setGraph] = useState(false);
  // Kostenanalyse: Fortschritt und Ergebnis (Text zum Kopieren)
  const [cost, setCost] = useState<{ i: number; n: number; label: string } | null>(null);
  const [costText, setCostText] = useState<string | null>(null);
  const [costCopied, setCostCopied] = useState(false);
  const graphRef = useRef<HTMLCanvasElement | null>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [copied, setCopied] = useState(false);
  const change = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    showRef.current?.applySettings(next);
  };
  const copy = async () => {
    const diff: Partial<Settings> = {};
    for (const k of Object.keys(settings) as (keyof Settings)[]) if (settings[k] !== DEFAULT_SETTINGS[k]) (diff as Record<string, unknown>)[k] = settings[k];
    const text = `WebGPU-Einstellungen: ${JSON.stringify(diff)} · ${stats ? `${Math.round(stats.fps)} fps, ${stats.ms.toFixed(1)} ms, CPU ${stats.cpu.toFixed(1)} ms, ×${stats.dpr.toFixed(2)}, ${(stats.tris / 1000).toFixed(0)}k Dreiecke` : ''}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { prompt('Einstellungen', text); }
  };
  const names = (members.data ?? []).map((m) => (m.display_name ?? '').trim()).filter(Boolean);
  const namesRef = useRef<string[]>(names);
  namesRef.current = names;
  const bikesRef = useRef<string>(bikes.current);
  bikesRef.current = bikes.current;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    let show: Showcase | null = null;
    let lastUi = 0;
    void import('../../game/gpu/showcase').then(({ Showcase: S }) => {
      if (!alive) return;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff5fa2';
      // eigener Fahrer wie im Spiel: Trikot in der Akzentfarbe, Rad aus der Garage
      const kit: Kit = { jersey: accent, side: '#ffffff', helmet: '#ffffff', shorts: '#16171a', skin: '#f0c4a0', shoes: '#ffffff', number: '27', bike: bikesRef.current };
      show = new S(host, {
        dayKey: DAY,
        names: namesRef.current,
        kit,
        onStats: (s) => {
          const now = performance.now();
          // selbst fahren: Tempo flüssiger anzeigen
          if (now - lastUi < (driveRef.current === 'manual' ? 90 : 250)) return;
          lastUi = now;
          show?.perf.event(16); // EV.ui: Seite zeichnet neu (kostet Zeit vor dem nächsten Bild)
          setStats({ ...s });
          if (driveRef.current === 'manual') setRide(show?.hud() ?? null);
        },
        onError: (e) => setError(String(e)),
      });
      showRef.current = show;
      show.onReport = (r) => {
        setMeasuring(false);
        setReport(r);
        setReportCopied(false);
        lsWrite(LS_REPORT, r.text);
        setLastReport(r.text);
      };
      // Test-Hilfe (Prüfbilder ohne Bedienung)
      (window as unknown as { __gpu?: Showcase }).__gpu = show;
      show.start().catch((e) => { console.error(e); setError(e instanceof Error ? e.message : String(e)); });
    }).catch((e) => setError(String(e)));
    const onResize = () => show?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      window.removeEventListener('resize', onResize);
      show?.dispose();
      showRef.current = null;
      delete (window as unknown as { __gpu?: Showcase }).__gpu;
    };
  }, []);

  const nextCam = () => {
    const i = CAMS.findIndex((c) => c.id === cam);
    const n = CAMS[(i + 1) % CAMS.length].id;
    setCam(n);
    if (showRef.current) showRef.current.camMode = n;
  };

  const toggleDrive = () => {
    const m: DriveMode = drive === 'auto' ? 'manual' : 'auto';
    setDrive(m);
    driveRef.current = m;
    setThumb(null);
    if (showRef.current) showRef.current.drive = m;
    if (m === 'manual') { setCam('chase'); setHelp(true); setMenu(false); } else setRide(null);
  };
  // Leinwand: im Autopilot wechselt Tippen die Kamera, beim Selbstfahren steuert der Daumen (wie im Spiel)
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drive !== 'manual') { nextCam(); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    showRef.current?.pointerDown(e.clientX, e.clientY);
    setThumb({ x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    setHelp(false);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drive !== 'manual' || !thumb) return;
    showRef.current?.pointerMove(e.clientX, e.clientY);
    setThumb({ ...thumb, x: e.clientX, y: e.clientY });
  };
  const onUp = () => {
    showRef.current?.pointerUp();
    setThumb(null);
  };
  // am Rechner: Pfeiltasten (oder WASD) wie im Spiel
  useEffect(() => {
    const map: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
    const on = (down: boolean) => (e: KeyboardEvent) => {
      const k = map[e.key];
      if (!k || driveRef.current !== 'manual') return;
      e.preventDefault();
      showRef.current?.key(k, down);
      if (down) setHelp(false);
    };
    const kd = on(true);
    const ku = on(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);
  useEffect(() => {
    if (!help) return;
    const id = window.setTimeout(() => setHelp(false), 7000);
    return () => window.clearTimeout(id);
  }, [help]);

  const startMeasure = (lap: boolean) => {
    const sh = showRef.current;
    if (!sh) return;
    const diff: Partial<Settings> = {};
    for (const k of Object.keys(settings) as (keyof Settings)[]) if (settings[k] !== DEFAULT_SETTINGS[k]) (diff as Record<string, unknown>)[k] = settings[k];
    sh.startMeasure(lap, { version: BUILD_ID, einstellungen: diff, aufnahme: new Date().toISOString() });
    setMeasuring(true);
    setReport(null);
    setMenu(false);
  };
  const runCost = () => {
    const sh = showRef.current;
    if (!sh || cost) return;
    setMenu(false);
    setCost({ i: 0, n: 1, label: 'startet' });
    void sh.costAnalysis((i, n, label) => setCost({ i, n, label })).then((t) => {
      setCost(null);
      setCostText(t);
      setCostCopied(false);
    }).catch((e: unknown) => { setCost(null); setError(String(e)); });
  };
  const stopMeasure = () => {
    const r = showRef.current?.stopMeasure() ?? null;
    setMeasuring(false);
    if (r) {
      setReport(r);
      setReportCopied(false);
      lsWrite(LS_REPORT, r.text);
      setLastReport(r.text);
    }
  };
  // Anzeige während der Messung (Dauer, Ruckler)
  useEffect(() => {
    if (!measuring) return;
    const id = window.setInterval(() => {
      const p = showRef.current?.perf;
      if (p) setRecInfo({ s: p.recSeconds, hitches: p.hitches });
    }, 500);
    return () => window.clearInterval(id);
  }, [measuring]);
  // Live-Kurve: Bildzeit (Balken) und CPU-Anteil, Linien bei 1× und 2× Takt
  useEffect(() => {
    const sh = showRef.current;
    if (sh) sh.graph = graph;
    if (!graph) return;
    let raf = 0;
    let k = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (k++ % 4) return;
      const cv = graphRef.current;
      const p = showRef.current?.perf;
      if (!cv || !p) return;
      const c = cv.getContext('2d');
      if (!c) return;
      const W = cv.width, H = cv.height;
      const period = stats?.period ?? 16.7;
      const scale = H / (period * 3);
      c.clearRect(0, 0, W, H);
      c.fillStyle = 'rgba(10,14,22,0.7)';
      c.fillRect(0, 0, W, H);
      const bw = W / 180;
      for (let j = 0; j < 180; j++) {
        const i = (p.ringAt + j) % 180;
        const d = p.ring[i * 2], cpu = p.ring[i * 2 + 1];
        if (!d) continue;
        c.fillStyle = d > period * 1.5 + 1 ? '#ff5a5a' : d > period * 1.15 ? '#ffc94a' : '#57d38c';
        const h = Math.min(H, d * scale);
        c.fillRect(j * bw, H - h, Math.max(1, bw - 0.5), h);
        c.fillStyle = 'rgba(111,183,255,0.9)';
        const hc = Math.min(H, cpu * scale);
        c.fillRect(j * bw, H - hc, Math.max(1, bw - 0.5), hc);
      }
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.lineWidth = 1;
      for (const m of [1, 2]) { const y = H - period * m * scale; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graph, stats?.period]);

  const loading = stats ? stats.loading < 1 : true;
  useEffect(() => {
    if (loading) return;
    const id = window.setTimeout(() => setVeil(false), 650);
    return () => window.clearTimeout(id);
  }, [loading]);
  const pct = Math.round((stats?.loading ?? 0) * 100);
  return (
    <div className="gpu-root">
      <div ref={hostRef} className="gpu-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <button type="button" className="gpu-back" onClick={() => navigate('/admin')} aria-label="Zurück">
        <Icon name="chevron" size={18} />
      </button>
      {settings.cinema ? <div className="gpu-bars" /> : null}
      {!loading ? (
        <button type="button" className="gpu-gear" onClick={() => setMenu((m) => !m)} aria-label="Einstellungen">
          <Icon name="settings" size={18} />
        </button>
      ) : null}
      {menu ? (
        <div className="gpu-menu abf-scroll" onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}>
          <div className="gpu-menu__tabs">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`gpu-tab${tab === t.id ? ' is-on' : ''}`} onClick={(e) => { setTab(t.id); e.currentTarget.closest('.gpu-menu')?.scrollTo(0, 0); }}>{t.label}</button>
            ))}
          </div>
          {tab === 'look' ? (
            <>
              <div className="gpu-menu__row gpu-menu__moods">
                {MOOD_IDS.map((id) => (
                  <button key={id} type="button" className={`gpu-chip${settings.mood === id && !settings.cycle ? ' is-on' : ''}`} onClick={() => change({ mood: id, cycle: false })}>{MOODS[id].name}</button>
                ))}
              </div>
              {TOGGLES.map((t) => (
                <label key={t.k} className="gpu-menu__row gpu-menu__check">
                  <input type="checkbox" checked={!!settings[t.k]} onChange={(e) => change({ [t.k]: e.target.checked } as Partial<Settings>)} />
                  <span>{t.label}</span>
                </label>
              ))}
            </>
          ) : null}
          {tab === 'tech' ? (
            <div className="gpu-menu__measure">
              <strong>Messfahrt</strong>
              <span className="muted">Zeichnet jedes Bild auf (Bildzeit, CPU je Baustein, GPU falls möglich, Aufrufe, Ort, Kamera, Gegner). Danach Bericht kopieren und mir schicken.</span>
              <div className="gpu-menu__row gpu-menu__actions">
                <button type="button" className="gpu-chip is-on" onClick={() => startMeasure(true)}>Eine Runde von vorn</button>
                <button type="button" className="gpu-chip" onClick={() => startMeasure(false)}>Ab hier bis Stopp</button>
                {lastReport ? <button type="button" className="gpu-chip" onClick={() => { void copyText(lastReport).then((ok) => { if (ok) { setReportCopied(true); setTimeout(() => setReportCopied(false), 1500); } }); }}>{reportCopied ? 'Kopiert ✓' : 'Letzten Bericht kopieren'}</button> : null}
              </div>
              <strong>Kostenanalyse</strong>
              <span className="muted">Die Fahrt hält dafür an der aktuellen Stelle an (das ist Absicht: gleiche Ansicht für alle Varianten). Dann wird je Ebene (Leuchten, Schattendurchgang, Gegner, Bäume, Landschaft …) und Auflösung gemessen, was sie kostet. Dauert etwa 25 s, danach fährt es weiter.</span>
              <div className="gpu-menu__row gpu-menu__actions">
                <button type="button" className="gpu-chip is-on" onClick={runCost}>Kostenanalyse starten</button>
              </div>
              <label className="gpu-menu__row gpu-menu__check">
                <input type="checkbox" checked={graph} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGraph(e.target.checked)} />
                <span>Bildzeit-Kurve (grün ok, gelb knapp, rot Ruckler; blau CPU)</span>
              </label>
              <span className="muted">GPU-Zeit: {showRef.current?.gpuTiming ? 'wird gemessen' : 'auf diesem Gerät nicht messbar'}</span>
            </div>
          ) : null}
          {tab !== 'look' ? SLIDERS.filter((sl) => (tab === 'tech') === TECH.includes(sl.k)).map((sl) => (
            <label key={sl.k} className="gpu-menu__row gpu-menu__slider">
              <span>{sl.label} <em>{Number(settings[sl.k]).toFixed(sl.step >= 1 ? 0 : 2)}</em></span>
              <input type="range" min={sl.min} max={sl.max} step={sl.step} value={Number(settings[sl.k])}
                onInput={(e: React.FormEvent<HTMLInputElement>) => change({ [sl.k]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>)}
                onChange={(e) => change({ [sl.k]: Number(e.target.value) } as Partial<Settings>)} />
            </label>
          )) : null}
          <div className="gpu-menu__row gpu-menu__actions">
            <button type="button" className="gpu-chip" onClick={() => change({ ...DEFAULT_SETTINGS, mood: settings.mood })}>Zurücksetzen</button>
            <button type="button" className="gpu-chip" onClick={copy}>{copied ? 'Kopiert ✓' : 'Einstellungen + fps kopieren'}</button>
          </div>
        </div>
      ) : null}
      {hud && stats && !loading ? (
        <div className="gpu-hud" onClick={() => setHud(false)}>
          <strong>{Math.round(stats.fps)} fps</strong>
          <span>{stats.ms.toFixed(1)} ms · CPU {stats.cpu.toFixed(1)} ms · Takt {Math.round(1000 / stats.period)} Hz</span>
          <span>{stats.backend} · Auflösung ×{stats.dpr.toFixed(2)}</span>
          <span>{(stats.tris / 1000).toFixed(0)}k Dreiecke · {stats.calls} Aufrufe</span>
        </div>
      ) : null}
      {hud && !menu && drive === 'auto' && stats && stats.loading >= 1 && stats.period > 14 && !hint60 ? (
        <div className="gpu-hint" onClick={() => setHint60(true)}>
          <strong>Nur 60 Hz?</strong> Safari zeichnet Webseiten auf dem iPhone meist mit 60 Bildern/s. Für 120 Hz:
          Einstellungen → Apps → Safari → Erweitert → Feature Flags → „Prefer Page Rendering Updates near 60fps“
          ausschalten, Seite neu laden. <span className="muted">(tippen zum Ausblenden)</span>
        </div>
      ) : null}
      {!hud ? <button type="button" className="gpu-hud gpu-hud--off" onClick={() => setHud(true)}>fps</button> : null}
      {!loading ? (
        <div className="gpu-bar">
          <button type="button" className="gpu-pill" onClick={nextCam}>
            Kamera: {CAMS.find((c) => c.id === cam)?.label}{settings.cycle ? ` · ${showRef.current?.moodName ?? ''}` : ''}
          </button>
          <div className="gpu-seg" role="group" aria-label="Fahren">
            <button type="button" className={drive === 'auto' ? 'is-on' : ''} onClick={() => { if (drive !== 'auto') toggleDrive(); }}>Autopilot</button>
            <button type="button" className={drive === 'manual' ? 'is-on' : ''} onClick={() => { if (drive !== 'manual') toggleDrive(); }}>Selbst fahren</button>
          </div>
        </div>
      ) : null}
      {drive === 'manual' && ride ? (
        <div className="gpu-ride">
          <strong>{Math.round(ride.kmh)}<small> km/h</small></strong>
          <div className="gpu-ride__chips">
            <span className={ride.tuck > 0.5 ? 'is-on' : ''}>Ducken</span>
            <span className={ride.brake > 0.25 ? 'is-on is-red' : ''}>Bremsen</span>
            <span className={ride.draft > 0.3 ? 'is-on is-blue' : ''}>Windschatten</span>
          </div>
        </div>
      ) : null}
      {thumb ? (
        <>
          <div className="gpu-thumb gpu-thumb--anchor" style={{ left: thumb.x0, top: thumb.y0 }}>
            <span className="gpu-thumb__up">ducken</span>
            <span className="gpu-thumb__down">bremsen</span>
          </div>
          <div className="gpu-thumb gpu-thumb--finger" style={{ left: thumb.x, top: thumb.y }} />
        </>
      ) : null}
      {help && drive === 'manual' ? (
        <div className="gpu-help" onClick={() => setHelp(false)}>
          <strong>Steuerung wie im Spiel</strong>
          <span>Daumen auflegen und ziehen: <b>seitlich</b> lenken · <b>hoch</b> schieben ducken (schneller) · <b>runter</b> ziehen bremsen.</span>
          <span className="muted">Vor Kehren hilft der Bremsassistent. Am Rechner: Pfeiltasten. Ohne Hindernisse und ohne Sturz.</span>
        </div>
      ) : null}
      {graph && !loading ? <canvas ref={graphRef} className="gpu-graph" width={360} height={120} /> : null}
      {measuring ? (
        <div className="gpu-rec">
          <i />
          <span>Messung {Math.floor(recInfo.s / 60)}:{String(Math.floor(recInfo.s % 60)).padStart(2, '0')} · {recInfo.hitches} Ruckler</span>
          <button type="button" onClick={stopMeasure}>Stopp</button>
        </div>
      ) : null}
      {cost ? (
        <div className="gpu-rec">
          <i />
          <span>Kostenanalyse {cost.i + 1}/{cost.n}: {cost.label}</span>
          <button type="button" onClick={() => showRef.current?.abortAnalysis()}>Abbrechen</button>
        </div>
      ) : null}
      {costText ? (
        <div className="gpu-report">
          <strong>Kostenanalyse fertig</strong>
          <pre className="gpu-report__pre">{costText.split('\n').slice(3).join('\n')}</pre>
          <div className="gpu-menu__row gpu-menu__actions">
            <button type="button" className="gpu-chip is-on" onClick={() => { void copyText(costText).then((ok) => setCostCopied(ok)); }}>{costCopied ? 'Kopiert ✓' : 'Ergebnis kopieren'}</button>
            <button type="button" className="gpu-chip" onClick={() => setCostText(null)}>Schließen</button>
          </div>
        </div>
      ) : null}
      {report ? (
        <div className="gpu-report">
          <strong>Messfahrt fertig</strong>
          <div className="gpu-report__grid">
            <span>Dauer</span><b>{report.summary.s.toFixed(0)} s</b>
            <span>Bildrate</span><b>{report.summary.fps.toFixed(0)} fps (Takt {Math.round(1000 / report.summary.period)} Hz)</b>
            <span>1 % langsamste</span><b>{report.summary.low1.toFixed(0)} fps</b>
            <span>Ruckler</span><b>{report.summary.hitches}</b>
            <span>schlimmstes Bild</span><b>{report.summary.worst.toFixed(0)} ms</b>
            <span>CPU (95 %)</span><b>{report.summary.cpuP95.toFixed(1)} ms</b>
            <span>GPU (95 %)</span><b>{report.summary.gpuP95 !== null ? `${report.summary.gpuP95.toFixed(1)} ms` : 'nicht messbar'}</b>
          </div>
          <div className="gpu-menu__row gpu-menu__actions">
            <button type="button" className="gpu-chip is-on" onClick={() => { void copyText(report.text).then((ok) => setReportCopied(ok)); }}>{reportCopied ? 'Kopiert ✓' : 'Bericht kopieren'}</button>
            <button type="button" className="gpu-chip" onClick={() => { void shareFile(report.full, `messfahrt-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`); }}>Vollständig als Datei</button>
            <button type="button" className="gpu-chip" onClick={() => setReport(null)}>Schließen</button>
          </div>
          <span className="muted">„Bericht kopieren“ reicht meist ({Math.round(report.text.length / 1000)} kB). Die Datei enthält zusätzlich jedes einzelne Bild.</span>
        </div>
      ) : null}
      {veil && !error ? (
        <div className={`gpu-load${loading ? '' : ' gpu-load--done'}`}>
          <div className="gpu-load__box">
            <strong>Passabfahrt</strong>
            <span className="gpu-load__sub">Dolomiten · WebGPU</span>
            <div className="gpu-load__bar"><i style={{ transform: `scaleX(${(stats?.loading ?? 0).toFixed(3)})` }} /></div>
            <span className="gpu-load__stage">{loading ? `${stats?.stage ?? 'WebGPU startet'} … ${pct} %` : 'Los geht’s'}</span>
          </div>
        </div>
      ) : null}
      {error ? <div className="gpu-load gpu-load--err"><span>{error}</span></div> : null}
    </div>
  );
}
