/*
 * Keeps the screen on while a camera analyses or records.
 *
 * Without it a screen saver or display sleep hides the page, the browser stops
 * drawing, and analysis and recording pause until someone comes back. The
 * browser drops the lock by itself whenever the page is hidden, so it has to
 * be taken again on return. Locking the computer or putting it to sleep cannot
 * be prevented from a web page.
 *
 * navigator and document are passed in, so the logic runs in Node tests.
 */
export class WakeKeeper {
  constructor({ nav = globalThis.navigator, doc = globalThis.document, onChange = () => {} } = {}) {
    this.nav = nav;
    this.doc = doc;
    this.onChange = onChange;
    this.wanted = false;
    this.lock = null;
    this.requesting = null;       // the request in flight, so two calls do not ask twice
    this.error = null;
  }

  get supported() { return !!this.nav?.wakeLock?.request; }

  state() {
    return { supported: this.supported, wanted: this.wanted, held: !!this.lock, error: this.error };
  }

  async set(wanted) {
    this.wanted = !!wanted;
    await this.sync();
  }

  /** Brings the lock in line with what is wanted; call again when the page shows. */
  async sync() {
    if (!this.supported) { this.onChange(this.state()); return; }

    if (this.wanted && !this.lock && this.doc?.visibilityState === 'visible') {
      if (!this.requesting) this.requesting = this.acquire();
      await this.requesting;
    }
    if (!this.wanted && this.lock) {
      const lock = this.lock;
      this.lock = null;
      try { await lock.release(); } catch { /* already released */ }
    }
    this.onChange(this.state());
  }

  async acquire() {
    try {
      const lock = await this.nav.wakeLock.request('screen');
      this.error = null;
      lock.addEventListener?.('release', () => {
        if (this.lock === lock) { this.lock = null; this.onChange(this.state()); }
      });
      if (this.wanted) this.lock = lock;
      else await lock.release().catch(() => {});   // no longer wanted by the time it came
    } catch (e) {
      this.error = e?.message || String(e);
    } finally {
      this.requesting = null;
    }
  }
}
