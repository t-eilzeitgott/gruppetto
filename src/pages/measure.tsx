/**
 * Messmodus der Rennfinals und des Zeitfahrens (wie in der Abfahrt): Messfahrt (jedes Bild – Bildzeit, Rechenzeit je
 * Baustein, Grafikzeit per Probebild, Auflösung und Sichtweite, was der Regler tut) und Kostenanalyse (was jede Ebene
 * genau hier kostet). Für Admins oder mit ?mess in der Adresse. Der Bericht lässt sich kopieren oder als Datei teilen.
 */
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import { BUILD_ID } from '../app/config';
import { AB_PERIOD_S, Perf3D, type AbTest, type Report } from '../game/abfahrt/perf3d';
import { setPaceOff } from '../game/frameClock';
import type { Renderer3D } from '../game/abfahrt/render3d';
import type { RaceView } from '../game/abfahrt/engine';
import { autoRangeDrop, chosenRange, viewRange } from '../game/abfahrt/viewRange';
import { gfxAA, gfxAuto, gfxDescribe, gfxOn, gfxRes } from '../game/abfahrt/gfxOpts';
import { autoView, fmtRes, setAutoSuspended } from '../game/abfahrt/autoGfx';
import { nextWeatherName, setShadowEvery, setShadowSizeOverride } from '../game/abfahrt/weather';
import { copyText, shareFile } from './admin/gpuKit';
import { lsGet, lsSet } from './gameKit';

const PLACE_LABEL: Record<string, string> = { frei: 'freie Strecke', ortsdurchfahrt: 'Ortsdurchfahrten', dorf: 'Dörfer' };

/**
 * Wechseltests: eine Einstellung wechselt während der Messfahrt alle 20 s zwischen A (normal) und B – der Bericht
 * vergleicht beide auf derselben Strecke (Ruckler je Minute, Taktfehler, Bildrate)
 */
const abTests = (renderer: () => Renderer3D | null): Record<string, AbTest> => ({
  schatten: { name: 'Sonnenschatten', labels: ['Schattenkarte jedes Bild', 'Schattenkarte alle 8 Bilder'], apply: (b) => setShadowEvery(b ? 8 : 1) },
  schattenKlein: { name: 'Schattenkarte klein', labels: ['Schattenkarte wie eingestellt', 'Schattenkarte 256 Texel'], apply: (b) => setShadowSizeOverride(b ? 256 : 0) },
  // Grafik absichtlich beschäftigen: taktet das iPhone bei kleiner Last herunter und verpasst dann die leichten Bilder?
  heizer: {
    name: 'Grafik-Füllarbeit', labels: ['ohne Füllarbeit', 'plus 4 ms Füllarbeit je Bild'],
    apply: (b) => { setAutoSuspended(true); const r = renderer(); if (r) r.heaterMs = b ? 4 : 0; },
    end: () => { setAutoSuspended(false); const r = renderer(); if (r) r.heaterMs = 0; },
  },
  // Auflösung fest halbe ↔ drei Viertel der gewählten (die Automatik setzt so lange aus)
  aufl: {
    name: 'Auflösung', labels: ['halbe gewählte Auflösung', 'drei Viertel der gewählten'],
    apply: (b) => { setAutoSuspended(true); renderer()?.setQuality(b ? 0.75 : 0.5); },
    end: () => { setAutoSuspended(false); renderer()?.setQuality(autoView().res / gfxRes()); },
  },
  hud: { name: 'Oberfläche', labels: ['Oberfläche an', 'Oberfläche aus'], apply: (b) => document.body.classList.toggle('mess-ohne-hud', b) },
  takt: { name: 'fester Bildtakt', labels: ['fester Bildtakt', 'ohne festen Takt (jeder Aufruf zeichnet)'], apply: (b) => setPaceOff(b) },
});
const AB_KEY = 'gruppetto.mess.wechsel';

/**
 * Anzeige „Messung 1:23 · 4 Ruckler“ während der Messfahrt: schreibt ihren Text selbst (zweimal je Sekunde) –
 * früher stieß das jedes Mal einen Neuaufbau der ganzen Spielseite an, mitten in der Messung
 */
