/* global firebase */
(function () {
  'use strict';
  const classId = location.pathname.includes('_wt/') ? 'wt' : 'et';
  const $ = id => document.getElementById(id);
  const panel = document.createElement('section');
  panel.style.cssText = 'max-width:980px;width:calc(100% - 24px);margin:0 auto 22px;padding:18px;border:1px solid #d6e3f1;border-radius:22px;background:linear-gradient(135deg,#f7fffc,#f3f7ff);box-shadow:0 10px 30px #15315b12';
  panel.innerHTML = '<h2 style="margin:0 0 8px;color:#15315b">🎙️ My Chayus Meter</h2><p id="chayusStatus" role="status" style="color:#516686;font-weight:700">Waiting for class Davening…</p><div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap"><div id="chayusCircle" aria-label="Microphone sound activity" style="width:76px;height:76px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#00aa91 0%,#e8f0fb 0);font-size:32px">🎵</div><p id="chayusFeedback" aria-live="polite" style="font-size:20px;font-weight:900;flex:1;min-width:200px">Daven at your own comfortable volume. You never need to shout.</p></div><div id="chayusControls" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"></div><div id="chayusReport" style="margin-top:14px"></div><p style="font-size:13px;color:#667085;margin-bottom:0">Microphone access starts only when you choose it. Sound is analyzed on this device; raw audio and transcripts are never recorded, saved, or sent. This estimates sound activity, not kavana, words, pronunciation, or davening quality. No points are automatic.</p>';
  document.querySelector('main').after(panel);
  const status = $('chayusStatus'), controls = $('chayusControls'), feedback = $('chayusFeedback');
  const circle = $('chayusCircle'), reportBox = $('chayusReport');
  let user = null, role = '', session = null, meter = null, restored = '', stream = null;
  let context = null, analyser = null, sampleTimer = null, uploadTimer = null, busy = false, isFinished = false;
  const samples = new Float32Array(1024);

  function button(label, fn, primary = false) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.style.cssText = `border:0;border-radius:12px;padding:11px 16px;font-weight:850;cursor:pointer;background:${primary ? '#315efb' : '#eaf0ff'};color:${primary ? '#fff' : '#15315b'}`;
    b.onclick = fn; controls.append(b); return b;
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
  async function call(action, extra = {}) {
    if (!user) throw new Error('Sign in through Student Login to use the Chayus Meter.');
    const project = window.B3_FIREBASE_CONFIG?.projectId;
    if (!['b3-games', 'fun-torah-tools-staging'].includes(project)
      || (location.hostname.includes('staging') && project !== 'fun-torah-tools-staging')) {
      throw new Error('The Chayus session service is unavailable.');
    }
    const response = await fetch(`https://us-central1-${project}.cloudfunctions.net/daveningChayus`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + await user.getIdToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, classId, sessionId: session?.id, ...extra })
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'The Chayus Meter could not connect.');
    return json.session;
  }
  async function sendMetrics(keepalive = false, force = false) {
    const metrics = metricsForUpload();
    if (!metrics || !session || !user || !role || (isFinished && !force)) return;
    try {
      const project = window.B3_FIREBASE_CONFIG?.projectId;
      const response = await fetch(`https://us-central1-${project}.cloudfunctions.net/daveningChayus`, {
        method: 'POST', keepalive,
        headers: { Authorization: 'Bearer ' + await user.getIdToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', classId, sessionId: session.id, metrics })
      });
      if (!response.ok) status.textContent = 'Your latest meter summary has not reached your teacher yet. It will retry.';
    } catch (_) { status.textContent = 'Offline · your latest meter summary will retry when you reconnect.'; }
  }
  function stopMedia() {
    if (sampleTimer !== null) clearInterval(sampleTimer);
    if (uploadTimer !== null) clearInterval(uploadTimer);
    sampleTimer = uploadTimer = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null; analyser = null;
    if (context) { const old = context; context = null; old.close().catch(() => {}); }
    circle.style.background = 'conic-gradient(#00aa91 0%,#e8f0fb 0)';
  }
  function pauseMonitor(message, report = true) {
    if (meter && stream) meter.pause(performance.now());
    stopMedia();
    if (report) void sendMetrics(true);
    if (message) status.textContent = message;
    renderControls();
  }
  function renderControls() {
    controls.replaceChildren();
    if (!role) return;
    if (role === 'teacher') {
      if (!session || session.endedAt) button('▶ Start Chayus session', startSession, true);
      else button('End Davening & prepare class report', endSession, true);
      if (session?.endedAt) button('Refresh class summary', loadReport);
      return;
    }
    if (!session || session.endedAt) {
      status.textContent = session?.endedAt ? 'This class session has ended.' : 'Waiting for your teacher to start Davening.';
      return;
    }
    if (isFinished) { button('Monitoring is off', () => {}); return; }
    if (stream) {
      button('Pause monitoring', () => pauseMonitor('Microphone paused · no sound is being measured'));
      button('Turn monitoring off', turnOff);
    } else {
      button(meter ? 'Resume My Chayus Meter' : '🎙️ Activate My Chayus Meter', startMonitor, true);
      if (meter) button('Turn monitoring off', turnOff);
    }
  }
  async function startSession() {
    try { session = await call('start'); status.textContent = 'Chayus session is open for this class.'; renderControls(); }
    catch (error) { status.textContent = error.message; }
  }
  async function endSession() {
    if (!session) return;
    try {
      session = await call('finish');
      if (stream) pauseMonitor('', false);
      await sendMetrics(true);
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
      summaryRow.textContent = row.hasData ? `${row.studentName} · ${row.soundActivityPercent}% sound activity` : `${row.studentName} · No microphone data`;
      summaryRow.style.fontWeight = '850'; details.append(summaryRow);
      const info = document.createElement('p');
      info.textContent = row.hasData
        ? `${row.measuredMinutes} monitored minutes · consistency across observed intervals: ${row.consistencyPercent === null ? 'not enough intervals' : row.consistencyPercent + '%'} · ${row.pauseCount} pause(s), ${row.pausedMinutes} paused minutes${row.missingAtEnd ? ' · missing update near session end' : ''}. Sound and room conditions affect estimates.`
        : row.missingAtEnd ? 'No aggregate was received near session end. Do not treat missing data as zero participation.' : 'No aggregate was submitted. This can mean no microphone, denied permission, or choosing not to participate.';
      details.append(info); list.append(details);
    }
    reportBox.append(list);
    const rewardLink = document.createElement('a'); rewardLink.href = `../student-rewards/teacher.html?class=b3_${classId}`;
    rewardLink.textContent = 'Open Student Rewards to decide points manually';
    rewardLink.style.cssText = 'display:inline-block;margin-top:12px;font-weight:800;color:#315efb';
    reportBox.append(rewardLink);
  }
  async function startMonitor() {
    if (!session || session.endedAt || stream || isFinished) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Microphone access is unavailable. Open this page over HTTPS in a supported browser.'; return;
    }
    let granted = null, newContext = null;
    try {
      status.textContent = 'Your browser will ask for microphone permission now.';
      granted = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false });
      newContext = new AudioContextClass(); await newContext.resume();
      stream = granted; context = newContext;
      const source = context.createMediaStreamSource(stream); analyser = context.createAnalyser(); analyser.fftSize = 2048; source.connect(analyser);
      if (!meter) meter = window.ChayusMeter.createMeter();
      meter.start(performance.now());
      sampleTimer = setInterval(() => {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = window.ChayusMeter.rmsFromFloatSamples(samples);
        const message = meter.sample(rms, performance.now());
        const value = Math.round(Math.min(100, rms * 500));
        circle.style.background = `conic-gradient(#00aa91 ${value}%,#e8f0fb 0)`;
        if (message) feedback.textContent = message;
      }, 200);
      uploadTimer = setInterval(() => { void sendMetrics(); }, 30000);
      status.textContent = restored ? 'Microphone on · your summary continued after reconnecting.' : 'Microphone on · calibrating room sound for a few seconds.';
      renderControls();
    } catch (error) {
      granted?.getTracks().forEach(track => track.stop());
      if (newContext) await newContext.close().catch(() => {});
      status.textContent = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
        ? 'Permission declined. The meter is off. You can daven normally.'
        : 'The microphone could not start. Check browser permissions or microphone availability.';
      renderControls();
    }
  }
  async function turnOff() {
    if (!meter || isFinished) return;
    if (stream) { meter.pause(performance.now()); stopMedia(); }
    const final = meter.finish(); isFinished = true;
    status.textContent = 'Monitoring is off. Sending only the aggregate summary…';
    renderControls();
    await sendMetrics(true, true);
    status.textContent = `Monitoring off · ${final.measuredSeconds.toFixed(1)} minutes measured · no audio was saved.`;
  }
  async function poll() {
    if (user && !document.hidden && !busy) {
      busy = true;
      try {
        const next = await call('read');
        if (next?.id !== session?.id) {
          if (stream) pauseMonitor('A new class session started; microphone paused.', false);
          session = next; meter = null; restored = ''; isFinished = false;
        } else session = next;
        if (role === 'student' && session?.metrics && restored !== session.id) {
          meter = window.ChayusMeter.createMeter(); meter.restore(session.metrics); restored = session.id;
        }
        if (session?.endedAt && stream) pauseMonitor('Class session ended · microphone paused.');
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
