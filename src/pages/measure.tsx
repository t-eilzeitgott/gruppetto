/**
 * Messmodus der Rennfinals und des Zeitfahrens (wie in der Abfahrt): Messfahrt (jedes Bild – Bildzeit, Rechenzeit je
 * Baustein, Grafikzeit per Probebild, Auflösung und Sichtweite, was der Regler tut) und Kostenanalyse (was jede Ebene
 * genau hier kostet). Für Admins oder mit ?mess in der Adresse. Der Bericht lässt sich kopieren oder als Datei teilen.
 */
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import { BUILD_ID } from '../app/config';
import { Perf3D, type Report } from '../game/abfahrt/perf3d';
import type { Renderer3D } from '../game/abfahrt/render3d';
import type { RaceView } from '../game/abfahrt/engine';
import { rangeDrop, viewRange } from '../game/abfahrt/viewRange';
import { gfxOn } from '../game/abfahrt/gfxOpts';
import { nextWeatherName } from '../game/abfahrt/weather';
import { copyText, shareFile } from './admin/gpuKit';
import { lsGet, lsSet } from './gameKit';

const PLACE_LABEL: Record<string, string> = { frei: 'freie Strecke', ortsdurchfahrt: 'Ortsdurchfahrten', dorf: 'Dörfer' };

