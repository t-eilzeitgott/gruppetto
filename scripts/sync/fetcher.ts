// Abruf über curl_cffi (Python) mit Browser-Fingerabdruck – siehe fetch_pcs.py.
// Liefert ein fetch-kompatibles Objekt, damit fetchPcsPage (Wiederholung, Sperr-Erkennung) gleich bleibt.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./fetch_pcs.py', import.meta.url));

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // wie fetch(): TypeError mit dem eigentlichen Grund in cause (letzte Zeile der Fehlerausgabe)
      if (err) reject(new TypeError('fetch failed', { cause: new Error(String(stderr || err.message).trim().split('\n').pop() || 'curl_cffi-Fehler') }));
      else resolve({ stdout, stderr });
    });
  });
}

/** Ist python3 mit curl_cffi vorhanden? */
export async function hasBrowserFetch(python = process.env.PYTHON ?? 'python3'): Promise<boolean> {
  try {
    await run(python, ['-c', 'import curl_cffi'], 15000);
    return true;
  } catch {
    return false;
  }
}

export function browserFetch(opts: { python?: string; script?: string; timeoutMs?: number } = {}): typeof fetch {
  const python = opts.python ?? process.env.PYTHON ?? 'python3';
  const script = opts.script ?? SCRIPT;
  const timeoutMs = opts.timeoutMs ?? 30000;
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const dir = await mkdtemp(join(tmpdir(), 'pcs-'));
    try {
      const file = join(dir, 'page.html');
      const { stdout } = await run(python, [script, url, file, String(timeoutMs / 1000 - 5)], timeoutMs);
      const meta = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { status: number; headers: Record<string, string> };
      const body = await readFile(file);
      return new Response(body, { status: meta.status, headers: meta.headers });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }) as typeof fetch;
}
