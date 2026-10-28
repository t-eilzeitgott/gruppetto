/**
 * WebGPU-Test (Admin): ein Stück Passabfahrt mit dem WebGPU-Renderer von three.js – zum Vergleich mit dem Spiel.
 * Vollbild, Fahrer fährt von selbst; Tippen wechselt die Kamera. Oben links Bildrate, Auflösung und Technik.
 */
import { useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { useMembers } from '../../app/hooks';
import { useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { useGameLock } from '../gameKit';
import type { CamMode, Showcase, ShowcaseStats } from '../../game/gpu/showcase';

/** feste Tagesstrecke: Dolomiten, vier Kehren, kein Tunnel – die schönsten 2,5 km zum Vergleichen */
const DAY = '2026-10-15';

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
  return (
    <div className="gpu-root">
      <div ref={hostRef} className="gpu-canvas" onClick={nextCam} />
      <button type="button" className="gpu-back" onClick={() => navigate('/admin')} aria-label="Zurück">
        <Icon name="chevron" size={18} />
      </button>
      {hud && stats ? (
        <div className="gpu-hud" onClick={() => setHud(false)}>
          <strong>{Math.round(stats.fps)} fps</strong>
          <span>{stats.ms.toFixed(1)} ms · Takt {Math.round(1000 / stats.period)} Hz</span>
          <span>{stats.backend} · Auflösung ×{stats.dpr.toFixed(2)}</span>
          <span>{(stats.tris / 1000).toFixed(0)}k Dreiecke · {stats.calls} Aufrufe</span>
        </div>
      ) : null}
      {hud && stats && stats.loading >= 1 && stats.period > 14 && !hint60 ? (
        <div className="gpu-hint" onClick={() => setHint60(true)}>
          <strong>Nur 60 Hz?</strong> Safari zeichnet Webseiten auf dem iPhone meist mit 60 Bildern/s. Für 120 Hz:
          Einstellungen → Apps → Safari → Erweitert → Feature Flags → „Prefer Page Rendering Updates near 60fps“
          ausschalten, Seite neu laden. <span className="muted">(tippen zum Ausblenden)</span>
        </div>
      ) : null}
      {!hud ? <button type="button" className="gpu-hud gpu-hud--off" onClick={() => setHud(true)}>fps</button> : null}
      <div className="gpu-cam">{CAMS.find((c) => c.id === cam)?.label} · tippen wechselt</div>
      {loading && !error ? (
        <div className="gpu-load">
          <span>{stats ? `Landschaft wird gebaut … ${Math.round(stats.loading * 100)} %` : 'WebGPU startet …'}</span>
        </div>
      ) : null}
      {error ? <div className="gpu-load gpu-load--err"><span>{error}</span></div> : null}
    </div>
  );
}
