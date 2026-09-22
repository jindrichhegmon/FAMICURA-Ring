import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WakeKeeper } from '../public/wake.js';

// A browser's navigator.wakeLock, reduced to what WakeKeeper touches.
function fakeBrowser({ supported = true, fail = null } = {}) {
  const doc = { visibilityState: 'visible' };
  const requests = [];
  const nav = !supported ? {} : { wakeLock: { async request(type) {
    if (fail) throw new Error(fail);
    const listeners = [];
    const lock = {
      type, released: false,
      addEventListener: (name, fn) => { if (name === 'release') listeners.push(fn); },
      async release() { lock.released = true; listeners.forEach((fn) => fn()); },
    };
    requests.push(lock);
    return lock;
  } } };
  // What the browser does on hiding the page: it releases the lock itself.
  const hide = () => { doc.visibilityState = 'hidden'; requests.forEach((l) => !l.released && l.release()); };
  const show = () => { doc.visibilityState = 'visible'; };
  return { nav, doc, requests, hide, show };
}

test('drží obrazovku, dokud je potřeba, pak ji pustí', async () => {
  const b = fakeBrowser();
  const w = new WakeKeeper(b);
  await w.set(true);
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].type, 'screen');
  assert.equal(w.state().held, true);
  await w.set(false);
  assert.equal(b.requests[0].released, true);
  assert.equal(w.state().held, false);
});

test('dvě rychlá volání požádají jen jednou', async () => {
  const b = fakeBrowser();
  const w = new WakeKeeper(b);
  await Promise.all([w.set(true), w.set(true), w.sync()]);
  assert.equal(b.requests.length, 1);
});

test('po skrytí stránky ho prohlížeč pustí a po návratu se vezme znovu', async () => {
  const b = fakeBrowser();
  const w = new WakeKeeper(b);
  await w.set(true);
  b.hide();
  assert.equal(w.state().held, false);
  await w.sync();                           // still hidden: nothing to ask for
  assert.equal(b.requests.length, 1);
  b.show();
  await w.sync();
  assert.equal(b.requests.length, 2);
  assert.equal(w.state().held, true);
});

test('když už není potřeba, po návratu se nebere', async () => {
  const b = fakeBrowser();
  const w = new WakeKeeper(b);
  await w.set(true);
  b.hide();
  await w.set(false);
  b.show();
  await w.sync();
  assert.equal(b.requests.length, 1);
});

test('prohlížeč bez podpory to řekne a nic nespadne', async () => {
  const seen = [];
  const w = new WakeKeeper({ ...fakeBrowser({ supported: false }), onChange: (s) => seen.push(s) });
  await w.set(true);
  assert.deepEqual(seen.at(-1), { supported: false, wanted: true, held: false, error: null });
});

test('odmítnutí prohlížečem se nahlásí', async () => {
  const w = new WakeKeeper(fakeBrowser({ fail: 'NotAllowedError' }));
  await w.set(true);
  assert.equal(w.state().held, false);
  assert.equal(w.state().error, 'NotAllowedError');
});
