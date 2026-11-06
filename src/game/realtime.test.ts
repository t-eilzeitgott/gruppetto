import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castFrame, joinFrame, readCast, rtUrl } from '../app/realtime';
import { gridIndex } from './live';

test('Echtzeit-Kanal: Adresse und Nachrichten wie im Realtime-Protokoll (Version 1.0.0)', () => {
  assert.equal(rtUrl('https://abc.supabase.co/', 'sb_publishable_x'), 'wss://abc.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0');
  assert.equal(rtUrl('http://127.0.0.1:54321', 'k'), 'ws://127.0.0.1:54321/realtime/v1/websocket?apikey=k&vsn=1.0.0');
  const j = joinFrame('realtime:gruppetto:lobby:g:ABCD', 'jwt', '1');
  assert.deepEqual(j, {
    topic: 'realtime:gruppetto:lobby:g:ABCD', event: 'phx_join', ref: '1', join_ref: '1',
    payload: { config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, private: false }, access_token: 'jwt' },
  });
  assert.equal('access_token' in (joinFrame('t', null, '1').payload as object), false);
  const c = castFrame('realtime:x', 'pos', { z: 1 }, '7', '1');
  assert.deepEqual(c, { topic: 'realtime:x', event: 'broadcast', ref: '7', join_ref: '1', payload: { type: 'broadcast', event: 'pos', payload: { z: 1 } } });
  // so kommt die Meldung bei den anderen an
  assert.deepEqual(readCast({ ref: null, event: 'broadcast', payload: { event: 'pos', payload: { z: 1 }, type: 'broadcast' }, topic: 'realtime:x' }, 'realtime:x'), { event: 'pos', payload: { z: 1 } });
  assert.equal(readCast({ event: 'broadcast', payload: { event: 'pos', payload: {} }, topic: 'realtime:y' }, 'realtime:x'), null, 'anderer Kanal');
  assert.equal(readCast({ event: 'phx_reply', payload: { status: 'ok' }, topic: 'realtime:x' }, 'realtime:x'), null);
  assert.equal(readCast(null, 'realtime:x'), null);
});

test('Lobby-Rennen: jeder bekommt seinen eigenen Startplatz – bei allen dieselbe Reihenfolge', () => {
  const members = [{ user_id: 'c' }, { user_id: 'a' }, { user_id: 'b' }];
  assert.deepEqual(['a', 'b', 'c'].map((id) => gridIndex(members, id)), [0, 1, 2]);
  assert.deepEqual(['a', 'b', 'c'].map((id) => gridIndex([...members].reverse(), id)), [0, 1, 2]);
  assert.equal(gridIndex(members, 'x'), 0);
});
