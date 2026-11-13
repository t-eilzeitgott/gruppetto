// Benachrichtigungen verschicken (Workflow „Benachrichtigungen“, alle 15 Minuten; dazu nach jedem Ergebnis-Abgleich).
//
//   node scripts/push/run.ts                  echter Lauf
//   node scripts/push/run.ts --probelauf      nur anzeigen, was verschickt würde
//   node scripts/push/run.ts --test <Name>    Testnachricht an alle Geräte dieses Mitglieds (Anzeigename oder ID)
//   node scripts/push/run.ts --schluessel     neues VAPID-Schlüsselpaar erzeugen
//   node scripts/push/run.ts --jetzt 2027-05-15T10:30   Uhrzeit simulieren (Berliner Zeit)
//
// Braucht SUPABASE_URL und SUPABASE_SECRET_KEY; das VAPID-Schlüsselpaar steht in der Tabelle push_keys (oder als
// VAPID_PRIVATE_KEY in der Umgebung). Ohne Schlüssel oder ohne angemeldete Geräte passiert nichts. Jede Nachricht wird vor dem Versand in push_log beansprucht (einmal je
// Mitglied, Art und Etappe – auch wenn zwei Läufe gleichzeitig laufen).
import { appendFile } from 'node:fs/promises';
import { newVapidKeys, sendPush, type Vapid } from './webpush.ts';
import { REMIND_BEFORE_H, RESULT_WINDOW_H, plan, sentKey, type PushData, type PushMessage, type PushSub } from './plan.ts';
import { berlinToDate } from '../sync/time.ts';

/** öffentlicher Schlüssel der App (wie in src/app/push.ts) */
export const VAPID_PUBLIC_KEY = 'BFVkrEd6Ow4HUXfWStsBfJDiS25c7Ekw2XzrRib6WdKQ5PiY3dMpFt5GmLCKahUOc_BfCWsyS_4R3Jgq8TZq_Qs';
const SUBJECT = 'https://gruppetto.talfahrt.dev';

