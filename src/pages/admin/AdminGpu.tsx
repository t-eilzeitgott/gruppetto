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
import type { CamMode, Showcase, ShowcaseStats } from '../../game/gpu/showcase';
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
const TECH: (keyof Settings)[] = ['maxDpr', 'shadowRes', 'shadowRange', 'msaa', 'rainK', 'wetK'];
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    let show: Showcase | null = null;
    let lastUi = 0;
    void import('../../game/gpu/showcase').then(({ Showcase: S }) => {
      if (!alive) return;
      show = new S(host, {
        dayKey: DAY,
        names: namesRef.current,
        onStats: (s) => {
          const now = performance.now();
          if (now - lastUi < 250) return;
          lastUi = now;
          setStats({ ...s });
        },
        onError: (e) => setError(String(e)),
      });
      showRef.current = show;
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

  const loading = stats ? stats.loading < 1 : true;
  useEffect(() => {
    if (loading) return;
    const id = window.setTimeout(() => setVeil(false), 650);
    return () => window.clearTimeout(id);
  }, [loading]);
  const pct = Math.round((stats?.loading ?? 0) * 100);
  return (
    <div className="gpu-root">
      <div ref={hostRef} className="gpu-canvas" onPointerDown={nextCam} />
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
      {hud && !menu && stats && stats.loading >= 1 && stats.period > 14 && !hint60 ? (
        <div className="gpu-hint" onClick={() => setHint60(true)}>
          <strong>Nur 60 Hz?</strong> Safari zeichnet Webseiten auf dem iPhone meist mit 60 Bildern/s. Für 120 Hz:
          Einstellungen → Apps → Safari → Erweitert → Feature Flags → „Prefer Page Rendering Updates near 60fps“
          ausschalten, Seite neu laden. <span className="muted">(tippen zum Ausblenden)</span>
        </div>
      ) : null}
      {!hud ? <button type="button" className="gpu-hud gpu-hud--off" onClick={() => setHud(true)}>fps</button> : null}
      {!loading ? <div className="gpu-cam">{CAMS.find((c) => c.id === cam)?.label} · tippen wechselt{settings.cycle ? ` · ${showRef.current?.moodName ?? ''}` : ''}</div> : null}
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