export interface Measure {
  can: boolean;
  perf: RefObject<Perf3D>;
  measuring: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * Zustand des Messmodus. game: Name im Bericht („Zeitfahren“), renderer: die Bühne (aus useRaceLoop), meta: Strecke
 * und Tag; onResume: das Spiel weiterlaufen lassen (Pause verlassen)
 */
export function useMeasure(o: { admin: boolean; game: string; renderer: () => Renderer3D | null; meta: () => Record<string, string | number>; onResume: () => void }) {
  const can = o.admin || /[?&]mess\b/.test(window.location.search);
  const perf = useRef(new Perf3D());
  const [measuring, setMeasuring] = useState(false);
  const [recInfo, setRecInfo] = useState({ s: 0, hitches: 0 });
  const [report, setReport] = useState<Report | null>(null);
  const key = `gruppetto.${o.game.toLowerCase()}.messbericht`;
  const [lastReport, setLastReport] = useState<string | null>(() => lsGet(key));
  const [cost, setCost] = useState<{ i: number; n: number; label: string } | null>(null);
  const [costText, setCostText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const deviceInfo = () => {
    const r = o.renderer();
    const cv = r?.gl.domElement;
    const rd = rangeDrop();
    return {
      geraet: navigator.userAgent,
      bildschirm: `${window.innerWidth}×${window.innerHeight} ×${window.devicePixelRatio || 1}`,
      zeichenflaeche: cv ? `${cv.width}×${cv.height}` : '?',
      aufloesung: r ? `${Math.round(r.quality * 100)} % (${r.gl.getPixelRatio().toFixed(2)} Pixel je Punkt)` : '?',
      sichtweite: `${viewRange().label}${rd ? ` (vom Regler ${rd} Stufe${rd > 1 ? 'n' : ''} kürzer)` : ''}`,
      grafik: `${gfxOn('lite') ? 'Einfache Grafik an, ' : ''}${r?.pc ? 'PC-Grafik an, ' : ''}Lichtfilter & Wetter ${gfxOn('licht') ? 'an' : 'aus'}, Sonnenschatten ${gfxOn('schatten') ? 'an' : 'aus'}, Landschaftsdetails ${gfxOn('details') ? 'an' : 'aus'}`,
    };
  };
  const start = () => {
    perf.current.startRec({ art: `gruppetto ${o.game} (WebGL) Messfahrt`, version: BUILD_ID, aufnahme: new Date().toISOString(), wetter: nextWeatherName() ?? 'aus', ...o.meta(), ...deviceInfo() });
    setMeasuring(true);
    setRecInfo({ s: 0, hitches: 0 });
    setReport(null);
    setCopied(false);
    o.onResume();
  };
  const stop = () => {
    if (!perf.current.rec) return;
    const d = deviceInfo();
    const r = perf.current.stopRec({ ende: new Date().toISOString(), aufloesung_ende: d.aufloesung, sichtweite_ende: d.sichtweite });
    setMeasuring(false);
    if (r) { setReport(r); setCopied(false); lsSet(key, r.text); setLastReport(r.text); }
  };
  useEffect(() => {
    if (!measuring) return undefined;
    const id = window.setInterval(() => { const p = perf.current; setRecInfo({ s: p.recSeconds, hitches: p.hitches }); }, 500);
    return () => window.clearInterval(id);
  }, [measuring]);
  const runCost = (eng: RaceView | null) => {
    const r = o.renderer();
    if (!r || !eng || cost) return;
    const d = deviceInfo();
    const meta = [
      `gruppetto ${o.game} (WebGL) Kostenanalyse · ${new Date().toISOString()} · Version ${BUILD_ID}`,
      `Gerät: ${d.geraet}`,
      `Bildschirm ${d.bildschirm} · Zeichenfläche ${d.zeichenflaeche} · Auflösung ${d.aufloesung} · Sichtweite ${d.sichtweite} · ${d.grafik}`,
      `Ort: ${Math.round(eng.p.z)} m, ${r.ridersShown} Fahrer als Modell im Bild, Phase ${eng.phase}`,
    ];
    setCost({ i: 0, n: 1, label: 'startet' });
    setCostText(null);
    void r.costAnalysis(eng as never, meta, (i, n, label) => setCost({ i, n, label }))
      .then((t) => { setCost(null); setCostText(t || null); setCopied(false); })
      .catch((e: unknown) => { setCost(null); setCostText(`Kostenanalyse abgebrochen: ${String(e)}`); });
  };

  const m: Measure = { can, perf, measuring, start, stop };
  return {
    m,
    /** Abschnitt im Pausenmenü */
    menu: (eng: () => RaceView | null) => (can ? (
      <div className="abf-gfx">
        <span className="abf-range__label">Messmodus</span>
        <span className="abf-range__hint">
          Messfahrt: zeichnet jedes Bild auf – Bildzeit, Rechenzeit je Baustein, Grafikzeit, Auflösung und Sichtweite. Endet mit dem Rennen oder mit Stopp.
          Kostenanalyse: misst genau hier, was jede Ebene kostet (gut eine Minute, das Spiel bleibt in der Pause).
        </span>
        <div className="race-row">
          {measuring
            ? <button type="button" className="btn btn--secondary btn--sm" onClick={stop}>Messung beenden</button>
            : <button type="button" className="btn btn--secondary btn--sm" onClick={start} disabled={!!cost}>Messfahrt starten</button>}
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => runCost(eng())} disabled={!!cost || measuring}>{cost ? `Messe ${cost.i + 1}/${cost.n} …` : 'Kostenanalyse hier'}</button>
        </div>
        {cost ? <span className="abf-range__hint">{cost.label}</span> : null}
        {lastReport ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void copyText(lastReport).then((ok) => setCopied(ok)); }}>{copied ? 'Kopiert ✓' : 'Letzten Messbericht kopieren'}</button> : null}
      </div>
    ) : null),
    /** Aufnahme-Anzeige, fertige Berichte */
    overlays: (paused: boolean) => (
      <>
        {measuring && !paused ? (
          <div className="gpu-rec abf-rec">
            <i />
            <span>Messung {Math.floor(recInfo.s / 60)}:{String(Math.floor(recInfo.s % 60)).padStart(2, '0')} · {recInfo.hitches} Ruckler</span>
            <button type="button" onClick={stop}>Stopp</button>
          </div>
        ) : null}
        {costText ? (
          <div className="gpu-report">
            <strong>Kostenanalyse fertig</strong>
            <pre className="gpu-report__pre">{costText.split('\n').filter((l) => !l.startsWith('Gerät:')).join('\n')}</pre>
            <div className="gpu-menu__row gpu-menu__actions">
              <button type="button" className="gpu-chip is-on" onClick={() => { void copyText(costText).then((ok) => setCopied(ok)); }}>{copied ? 'Kopiert ✓' : 'Ergebnis kopieren'}</button>
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
              <span>Grafik (Probe, Median)</span><b>{report.summary.gpuMed !== null ? `${report.summary.gpuMed.toFixed(1)} ms` : '–'}</b>
              {report.summary.places.map((p) => (
                <Fragment key={p.name}>
                  <span>{PLACE_LABEL[p.name] ?? p.name}</span>
                  <b>{p.fps.toFixed(0)} fps · 60 % unter {p.p60.toFixed(1)} ms{p.gpu !== null ? ` · Grafik ${p.gpu.toFixed(1)} ms` : ''}</b>
                </Fragment>
              ))}
            </div>
            <div className="gpu-menu__row gpu-menu__actions">
              <button type="button" className="gpu-chip is-on" onClick={() => { void copyText(report.text).then((ok) => setCopied(ok)); }}>{copied ? 'Kopiert ✓' : 'Bericht kopieren'}</button>
              <button type="button" className="gpu-chip" onClick={() => { void shareFile(report.full, `${o.game.toLowerCase()}-messfahrt-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`); }}>Vollständig als Datei</button>
              <button type="button" className="gpu-chip" onClick={() => setReport(null)}>Schließen</button>
            </div>
          </div>
        ) : null}
      </>
    ),
  };
}