class Db {
  private readonly url: string;
  private readonly key: string;
  constructor(url: string, key: string) {
    this.url = url.replace(/\/+$/, '');
    this.key = key;
  }
  async req<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { apikey: this.key, 'Content-Type': 'application/json' };
    if (this.key.startsWith('eyJ')) headers.Authorization = `Bearer ${this.key}`;
    if (init.prefer) headers.Prefer = init.prefer;
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Supabase ${init.method ?? 'GET'} ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

const inList = (xs: (string | number)[]) => `in.(${xs.map((x) => (typeof x === 'number' ? x : `"${x}"`)).join(',')})`;

async function load(db: Db, now: Date, subs: PushSub[]): Promise<PushData> {
  const from = new Date(now.getTime() - RESULT_WINDOW_H * 3600e3).toISOString();
  const to = new Date(now.getTime() + REMIND_BEFORE_H * 3600e3).toISOString();
  const [profiles, groups, tours, stages] = await Promise.all([
    db.req<PushData['profiles']>('profiles?select=id,display_name,group_id,is_member&is_member=eq.true'),
    db.req<PushData['groups']>('groups?select=id,stage_points,underdog_bonus'),
    db.req<PushData['tours']>('tours?select=id,short_name,group_id&is_visible=eq.true'),
    db.req<PushData['stages']>(`stages?select=id,tour_id,number,starts_at,departure,arrival,results_published&starts_at=gte.${from}&starts_at=lte.${to}&order=starts_at`),
  ]);
  const ids = stages.map((s) => s.id);
  const published = stages.filter((s) => s.results_published).map((s) => s.id);
  const users = [...new Set(subs.map((s) => s.user_id))];
  const [tips, results, sent] = ids.length ? await Promise.all([
    db.req<PushData['tips']>(`stage_tips?select=stage_id,user_id,rider_id&stage_id=${inList(ids)}`),
    published.length ? db.req<PushData['results']>(`stage_results?select=stage_id,position,rider_id&stage_id=${inList(published)}`) : [],
    db.req<{ user_id: string; kind: 'result' | 'remind'; stage_id: number }[]>(`push_log?select=user_id,kind,stage_id&stage_id=${inList(ids)}&user_id=${inList(users)}`),
  ]) : [[], [], []];
  const riderIds = [...new Set([...tips.map((t) => t.rider_id), ...results.filter((r) => r.position === 1).map((r) => r.rider_id)])];
  const riders = riderIds.length ? await db.req<PushData['riders']>(`riders?select=id,name&id=${inList(riderIds)}`) : [];
  return {
    now, subs, profiles, groups, tours, stages, tips, results, riders,
    sent: new Set(sent.map((s) => sentKey(s.user_id, s.kind, s.stage_id))),
  };
}

async function summary(md: string) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

/** an alle Geräte eines Mitglieds; abgemeldete Geräte (404/410) werden gelöscht. true = mindestens eins erreicht */
async function deliver(db: Db, vapid: Vapid, subs: PushSub[], msg: Pick<PushMessage, 'payload' | 'ttl'> & { topic?: string }, log: string[]): Promise<boolean> {
  let any = false;
  for (const s of subs) {
    try {
      const r = await sendPush(s, msg.payload, vapid, { ttl: msg.ttl, topic: msg.topic });
      if (r.ok) any = true;
      else if (r.gone) {
        await db.req(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
        log.push(`  Gerät abgemeldet (${r.status}), gelöscht`);
      } else log.push(`  Fehler ${r.status} bei ${new URL(s.endpoint).host}: ${r.body ?? ''}`);
    } catch (e) {
      log.push(`  Fehler bei ${new URL(s.endpoint).host}: ${(e as Error).message}`);
    }
  }
  return any;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (k: string) => argv.includes(`--${k}`);
  const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };

  if (flag('schluessel')) {
    const k = newVapidKeys();
    console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const msg = 'SUPABASE_URL oder SUPABASE_SECRET_KEY fehlen – keine Benachrichtigungen.';
    console.log(msg);
    await summary(`## Benachrichtigungen\n\n${msg}`);
    return;
  }
  const db = new Db(url, key);
  // Schlüssel: Secret VAPID_PRIVATE_KEY, sonst aus der Tabelle push_keys
  let vapidPair = process.env.VAPID_PRIVATE_KEY ? { public_key: process.env.VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY, private_key: process.env.VAPID_PRIVATE_KEY } : null;
  vapidPair ??= (await db.req<{ public_key: string; private_key: string }[]>('push_keys?select=public_key,private_key&id=eq.1'))[0] ?? null;
  if (!vapidPair) {
    console.log('Kein VAPID-Schlüssel (Tabelle push_keys leer) – keine Benachrichtigungen.');
    return;
  }
  if (vapidPair.public_key !== VAPID_PUBLIC_KEY) console.log('Achtung: Schlüssel in push_keys passt nicht zum Schlüssel der App (src/app/push.ts).');
  const vapid: Vapid = { publicKey: vapidPair.public_key, privateKey: vapidPair.private_key, subject: SUBJECT };
  const dry = flag('probelauf');
  const nowArg = arg('jetzt');
  let now = new Date();
  if (nowArg) {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})$/.exec(nowArg);
    now = m ? berlinToDate(m[1], m[2]) : new Date(nowArg);
  }

  const subs = await db.req<PushSub[]>('push_subscriptions?select=endpoint,user_id,p256dh,auth');
  const log: string[] = [];

  // Testnachricht
  const testWho = arg('test');
  if (testWho) {
    const people = await db.req<{ id: string; display_name: string | null }[]>('profiles?select=id,display_name');
    const p = people.find((x) => x.id === testWho || x.display_name?.toLowerCase() === testWho.toLowerCase());
    if (!p) throw new Error(`Kein Mitglied „${testWho}“`);
    const mine = subs.filter((s) => s.user_id === p.id);
    console.log(`${p.display_name}: ${mine.length} Gerät(e)`);
    if (!mine.length || dry) return;
    const ok = await deliver(db, vapid, mine, { ttl: 3600, payload: { title: 'gruppetto', body: 'Testnachricht – Benachrichtigungen funktionieren.', url: '/', tag: 'test' } }, log);
    console.log(ok ? 'zugestellt' : 'nicht zugestellt', log.join('\n'));
    await summary(`## Testnachricht an ${p.display_name}\n\n${ok ? 'zugestellt' : 'nicht zugestellt'}\n\n${log.join('\n')}`);
    return;
  }

  if (!subs.length) {
    console.log('Keine Geräte angemeldet.');
    return;
  }
  const data = await load(db, now, subs);
  const messages = plan(data);
  console.log(`${subs.length} Gerät(e), ${data.stages.length} Etappe(n) im Zeitfenster, ${messages.length} Nachricht(en)`);
  let sent = 0;
  for (const m of messages) {
    const name = data.profiles.find((p) => p.id === m.userId)?.display_name ?? m.userId;
    log.push(`${m.kind === 'remind' ? 'Erinnerung' : 'Ergebnis'} an ${name}: ${m.payload.title} – ${m.payload.body}`);
    if (dry) continue;
    // beanspruchen: nur wer den Eintrag anlegt, verschickt
    const claimed = await db.req<unknown[]>('push_log?on_conflict=user_id,kind,stage_id', {
      method: 'POST',
      body: [{ user_id: m.userId, kind: m.kind, stage_id: m.stageId }],
      prefer: 'resolution=ignore-duplicates,return=representation',
    });
    if (!claimed?.length) { log.push('  schon verschickt (anderer Lauf)'); continue; }
    const ok = await deliver(db, vapid, subs.filter((s) => s.user_id === m.userId), { ...m, topic: m.payload.tag }, log);
    if (ok) sent += 1;
    else {
      // niemand erreicht: Anspruch zurückgeben, nächster Lauf versucht es noch einmal (abgemeldete Geräte sind weg)
      await db.req(`push_log?user_id=eq.${m.userId}&kind=eq.${m.kind}&stage_id=eq.${m.stageId}`, { method: 'DELETE' });
    }
  }
  console.log(log.join('\n'));
  if (messages.length) await summary(`## Benachrichtigungen${dry ? ' (Probelauf)' : ''}\n\n${dry ? messages.length : sent} verschickt\n\n${log.map((l) => `- ${l}`).join('\n')}`);
}

main().catch(async (e) => {
  console.error(e);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${String((e as Error).message).replace(/\r?\n/g, '%0A')}`);
  process.exitCode = 1;
});
