/*
 * One open camera: its own WHEP connection, watchdog, picture, recording and
 * analysis, all bound to its own card. The page can hold several at once.
 *
 * Everything shared - the analysis log, the recordings list, CLB1, the folder
 * and the scheduler - stays in index.html and is reached through callbacks.
 */
import { LiveAnalyzer, fmtTime, drawBackground, drawSkeleton } from '/analyzer.js';

const ICE = [{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}];

/*
 * Ring live sessions do not last forever, and a phone that changes network or
 * goes to the background loses the peer connection. Both fail quietly: the
 * picture holds its last frame while connectionState still reads "connected",
 * so nothing but the frames themselves proves the stream is alive.
 */
const STALL_MS = 7000;        // no new frame for this long counts as frozen
const WATCHDOG_MS = 2000;
const MAX_RECONNECTS = 8;

// Icon-only control, so the state has to reach assistive tech through the label.
const SPEAKER_BODY = '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/>';
const SPEAKER_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" aria-hidden="true">${SPEAKER_BODY}
  <path d="M16.5 8.8a4.5 4.5 0 010 6.4"/><path d="M19.2 6a8 8 0 010 12"/></svg>`;
const SPEAKER_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" aria-hidden="true">${SPEAKER_BODY}
  <path d="M16.5 9.5l5 5"/><path d="M21.5 9.5l-5 5"/></svg>`;

// Ring answers a single SDP offer, so gather ICE candidates before sending
// rather than trickling them afterwards.
function waitForIce(peer) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (peer.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, 3000);
    peer.addEventListener('icegatheringstatechange', check);
  });
}

/*
 * The WASM runtime is loaded once for the page. Each camera still gets its
 * own landmarker: in VIDEO mode a landmarker tracks one stream from frame to
 * frame, and feeding it two cameras in turn would blend them into one person.
 */
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest';
let visionPromise = null;

async function createLandmarker() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const mod = await import(MP);
      return { mod, vision: await mod.FilesetResolver.forVisionTasks(MP + '/wasm') };
    })();
    visionPromise.catch(() => { visionPromise = null; });   // let a later attempt retry
  }
  const { mod, vision } = await visionPromise;
  const landmarker = await mod.PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: .55, minPosePresenceConfidence: .55, minTrackingConfidence: .55
  });
  return { landmarker, connections: mod.PoseLandmarker.POSE_CONNECTIONS };
}

function pickMime() {
  const choices = [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'], ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'], ['video/webm;codecs=vp8', 'webm'], ['video/webm', 'webm']
  ];
  for (const [mime, ext] of choices) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'webm' };
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

export class CameraView {
  /**
   * @param device    { id, name }
   * @param template  <template> holding one camera card
   * @param hooks     api(path, opts), onLog(ev), onRecording(rec), onChange(),
   *                  onSound(view) when this one is unmuted, onClose(view)
   */
  constructor(device, template, hooks) {
    this.device = { id: device.id, name: device.name };
    this.hooks = hooks;

    this.pc = null;
    this.sessionUrl = null;
    this.wantStream = false;          // the stream stays wanted until Ukončit
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.watchdogId = null;
    this.watchTime = -1;
    this.stalledFor = 0;

    this.displayMode = 'normal';
    this.rafId = null;
    this.lastFrameTime = -1;

    this.recorder = null;
    this.recording = false;
    this.autoWindow = null;           // the schedule interval this recording belongs to
    this.chunks = [];
    this.recStartedAt = 0;
    this.timerId = null;

    this.analyzing = false;
    this.landmarker = null;
    this.connections = [];
    this.analysisStartedAt = 0;
    this.analyzer = new LiveAnalyzer((ev) => this.log(ev));

    this.card = template.content.firstElementChild.cloneNode(true);
    const q = (sel) => this.card.querySelector(sel);
    this.el = {
      name: q('.name'), video: q('video'), canvas: q('canvas.draw'), small: q('canvas.small'),
      modes: q('.modes'), record: q('.record'), analyze: q('.analyze'), sound: q('.sound'),
      retry: q('.retry'), recBar: q('.recBar'), timer: q('.timer'), stop: q('.stop'), msg: q('.msg'),
    };
    this.cctx = this.el.canvas.getContext('2d');
    this.sctx = this.el.small.getContext('2d');
    this.card.dataset.id = this.device.id;
    this.el.name.textContent = '– ' + this.device.name;
    this.setSoundIcon(true);
    this.bind();
  }

