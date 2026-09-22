/*
 * Which analysis events are reported for each camera.
 *
 * The detector always sees everything; this decides what reaches the log and
 * CLB1. A bedroom camera, say, should report a fall at any hour but not lying
 * down at night. Shared by the page and by the /api/watch function, so what the
 * server accepts is exactly what the page applies. No DOM: unit tested in Node.
 */
import { toMinutes, isWithin } from './schedule.js';

/*
 * The events the pose detector can tell apart. `after` lists the durations a
 * caregiver can pick for events that are only worth reporting once they last;
 * the first value is what the detector did before this was configurable.
 */
export const WATCH_EVENTS = [
  { kind: 'fall',    label: 'Pád' },
  { kind: 'longlie', label: 'Dlouhé ležení',    after: [6, 30, 60, 120, 300, 600, 1800] },
  { kind: 'abrupt',  label: 'Prudký pohyb' },
  { kind: 'missing', label: 'Odchod ze záběru', after: [2, 10, 30, 60, 300] },
  { kind: 'state',   label: 'Změny polohy (stojí, sedí, leží)' },
];

const BY_KIND = Object.fromEntries(WATCH_EVENTS.map((e) => [e.kind, e]));

/** Everything on, all day, original durations – how analysis always behaved. */
export function defaultWatch() {
  const w = {};
  for (const e of WATCH_EVENTS) {
    w[e.kind] = { enabled: true, from: '', to: '' };
    if (e.after) w[e.kind].after = e.after[0];
  }
  return w;
}

export function fmtAfter(s) {
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/**
 * Accepts what the editor sends and returns what is safe to store. A missing
 * event falls back to its default and an unknown one is dropped, so a page
 * from before an event existed cannot break the settings.
 */
export function normalizeWatch(raw) {
  if (raw === undefined || raw === null) return { ok: true, watch: defaultWatch() };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Nastavení musí být objekt.' };

  const watch = defaultWatch();
  for (const e of WATCH_EVENTS) {
    const r = raw[e.kind];
    if (r === undefined || r === null) continue;
    if (typeof r !== 'object') return { ok: false, error: `${e.label}: neplatné nastavení.` };

    const from = String(r.from ?? '').trim();
    const to = String(r.to ?? '').trim();
    if (!!from !== !!to) return { ok: false, error: `${e.label}: vyplňte začátek i konec hodin, nebo ani jedno.` };
    if (from && (toMinutes(from) === null || toMinutes(to) === null)) {
      return { ok: false, error: `${e.label}: čas musí být ve tvaru HH:MM.` };
    }
    if (from && from === to) return { ok: false, error: `${e.label}: začátek a konec se nesmí rovnat.` };

    const out = { enabled: r.enabled !== false, from, to };
    if (e.after) {
      const after = r.after === undefined ? e.after[0] : Number(r.after);
      if (!e.after.includes(after)) return { ok: false, error: `${e.label}: nepodporovaná délka.` };
      out.after = after;
    }
    watch[e.kind] = out;
  }
  return { ok: true, watch };
}

export function isDefaultWatch(w) {
  return JSON.stringify(normalizeWatch(w).watch) === JSON.stringify(defaultWatch());
}

/** One line for the camera card: what this camera is watching for. */
export function describeWatch(w) {
  const parts = [];
  for (const e of WATCH_EVENTS) {
    const r = w?.[e.kind];
    if (!r || !r.enabled) continue;
    let text = e.label;
    if (e.after && r.after !== e.after[0]) text += ` déle než ${fmtAfter(r.after)}`;
    if (r.from) text += ` (${r.from}–${r.to})`;
    parts.push(text);
  }
  return parts.length ? parts.join(' · ') : 'nic – analýza nic nehlásí';
}

/**
 * Decides, event by event, what gets reported. Events outside the catalogue –
 * a lost connection, say – always pass. "found" belongs to "missing": the
 * person reappearing is only news if their disappearance was reported.
 */
export class WatchFilter {
  constructor(watch) {
    this.set(watch);
  }

  set(watch) {
    this.watch = normalizeWatch(watch).watch;
    this.missingShown = false;
  }

  accept(ev, date = new Date()) {
    if (ev.kind === 'found') {
      const shown = this.missingShown;
      this.missingShown = false;
      return shown;
    }
    if (!BY_KIND[ev.kind]) return true;

    const r = this.watch[ev.kind];
    const ok = r.enabled && (!r.from || isWithin({ from: r.from, to: r.to }, date));
    if (ev.kind === 'missing') this.missingShown = ok;
    return ok;
  }

  /** Durations the detector itself needs to know. */
  detectorOptions() {
    return { longLieS: this.watch.longlie.after, missingS: this.watch.missing.after };
  }
}
