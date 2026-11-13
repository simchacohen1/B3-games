'use strict';
// Local-only preview. No Firebase connection or audio/network upload here.
(function () {
  const $ = (id) => document.getElementById(id);
  const startButton = $('start');
  const pauseButton = $('pause');
  const finishButton = $('finish');
  const status = $('status');
  const feedback = $('feedback');
  const circle = $('circle');
  const meter = window.ChayusMeter.createMeter();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let stream = null;
  let context = null;
  let analyser = null;
  let intervalId = null;
  let requestSequence = 0;
  let finished = false;
  let starting = false;
  const samples = new Float32Array(1024);

  function setStatus(message) { status.textContent = message; }
  function releaseMedia() {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    analyser = null;
    if (context) { const old = context; context = null; old.close().catch(() => {}); }
    circle.style.setProperty('--fill', '0%');
  }
  function setPaused(message) {
    requestSequence++;
    releaseMedia();
    meter.pause();
    starting = false;
    startButton.disabled = finished;
    startButton.textContent = '🎤 Resume microphone';
    pauseButton.disabled = true;
    if (!finished) setStatus(message);
  }
  function readSoundActivity() {
    if (!analyser || finished) return;
    analyser.getFloatTimeDomainData(samples);
    const rms = window.ChayusMeter.rmsFromFloatSamples(samples);
    const message = meter.sample(rms, performance.now());
    // The animation is illustrative. Loudness is NOT used as a point score.
    const fill = Math.round(Math.min(100, rms * 500));
    circle.style.setProperty('--fill', fill + '%');
    if (message) {
      feedback.textContent = message;
      setStatus('Microphone on · a new encouragement was shown');
    }
  }
  async function start() {
    if (finished || starting || stream) return;
    if (!AudioContextClass || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Microphone access is unavailable. Open this page using HTTPS in a supported browser.');
      return;
    }
    const seq = ++requestSequence;
    starting = true;
    startButton.disabled = true;
    setStatus('Waiting for your microphone permission…');
    let grantedStream = null;
    let newContext = null;
    try {
      grantedStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: false
      });
      if (seq !== requestSequence || finished) {
        grantedStream.getTracks().forEach((track) => track.stop());
        return;
      }
      newContext = new AudioContextClass();
      await newContext.resume();
      if (seq !== requestSequence || finished) {
        grantedStream.getTracks().forEach((track) => track.stop());
        await newContext.close();
        return;
      }
      stream = grantedStream;
      context = newContext;
      const source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      // Never connect the microphone to audio output; prevent feedback loops.
      meter.start(performance.now());
      intervalId = setInterval(readSoundActivity, 200);
      startButton.disabled = true;
      pauseButton.disabled = false;
      finishButton.disabled = false;
      feedback.textContent = 'Great! Daven at your own comfortable volume.';
      setStatus('Microphone on · calibrating room sound for a few seconds');
    } catch (err) {
      if (grantedStream) grantedStream.getTracks().forEach((track) => track.stop());
      if (newContext) await newContext.close().catch(() => {});
      if (seq === requestSequence) {
        startButton.disabled = false;
        setStatus(err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
          ? 'Permission declined. The meter is off. You can still daven normally.'
          : 'The microphone could not start. Please check browser permissions.');
      }
    } finally {
      if (seq === requestSequence) starting = false;
    }
  }
  function finish() {
    if (finished) return;
    setPaused('');
    finished = true;
    const data = meter.finish();
    startButton.disabled = true;
    pauseButton.disabled = true;
    finishButton.disabled = true;
    $('summary').classList.remove('hidden');
    $('measured').textContent = (data.measuredSeconds / 60).toFixed(1);
    $('activity').textContent = data.hasMeasuredActivity ? data.soundActivityPercent + '%' : 'No data';
    $('messages').textContent = String(data.feedbackCount);
    feedback.textContent = 'Yasher koach for davening!';
    setStatus('Session finished · microphone off · no data was sent');
    $('summary').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  startButton.addEventListener('click', start);
  pauseButton.addEventListener('click', () => setPaused('Microphone paused · no sound is being measured'));
  finishButton.addEventListener('click', finish);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (stream || starting)) setPaused('Microphone paused because this page was hidden');
  });
  window.addEventListener('pagehide', () => { requestSequence++; releaseMedia(); meter.pause(); });
})();
