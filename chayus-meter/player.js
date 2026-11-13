/* global firebase */
/*
 * Chayus Meter panel for the ET/WT Davening pages.
 * Independent of "I Want to Be Chazzan": it shares no state, session or
 * microphone with that panel. Sound is analysed on this device only; the
 * only thing ever sent is a small set of bounded totals (see metricsForUpload).
 */
(function () {
  'use strict';
  const classId = location.pathname.includes('_wt/') ? 'wt' : 'et';
  const $ = id => document.getElementById(id);
  const RING = 2 * Math.PI * 52;
  const DEFAULT_FEEDBACK = 'Daven at your own comfortable volume. You never need to shout.';
  const style = document.createElement('style');
  style.textContent = `
.chayus-panel{max-width:980px;width:calc(100% - 24px);margin:0 auto 22px;padding:20px;border:1px solid #d6e3f1;border-radius:24px;background:linear-gradient(135deg,#f7fffc,#f3f7ff);box-shadow:0 10px 30px #15315b12;color:#15315b;box-sizing:border-box}
.chayus-panel h2{margin:0 0 6px;color:#15315b}
.chayus-status{color:#516686;font-weight:700;margin:0 0 12px}
.chayus-body{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.chayus-body[hidden]{display:none}
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
.chayus-report{margin-top:14px}
@keyframes chayusFlicker{0%,100%{transform:scale(1,1) rotate(-1.5deg)}35%{transform:scale(.96,1.06) rotate(1.5deg)}70%{transform:scale(1.04,.97) rotate(-.5deg)}}
@keyframes chayusBar{0%,100%{height:6px}50%{height:26px}}
@keyframes chayusBreathe{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes chayusPop{0%{transform:scale(.94);opacity:.3}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.chayus-panel *{animation:none!important;transition:none!important}.chayus-bars[data-voice="on"] i{height:18px}}
`;
  const panel = document.createElement('section');
  panel.className = 'chayus-panel';
  panel.innerHTML = `<h2>🎙️ My Chayus Meter</h2>
<p id="chayusStatus" class="chayus-status" role="status">Waiting for class Davening…</p>
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
<div id="chayusReport" class="chayus-report"></div>
<p class="chayus-privacy">Microphone access starts only when you choose it. Sound is analyzed on this device; raw audio and transcripts are never recorded, saved, or sent. The meter follows how steadily a voice is heard, never how loud it is. It does not judge kavana, words, pronunciation, or davening quality. No points are automatic.</p>`;
  document.head.append(style);
  document.querySelector('main').after(panel);
  const status = $('chayusStatus'), controls = $('chayusControls'), feedback = $('chayusFeedback');
  const circle = $('chayusCircle'), ring = $('chayusRing'), bars = $('chayusBars'), liveLine = $('chayusLive');
  const body = $('chayusBody'), reportBox = $('chayusReport');
  let user = null, role = '', session = null, meter = null, restored = '', stream = null;
  let context = null, analyser = null, sampleTimer = null, uploadTimer = null, busy = false, turnedOff = false;
  const samples = new Float32Array(2048);

  function button(label, fn, primary = false) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    if (primary) b.className = 'primary';
    b.onclick = fn; controls.append(b); return b;
  }
  // The picture is driven by "is a voice heard" and "how steadily", both of
  // which ignore volume. A louder voice never makes it bigger or brighter.
  function paintMeter(state) {
    const live = state === 'on' && meter ? meter.live() : null;
    const shown = live ? (live.calibrating ? 'calibrating' : 'on') : state === 'on' ? 'off' : state;
    const steadiness = meter && shown !== 'off' && shown !== 'calibrating' ? meter.live().steadiness : 0;
    const voice = live?.voiceHeard ? 'on' : 'off';
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
  function metricsForUpload() {
    const data = meter?.snapshot();
    if (!data) return null;
    return {
      measuredSeconds: data.measuredSeconds, activeSeconds: data.activeSeconds,
      calibrationSeconds: data.calibrationSeconds, feedbackCount: data.feedbackCount,
      activeIntervals: data.activeIntervals, pauseCount: data.pauseCount, pausedSeconds: data.pausedSeconds
    };
  }
  function endpoint() {
    const project = window.B3_FIREBASE_CONFIG?.projectId;
    if (!['b3-games', 'fun-torah-tools-staging'].includes(project)
      || (location.hostname.includes('staging') && project !== 'fun-torah-tools-staging')) {
      throw new Error('The Chayus session service is unavailable.');
    }
    return `https://us-central1-${project}.cloudfunctions.net/daveningChayus`;
  }
  async function call(action, extra = {}) {
    if (!user) throw new Error('Sign in through Student Login to use the Chayus Meter.');
    const response = await fetch(endpoint(), {
      method: 'POST', headers: { Authorization: 'Bearer ' + await user.getIdToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, classId, sessionId: session?.id, ...extra })
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'The Chayus Meter could not connect.');
    return json.session;
  }
  async function sendMetrics(keepalive = false) {
    const metrics = metricsForUpload();
    if (!metrics || !session || !user || role !== 'student') return;
    try {
      const response = await fetch(endpoint(), {
        method: 'POST', keepalive,
        headers: { Authorization: 'Bearer ' + await user.getIdToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', classId, sessionId: session.id, metrics })
      });
      if (!response.ok && response.status !== 429) status.textContent = 'Your latest meter summary has not reached your teacher yet. It will retry.';
    } catch (_) { status.textContent = 'Offline · your latest meter summary will retry when you reconnect.'; }
  }
  function stopMedia() {
    if (sampleTimer !== null) clearInterval(sampleTimer);
    if (uploadTimer !== null) clearInterval(uploadTimer);
    sampleTimer = uploadTimer = null;
    if (stream) stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream = null; analyser = null;
    if (context) { const old = context; context = null; old.close().catch(() => {}); }
  }
  function pauseMonitor(message, report = true) {
    if (meter && stream) meter.pause(performance.now());
    stopMedia();
    paintMeter(turnedOff ? 'off' : 'paused');
    if (report) void sendMetrics(true);
    if (message) status.textContent = message;
    renderControls();
  }
  function renderControls() {
    controls.replaceChildren();
    if (!role) return;
    if (role === 'teacher') {
      body.hidden = true;
      if (!session || session.endedAt) button('▶ Start Chayus session', startSession, true);
      else button('End Davening & prepare class report', endSession, true);
      if (session?.endedAt) button('Refresh class summary', loadReport);
      return;
    }
    body.hidden = false;
    if (!session || session.endedAt) {
      status.textContent = session?.endedAt ? 'This class session has ended.' : 'Waiting for your teacher to start Davening.';
      return;
    }
    if (stream) {
      button('⏸ Pause my meter', () => pauseMonitor('Paused · your microphone is off and nothing is being measured.'));
      button('Turn my microphone off', turnOff);
    } else if (meter && !turnedOff && restored !== 'idle') {
      button('▶ Resume My Chayus Meter', startMonitor, true);
      button('Turn my microphone off', turnOff);
    } else {
      button(meter ? '🎙️ Turn My Chayus Meter back on' : '🎙️ Activate My Chayus Meter', startMonitor, true);
    }
  }
  async function startSession() {
    try { session = await call('start'); reportBox.replaceChildren(); status.textContent = 'Chayus session is open for this class.'; renderControls(); }
    catch (error) { status.textContent = error.message; }
  }
  async function endSession() {
    if (!session) return;
    try {
      session = await call('finish');
      status.textContent = 'Session ended. Preparing the class summary…';
      renderControls();
      await loadReport();
    } catch (error) { status.textContent = error.message; }
  }
  async function loadReport() {
    try {
      const result = await call('report');
      renderReport(result?.students || []);
      status.textContent = 'Teacher summary ready. Points remain your decision through the Rewards controls.';
    } catch (error) { status.textContent = error.message; }
  }
  function renderReport(reports) {
    reportBox.replaceChildren();
    const rows = window.ChayusMeter.teacherRows(reports);
    const summary = document.createElement('p');
    const withData = rows.filter(row => row.hasData).length;
    summary.textContent = `${withData} of ${rows.length} students chose microphone monitoring. These estimates are observational and are not grades.`;
    reportBox.append(summary);
    const list = document.createElement('div'); list.style.cssText = 'display:grid;gap:7px';
    for (const row of rows) {
      const details = document.createElement('details'); details.style.cssText = 'padding:10px 12px;border-radius:12px;background:#fff;border:1px solid #d6e3f1';
      const summaryRow = document.createElement('summary');
      summaryRow.textContent = row.hasData ? `${row.studentName} · voice heard ${row.soundActivityPercent}% of the measured time` : `${row.studentName} · No microphone data`;
      summaryRow.style.fontWeight = '850'; details.append(summaryRow);
      const info = document.createElement('p');
      info.textContent = row.hasData
        ? `${row.measuredMinutes} monitored minutes · consistency across observed intervals: ${row.consistencyPercent === null ? 'not enough intervals' : row.consistencyPercent + '%'} · ${row.pauseCount} pause(s), ${row.pausedMinutes} paused minutes${row.missingAtEnd ? ' · missing update near session end' : ''}. Sound and room conditions affect estimates. Volume is not measured.`
        : row.missingAtEnd ? 'No aggregate was received near session end. Do not treat missing data as zero participation.' : 'No aggregate was submitted. This can mean no microphone, denied permission, or choosing not to participate.';
      details.append(info); list.append(details);
    }
    reportBox.append(list);
    const note = document.createElement('p');
    note.textContent = 'No points were given. If you want to award points, you choose the students and amounts yourself in Student Rewards.';
    note.style.cssText = 'margin:12px 0 4px;font-weight:700;color:#516686';
    const rewardLink = document.createElement('a');
    rewardLink.href = `../student-rewards/teacher.html?class=b3_${classId}&tab=${encodeURIComponent('Daily Points')}`;
    rewardLink.textContent = 'Open Student Rewards to decide points manually';
    rewardLink.style.cssText = 'display:inline-block;font-weight:800;color:#315efb';
    reportBox.append(note, rewardLink);
  }
  async function startMonitor() {
    if (!session || session.endedAt || stream) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Microphone access is unavailable. Open this page over HTTPS in a supported browser.'; return;
    }
    let granted = null, newContext = null;
    try {
      status.textContent = 'Your browser will ask for microphone permission now.';
      granted = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false });
      newContext = new AudioContextClass(); await newContext.resume();
      stream = granted; context = newContext; turnedOff = false;
      if (restored === 'idle') restored = session.id;
      // The stream goes only into a local analyser. It is never connected to a
      // recorder, a network connection, or the speakers.
      const source = context.createMediaStreamSource(stream); analyser = context.createAnalyser(); analyser.fftSize = 2048; source.connect(analyser);
      stream.getTracks().forEach(track => {
        track.onended = () => pauseMonitor('Your microphone disconnected, so the meter paused. You can daven normally.');
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
      uploadTimer = setInterval(() => { void sendMetrics(); }, 30000);
      status.textContent = continued
        ? 'Microphone on · your meter picked up where it left off.' : 'Microphone on · you can pause or turn it off at any time.';
      paintMeter('on');
      renderControls();
    } catch (error) {
      granted?.getTracks().forEach(track => track.stop());
      if (newContext) await newContext.close().catch(() => {});
      status.textContent = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
        ? 'Permission declined. The meter is off. You can daven normally.'
        : 'The microphone could not start. Check browser permissions or microphone availability.';
      paintMeter('off');
      renderControls();
    }
  }
  async function turnOff() {
    if (!meter) return;
    if (stream) meter.pause(performance.now());
    stopMedia();
    turnedOff = true;
    paintMeter('off');
    feedback.textContent = DEFAULT_FEEDBACK;
    status.textContent = 'Microphone off. Sending only your summary numbers…';
    renderControls();
    await sendMetrics(true);
    const minutes = Math.round(meter.snapshot().measuredSeconds / 60);
    status.textContent = `Microphone off · ${minutes < 1 ? 'less than 1 minute' : minutes === 1 ? 'about 1 minute' : 'about ' + minutes + ' minutes'} measured · no audio was saved.`;
  }
  async function poll() {
    if (user && !document.hidden && !busy) {
      busy = true;
      try {
        const next = await call('read');
        if (next?.id !== session?.id) {
          if (stream) pauseMonitor('A new class session started; microphone paused.', false);
          session = next; meter = null; restored = ''; turnedOff = false;
          feedback.textContent = DEFAULT_FEEDBACK; paintMeter('off');
        } else session = next;
        // After a page refresh the saved totals come back, but the microphone
        // stays off until the student chooses to turn it on again.
        if (role === 'student' && session?.metrics && !meter && !restored) {
          meter = window.ChayusMeter.createMeter(); meter.restore(session.metrics); restored = 'idle';
        }
        if (session?.endedAt && stream) pauseMonitor('Class session ended · microphone off. Your summary went to your teacher.');
        renderControls();
      } catch (error) { status.textContent = error.message; }
      finally { busy = false; }
    }
    setTimeout(poll, session?.id && !session.endedAt ? 5000 : 15000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) pauseMonitor('Microphone paused because this page was hidden.');
  });
  window.addEventListener('pagehide', () => {
    if (meter && stream) meter.pause(performance.now());
    stopMedia(); void sendMetrics(true);
  });
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
    firebase.auth().onAuthStateChanged(async current => {
      user = current;
      if (!current) { role = ''; status.textContent = 'Sign in through Student Login to use the Chayus Meter.'; controls.replaceChildren(); return; }
      const claims = (await current.getIdTokenResult(true)).claims || {};
      role = claims.b3StudentRole === 'student' ? 'student' : 'teacher';
      void poll();
    });
  } catch (error) { status.textContent = error.message; }
})();
