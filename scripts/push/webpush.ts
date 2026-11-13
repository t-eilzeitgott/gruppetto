// Web Push ohne Zusatzpaket: Nachricht verschlüsseln (RFC 8291, aes128gcm) und beim Push-Dienst des Geräts
// abliefern, angemeldet mit VAPID (RFC 8292). Nur node:crypto.
//
// Schlüssel: VAPID-Schlüsselpaar (P-256). Öffentlicher Schlüssel = 65 Bytes (unkomprimierter Punkt) als base64url –
// steht auch in der App (src/app/push.ts); privater Schlüssel = 32 Bytes (d) als base64url, nur als Secret.
// Neues Paar: node scripts/push/run.ts --schluessel
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type ECDH } from 'node:crypto';

export interface PushTarget {
  endpoint: string;
  /** öffentlicher Schlüssel des Geräts (base64url, 65 Bytes) */
  p256dh: string;
  /** Geheimnis des Geräts (base64url, 16 Bytes) */
  auth: string;
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  /** Kontakt für den Push-Dienst: https:-Adresse oder mailto: */
  subject: string;
}

export interface SendResult {
  status: number;
  /** Gerät gibt es nicht mehr (abgemeldet, App gelöscht) – Eintrag löschen */
  gone: boolean;
  ok: boolean;
  body?: string;
}

export const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const fromB64u = (s: string) => Buffer.from(s.replace(/=+$/, ''), 'base64url');

export function newVapidKeys(): { publicKey: string; privateKey: string } {
  const ec = createECDH('prime256v1');
  ec.generateKeys();
  return { publicKey: b64u(ec.getPublicKey()), privateKey: b64u(ec.getPrivateKey()) };
}

function vapidKey(v: Vapid) {
  const pub = fromB64u(v.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID-Schlüssel: öffentlicher Schlüssel muss 65 Bytes (unkomprimiert) sein');
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(fromB64u(v.privateKey)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

/** VAPID-Anmeldung für einen Push-Dienst (JWT, ES256) */
export function vapidHeader(endpoint: string, v: Vapid, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject })));
  const data = `${head}.${claims}`;
  const sig = sign('sha256', Buffer.from(data), { key: vapidKey(v), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${v.publicKey}`;
}

/**
 * Nachricht für ein Gerät verschlüsseln (aes128gcm, ein Datensatz). Ergebnis: Kopf (Salz, Datensatzgröße,
 * öffentlicher Schlüssel des Absenders) + verschlüsselter Text.
 */
export function encrypt(target: Pick<PushTarget, 'p256dh' | 'auth'>, plaintext: Uint8Array, salt: Buffer = randomBytes(16), sender?: ECDH) {
  const uaPub = fromB64u(target.p256dh);
  const authSecret = fromB64u(target.auth);
  if (uaPub.length !== 65) throw new Error('Geräteschlüssel (p256dh) ungültig');
  if (authSecret.length < 16) throw new Error('Gerätegeheimnis (auth) ungültig');
  if (!sender) {
    sender = createECDH('prime256v1');
    sender.generateKeys();
  }
  const asPub = sender.getPublicKey();
  const shared = sender.computeSecret(uaPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 = letzter Datensatz (ohne Auffüllen)
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

/** Nachricht (JSON) an ein Gerät schicken */
export async function sendPush(target: PushTarget, payload: unknown, v: Vapid, opts: { ttl?: number; urgency?: 'low' | 'normal' | 'high'; topic?: string } = {}): Promise<SendResult> {
  const data = encrypt(target, Buffer.from(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    Authorization: vapidHeader(target.endpoint, v),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 6 * 3600),
    Urgency: opts.urgency ?? 'normal',
  };
  // gleiches Thema ersetzt eine noch nicht zugestellte ältere Nachricht (nur a–z, A–Z, 0–9, -, _; max. 32 Zeichen)
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);
  const res = await fetch(target.endpoint, { method: 'POST', headers, body: data, signal: AbortSignal.timeout(20000) });
  const ok = res.status >= 200 && res.status < 300;
  const body = ok ? undefined : (await res.text().catch(() => '')).slice(0, 300);
  return { status: res.status, ok, gone: res.status === 404 || res.status === 410, body };
}
