import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueRecording, dueRecordings } from '../public/schedule.js';

const at = (h, m = 0) => new Date(2026, 8, 22, h, m, 0);
const schedules = {
  camA: [{ from: '08:00', to: '12:00' }],
  camB: [{ from: '10:00', to: '11:00' }],
  camC: [{ from: '22:00', to: '06:00' }],
};

test('překrývající se plány vrátí všechny kamery', () => {
  assert.deepEqual(dueRecordings(schedules, at(10, 30)).map((d) => d.deviceId), ['camA', 'camB']);
});

test('mimo všechny intervaly nic', () => {
  assert.deepEqual(dueRecordings(schedules, at(15)), []);
  assert.equal(dueRecording(schedules, at(15)), null);
});

test('vypnutý interval se nepočítá', () => {
  assert.deepEqual(dueRecordings({ camA: [{ from: '08:00', to: '12:00', enabled: false }] }, at(9)), []);
});

test('interval přes půlnoc', () => {
  assert.deepEqual(dueRecordings(schedules, at(23)).map((d) => d.deviceId), ['camC']);
});
