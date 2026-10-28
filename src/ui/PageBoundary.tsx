/**
 * Auffangnetz für eine Seite: Wirft eine Seite beim Zeichnen einen Fehler, bleibt der Rest der App stehen
 * (sonst wäre der ganze Bildschirm leer). Typischer Fall nach einem Update: Die App war noch offen, eine Seite
 * wird erst jetzt nachgeladen – ihre alte Datei gibt es auf dem Server nicht mehr. Dann einmal neu laden.
 */
import { Component, type ReactNode } from 'react';
import { Button } from './kit';
import { navigate } from '../app/router';

const RELOAD_KEY = 'gruppetto.reloadAt';

/** Fehler beim Nachladen eines Seitenteils (Chrome, Safari, Firefox formulieren es verschieden) */
export function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Load failed/i.test(msg);
}

/** Einmal neu laden (nicht öfter als alle 30 s – sonst hinge die App in einer Schleife fest) */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* ohne Speicher: trotzdem neu laden */ }
  window.location.reload();
  return true;
}

interface State { error: unknown }

export class PageBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error('Seite abgestürzt:', error);
    if (isChunkError(error)) reloadOnce();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    const msg = error instanceof Error ? error.message : String(error);
    return (
      <div className="page-crash" role="alert">
        <h2>{chunk ? 'Neue Version verfügbar' : 'Hier ist etwas schiefgelaufen'}</h2>
        <p>{chunk ? 'Die App wurde gerade aktualisiert. Einmal neu laden, dann geht es weiter.' : 'Diese Seite ließ sich nicht anzeigen. Der Rest der App funktioniert weiter.'}</p>
        {!chunk && msg ? <p className="page-crash__detail">{msg.slice(0, 240)}</p> : null}
        <div className="page-crash__actions">
          <Button onClick={() => window.location.reload()}>Neu laden</Button>
          <Button variant="secondary" onClick={() => { this.setState({ error: null }); navigate('/'); }}>Zur Startseite</Button>
        </div>
      </div>
    );
  }
}