  bind() {
    const e = this.el;
    e.modes.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        this.displayMode = b.dataset.mode;
        e.modes.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        this.updateRender();
      };
    });
    e.record.onclick = () => (this.recording ? this.stopRecording() : this.startRecording());
    e.analyze.onclick = () => (this.analyzing ? this.stopAnalysis() : this.startAnalysis());
    e.sound.onclick = () => this.setMuted(!e.video.muted);
    e.retry.onclick = () => this.retry();
    e.stop.onclick = (ev) => {
      if (ev && ev.isTrusted === false) return;   // never end a stream from script
      this.close();
    };
  }

  /* ---------- state the page asks about ---------- */

  get connected() { return !!this.pc && this.wantStream; }

  /** Frames are flowing, so a recording would not come out black. */
  hasPicture() {
    const v = this.el.video;
    return !!v.srcObject && v.readyState >= 2;
  }

  setMsg(text, bad) {
    this.el.msg.innerHTML = bad ? `<span class="bad">${esc(text)}</span>` : esc(text);
  }

  log(ev) {
    this.hooks.onLog({ ...ev, at: ev.at || new Date(), device: this.device });
  }

  /* ---------- connection ---------- */

  async start({ isReconnect = false, scroll = false } = {}) {
    if (!isReconnect) {
      this.reconnectAttempt = 0;
      this.el.retry.classList.add('hide');
    }
    await this.teardown({ keepIntent: true });
    this.wantStream = true;

    this.setMsg(isReconnect ? 'Obnovuji spojení…' : 'Navazuji spojení…');
    if (scroll) this.card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      this.pc = pc;

      pc.addEventListener('track', (e) => {
        if (this.pc !== pc) return;           // a stale connection must not hijack the player
        const v = this.el.video;
        // An SDP answer without msid gives no stream on the event, so build one
        // from the track rather than assigning undefined and showing nothing.
        v.srcObject = e.streams[0] || new MediaStream([e.track]);
        // iOS Safari will not start playback on its own in every case; muted
        // playback is always allowed, so offer sound as a separate tap.
        v.play().then(() => {
          this.setMsg(this.reconnectAttempt ? 'Spojení obnoveno, přehrávám.' : 'Přehrávám.');
          this.reconnectAttempt = 0;
          this.el.sound.classList.remove('hide');
        }).catch(() => this.setMsg('Klepněte na obraz pro spuštění.'));
      });

      pc.addEventListener('connectionstatechange', () => {
        if (this.pc !== pc) return;
        // "disconnected" often recovers by itself; the watchdog catches it if not.
        if (pc.connectionState === 'failed') this.reconnect('Spojení selhalo');
        else if (pc.connectionState === 'disconnected') this.setMsg('Spojení kolísá…');
      });

      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'recvonly' });

      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);

      const { res, body } = await this.hooks.api('/api/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: this.device.id, sdpOffer: pc.localDescription.sdp })
      });

      if (this.pc !== pc) return;             // superseded while the request was in flight
      if (!res.ok) throw new Error(body.detail || body.error || ('HTTP ' + res.status));

      this.sessionUrl = body.sessionUrl || null;
      await pc.setRemoteDescription({ type: 'answer', sdp: body.sdpAnswer });

      this.startWatchdog();
      this.updateRender();
      this.hooks.onChange();
    } catch (e) {
      if (this.wantStream) this.reconnect(`Nepodařilo se připojit (${e.message})`);
      else { this.setMsg(e.message, true); await this.teardown({ keepIntent: false }); }
    }
  }

  retry() {
    this.reconnectAttempt = 0;
    this.el.retry.classList.add('hide');
    this.start();
  }

  startWatchdog() {
    this.stopWatchdog();
    this.watchTime = -1;
    this.stalledFor = 0;
    this.watchdogId = setInterval(() => {
      if (!this.wantStream || !this.pc) return;
      const v = this.el.video;
      if (v.currentTime !== this.watchTime) {  // sampling currentTime needs no events
        this.watchTime = v.currentTime;
        this.stalledFor = 0;
        return;
      }
      this.stalledFor += WATCHDOG_MS;
      if (this.stalledFor >= STALL_MS) this.reconnect('Obraz se zastavil');
    }, WATCHDOG_MS);
  }

  stopWatchdog() {
    if (this.watchdogId !== null) { clearInterval(this.watchdogId); this.watchdogId = null; }
  }

  reconnect(reason) {
    if (!this.wantStream || this.reconnectTimer !== null) return;
    this.stopWatchdog();

    if (this.reconnectAttempt >= MAX_RECONNECTS) { this.giveUp(reason); return; }

    const delay = Math.min(15000, 1000 * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt++;
    this.setMsg(`${reason}. Obnovuji spojení… (pokus ${this.reconnectAttempt})`);
    if (this.analyzing) {
      this.analyzer.notePause();
      this.log({ t: (Date.now() - this.analysisStartedAt) / 1000, level: 'warn',
                 text: `${reason} – analýza pokračuje po obnovení spojení.` });
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.teardown({ keepIntent: true });
      if (this.wantStream) this.start({ isReconnect: true });
    }, delay);
  }

  giveUp(reason) {
    this.wantStream = false;
    this.setMsg(`${reason}. Spojení se nepodařilo obnovit.`, true);
    this.el.retry.classList.remove('hide');
    if (this.recording) this.stopRecording();
    if (this.analyzing) this.stopAnalysis();
    this.hooks.onChange();
  }

  /**
   * Releases the Ring session and the peer connection. keepIntent leaves the
   * wish to watch in place, so a reconnect or a return to the tab can pick it
   * back up.
   */
  async teardown({ keepIntent }) {
    this.stopWatchdog();
    if (!keepIntent) {
      this.wantStream = false;
      if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    }

    const sessionUrl = this.sessionUrl;
    this.sessionUrl = null;
    if (sessionUrl) {
      try {
        await this.hooks.api('/api/stream', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionUrl })
        });
      } catch { /* the session expires on Ring's side anyway */ }
    }
    if (this.pc) { this.pc.close(); this.pc = null; }

    const v = this.el.video;
    v.srcObject = null;
    v.muted = true;
    this.updateRender();
    this.setSoundIcon(true);
    this.el.sound.classList.add('hide');
    this.hooks.onChange();
  }

  /** Ukončit: the only thing that ends a stream for good. */
  async close() {
    this.stopAnalysis();
    if (this.recording) this.stopRecording();
    await this.teardown({ keepIntent: false });
    try { this.landmarker?.close?.(); } catch { /* already gone */ }
    this.landmarker = null;
    this.hooks.onClose(this);
  }

  /*
   * Nothing but Ukončit ends the stream. Safari reports the page hidden for
   * things the user does not think of as leaving - a download sheet, a share
   * sheet, a locked screen - so coming back only revives what the browser
   * itself dropped.
   */
  onPageVisible() {
    if (!this.wantStream) return;
    if (!this.pc) { this.reconnectAttempt = 0; this.start({ isReconnect: true }); return; }
    const v = this.el.video;
    if (v.srcObject && v.paused) v.play().catch(() => {});
  }

  /* ---------- sound ---------- */

  setSoundIcon(muted) {
    const label = muted ? 'Zapnout zvuk' : 'Ztlumit';
    this.el.sound.innerHTML = muted ? SPEAKER_OFF : SPEAKER_ON;
    this.el.sound.setAttribute('aria-label', label);
    this.el.sound.title = label;
  }

  setMuted(muted) {
    const v = this.el.video;
    v.muted = muted;
    if (!muted) { v.play().catch(() => {}); this.hooks.onSound(this); }
    this.setSoundIcon(muted);
  }

  /* ---------- picture ---------- */

  // The canvas pipeline costs CPU, so it only runs when the picture is actually
  // being altered, recorded or analysed; otherwise the raw video is cheaper and
  // keeps the native iOS controls.
  needsCanvas() {
    return this.displayMode !== 'normal' || this.analyzing || this.recording;
  }

  updateRender() {
    const on = this.needsCanvas() && !!this.el.video.srcObject;
    // Only the canvas is toggled. The video stays rendered underneath, because a
    // video that is not rendered can stop decoding - and then the picture we draw
    // from, and the watchdog that checks it, both go stale.
    this.el.canvas.classList.toggle('hide', !on);
    if (on && this.rafId === null) this.rafId = requestAnimationFrame(() => this.renderLoop());
    if (!on && this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  fitCanvas() {
    const { video: v, canvas, small } = this.el;
    const w = v.videoWidth || 1280, h = v.videoHeight || 720;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      // ~48px wide before upscaling, so the mosaic removes detail rather than softening it.
      small.width = 48;
      small.height = Math.max(24, Math.round(48 * h / w));
    }
  }

  renderLoop() {
    this.rafId = null;
    const v = this.el.video;
    if (!v.srcObject || !this.needsCanvas()) { this.updateRender(); return; }

    this.fitCanvas();
    if (v.readyState >= 2 && v.currentTime !== this.lastFrameTime) {
      this.lastFrameTime = v.currentTime;
      drawBackground(this.cctx, this.el.canvas, v, this.displayMode, this.el.small, this.sctx);
      if (this.analyzing) this.detectPose(v);
    }
    this.rafId = requestAnimationFrame(() => this.renderLoop());
  }

  /* ---------- recording ---------- */

  /** interval: the schedule interval that started it, or null when started by hand. */
  startRecording(interval = null) {
    const canvas = this.el.canvas;
    if (!canvas.captureStream || !window.MediaRecorder) {
      this.setMsg('Tento prohlížeč neumí nahrávat canvas.', true);
      return;
    }
    this.chunks = [];

    // captureStream only produces frames from a canvas that is visible and being
    // drawn, so switch the pipeline on before grabbing the stream.
    this.recording = true;
    this.autoWindow = interval;
    this.updateRender();
    this.fitCanvas();

    const fmt = pickMime();
    // Decided now: by the time the recorder hands over the file, a scheduled
    // recording has already had its window cleared.
    const zdroj = interval ? 'plan' : 'rucne';

    // If anything here throws, `recording` must not stay true: the button would
    // read as recording for ever and the scheduler would never start again.
    const fail = (e) => {
      this.recorder = null;
      this.recording = false;
      this.autoWindow = null;
      this.updateRender();
      this.setMsg(`Nahrávání se nepodařilo spustit: ${e.message}`, true);
    };

    let recorder;
    try {
      const stream = canvas.captureStream(30);
      recorder = fmt.mime
        ? new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 3500000 })
        : new MediaRecorder(stream);
    } catch (e) { fail(e); return; }

    this.recorder = recorder;
    const chunks = this.chunks;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    const from = new Date();

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || fmt.mime || 'video/mp4' });
      this.hooks.onRecording({ blob, device: this.device, from, to: new Date(), ext: fmt.ext, zdroj });
      this.setMsg(`Nahrávka hotova (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
      if (this.recorder === recorder) { this.recorder = null; this.recording = false; }
      this.updateRender();
    };

    this.recStartedAt = Date.now();
    try { recorder.start(1000); } catch (e) { fail(e); return; }

    this.tickTimer();
    this.timerId = setInterval(() => this.tickTimer(), 250);
    this.el.record.textContent = '■ Zastavit nahrávání';
    this.el.recBar.classList.remove('hide');
    this.updateRender();
    this.hooks.onChange();
  }

  tickTimer() {
    this.el.timer.textContent = fmtTime((Date.now() - this.recStartedAt) / 1000);
  }

  stopRecording() {
    this.autoWindow = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    else { this.recorder = null; this.recording = false; this.updateRender(); }
    clearInterval(this.timerId);
    this.el.record.textContent = '● Nahrávat';
    this.el.recBar.classList.add('hide');
    this.hooks.onChange();
  }

  /* ---------- live analysis ---------- */

  async startAnalysis() {
    const btn = this.el.analyze;
    btn.disabled = true;
    try {
      if (!this.landmarker) {
        this.setMsg('Načítám model pro analýzu…');
        ({ landmarker: this.landmarker, connections: this.connections } = await createLandmarker());
      }
    } catch (e) {
      this.setMsg(`Model se nepodařilo načíst: ${e.message}`, true);
      btn.disabled = false;
      return;
    }
    this.analyzer.reset();
    this.analysisStartedAt = Date.now();
    this.analyzing = true;
    btn.textContent = 'Zastavit analýzu';
    btn.disabled = false;
    this.setMsg('Analýza běží.');
    this.updateRender();
    this.hooks.onChange();
  }

  stopAnalysis() {
    if (!this.analyzing) return;
    this.analyzing = false;
    this.el.analyze.textContent = 'Spustit analýzu';
    this.setMsg('Analýza zastavena.');
    this.updateRender();
    this.hooks.onChange();
  }

  detectPose(video) {
    if (!this.landmarker) return;
    let result;
    try { result = this.landmarker.detectForVideo(video, performance.now()); }
    catch { return; }

    const t = (Date.now() - this.analysisStartedAt) / 1000;
    const lm = result.landmarks?.[0] || null;
    if (lm) drawSkeleton(this.cctx, this.el.canvas, lm, this.connections);
    this.analyzer.push(t, lm);
  }
}
