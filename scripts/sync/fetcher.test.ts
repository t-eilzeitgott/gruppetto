import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserFetch } from './fetcher.ts';
import { fetchPcsPage, parseStagePage, PcsError } from './pcs.ts';

const hasPython = (() => {
  try {
    execFileSync('python3', ['--version']);
    return true;
  } catch {
    return false;
  }
})();

// Ersatz für fetch_pcs.py ohne curl_cffi: gleiche Aufrufform und Ausgabe
function stub(status: number, body: string, headers: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stub-'));
  const page = join(dir, 'body.html');
  writeFileSync(page, body);
  const script = join(dir, 'stub.py');
  writeFileSync(script, [
    'import json, shutil, sys',
    `shutil.copyfile(${JSON.stringify(page)}, sys.argv[2])`,
    `print(json.dumps({"status": ${status}, "headers": ${JSON.stringify(headers)}, "impersonate": "chrome"}))`,
  ].join('\n'));
  return script;
}

test('Abruf über Python: Seite, Status und Kopfzeilen kommen an', { skip: !hasPython && 'python3 fehlt' }, async () => {
  const html = '<html><head><title>Giro</title></head><body><ul class="list keyvalueList"><li><div>Distance:</div><div>147 km</div></li></ul></body></html>';
  const page = await fetchPcsPage('race/giro-d-italia/2026/stage-1', { fetchImpl: browserFetch({ script: stub(200, html) }) });
  assert.equal(parseStagePage(page).distanceKm, 147);
});

test('Abruf über Python: Cloudflare-Sperre wird erkannt', { skip: !hasPython && 'python3 fehlt' }, async () => {
  const f = browserFetch({ script: stub(403, '<title>Just a moment...</title>', { 'cf-mitigated': 'challenge' }) });
  await assert.rejects(fetchPcsPage('race/x/2026/stage-1', { fetchImpl: f, retries: 0 }), (e: unknown) => e instanceof PcsError && e.blocked);
});

test('Abruf über Python: Absturz zählt als Netzfehler und wird wiederholt', { skip: !hasPython && 'python3 fehlt' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stub-'));
  const script = join(dir, 'kaputt.py');
  writeFileSync(script, 'import sys\nsys.stderr.write("curl: (28) Operation timed out\\n")\nsys.exit(2)\n');
  await assert.rejects(
    fetchPcsPage('race/x/2026/stage-1', { fetchImpl: browserFetch({ script }), retries: 1, retryDelayMs: 1 }),
    (e: unknown) => e instanceof PcsError && /nicht erreichbar.*Operation timed out/.test(e.message),
  );
});
