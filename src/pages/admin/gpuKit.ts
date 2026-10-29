/** Kleine Helfer der WebGPU-Seiten (Test und Abfahrt): Bericht kopieren, als Datei teilen, lokaler Speicher */

export const lsRead = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsWrite = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* voll oder gesperrt */ } };

/** Text in die Zwischenablage (Fallback: Auswahl-Dialog) */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { prompt('Bericht (alles markieren und kopieren)', text.slice(0, 20000)); return false; }
}

/** Datei teilen (iPhone: Teilen-Blatt) oder herunterladen */
export async function shareFile(text: string, name: string) {
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
