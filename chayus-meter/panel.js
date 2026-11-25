/*
 * Chayus Meter panel for the ET/WT Davening pages (pages-only version).
 * Independent of "I Want to Be Chazzan": it shares no state, audio or
 * microphone with it and never touches the page's player.
 * Sound is analysed on this device only. NOTHING is sent anywhere: this file
 * makes no network requests, and the microphone stream goes only into a local
 * analyser (no recorder, no connection, not played back).
 */
(function () {
  'use strict';
  if (window.__chayusPanelLoaded || !window.ChayusMeter) return;
  window.__chayusPanelLoaded = true;
  const $ = id => document.getElementById(id);
  const RING = 2 * Math.PI * 52;
  const DEFAULT_FEEDBACK = 'Daven at your own comfortable volume. You never need to shout.';
  const style = document.createElement('style');
  style.textContent = `
.chayus-panel{max-width:980px;width:calc(100% - 24px);margin:0 auto 22px;padding:20px;border:1px solid #d6e3f1;border-radius:24px;background:linear-gradient(135deg,#f7fffc,#f3f7ff);box-shadow:0 10px 30px #15315b12;color:#15315b;box-sizing:border-box}
.chayus-panel h2{margin:0 0 6px;color:#15315b}
.chayus-status{color:#516686;font-weight:700;margin:0 0 12px}
.chayus-body{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.chayus-meter{position:relative;width:132px;height:132px;flex:none}
.chayus-meter svg{position:relative;width:100%;height:100%;display:block;overflow:visible}
.chayus-halo{position:absolute;inset:10px;border-radius:50%;background:radial-gradient(circle,#ffd98a 0,#ffd98a00 70%);opacity:0;transform:scale(.8);transition:opacity .8s ease,transform .8s ease}
.chayus-track{fill:none;stroke:#e3ecf8;stroke-width:9}
.chayus-ring{fill:none;stroke:url(#chayusGlow);stroke-width:9;stroke-linecap:round;transform:rotate(-90deg);transform-origin:60px 60px;transition:stroke-dashoffset .9s ease}
.chayus-flame{transform-origin:60px 84px;transform:scale(var(--chayus-flame,.55));opacity:.4;transition:transform .9s ease,opacity .6s ease}
.chayus-flame-inner{transform-origin:60px 84px}
.chayus-meter[data-state="off"] .chayus-flame,.chayus-meter[data-state="paused"] .chayus-flame{filter:grayscale(1)}
.chayus-meter[data-state="calibrating"] .chayus-ring{stroke:#b9c8de;animation:chayusBreathe 1.6s ease-in-out infinite}
.chayus-meter[data-voice="on"] .chayus-flame{opacity:1}
.chayus-meter[data-voice="on"] .chayus-flame-inner{animation:chayusFlicker 1.3s ease-in-out infinite}
.chayus-meter[data-voice="on"] .chayus-halo{opacity:.85;transform:scale(1.08)}
.chayus-text{flex:1;min-width:210px}
.chayus-feedback{font-size:20px;font-weight:900;line-height:1.35;margin:0 0 10px}
.chayus-feedback.chayus-pop{animation:chayusPop .7s ease}
.chayus-bars{display:flex;align-items:flex-end;gap:5px;height:28px}
.chayus-bars i{width:7px;height:6px;border-radius:4px;background:#c9d8ec;transition:background .4s ease}
.chayus-bars[data-voice="on"] i{background:linear-gradient(#00aa91,#31c4a9);animation:chayusBar 1.1s ease-in-out infinite}
.chayus-bars[data-voice="on"] i:nth-child(2){animation-delay:.15s}
.chayus-bars[data-voice="on"] i:nth-child(3){animation-delay:.3s}
.chayus-bars[data-voice="on"] i:nth-child(4){animation-delay:.45s}
.chayus-bars[data-voice="on"] i:nth-child(5){animation-delay:.6s}
.chayus-live{font-size:14px;font-weight:800;color:#516686;margin:8px 0 0;min-height:1.3em}
.chayus-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.chayus-controls button{border:0;border-radius:12px;padding:11px 16px;font:inherit;font-weight:850;cursor:pointer;background:#eaf0ff;color:#15315b}
.chayus-controls button.primary{background:#315efb;color:#fff}
.chayus-controls button:focus-visible{outline:3px solid #eeac17;outline-offset:3px}
.chayus-privacy{font-size:13px;color:#667085;margin:14px 0 0}
@keyframes chayusFlicker{0%,100%{transform:scale(1,1) rotate(-1.5deg)}35%{transform:scale(.96,1.06) rotate(1.5deg)}70%{transform:scale(1.04,.97) rotate(-.5deg)}}
@keyframes chayusBar{0%,100%{height:6px}50%{height:26px}}
@keyframes chayusBreathe{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes chayusPop{0%{transform:scale(.94);opacity:.3}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.chayus-panel *{animation:none!important;transition:none!important}.chayus-bars[data-voice="on"] i{height:18px}}
`;
  const panel = document.createElement('section');
  panel.className = 'chayus-panel';
  panel.setAttribute('aria-label', 'My Chayus Meter');
  panel.innerHTML = `<h2>🎙️ My Chayus Meter</h2>
<p id="chayusStatus" class="chayus-status" role="status">The microphone is off. Turn it on only if you want to.</p>
<div id="chayusBody" class="chayus-body">
  <div id="chayusCircle" class="chayus-meter" data-state="off" data-voice="off" role="img" aria-label="Chayus meter. It glows while your voice is heard steadily. It does not measure how loud you are.">
    <div class="chayus-halo"></div>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id="chayusGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00aa91"/><stop offset="1" stop-color="#ffb938"/></linearGradient>
        <linearGradient id="chayusFire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ffd257"/></linearGradient>
      </defs>
      <circle class="chayus-track" cx="60" cy="60" r="52"/>
      <circle id="chayusRing" class="chayus-ring" cx="60" cy="60" r="52" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${RING.toFixed(1)}"/>
      <g class="chayus-flame"><g class="chayus-flame-inner">
        <path fill="url(#chayusFire)" d="M60 28c4 12 17 20 17 36a17 17 0 0 1-34 0c0-9 5-14 9-20 1 6 4 9 6 9 3-7 1-16 2-25z"/>
        <path fill="#fff3c4" d="M60 58c2 5 7 8 7 14a7 7 0 0 1-14 0c0-6 5-8 7-14z"/>
      </g></g>
    </svg>
  </div>
  <div class="chayus-text">
    <p id="chayusFeedback" class="chayus-feedback" aria-live="polite">${DEFAULT_FEEDBACK}</p>
    <div id="chayusBars" class="chayus-bars" data-voice="off" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <p id="chayusLive" class="chayus-live"></p>
  </div>
</div>
<div id="chayusControls" class="chayus-controls"></div>
<p class="chayus-privacy">Microphone access starts only when you choose it, and your browser asks permission each time. Sound is analyzed on this computer only. It is never recorded, saved, or sent anywhere. The meter follows how steadily a voice is heard, never how loud it is. It does not judge kavana, words, pronunciation, or davening quality. Points are never automatic.</p>`;
  document.head.append(style);
  const anchor = document.querySelector('main');
  if (anchor) anchor.after(panel); else document.body.append(panel);
  const status = $('chayusStatus'), controls = $('chayusControls'), feedback = $('chayusFeedback');
  const circle = $('chayusCircle'), ring = $('chayusRing'), bars = $('chayusBars'), liveLine = $('chayusLive');
  let meter = null, stream = null, context = null, analyser = null, sampleTimer = null, starting = false;
  const samples = new Float32Array(2048);

  function button(label, fn, primary = false) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    if (primary) b.className = 'primary';
    b.onclick = () => fn(); controls.append(b); return b;
  }
  // The picture is driven by "is a voice heard" and "how steadily", both of
  // which ignore volume. A louder voice never makes it bigger or brighter.
  function paintMeter(state) {
    const live = state === 'on' && meter ? meter.live() : null;
    const shown = live ? (live.calibrating ? 'calibrating' : 'on') : state === 'on' ? 'off' : state;
    const steadiness = live && shown === 'on' ? live.steadiness : 0;
    const voice = live && shown === 'on' && live.voiceHeard ? 'on' : 'off';
    circle.dataset.state = shown;
    circle.dataset.voice = voice;
    bars.dataset.voice = voice;
    ring.style.strokeDashoffset = (RING * (1 - (shown === 'calibrating' ? 1 : steadiness))).toFixed(1);
    circle.style.setProperty('--chayus-flame', (0.55 + 0.5 * steadiness).toFixed(3));
    liveLine.textContent = shown === 'calibrating' ? 'Getting used to the sound of the room…'
      : shown === 'paused' ? 'Paused. Nothing is being measured.'
      : shown === 'off' ? ''
      : live.gentleVolumeHint ? 'A comfortable voice is perfect. No need to be loud.'
      : live.voiceHeard ? 'I hear you davening!' : 'Listening quietly…';
  }
  function showFeedback(message) {
    feedback.textContent = message;
    feedback.classList.remove('chayus-pop');
    void feedback.offsetWidth; // restart the animation
    feedback.classList.add('chayus-pop');
  }
  function stopMedia() {
    if (sampleTimer !== null) clearInterval(sampleTimer);
    sampleTimer = null;
    if (stream) stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream = null; analyser = null;
    if (context) { const old = context; context = null; old.close().catch(() => {}); }
  }
  function renderControls() {
    controls.replaceChildren();
    if (starting) return;
    if (stream) {
      button('⏸ Pause', pause);
      button('Turn microphone off', turnOff);
    } else if (meter) {
      button('▶ Resume', start, true);
      button('Turn microphone off', turnOff);
    } else {
      button('🎙️ Turn on My Chayus Meter', start, true);
    }
  }
  function pause(message) {
    if (meter && stream) meter.pause(performance.now());
    stopMedia();
    paintMeter('paused');
    status.textContent = typeof message === 'string' ? message : 'Paused · your microphone is off and nothing is being measured.';
    renderControls();
  }
  function turnOff() {
    if (meter && stream) meter.pause(performance.now());
    const hadSession = Boolean(meter);
    stopMedia();
    meter = null; // the next time starts completely fresh
    paintMeter('off');
    feedback.textContent = DEFAULT_FEEDBACK;
    status.textContent = hadSession
      ? 'Microphone off · no audio was saved or sent. Thank you for davening!'
      : 'The microphone is off.';
    renderControls();
  }
  async function start() {
    if (stream || starting) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Microphone access is unavailable here. Open this page over HTTPS in a supported browser. You can daven normally.';
      return;
    }
    starting = true; renderControls();
    let granted = null, newContext = null;
    try {
      status.textContent = 'Your browser will ask for microphone permission now.';
      granted = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false });
      newContext = new AudioContextClass(); await newContext.resume();
      stream = granted; context = newContext;
      // The stream goes only into a local analyser. It is never connected to a
      // recorder, a network connection, or the speakers.
      const source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser(); analyser.fftSize = 2048; source.connect(analyser);
      stream.getTracks().forEach(track => {
        track.onended = () => pause('Your microphone disconnected, so the meter paused. You can daven normally.');
      });
      const continued = Boolean(meter && meter.snapshot().measuredSeconds > 0);
      if (!meter) meter = window.ChayusMeter.createMeter();
      meter.start(performance.now());
      sampleTimer = setInterval(() => {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(samples);
        const message = meter.sample(window.ChayusMeter.rmsFromFloatSamples(samples), performance.now());
        paintMeter('on');
        if (message) showFeedback(message);
      }, 200);
      status.textContent = continued
        ? 'Microphone on · your meter picked up where it left off.'
        : 'Microphone on · you can pause or turn it off at any time.';
      paintMeter('on');
    } catch (error) {
      granted?.getTracks().forEach(track => track.stop());
      if (newContext) await newContext.close().catch(() => {});
      status.textContent = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
        ? 'Permission declined. The meter is off. You can daven normally.'
        : 'The microphone could not start. Check browser permissions or microphone availability. You can daven normally.';
      paintMeter(meter ? 'paused' : 'off');
    } finally {
      starting = false; renderControls();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) pause('Microphone paused because this page was hidden.');
  });
  window.addEventListener('pagehide', () => {
    if (meter && stream) meter.pause(performance.now());
    stopMedia();
  });
  paintMeter('off');
  renderControls();
})();
