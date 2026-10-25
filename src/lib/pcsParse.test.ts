import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStartlist, parseResults, pcsName, normalize } from './pcsParse';
import type { Rider } from './types';

test('PCS-Namen werden umgedreht und schön geschrieben', () => {
  assert.equal(pcsName('POGAČAR Tadej'), 'Tadej Pogačar');
  assert.equal(pcsName('VAN DER POEL Mathieu'), 'Mathieu van der Poel');
  assert.equal(pcsName('DEL TORO Isaac'), 'Isaac del Toro');
  assert.equal(pcsName("O'CONNOR Ben"), "Ben O'Connor");
  assert.equal(pcsName('Jonas Vingegaard'), 'Jonas Vingegaard');
  assert.equal(pcsName('VAN AERT Wout'), 'Wout van Aert');
});

test('Normalisierung entfernt Akzente', () => {
  assert.equal(normalize('Pogačar, Tadej'), 'pogacar tadej');
  assert.equal(normalize('Søren Kragh Andersen'), 'soren kragh andersen');
});

test('Startliste im PCS-Format mit Teamzeilen', () => {
  const text = `
UAE Team Emirates XRG (WT)
1 POGAČAR Tadej
2 DEL TORO Isaac

Visma | Lease a Bike (WT)
11 VINGEGAARD Jonas
12  VAN AERT Wout
`;
  const { riders, skipped } = parseStartlist(text);
  assert.deepEqual(riders, [
    { bib: 1, name: 'Tadej Pogačar', team: 'UAE Team Emirates XRG' },
    { bib: 2, name: 'Isaac del Toro', team: 'UAE Team Emirates XRG' },
    { bib: 11, name: 'Jonas Vingegaard', team: 'Visma | Lease a Bike' },
    { bib: 12, name: 'Wout van Aert', team: 'Visma | Lease a Bike' },
  ]);
  assert.equal(skipped.length, 0);
});

test('Startliste als CSV', () => {
  const { riders } = parseStartlist('Nr;Name;Team\n1;Tadej Pogačar;UAE\n44\tJonathan Milan\tLidl-Trek');
  assert.deepEqual(riders, [
    { bib: 1, name: 'Tadej Pogačar', team: 'UAE' },
    { bib: 44, name: 'Jonathan Milan', team: 'Lidl-Trek' },
  ]);
});

const r = (id: number, name: string): Rider => ({
  id, tour_id: 't', bib: id, name, team: 'X', tip_limit: null, excluded_from_rest: false, status: 'active',
});

test('Ergebnis aus kopiertem PCS-Text erkennen', () => {
  const riders = [r(1, 'Kaden Groves'), r(2, 'Jonathan Milan'), r(3, 'Mathieu van der Poel'), r(4, 'Tadej Pogačar')];
  const text = `Rnk\tBIB\tRider\tTeam
1\t71\tGROVES Kaden\tAlpecin
2\t44\tMILAN Jonathan\tLidl-Trek
Dies ist Werbung
3\t72\tVAN DER POEL Mathieu\tAlpecin
4\t1\tPOGACAR Tadej\tUAE`;
  const parsed = parseResults(text, riders);
  assert.deepEqual(parsed.riderIds, [1, 2, 3, 4]);
  assert.ok(parsed.unmatched.includes('Dies ist Werbung'));
});
