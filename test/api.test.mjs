import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createHandler } from '../src/api.mjs';
import { pripravit } from '../src/zaznamy.mjs';
import { mockDbs } from './mock-db.mjs';

process.env.RING_HMAC_KEY = 'testovaci-klic';

/** Stejná cookie, jakou vydává Netlify funkce login. */
function cookie(expiresAt = Date.now() + 3600_000, key = process.env.RING_HMAC_KEY) {
  const sig = crypto.createHmac('sha256', key).update(`famicura-session:${expiresAt}`, 'utf8').digest('base64url');
  return `fam_sess=${expiresAt}.${sig}`;
}

const req = (method, path, { body, cookies } = {}) =>
  new Request('http://localhost' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookies ? { cookie: cookies } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('health nepotřebuje přihlášení a vrací verzi', async () => {
  const { dbs } = mockDbs();
  const r = await createHandler({ dbs })(req('GET', '/api/health'));
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.ok(b.cas);
});

test('zápis bez přihlášení je odmítnut', async () => {
  const { dbs, provedene } = mockDbs();
  const r = await createHandler({ dbs })(req('POST', '/api/clb', { body: { typ: 'udalost', cas: new Date().toISOString() } }));
  assert.equal(r.status, 401);
  assert.equal(provedene.length, 0, 'nic se nesmí zapsat');
});

test('zápis s cizím podpisem je odmítnut', async () => {
  const { dbs, provedene } = mockDbs();
  const r = await createHandler({ dbs })(req('POST', '/api/clb',
    { body: { typ: 'udalost', cas: new Date().toISOString() }, cookies: cookie(Date.now() + 3600_000, 'jiny-klic') }));
  assert.equal(r.status, 401);
  assert.equal(provedene.length, 0);
});

test('zápis s prošlou cookie je odmítnut', async () => {
  const { dbs } = mockDbs();
  const r = await createHandler({ dbs })(req('POST', '/api/clb',
    { body: { typ: 'udalost', cas: new Date().toISOString() }, cookies: cookie(Date.now() - 1000) }));
  assert.equal(r.status, 401);
});

test('událost se zapíše parametrizovaně', async () => {
  const { dbs, provedene } = mockDbs();
  const r = await createHandler({ dbs })(req('POST', '/api/clb', {
    cookies: cookie(),
    body: { typ: 'udalost', cas: '2026-09-22T09:04:07.000Z', kameraId: 'ava1.ring.device.A',
            kameraNazev: "Vchod 'hlavní'", druh: 'fall', zavaznost: 'varovani',
            popis: 'MOŽNÝ PÁD', odZacatkuS: 95 },
  }));
  assert.equal(r.status, 200);
  assert.equal(provedene.length, 1);
  const { text, params } = provedene[0];
  assert.match(text, /INSERT INTO dbo\.FamicuraRingLog/);
  assert.equal(params.kameraNazev, "Vchod 'hlavní'", 'hodnota jde beze změny, escapovat není co');
  assert.ok(params.cas instanceof Date);
  assert.equal(params.odZacatkuS, 95);
});

test('nahrávka se zapíše do své tabulky i s odkazem na soubor', async () => {
  const { dbs, provedene } = mockDbs();
  const r = await createHandler({ dbs })(req('POST', '/api/clb', {
    cookies: cookie(),
    body: { typ: 'nahravka', od: '2026-09-22T09:04:07.000Z', do: '2026-09-22T09:14:07.000Z',
            kameraNazev: 'Zahrada', velikostB: 26214400, soubor: 'famicura-Zahrada.mp4',
            slozka: 'Famicura-Camera', zdroj: 'plan' },
  }));
  assert.equal(r.status, 200);
  const { text, params } = provedene[0];
  assert.match(text, /INSERT INTO dbo\.FamicuraRingNahravky/);
  assert.equal(params.slozka, 'Famicura-Camera');
  assert.equal(params.velikostB, 26214400);
});

test('pokus o injekci je jen hodnota, dotaz se nemění', async () => {
  const { dbs, provedene } = mockDbs();
  const utok = "x'); DROP TABLE dbo.FamicuraRingLog; --";
  await createHandler({ dbs })(req('POST', '/api/clb', {
    cookies: cookie(),
    body: { typ: 'udalost', cas: new Date().toISOString(), popis: utok },
  }));
  const { text, params } = provedene[0];
  assert.equal(params.popis, utok, 'text se ukládá tak, jak přišel');
  assert.ok(!text.includes('DROP'), 'do dotazu se nedostane');
  assert.equal((text.match(/INSERT INTO/g) || []).length, 1);
});

test('neznámý typ a nesmyslné tělo se odmítnou bez zápisu', async () => {
  const { dbs, provedene } = mockDbs();
  const h = createHandler({ dbs });
  assert.equal((await h(req('POST', '/api/clb', { cookies: cookie(), body: { typ: 'neco' } }))).status, 400);
  assert.equal((await h(req('POST', '/api/clb', { cookies: cookie(), body: { typ: 'udalost' } }))).status, 400);
  assert.equal((await h(req('POST', '/api/clb', { cookies: cookie(), body: { typ: 'nahravka' } }))).status, 400);
  assert.equal(provedene.length, 0);
});

test('diagnostika vrací počty řádků', async () => {
  const { dbs } = mockDbs({ log: 12, nahravky: 4 });
  const r = await createHandler({ dbs })(req('GET', '/api/diag', { cookies: cookie() }));
  const b = await r.json();
  assert.equal(b.log, 12);
  assert.equal(b.nahravky, 4);
});

test('neznámá adresa je 404', async () => {
  const { dbs } = mockDbs();
  assert.equal((await createHandler({ dbs })(req('GET', '/api/neco'))).status, 404);
});

test('příprava ořízne délky a řídicí znaky', () => {
  const p = pripravit({ typ: 'udalost', cas: new Date(), popis: 'a\u0000b'.padEnd(3000, 'x'), kameraNazev: 'y'.repeat(500) });
  assert.equal(p.params.popis.includes('\u0000'), false);
  assert.ok(p.params.popis.length <= 1000);
  assert.ok(p.params.kameraNazev.length <= 200);
});

test('prázdné hodnoty jsou NULL, ne prázdné řetězce', () => {
  const p = pripravit({ typ: 'udalost', cas: new Date(), kameraId: '', velikostB: '' });
  assert.equal(p.params.kameraId, null);
  assert.equal(p.params.odZacatkuS, null);
});

test('neplatné číslo neprojde jako text', () => {
  const p = pripravit({ typ: 'nahravka', od: new Date(), velikostB: '1; DROP TABLE x' });
  assert.equal(p.params.velikostB, null);
});
