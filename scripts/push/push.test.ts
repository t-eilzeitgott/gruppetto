import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { b64u, encrypt, fromB64u, newVapidKeys, vapidHeader } from './webpush.ts';
import { plan, sentKey, shortName, type PushData } from './plan.ts';

/** wie ein Browser: Nachricht mit dem eigenen Schlüssel entschlüsseln (RFC 8291) */
function decrypt(body: Buffer, ua: ReturnType<typeof createECDH>, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const shared = ua.computeSecret(asPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'Trennzeichen „letzter Datensatz“');
  return plain.subarray(0, plain.length - 1).toString();
}

test('Verschlüsselung lässt sich vom Gerät entschlüsseln', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const msg = JSON.stringify({ title: 'Etappe 7', body: 'Pogačar wurde 2. – +15 Punkte' });
  const enc = encrypt({ p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) }, Buffer.from(msg));
  assert.equal(decrypt(enc, ua, auth), msg);
});

test('VAPID-Anmeldung ist gültig signiert', () => {
  const k = newVapidKeys();
  const h = vapidHeader('https://web.push.apple.com/abc', { ...k, subject: 'https://gruppetto.talfahrt.dev' }, Date.UTC(2027, 4, 15));
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  assert.equal(m[4], k.publicKey);
  const claims = JSON.parse(fromB64u(m[2]).toString());
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://gruppetto.talfahrt.dev');
  const pub = fromB64u(k.publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(m[3])));
});

test('Kurzname', () => {
  assert.equal(shortName('Tadej Pogačar'), 'Pogačar');
  assert.equal(shortName('Wout van Aert'), 'van Aert');
  assert.equal(shortName('Merlier'), 'Merlier');
});

const G = 'g1';
function data(over: Partial<PushData> = {}): PushData {
  return {
    now: new Date('2027-05-15T08:30:00Z'), // 10:30 in Berlin
    subs: [
      { endpoint: 'https://p/a', user_id: 'anna', p256dh: '', auth: '' },
      { endpoint: 'https://p/b', user_id: 'ben', p256dh: '', auth: '' },
      { endpoint: 'https://p/x', user_id: 'fremd', p256dh: '', auth: '' },
    ],
    profiles: [
      { id: 'anna', display_name: 'Anna', group_id: G, is_member: true },
      { id: 'ben', display_name: 'Ben', group_id: G, is_member: true },
      { id: 'cleo', display_name: 'Cleo', group_id: G, is_member: true },
      { id: 'fremd', display_name: 'Fremd', group_id: 'g2', is_member: true },
    ],
    groups: [{ id: G, stage_points: [20, 15, 10], underdog_bonus: true }, { id: 'g2', stage_points: [5], underdog_bonus: false }],
    tours: [{ id: 'giro', short_name: 'Giro', group_id: null }, { id: 'test', short_name: 'Test', group_id: G }],
    stages: [
      // gestern, Ergebnis da
      { id: 7, tour_id: 'giro', number: 7, starts_at: '2027-05-14T10:00:00Z', departure: 'Chieti', arrival: 'Tagliacozzo', results_published: true },
      // heute 12:00 Berlin
      { id: 8, tour_id: 'giro', number: 8, starts_at: '2027-05-15T10:00:00Z', departure: 'Giulianova', arrival: 'Castel di Sangro', results_published: false },
      // nur Gruppe g1
      { id: 9, tour_id: 'test', number: 1, starts_at: '2027-05-15T09:30:00Z', departure: null, arrival: null, results_published: false },
    ],
    tips: [
      { stage_id: 7, user_id: 'anna', rider_id: 2 },
      { stage_id: 7, user_id: 'ben', rider_id: 1 },
      { stage_id: 7, user_id: 'cleo', rider_id: 1 },
      { stage_id: 8, user_id: 'anna', rider_id: 1 },
    ],
    results: [{ stage_id: 7, position: 1, rider_id: 2 }, { stage_id: 7, position: 2, rider_id: 1 }],
    riders: [{ id: 1, name: 'Jonathan Milan' }, { id: 2, name: 'Tim Merlier' }],
    sent: new Set(),
    ...over,
  };
}

test('Erinnerung nur ohne Tipp und nur für die eigene Gruppe', () => {
  const r = plan(data()).filter((m) => m.kind === 'remind');
  const who = r.map((m) => `${m.userId}:${m.stageId}`).sort();
  assert.deepEqual(who, ['anna:9', 'ben:8', 'ben:9', 'fremd:8']);
  const ben8 = r.find((m) => m.userId === 'ben' && m.stageId === 8)!;
  assert.equal(ben8.payload.title, 'Noch kein Tipp für Etappe 8');
  assert.match(ben8.payload.body, /Giro · Giulianova → Castel di Sangro – Tippschluss in 2 Stunden \(12:00 Uhr\)/);
  assert.equal(ben8.payload.url, '/tipp/8');
});

test('Ergebnis mit Punkten nach Gruppenregeln, Außenseiter-Bonus und Tagesbestem', () => {
  const r = plan(data()).filter((m) => m.kind === 'result');
  const anna = r.find((m) => m.userId === 'anna')!;
  // Anna allein auf Merlier (Sieger), zwei Tipps auf Milan → 20 + 2
  assert.equal(anna.payload.body, 'Merlier hat gewonnen – +22 Punkte (inkl. 2 Außenseiter-Bonus). Du bist Tagesbester!');
  const ben = r.find((m) => m.userId === 'ben')!;
  assert.equal(ben.payload.body, 'Sieg für Merlier. Milan wurde 2. – +15 Punkte. Tagesbester: Anna (22).');
  const fremd = r.find((m) => m.userId === 'fremd')!;
  assert.equal(fremd.payload.body, 'Sieg für Merlier. Du hattest nicht getippt.');
  assert.equal(anna.payload.url, '/etappe/7');
});

test('schon verschickt: nicht noch einmal', () => {
  const sent = new Set([sentKey('anna', 'result', 7), sentKey('ben', 'remind', 8)]);
  const r = plan(data({ sent }));
  assert.ok(!r.some((m) => m.userId === 'anna' && m.kind === 'result'));
  assert.ok(!r.some((m) => m.userId === 'ben' && m.kind === 'remind' && m.stageId === 8));
});

test('zu früh, zu spät: nichts', () => {
  assert.equal(plan(data({ now: new Date('2027-05-15T07:30:00Z') })).filter((m) => m.kind === 'remind' && m.stageId === 8).length, 0);
  assert.equal(plan(data({ now: new Date('2027-05-15T10:00:00Z') })).filter((m) => m.kind === 'remind').length, 0);
  assert.equal(plan(data({ now: new Date('2027-05-16T08:30:00Z') })).filter((m) => m.kind === 'result' && m.stageId === 7).length, 0);
});
