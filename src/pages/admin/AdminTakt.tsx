/**
 * Takt-Prüfstand (Admin): misst, wie gleichmäßig der Browser die Bildaufrufe (requestAnimationFrame) liefert – ohne
 * das Spiel, mit einer winzigen WebGL-Szene. Nacheinander ein paar Varianten je 15 s: nur Aufrufe zählen, leeres
 * Bild, 300 Zeichenaufrufe, dazu Hochladen (256 KiB je Bild), eine Textur je Bild, Text in der Oberfläche je Bild,
 * jeder Takt. Zeigt je Variante die ausgelassenen Takte und Ruckler. So lässt sich trennen, was das iPhone bzw.
 * Safari von sich aus tut und was am Spiel liegt – und ob es im Home-Bildschirm-Modus (ohne Safari-Leiste) oder
 * mit der Safari-Einstellung „Prefer Page Rendering Updates near 60fps“ anders ist.
 */
import React, { useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { useGameLock } from '../gameKit';
import { BUILD_ID } from '../../app/config';
import { copyText, lsRead, lsWrite, shareFile } from './gpuKit';

const LS_REPORT = 'gruppetto.takt.lastReport';
/** Sekunden je Variante */
const STEP_S = 15;

interface Variant { id: string; name: string; draw: boolean; calls: number; upload: boolean; texture: boolean; dom: boolean; every: boolean }
const V = (id: string, name: string, o: Partial<Variant> = {}): Variant => ({ id, name, draw: true, calls: 1, upload: false, texture: false, dom: false, every: false, ...o });
const VARIANTS: Variant[] = [
  V('zaehlen', 'nur Aufrufe zählen (nichts zeichnen)', { draw: false }),
  V('leer', 'leeres Bild, 60 je s'),
  V('aufrufe', '300 Zeichenaufrufe', { calls: 300 }),
  V('hochladen', '300 Aufrufe + 256 KiB je Bild hochladen', { calls: 300, upload: true }),
  V('textur', '300 Aufrufe + 1 MB Textur je Bild', { calls: 300, texture: true }),
  V('text', '300 Aufrufe + Text in der Oberfläche je Bild', { calls: 300, dom: true }),
  V('jeder', '300 Aufrufe, jeder Takt (120 je s, wenn möglich)', { calls: 300, every: true }),
];

interface Stat {
  name: string; secs: number; ticks: number; tickGapP50: number; tickGapMax: number; ticksSkipped: number;
  frames: number; fps: number; frameP50: number; frameP90: number; frameMax: number; offBeat: number; hitches: number; hitchesPerMin: number;
  runs: Record<string, number>; hist: Record<string, number>;
}

const pct = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

export function TaktTestPage() {
  useTitle('Takt-Prüfstand');
  useGameLock();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<string | null>(() => lsRead(LS_REPORT));
  const [copied, setCopied] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const start = () => {
    const cv = canvasRef.current;
    if (!cv || running) return;
    setRunning(true);
    setReport(null);
    setCopied(false);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cv.clientWidth * dpr);
    cv.height = Math.round(cv.clientHeight * dpr);
    const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) { setReport('Kein WebGL2.'); setRunning(false); return; }
    // winzige Szene: farbige Quadrate, je Aufruf eines (Uniform-Wechsel wie im Spiel)
    const vs = `#version 300 es
      in vec2 aPos; uniform vec4 uRect; out vec2 vUv;
      void main() { vUv = aPos; gl_Position = vec4(uRect.xy + aPos * uRect.zw, 0.0, 1.0); }`;
    const fs = `#version 300 es
      precision mediump float; in vec2 vUv; uniform vec4 uCol; uniform sampler2D uTex; out vec4 o;
      void main() { o = vec4(uCol.rgb * (0.7 + 0.3 * texture(uTex, vUv).r), 1.0); }`;
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh); gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    // Eckpunkte in einem 256-KiB-Puffer (die Variante „hochladen“ lädt ihn jedes Bild ganz neu – wie die
    // Landschaftsstücke im Spiel, 256 KiB je Bild in einen Puffer, den das vorige Bild noch zeichnet)
    const big = new Float32Array(65536);
    big.set([0, 0, 1, 0, 0, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, big, gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRect = gl.getUniformLocation(prog, 'uRect');
    const uCol = gl.getUniformLocation(prog, 'uCol');
    // Textur 512² (1 MB), Variante „textur“ lädt sie jedes Bild neu (wie Kacheln und Atlanten im Spiel)
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const px = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < px.length; i += 4) { px[i] = (i >> 2) & 255; px[i + 1] = 128; px[i + 2] = 200; px[i + 3] = 255; }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.viewport(0, 0, cv.width, cv.height);

    // Takt erkennen: Median der Aufruf-Abstände in der ersten Sekunde (Apple: 60 oder 120 Hz)
    let tickMs = 0;
    const warm: number[] = [];
    let vi = -1;
    let vStart = 0;
    let last = -1;
    let lastDraw = -1;
    let ticksSince = 0;
    let frame = 0;
    const stats: Stat[] = [];
    let gaps: number[] = [];
    let dts: number[] = [];
    let run = 0;
    let runs: Record<string, number> = {};
    const flushRun = () => { if (!run) return; runs[run === 1 ? '1' : run === 2 ? '2' : run <= 5 ? '3-5' : run <= 10 ? '6-10' : '>10'] = (runs[run === 1 ? '1' : run === 2 ? '2' : run <= 5 ? '3-5' : run <= 10 ? '6-10' : '>10'] ?? 0) + 1; run = 0; };
    let lastHud = 0;
    let raf = 0;
    let stopped = false;
    const finish = (v: Variant, now: number) => {
      flushRun();
      const k = v.every ? 1 : Math.max(1, Math.round(16.7 / tickMs));
      const frameMs = tickMs * k;
      const g = [...gaps].sort((a, b) => a - b);
      const d = [...dts].sort((a, b) => a - b);
      const secs = (now - vStart) / 1000;
      const hitchMs = Math.max(frameMs, 16.7) * 1.5 + 1;
      const hist: Record<string, number> = {};
      for (const x of dts) { const key = x < 13 ? '<13' : x < 18 ? '13-18' : x < 25 ? '18-25' : x < 34 ? '25-34' : x < 50 ? '34-50' : '>50'; hist[key] = (hist[key] ?? 0) + 1; }
      const st: Stat = {
        name: v.name, secs: r1(secs), ticks: gaps.length, tickGapP50: r1(pct(g, 0.5)), tickGapMax: r1(g[g.length - 1] ?? 0),
        ticksSkipped: gaps.filter((x) => x > tickMs * 1.5).length,
        frames: dts.length, fps: r1(dts.length / Math.max(0.001, secs)), frameP50: r1(pct(d, 0.5)), frameP90: r1(pct(d, 0.9)), frameMax: r1(d[d.length - 1] ?? 0),
        offBeat: dts.filter((x) => x > frameMs * 1.25 + 1).length, hitches: dts.filter((x) => x > hitchMs).length, hitchesPerMin: 0,
        runs, hist,
      };
      st.hitchesPerMin = r1(st.hitches / Math.max(0.001, secs / 60));
      stats.push(st);
    };
    const done = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      const nav = navigator as Navigator & { standalone?: boolean };
      const out = {
        art: 'gruppetto Takt-Prüfstand', version: BUILD_ID, zeit: new Date().toISOString(), geraet: navigator.userAgent,
        home_bildschirm_app: nav.standalone === true, bildschirm: `${window.innerWidth}×${window.innerHeight} ×${window.devicePixelRatio || 1}`,
        leinwand: `${cv.width}×${cv.height}`, takt_ms: r1(tickMs), takt_hz: Math.round(1000 / tickMs),
        hinweis: 'je Variante 15 s; takte_uebersprungen: Aufruf-Abstand über anderthalb Takte; Ruckler: Bild über anderthalb Bildtakte (+1 ms); taktfehler: über fünf Viertel. „zaehlen“ zeichnet nichts – zeigt, was Safari ohne jede Grafik tut',
        varianten: stats.map((s) => ({
          variante: s.name, sekunden: s.secs, takte: s.ticks, takt_abstand_p50_ms: s.tickGapP50, takt_abstand_max_ms: s.tickGapMax, takte_uebersprungen: s.ticksSkipped,
          bilder: s.frames, fps: s.fps, bildzeit_p50_ms: s.frameP50, bildzeit_p90_ms: s.frameP90, bildzeit_max_ms: s.frameMax, taktfehler: s.offBeat, ruckler: s.hitches, ruckler_je_min: s.hitchesPerMin,
          ruckler_folgen: s.runs, verteilung_ms: s.hist,
        })),
      };
      const text = JSON.stringify(out);
      lsWrite(LS_REPORT, text);
      setReport(text);
      setRunning(false);
    };
    stopRef.current = done;
    const loop = (now: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      if (last >= 0) {
        const gap = now - last;
        if (!tickMs) {
          if (gap > 0 && gap < 60) warm.push(gap);
          if (warm.length >= 60) {
            const s = [...warm].sort((a, b) => a - b);
            const med = s[s.length >> 1];
            // (Apple: nur 60 oder 120 Hz; ein verrauschter Median um 8–11 ms heißt 120)
            tickMs = med < 12 ? 1000 / 120 : 1000 / 60;
            vi = 0; vStart = now; lastDraw = now; ticksSince = 0;
          }
        } else gaps.push(gap);
      }
      last = now;
      // (beim Erkennen des Takts schon zeichnen: Shader und Textur sind dann warm, bevor die Varianten zählen)
      if (!tickMs) {
        gl.clearColor(0.05, 0.07, 0.11, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform4f(uRect, -0.5, -0.5, 1, 1); gl.uniform4f(uCol, 0.3, 0.5, 0.9, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return;
      }
      const v = VARIANTS[vi];
      if (now - vStart >= STEP_S * 1000) {
        finish(v, now);
        vi += 1;
        if (vi >= VARIANTS.length) { done(); return; }
        vStart = now; gaps = []; dts = []; runs = {}; run = 0; lastDraw = now; ticksSince = 0;
        if (textRef.current) textRef.current.textContent = '';
      }
      const cur = VARIANTS[vi];
      ticksSince += 1;
      const k = cur.every ? 1 : Math.max(1, Math.round(16.7 / tickMs));
      // wie der feste Bildtakt im Spiel: nach k Aufrufen zeichnen, oder wenn das nächste Bild im Raster fast dran ist
      const due = ticksSince >= k || now >= lastDraw + (k - 0.15) * tickMs;
      if (!due) return;
      const dt = now - lastDraw;
      lastDraw = now;
      ticksSince = 0;
      dts.push(dt);
      const frameMs = tickMs * k;
      if (dt > Math.max(frameMs, 16.7) * 1.5 + 1) run += 1; else flushRun();
      frame += 1;
      if (cur.draw) {
        if (cur.upload) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, big); }
        if (cur.texture) { px[(frame * 4) % px.length] = frame & 255; gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 512, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        gl.clearColor(0.05, 0.07, 0.11, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const t = now / 1000;
        for (let i = 0; i < cur.calls; i++) {
          const a = t * 0.7 + i * 0.021;
          const x = Math.sin(a) * 0.8, y = Math.cos(a * 1.3 + i) * 0.8;
          gl.uniform4f(uRect, x, y, 0.08, 0.08);
          gl.uniform4f(uCol, 0.4 + 0.6 * Math.abs(Math.sin(i)), 0.5, 0.9 - 0.4 * Math.abs(Math.cos(i * 0.3)), 1);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }
      if (cur.dom && textRef.current) textRef.current.textContent = `${Math.round(40 + 20 * Math.sin(now / 900))} km/h · ${(now / 1000).toFixed(2)} s`;
      if (now - lastHud > 500 && hudRef.current) {
        lastHud = now;
        const recent = dts.slice(-30);
        const bad = recent.filter((x) => x > Math.max(frameMs, 16.7) * 1.5 + 1).length;
        hudRef.current.textContent = `${vi + 1}/${VARIANTS.length} ${cur.name} · ${Math.round(STEP_S - (now - vStart) / 1000)} s · Takt ${Math.round(1000 / tickMs)} Hz · ${bad} Ruckler in den letzten 30 Bildern`;
      }
    };
    raf = requestAnimationFrame(loop);
  };

  useEffect(() => () => { stopRef.current?.(); }, []);

  const parsed = (() => { try { return report ? (JSON.parse(report) as { takt_hz?: number; home_bildschirm_app?: boolean; varianten?: { variante: string; fps: number; takte_uebersprungen: number; ruckler: number; ruckler_je_min: number; bildzeit_max_ms: number }[] }) : null; } catch { return null; } })();

  return (
    <div className="gpu-root">
      <canvas ref={canvasRef} className="gpu-canvas" style={{ width: '100%', height: '100%' }} />
      <button type="button" className="gpu-back" onClick={() => { stopRef.current?.(); navigate('/admin'); }} aria-label="Zurück"><Icon name="chevron" /></button>
      <div ref={hudRef} className="gpu-hud" style={{ textAlign: 'left', maxWidth: '70%' }}>{running ? 'Takt wird erkannt …' : 'Takt-Prüfstand'}</div>
      <div className="gpu-ride" style={{ pointerEvents: 'none' }}><strong><span ref={textRef} /></strong></div>
      {!running && !report ? (
        <div className="gpu-report">
          <strong>Takt-Prüfstand</strong>
          <div className="muted">Misst gut zwei Minuten lang, wie gleichmäßig der Browser die Bildaufrufe liefert – mit einer winzigen Szene statt des Spiels, in sieben Varianten je {STEP_S} s. Telefon dabei ruhig halten, nichts berühren.</div>
          <button type="button" className="gpu-pill" style={{ background: '#6fb7ff', color: '#0b0f16', fontWeight: 700 }} onClick={start}>Starten</button>
        </div>
      ) : null}
      {running ? <div className="gpu-rec"><i /> Prüfstand läuft <button type="button" onClick={() => stopRef.current?.()}>Abbrechen</button></div> : null}
      {!running && report ? (
        <div className="gpu-report">
          <strong>Ergebnis</strong>
          {parsed?.varianten ? (
            <div className="gpu-report__grid">
              <span>Takt</span><b>{parsed.takt_hz} Hz{parsed.home_bildschirm_app ? ' · Home-Bildschirm-App' : ' · in Safari'}</b>
              {parsed.varianten.map((v) => <React.Fragment key={v.variante}><span>{v.variante}</span><b>{v.ruckler_je_min} Ruckler/min · {v.takte_uebersprungen} Takte ausgelassen · {v.fps} fps</b></React.Fragment>)}
            </div>
          ) : <pre className="gpu-report__pre">{report}</pre>}
          <div className="gpu-menu__row gpu-menu__actions">
            <button type="button" className="gpu-chip" onClick={() => { void copyText(report).then(() => setCopied(true)); }}>{copied ? 'Kopiert ✓' : 'Bericht kopieren'}</button>
            <button type="button" className="gpu-chip" onClick={() => { void shareFile(report, `takt-${BUILD_ID}.json`); }}>Teilen</button>
            <button type="button" className="gpu-chip" onClick={start}>Noch einmal</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