export function RecBadge({ perf, onStop }: { perf: Perf3D; onStop: () => void }) {
  const txt = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let last = '';
    const tick = () => {
      const s = perf.recSeconds;
      const t = `Messung ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')} · ${perf.hitches} Ruckler`;
      if (t !== last && txt.current) { last = t; txt.current.textContent = t; }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [perf]);
  return (
    <div className="gpu-rec abf-rec">
      <i />
      <span ref={txt} />
      <button type="button" onClick={onStop}>Stopp</button>
    </div>
  );
}

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
  const [report, setReport] = useState<Report | null>(null);
  const key = `gruppetto.${o.game.toLowerCase()}.messbericht`;
  const [lastReport, setLastReport] = useState<string | null>(() => lsGet(key));
  const [cost, setCost] = useState<{ i: number; n: number; label: string } | null>(null);
  const [costText, setCostText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [abKey, setAbKey] = useState<string>(() => lsGet(AB_KEY) ?? '');

  const deviceInfo = () => {
    const r = o.renderer();
    const cv = r?.gl.domElement;
    return {
      geraet: navigator.userAgent,
      bildschirm: `${window.innerWidth}×${window.innerHeight} ×${window.devicePixelRatio || 1}`,
      zeichenflaeche: cv ? `${cv.width}×${cv.height}` : '?',
      aufloesung: r ? `${fmtRes(gfxRes() * r.quality)}${r.quality < 1 ? ` (Automatik; gewählt ${fmtRes(gfxRes())})` : ''} (${r.gl.getPixelRatio().toFixed(2)} Pixel je Punkt)` : '?',
      sichtweite: `${viewRange().label}${autoRangeDrop() ? ` (Automatik; gewählt ${chosenRange().label})` : ''}`,
      automatik: gfxAuto() ? 'an' : 'aus',
      // (PC-Grafik und Kantenglättung gehören zur Bühne: nach einem Wechsel gelten sie erst im nächsten Spiel)
      grafik: `${gfxDescribe()}${r && r.pc !== gfxOn('pc') ? ' – PC-Grafik erst ab dem nächsten Spiel' : ''}${r && r.aa !== gfxAA() ? ` – Kantenglättung ${r.aa ? 'noch an' : 'noch aus'} bis zum nächsten App-Start` : ''}`,
    };
  };
  const AB_TESTS = abTests(o.renderer);
  const start = () => {
    const ab = AB_TESTS[abKey] ?? null;
    perf.current.startRec({ art: `gruppetto ${o.game} (WebGL) Messfahrt`, version: BUILD_ID, aufnahme: new Date().toISOString(), wetter: nextWeatherName() ?? 'aus', ...o.meta(), ...deviceInfo(), ...(ab ? { wechseltest_einstellung: ab.name } : {}) }, ab);
    setMeasuring(true);
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

  const abSelect = (
    <label className="abf-range__hint">Wechseltest (alle {AB_PERIOD_S} s A ↔ B):{' '}
      <select value={abKey} onChange={(e) => { setAbKey(e.target.value); lsSet(AB_KEY, e.target.value); }}>
        <option value="">keiner</option>
        {Object.entries(AB_TESTS).map(([k, t]) => <option key={k} value={k}>{t.name}: {t.labels[0]} ↔ {t.labels[1]}</option>)}
      </select>
    </label>
  );
  const m: Measure = { can, perf, measuring, start, stop };
  return {
    m,
    /** Auswahl des Wechseltests (Startkarte) */
    abSelect: can ? abSelect : null,
    /** Abschnitt im Pausenmenü */
    menu: (eng: () => RaceView | null) => (can ? (
      <div className="abf-gfx">
        <div className="race-row">
          {measuring
            ? <button type="button" className="btn btn--secondary btn--sm" onClick={stop}>Messung beenden</button>
            : <button type="button" className="btn btn--secondary btn--sm" onClick={start} disabled={!!cost}>Messfahrt starten</button>}
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => runCost(eng())} disabled={!!cost || measuring}>{cost ? `Messe ${cost.i + 1}/${cost.n} …` : 'Kostenanalyse'}</button>
        </div>
        {cost ? <span className="abf-range__hint">{cost.label}</span> : null}
        {!measuring ? abSelect : null}
        {lastReport ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void copyText(lastReport).then((ok) => setCopied(ok)); }}>{copied ? 'Kopiert ✓' : 'Letzten Bericht kopieren'}</button> : null}
      </div>
    ) : null),
    /** Aufnahme-Anzeige, fertige Berichte */
    overlays: (paused: boolean) => (
      <>
        {measuring && !paused ? <RecBadge perf={perf.current} onStop={stop} /> : null}
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
              {report.summary.ab?.map((a) => (
                <Fragment key={a.label}>
                  <span>{a.label}</span>
                  <b>{a.hitchesPerMin.toFixed(1)} Ruckler/min · {a.late.toFixed(1)} % zu spät · {a.fps.toFixed(0)} fps ({a.s.toFixed(0)} s)</b>
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
