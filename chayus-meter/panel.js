/*
 * Chayus Meter panel for the ET/WT Davening pages and the Chayus Meter page.
 * Independent of "I Want to Be Chazzan": it shares no state, audio or
 * microphone with it and never touches the page's player (it only LISTENS to the
 * class audio level, to tell it apart from the student's voice).
 * Sound is analysed on this device only. This file makes no network requests and
 * has no recorder or connection: the microphone stream goes only into a local
 * analyser. The one number a signed-in student's day adds up to is handed to
 * points.js, which is the only file that talks to the server.
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
.chayus-level{margin:16px 0 0;padding:14px 16px;border-radius:16px;background:#fff;border:1px solid #d6e3f1}
.chayus-level-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline}
.chayus-level-name{font-size:19px;font-weight:900;color:#15315b}
.chayus-points{font-size:14px;font-weight:850;color:#8a5a00}
.chayus-level-bar{height:12px;border-radius:8px;background:#e3ecf8;overflow:hidden;margin:10px 0 6px}
.chayus-level-bar i{display:block;height:100%;width:0;border-radius:8px;background:linear-gradient(90deg,#00aa91,#ffb938);transition:width .8s ease}
.chayus-level-next{margin:0;font-size:14px;font-weight:750;color:#516686}
.chayus-celebrate{position:relative;margin:12px 0 0;padding:14px 16px;border-radius:16px;background:linear-gradient(135deg,#fff3c4,#ffe0a3);color:#5c3b00;font-size:21px;font-weight:950;text-align:center;overflow:hidden;animation:chayusCelebrate .6s ease}
.chayus-celebrate[hidden]{display:none}
.chayus-celebrate small{display:block;font-size:15px;font-weight:800;margin-top:4px}
.chayus-spark{position:absolute;top:50%;left:50%;width:10px;height:10px;border-radius:50%;background:#ff8a3d;opacity:0;animation:chayusSpark 1.6s ease-out forwards}
@keyframes chayusCelebrate{0%{transform:scale(.8);opacity:0}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
@keyframes chayusSpark{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.3)}}
@keyframes chayusFlicker{0%,100%{transform:scale(1,1) rotate(-1.5deg)}35%{transform:scale(.96,1.06) rotate(1.5deg)}70%{transform:scale(1.04,.97) rotate(-.5deg)}}
@keyframes chayusBar{0%,100%{height:6px}50%{height:26px}}
@keyframes chayusBreathe{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes chayusPop{0%{transform:scale(.94);opacity:.3}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.chayus-panel *{animation:none!important;transition:none!important}.chayus-spark{display:none}.chayus-bars[data-voice="on"] i{height:18px}}
`;
  const panel = document.createElement('section');
  panel.className = 'chayus-panel';
  panel.setAttribute('aria-label', 'My Chayus Meter');
  panel.innerHTML = `<h2>🎙️ My Chayus Meter</h2>
<p id="chayusStatus" class="chayus-status" role="status">The microphone is off. Turn it on only if you want to.</p>
<div id="chayusBody" class="chayus-body">
  <div id="chayusCircle" class="chayus-meter" data-state="off" data-voice="off" role="img" aria-label="Chayus meter. It glows while your voice is heard steadily. A normal voice counts fully and a stronger voice counts up to double. Shouting adds nothing more.">
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
<div id="chayusCelebrate" class="chayus-celebrate" role="status" aria-live="polite" hidden></div>
<div id="chayusLevel" class="chayus-level" aria-label="My Chayus level">
  <div class="chayus-level-head"><span id="chayusLevelName" class="chayus-level-name"></span><span id="chayusPoints" class="chayus-points"></span></div>
  <div class="chayus-level-bar" aria-hidden="true"><i id="chayusLevelFill"></i></div>
  <p id="chayusLevelNext" class="chayus-level-next"></p>
</div>
<div id="chayusControls" class="chayus-controls"></div>
<p class="chayus-privacy">Microphone access starts only when you choose it, and your browser asks permission each time. Sound is analyzed on this computer only. It is never recorded, saved, or sent anywhere. Only the number of minutes your voice was heard today is saved, to give you your Chayus points (1 point for each level, up to 10 a day). Your time counts only while a voice is heard: a normal voice counts fully and a stronger voice counts up to double, so shouting adds nothing more. Class audio from your speakers does not count. It does not judge kavana, words, pronunciation, or davening quality.</p>`;
  document.head.append(style);
  const anchor = document.querySelector('main');
  if (anchor) anchor.after(panel); else document.body.append(panel);
  const status = $('chayusStatus'), controls = $('chayusControls'), feedback = $('chayusFeedback');
  const circle = $('chayusCircle'), ring = $('chayusRing'), bars = $('chayusBars'), liveLine = $('chayusLive');
  const levelName = $('chayusLevelName'), levelPoints = $('chayusPoints'), levelFill = $('chayusLevelFill'), levelNext = $('chayusLevelNext');
  const celebrateBox = $('chayusCelebrate');
  let meter = null, stream = null, context = null, analyser = null, sampleTimer = null, starting = false;
  const samples = new Float32Array(2048);
  const points = window.ChayusPoints || null;
  const REPORT_EVERY_MS = 30000;
  let server = null, signedOut = false, reportTimer = null, reporting = false, lastReported = -1, celebrateTimer = null;
  let currentDay = schoolDay();
  // The class audio playing on the page. It is only listened to (never changed) so it can be told apart from the voice.
  let classAudio = null, classAnalyser = null, classTracksSeen = 0, playingSince = 0, playbackSeen = 0;
  const classSamples = new Float32Array(1024);

  // The school day is the New York day, the same one the server uses to reset Chayus points.
  function schoolDay(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = type => (parts.find(part => part.type === type) || {}).value || '';
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  function totalSeconds() {
    const mine = meter ? meter.live().countedSeconds : 0;
    return Math.max(mine, server ? server.countedSeconds : 0);
  }
  function paintLevel() {
    const info = window.ChayusMeter.levelInfo(totalSeconds());
    const earned = server && Number.isFinite(server.points) ? server.points : null;
    levelName.textContent = info.level ? 'Level ' + info.level + ' · ' + info.name : 'Level 0 · ' + info.name;
    levelPoints.textContent = server && server.paused ? 'Points are paused right now'
      : signedOut ? 'Sign in from the home page to save your points'
      : earned === null ? info.level + ' / ' + info.maxLevel + ' levels today'
      : earned + ' / ' + info.maxLevel + ' points today';
    levelFill.style.width = Math.round(info.progressToNext * 100) + '%';
    if (info.nextLevel) {
      const s = info.secondsToNext, m = Math.floor(s / 60), r = String(s % 60).padStart(2, '0');
      levelNext.textContent = m + ':' + r + ' of davening to go until Level ' + info.nextLevel + ' · ' + info.nextName;
    } else {
      levelNext.textContent = 'You reached the top level today. Wonderful!';
    }
  }
  function celebrate(level) {
    const row = window.ChayusMeter.LEVELS[level - 1];
    if (!row) return;
    celebrateBox.replaceChildren();
    const title = document.createElement('div'); title.textContent = '🎉 Level ' + level + ': ' + row.name + '!';
    const small = document.createElement('small'); small.textContent = row.cheer + (level === window.ChayusMeter.LEVELS.length ? '' : ' Keep going!');
    celebrateBox.append(title, small);
    for (let i = 0; i < 14; i++) {
      const spark = document.createElement('span'); spark.className = 'chayus-spark';
      const angle = (Math.PI * 2 * i) / 14;
      spark.style.setProperty('--dx', Math.round(Math.cos(angle) * 140) + 'px');
      spark.style.setProperty('--dy', Math.round(Math.sin(angle) * 60) + 'px');
      spark.style.background = i % 2 ? '#ff8a3d' : '#00aa91';
      celebrateBox.append(spark);
    }
    celebrateBox.hidden = false;
    clearTimeout(celebrateTimer);
    celebrateTimer = setTimeout(() => { celebrateBox.hidden = true; }, 6000);
  }
  // Hands today's running total to the server (one number). Safe to call often: it skips when nothing changed.
  async function reportNow(force) {
    if (!points || signedOut || reporting || !meter) return;
    const seconds = meter.live().countedSeconds;
    if (!force && seconds === lastReported) return;
    reporting = true;
    try {
      const result = await points.report(seconds);
      if (result && result.ok) {
        lastReported = seconds; server = result;
        if (meter && !result.paused) meter.adoptCountedSeconds(result.countedSeconds);
      } else if (result && result.signedOut) {
        signedOut = true;
      }
    } finally { reporting = false; paintLevel(); }
  }
  async function loadSavedDay() {
    if (!points || signedOut) return;
    const result = await points.status();
    if (result && result.ok) {
      server = result;
      if (meter && !result.paused) meter.adoptCountedSeconds(result.countedSeconds);
    } else if (result && result.signedOut) signedOut = true;
    paintLevel();
  }
  // A new school day starts from zero.
  function checkNewDay() {
    const today = schoolDay();
    if (today === currentDay) return;
    currentDay = today; server = null; lastReported = -1;
    if (meter) meter.resetDay();
    paintLevel();
    loadSavedDay();
  }
  function classAux() {
    if (!classAudio) return undefined;
    const a = classAudio;
    const playing = !a.paused && !a.ended && a.currentTime > 0 && !a.muted && a.volume > 0;
    if (!playing) { playingSince = 0; return { playing: false }; }
    if (!playingSince) playingSince = performance.now();
    if (!classAnalyser && context) {
      try {
        const captured = a.captureStream ? a.captureStream() : a.mozCaptureStream ? a.mozCaptureStream() : null;
        if (captured && captured.getAudioTracks().length) {
          classAnalyser = context.createAnalyser(); classAnalyser.fftSize = 1024;
          context.createMediaStreamSource(captured).connect(classAnalyser);
        }
      } catch (_) { classAnalyser = null; }
    }
    let level;
    if (classAnalyser) {
      classAnalyser.getFloatTimeDomainData(classSamples);
      level = window.ChayusMeter.rmsFromFloatSamples(classSamples) * a.volume;
      playbackSeen = Math.max(playbackSeen, level);
      // A capture that stays silent while the class audio plays cannot be trusted: say the level is unknown.
      if (performance.now() - playingSince > 3000 && playbackSeen < 0.0015) level = undefined;
    }
    return { playing: true, playbackLevel: level };
  }

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
    stream = null; analyser = null; classAnalyser = null; playbackSeen = 0; playingSince = 0;
    if (reportTimer !== null) clearInterval(reportTimer);
    reportTimer = null;
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
    paintLevel();
    reportNow(true);
  }
  function turnOff() {
    if (meter && stream) meter.pause(performance.now());
    const hadSession = Boolean(meter);
    stopMedia();
    reportNow(true);
    meter = null; // the next time starts completely fresh, and picks the day's saved total back up from the server
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
      classAudio = document.querySelector('audio');
      checkNewDay();
      meter.start(performance.now());
      loadSavedDay();
      reportTimer = setInterval(() => reportNow(false), REPORT_EVERY_MS);
      sampleTimer = setInterval(() => {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(samples);
        const message = meter.sample(window.ChayusMeter.rmsFromFloatSamples(samples), performance.now(), classAux());
        checkNewDay();
        paintMeter('on');
        paintLevel();
        const reached = meter.consumeLevelUp();
        if (reached && server && server.paused) { reportNow(true); }
        else if (reached) { celebrate(reached); reportNow(true); }
        else if (message) showFeedback(message);
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
  paintLevel();
  renderControls();
})();
