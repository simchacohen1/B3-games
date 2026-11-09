/* Homework Portal browser helpers (shared by student.html and teacher.html). */
(function (root) {
  'use strict';
  var STAGING_PROJECT = 'fun-torah-tools-staging';
  var STAGING_HOST = 'fun-torah-tools-staging.web.app';
  var STAGING_PREVIEW_HOST = /^fun-torah-tools-staging--(?:homework-406-preview|pr-597-homework-notes)-[a-z0-9]+\.web\.app$/;
  var projectId = root.B3_FIREBASE_CONFIG && root.B3_FIREBASE_CONFIG.projectId;
  var host = root.location && root.location.hostname ? root.location.hostname.toLowerCase() : '';
  var localPreview = /^(localhost|127\.0\.0\.1)$/.test(host) &&
    root.location.search.indexOf('local-staging=1') !== -1;
  var isStagingRuntime = projectId === STAGING_PROJECT &&
    (host === STAGING_HOST || STAGING_PREVIEW_HOST.test(host) || localPreview);
  var LIVE_PROJECT = 'b3-games';
  var LIVE_HOSTS = ['funtorahtools.com', 'www.funtorahtools.com', 'simchacohen1.github.io'];
  var isLiveRuntime = projectId === LIVE_PROJECT && LIVE_HOSTS.indexOf(host) !== -1;
  var API = isStagingRuntime
    ? (localPreview && /^http:\/\/(localhost|127\.0\.0\.1):5001\//.test(root.B3_HOMEWORK_API_URL || '')
      ? root.B3_HOMEWORK_API_URL
      : 'https://us-central1-' + STAGING_PROJECT + '.cloudfunctions.net/homeworkPortal')
    : isLiveRuntime ? 'https://us-central1-' + LIVE_PROJECT + '.cloudfunctions.net/homeworkPortal' : '';
  var TYPES = {
    shorashim: 'Shorashim practice', weeklyQuiz: 'Weekly Quiz', rashiLetters: 'Rashi Letters',
    posuk: 'Posuk Practice', chazara: 'Chazara', workbook: 'Workbook page',
    audio: 'Audio recording', video: 'Video', other: 'Other'
  };
  var STATUS = {
    assigned: 'Not started', in_progress: 'In progress', submitted: 'Submitted', approved: 'Completed ✓', returned: 'Try again'
  };
  var ACTIVITY_URLS = {
    shorashim: '../shorashim/index.html', weeklyQuiz: '../weekly-quiz/index.html',
    rashiLetters: '../rashi-letters/student.html', chazara: '../chazara/index.html',
    posuk: '../record_pesukim/student.html'
  };
  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  async function call(body, token) {
    if (!API) throw new Error('Homework is not available on this site.');
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    var res;
    try { res = await fetch(API, { method: 'POST', headers: headers, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('No internet connection. Your work is kept on this page; try again.'); }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw Object.assign(new Error(data.error || ('Error ' + res.status)), { status: res.status });
    return data;
  }
  function when(ms) {
    if (ms == null) return '';
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  // Due dates are end of the chosen day, local time.
  function dueFromInput(v) { return v ? new Date(v + 'T23:59:59').getTime() : null; }
  function assignedFromInput(v) { return v ? new Date(v + 'T00:00:00').getTime() : null; }
  function inputFromDue(ms) {
    if (ms == null) return '';
    var d = new Date(ms), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function activityUrl(type) {
    var path = ACTIVITY_URLS[type];
    return path ? new URL(path, root.location.href).href : '';
  }
  // Teacher-facing workload buckets are derived from the server-scoped
  // student rows. Missing means not started after the due date; overdue
  // includes any unfinished work past its due date.
  function teacherStatusCounts(students) {
    var counts = { assigned: 0, submitted: 0, completed: 0, missing: 0, overdue: 0 };
    Object.keys(students || {}).forEach(function (id) {
      var student = students[id] || {};
      if (student.status === 'assigned') counts.assigned++;
      if (student.status === 'submitted') counts.submitted++;
      if (student.status === 'approved') counts.completed++;
      if (student.late) {
        counts.overdue++;
        if (student.status === 'assigned') counts.missing++;
      }
    });
    return counts;
  }
  // ---- Notes thread (typed messages + voice notes), shared by student and teacher pages ----
  var VOICE_MAX_MS = 15000, VOICE_MAX_BYTES = 100000, VOICE_SAFE_BYTES = 88000;
  // Kept per thread so a page redraw (new data, another thread sending) never loses an open box,
  // its last notice, or a half-typed message.
  var openThreads = {}, threadNotices = {}, threadDrafts = {};
  function unreadCount(messages, role) {
    return (messages || []).filter(function (m) { return m && m.unread && m.role !== role; }).length;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return two(Math.floor(s / 60)) + ':' + two(s % 60); }
  // "00:04 · 00:11 left": elapsed time, then what is left of the 15 second limit.
  function recClock(elapsed) { return clock(Math.floor(Math.min(elapsed, VOICE_MAX_MS) / 1000) * 1000) + ' · ' + clock(VOICE_MAX_MS - elapsed) + ' left'; }
  function sentAt(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  // "Today", "Yesterday", or "Mon, Nov 3": the divider shown above each day's messages.
  function dayLabel(ts, now) {
    if (!ts) return '';
    var d = new Date(ts), today = new Date(now || Date.now());
    var start = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((start(today) - start(d)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    try {
      return d.toLocaleDateString([], d.getFullYear() === today.getFullYear()
        ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return ''; }
  }
  // The server accepts audio/webm, audio/ogg, audio/mp4 and audio/mpeg. Safari/iPad report mp4 under a few names.
  function audioType(type) {
    type = String(type || '').split(';')[0].toLowerCase();
    if (/mp4|m4a|aac/.test(type)) return 'audio/mp4';
    if (/webm/.test(type)) return 'audio/webm';
    if (/ogg/.test(type)) return 'audio/ogg';
    if (/mpeg|mp3/.test(type)) return 'audio/mpeg';
    return type;
  }
  function addConversationStyles() {
    if (!root.document || document.getElementById('homework-conversation-styles')) return;
    var style = document.createElement('style'); style.id = 'homework-conversation-styles';
    style.textContent = [
      /* One chat look for every notes thread, on both the student and teacher pages. */
      '.home-conversation{border:1.5px solid #d4e3f5;border-radius:16px;background:#f6f9fd;padding:14px;margin:14px 0}',
      '.home-conversation h4{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:16px;font-weight:800;margin:0 0 10px;color:#1a2744}',
      '.conversation-content{padding-top:10px}',
      '.conversation-history{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;padding:2px 2px 6px;overscroll-behavior:contain}',
      '.conversation-history>.muted{margin:6px 0;text-align:center;font-size:14px;color:#5b7290}',
      '.conversation-day{align-self:center;margin:6px 0 2px;padding:2px 10px;border-radius:999px;background:#e6edf6;color:#5b7290;font-size:12px;font-weight:800}',
      '.conversation-message{align-self:flex-start;max-width:min(85%,520px);background:#fff;border:1px solid #dbe6f3;border-radius:16px 16px 16px 5px;padding:8px 12px 9px;box-shadow:0 1px 2px rgba(26,39,68,.06)}',
      '.conversation-message.mine{align-self:flex-end;background:#e2f5e9;border-color:#b5e0c4;border-radius:16px 16px 5px 16px}',
      '.conversation-message.unread{border-color:#f0b429;background:#fffaeb;box-shadow:0 0 0 2px rgba(240,180,41,.25)}',
      '.conversation-message p{margin:3px 0 0;font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.conversation-who{display:flex;align-items:center;flex-wrap:wrap;gap:6px}',
      '.conversation-message.mine .conversation-who{justify-content:flex-end}',
      '.conversation-who strong{font-size:12.5px;font-weight:800;color:#5b7290}',
      '.conversation-message.theirs.from-teacher strong{color:#1d4ed8}',
      '.conversation-message.theirs.from-student strong{color:#6d3fc0}',
      '.conversation-time{font-size:12px;color:#6b7c93}',
      '.conversation-new,.conversation-unread{display:inline-block;padding:1px 8px;border-radius:999px;background:#f0b429;color:#3d2a00;font-size:12px;font-weight:800;line-height:1.5}',
      '.conversation-unread{margin-left:8px;vertical-align:middle}',
      '.conversation-message .conversation-listen{display:inline-flex;align-items:center;gap:6px;margin:6px 0 0!important;min-height:36px;padding:6px 14px;border-radius:999px;font-size:14px}',
      '.conversation-message audio{display:block;max-width:100%;width:280px;margin-top:6px}',
      '.conversation-toggle{display:flex!important;align-items:center;width:100%;text-align:left;min-height:46px;margin:0!important;background:#fff!important;border:1.5px solid #c9dbef!important;color:#1a2744!important;border-radius:12px!important;font-weight:700!important}',
      '.conversation-toggle::after{content:"";margin-left:auto;width:8px;height:8px;border-right:2.5px solid currentColor;border-bottom:2.5px solid currentColor;transform:rotate(45deg);transition:transform .15s;flex:none}',
      '.conversation-toggle[aria-expanded="true"]::after{transform:rotate(225deg)}',
      '.conversation-toggle.has-unread{background:#fff3c4!important;border-color:#f0b429!important;color:#5c3b00!important;font-weight:800!important}',
      '.conversation-compose{margin-top:10px}',
      '.conversation-compose textarea{display:block;width:100%;min-height:46px;max-height:180px;margin:0;padding:11px 14px;border:1.5px solid #c9dbef;border-radius:14px;background:#fff;font:inherit;font-size:15px;line-height:1.4;resize:none;overflow-y:auto}',
      '.conversation-compose textarea:focus{outline:none;border-color:#4a9eed;box-shadow:0 0 0 3px rgba(74,158,237,.18)}',
      '.conversation-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}',
      '.conversation-actions button{margin:0!important;min-height:42px}',
      '.conversation-actions .conversation-send{order:3;margin-left:auto!important}',
      '.conversation-hint{order:2;font-size:12px;color:#6b7c93}',
      '@media (pointer:coarse){.conversation-hint{display:none}}',
      '.conversation-feedback{min-height:20px;margin:6px 0 0;color:#5b7290;font-size:14px;font-weight:600}',
      '.conversation-feedback.is-error{color:#c03030}',
      '.conversation-feedback.is-good{color:#17834a}',
      '.conversation-recording{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;padding:10px 12px;border-radius:12px;background:#fff1f1;border:1.5px solid #f5b5b5;color:#8a1c1c;font-weight:700}',
      '.conversation-recording[hidden]{display:none}',
      '.rec-dot{width:14px;height:14px;border-radius:50%;background:#e02424;flex:none;animation:recPulse 1.2s ease-out infinite}',
      '@keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(224,36,36,.6);opacity:1}50%{opacity:.55}70%{box-shadow:0 0 0 10px rgba(224,36,36,0)}100%{box-shadow:0 0 0 0 rgba(224,36,36,0);opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.rec-dot{animation:none}}',
      '.rec-time{font-variant-numeric:tabular-nums;min-width:120px}',
      '.rec-meter{flex:1 1 90px;min-width:90px;height:10px;border-radius:6px;background:#f7d4d4;overflow:hidden}',
      '.rec-meter[hidden]{display:none}',
      '.rec-meter span{display:block;height:100%;width:100%;background:linear-gradient(90deg,#16a34a,#eab308 70%,#e02424);transform-origin:left center;transform:scaleX(0);transition:transform .08s linear}',
      '.conversation-recording button{margin:0!important;min-height:36px}',
      '.general-messages h4{margin-top:0}',
      '.message-picker{display:flex;flex-direction:column;gap:6px;margin:8px 0 12px;font-weight:700}',
      '.message-picker select{max-width:100%}',
      '.instruction-voice{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0}',
      '.instruction-play{font-size:18px;font-weight:800;padding:12px 20px;min-height:48px;border-radius:14px;background:#2d7ecc;color:#fff;border:0;cursor:pointer}',
      '.instruction-play[aria-pressed="true"]{background:#1a2744}',
      '.instruction-status{color:#8a1c1c;font-weight:700}',
      '.conversation-record[data-recording="true"]{background:#e02424!important;border-color:#e02424!important;color:#fff!important}'
    ].join('\n');
    document.head.append(style);
  }
  // Live input level for the sound meter. Returns a stop function, or null if the browser cannot do it.
  function startMeter(stream, onLevel) {
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC || !root.requestAnimationFrame) return null;
      var ctx = new AC(), source = ctx.createMediaStreamSource(stream), analyser = ctx.createAnalyser();
      analyser.fftSize = 512; source.connect(analyser);
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
      var data = new Uint8Array(analyser.fftSize), frame = 0;
      (function draw() {
        analyser.getByteTimeDomainData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) { var v = (data[i] - 128) / 128; sum += v * v; }
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
        frame = root.requestAnimationFrame(draw);
      })();
      return function () {
        root.cancelAnimationFrame(frame);
        try { source.disconnect(); } catch (e) { /* already gone */ }
        if (ctx.close) ctx.close().catch(function () {});
      };
    } catch (e) { return null; }
  }
  // One voice recorder for notes and recorded instructions: pulsing red dot, MM:SS timer (time used and
  // time left), live sound meter, Cancel, and the 15 second / 100 KB limits the server also enforces.
  // options.onRecorded(voiceDataURL) saves the recording and returns the message to show.
  function voiceRecorder(options) {
    addConversationStyles();
    var feedback = options.feedback;
    function say(text, tone) { if (options.tell) options.tell(text, tone); else feedback.textContent = text || ''; }
    var idleLabel = options.idleLabel || '🎙 Record voice note', stopLabel = options.stopLabel || '■ Stop & send';
    var record = el('button', idleLabel, options.buttonClass || 'conversation-record sec'); record.type = 'button';
    var panel = el('div', null, 'conversation-recording'); panel.hidden = true;
    var recLabel = el('span', 'Recording', 'rec-label'), recTime = el('span', recClock(0), 'rec-time');
    recTime.setAttribute('role', 'timer');
    var meter = el('span', null, 'rec-meter'), meterBar = el('span');
    meter.append(meterBar); meter.setAttribute('aria-hidden', 'true');
    var cancel = el('button', 'Cancel', 'sec conversation-cancel'); cancel.type = 'button';
    panel.append(el('span', null, 'rec-dot'), recLabel, recTime, meter, cancel);
    var rec = null;
    function stopRecording(cancelled) {
      if (!rec) return;
      rec.cancelled = rec.cancelled || !!cancelled;
      if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    }
    function idle() {
      record.dataset.recording = 'false'; record.textContent = idleLabel;
      if (options.onEnd) options.onEnd();
    }
    cancel.onclick = function () { stopRecording(true); };
    record.onclick = async function () {
      if (rec) { stopRecording(false); return; }
      if (!root.navigator?.mediaDevices?.getUserMedia || !root.MediaRecorder) {
        say(options.unsupportedText || 'Voice notes are not supported in this browser. You can send a written message.', 'error'); return;
      }
      record.disabled = true; say('Starting the microphone…');
      var stream;
      try {
        stream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
        // Chrome/Firefox record webm or ogg; Safari and iPad record mp4.
        var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(function (type) {
          return !root.MediaRecorder.isTypeSupported || root.MediaRecorder.isTypeSupported(type);
        });
        var recorder = new root.MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
        var r = rec = { recorder: recorder, stream: stream, chunks: [], bytes: 0, started: 0, peak: 0, cancelled: false, full: false };
        recorder.ondataavailable = function (event) {
          if (!event.data || !event.data.size) return;
          r.chunks.push(event.data); r.bytes += event.data.size;
          // Some browsers ignore the bitrate; stop before the note gets bigger than the server allows.
          if (r.bytes > VOICE_SAFE_BYTES && recorder.state === 'recording') { r.full = true; recorder.stop(); }
        };
        recorder.onstop = async function () {
          clearInterval(r.tick); if (r.stopMeter) r.stopMeter();
          stream.getTracks().forEach(function (track) { track.stop(); });
          rec = null; panel.hidden = true; meterBar.style.transform = 'scaleX(0)';
          idle();
          if (r.cancelled) { say(options.cancelledText || 'Recording cancelled. Nothing was sent.'); record.disabled = false; return; }
          record.disabled = true;
          try {
            if (Date.now() - r.started < 700) throw new Error('That was too short. Press Record, speak, then press ' + stopLabel.replace(/^■\s*/, '') + '.');
            var type = audioType(recorder.mimeType || (r.chunks[0] && r.chunks[0].type) || mime || 'audio/webm');
            var blob = new Blob(r.chunks, { type: type });
            if (!blob.size) throw new Error('Nothing was recorded. Check your microphone and try again.');
            if (blob.size > VOICE_MAX_BYTES) throw new Error('That recording was too large. Please try a shorter note.');
            say(options.busyText || 'Sending voice note…');
            var voiceDataURL = await new Promise(function (resolve, reject) {
              var reader = new FileReader(); reader.onload = function () { resolve(reader.result); }; reader.onerror = reject; reader.readAsDataURL(blob);
            });
            say((await options.onRecorded(voiceDataURL)) || '', 'good');
          } catch (error) { say(error.message || 'Voice note could not be sent.', 'error'); }
          finally { record.disabled = false; }
        };
        recorder.start(1000);
        r.started = Date.now();
        record.dataset.recording = 'true'; record.disabled = false; record.textContent = stopLabel;
        if (options.onStart) options.onStart();
        panel.hidden = false; recTime.textContent = recClock(0);
        say(options.recordingText || 'Recording now. Speak your note, then press Stop & send.');
        r.stopMeter = startMeter(stream, function (level) {
          if (level > r.peak) r.peak = level;
          meterBar.style.transform = 'scaleX(' + level.toFixed(3) + ')';
        });
        meter.hidden = !r.stopMeter;
        r.tick = setInterval(function () {
          if (!(options.host || panel).isConnected) { stopRecording(true); return; } // the page re-drew: never leave the mic on
          var elapsed = Date.now() - r.started;
          recTime.textContent = recClock(elapsed);
          if (r.stopMeter && elapsed > 3000 && r.peak < 0.03)
            say('We can’t hear anything yet. Check that your microphone is on and not muted.', 'error');
          if (elapsed >= VOICE_MAX_MS && recorder.state === 'recording') recorder.stop();
        }, 250);
      } catch (error) {
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        rec = null; panel.hidden = true; record.disabled = false; idle();
        say(error.name === 'NotAllowedError' ? 'Allow microphone access to record a note.' : (options.failText || 'Could not start recording. You can send a written message.'), 'error');
      }
    };
    return { button: record, panel: panel, cancel: function () { stopRecording(true); } };
  }
  // A big, clear button that plays recorded instructions. It loads the audio once, then can be
  // played again as many times as the student likes. load() returns { voiceDataURL }.
  function instructionPlayer(load, options) {
    addConversationStyles();
    options = options || {};
    var wrap = el('div', null, 'instruction-voice');
    var playText = options.label || '🔊 Listen to the instructions';
    var button = el('button', playText, 'instruction-play'); button.type = 'button';
    var status = el('span', null, 'instruction-status'); status.setAttribute('aria-live', 'polite');
    var player = null, played = false, cantPlay = 'This recording was made on a different kind of device and can’t play here. Try opening it in Chrome or on a computer.';
    function ready() { button.disabled = false; button.textContent = played ? '🔁 Listen again' : playText; button.setAttribute('aria-pressed', 'false'); }
    button.onclick = async function () {
      if (player && !player.paused) { player.pause(); player.currentTime = 0; ready(); return; }
      button.disabled = true; status.textContent = '';
      try {
        if (!player) {
          button.textContent = 'Loading…';
          var audio = await load();
          player = new root.Audio(); player.preload = 'auto';
          var type = String(audio.voiceDataURL || '').slice(5).split(';')[0];
          if (type && player.canPlayType && !player.canPlayType(type)) throw new Error(cantPlay);
          player.onended = function () { played = true; ready(); };
          player.onerror = function () { status.textContent = cantPlay; ready(); };
          player.src = audio.voiceDataURL;
        }
        player.currentTime = 0;
        await player.play();
        button.disabled = false; button.textContent = '■ Stop'; button.setAttribute('aria-pressed', 'true');
      } catch (error) {
        if (error && error.message === cantPlay) player = null;
        status.textContent = (error && error.name === 'NotAllowedError') ? 'Press the button again to play.' : (error && error.message) || 'The instructions could not play.';
        ready();
      }
    };
    wrap.append(button, status);
    return wrap;
  }
  function conversation(options) {
    addConversationStyles();
    var box = el('section', null, 'home-conversation');
    var messages = options.messages || [];
    var role = options.role;
    var unread = unreadCount(messages, role), marked = false;
    var heading = el('h4', options.title || (role === 'teacher' ? 'Notes with this student' : 'Notes with your teacher'));
    var headingBadge = null;
    if (unread && !options.collapsed) { headingBadge = el('span', unread + ' new', 'conversation-unread'); heading.append(headingBadge); }
    box.append(heading);
    var toggle = null, content = el('div', null, 'conversation-content');
    var key = options.threadKey ? String(options.threadKey) : '';
    var other = role === 'teacher' ? (options.studentName || 'this student') : 'your teacher';
    function toggleText() {
      if (unread && !marked) return '💬 ' + unread + ' new ' + (unread === 1 ? 'message' : 'messages') + ' from ' + other;
      return messages.length ? '💬 Read messages · ' + messages.length : '💬 Message ' + other;
    }
    // Tell the server this side has now seen the thread, so the "new" count clears on the next load.
    function markRead() {
      if (marked || !unread) return;
      marked = true;
      Promise.resolve().then(function () { return options.send({ action: 'markRead' }); }).then(function () {
        if (headingBadge) headingBadge.remove();
        if (toggle) { toggle.textContent = toggleText(); toggle.classList.remove('has-unread'); }
        if (options.onRead) options.onRead();
      }).catch(function () { marked = false; });
    }
    if (options.collapsed) {
      toggle = el('button', toggleText(), 'conversation-toggle sec' + (unread ? ' has-unread' : ''));
      toggle.type = 'button';
      var startOpen = !!(key && openThreads[key]);
      toggle.setAttribute('aria-expanded', String(startOpen));
      toggle.onclick = function () {
        var open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open)); content.hidden = !open;
        if (key) openThreads[key] = open;
        if (open) markRead();
      };
      box.append(toggle); content.hidden = !startOpen;
      if (startOpen) markRead();
    } else if (unread) {
      // Teacher threads sit inside closed <details>; only count them read once they are actually on screen.
      if (root.IntersectionObserver) {
        var seen = new root.IntersectionObserver(function (entries) {
          if (entries.some(function (e) { return e.isIntersecting; })) { seen.disconnect(); markRead(); }
        });
        seen.observe(content);
      } else markRead();
    }
    var history = el('div', null, 'conversation-history');
    var feedback = el('p', null, 'conversation-feedback'); feedback.setAttribute('aria-live', 'polite');
    function tell(text, tone) {
      feedback.textContent = text || '';
      feedback.classList.toggle('is-error', tone === 'error');
      feedback.classList.toggle('is-good', tone === 'good');
    }
    if (key && threadNotices[key]) { tell(threadNotices[key], 'good'); delete threadNotices[key]; }
    var lastDay = '';
    messages.slice(-30).forEach(function (message) {
      var day = dayLabel(message.createdAt);
      if (day && day !== lastDay) { history.append(el('div', day, 'conversation-day')); lastDay = day; }
      var mine = message.role === role;
      var isNew = !mine && !!message.unread;
      var item = el('article', null, 'conversation-message ' + (mine ? 'mine' : 'theirs') +
        (message.role === 'teacher' ? ' from-teacher' : ' from-student') + (isNew ? ' unread' : ''));
      var who = el('div', null, 'conversation-who');
      who.append(el('strong', mine ? 'You' : message.role === 'teacher' ? 'Teacher' : (options.studentName || 'Student')));
      var when = sentAt(message.createdAt);
      if (when) who.append(el('span', when, 'conversation-time'));
      if (isNew) who.append(el('span', 'New', 'conversation-new'));
      item.append(who);
      if (message.text) item.append(el('p', message.text));
      if (message.voice) {
        var listen = el('button', '▶ Play voice note', 'conversation-listen'); listen.type = 'button';
        listen.onclick = async function () {
          listen.disabled = true; listen.textContent = 'Loading voice note…';
          try {
            var audio = await options.send({ action: 'voiceRead', messageId: message.id });
            var player = el('audio'); player.controls = true; player.preload = 'auto';
            var type = String(audio.voiceDataURL || '').slice(5).split(';')[0];
            var cantPlay = 'This voice note was recorded on a different kind of device and can’t play here. Try opening it in Chrome or on a computer.';
            if (type && player.canPlayType && !player.canPlayType(type)) tell(cantPlay, 'error');
            player.onerror = function () { tell(cantPlay, 'error'); };
            player.src = audio.voiceDataURL;
            listen.replaceWith(player);
            var playing = player.play && player.play();
            if (playing && playing.catch) playing.catch(function () { /* the player controls are there to press */ });
          } catch (error) {
            tell(error.message || 'This voice note could not play.', 'error');
            listen.disabled = false; listen.textContent = '▶ Play voice note';
          }
        };
        item.append(listen);
      }
      history.append(item);
    });
    if (!messages.length) history.append(el('p', options.emptyText || 'No notes yet. Send a message if you have a question.', 'muted'));
    content.append(history);
    if (messages.length) setTimeout(function () { history.scrollTop = history.scrollHeight; }, 0);
    var compose = el('div', null, 'conversation-compose');
    var note = el('textarea'); note.maxLength = 500; note.rows = 1;
    note.placeholder = role === 'teacher' ? 'Write a note…' : 'Write a message…';
    note.setAttribute('aria-label', role === 'teacher' ? 'Write a message to ' + other : 'Write a message to your teacher');
    // The box grows with the message (up to a limit) instead of showing a scroll bar for two lines.
    function fit() { note.style.height = 'auto'; note.style.height = Math.min(note.scrollHeight + 3, 180) + 'px'; }
    if (key && threadDrafts[key]) note.value = threadDrafts[key];
    note.addEventListener('input', function () {
      if (key) { if (note.value) threadDrafts[key] = note.value; else delete threadDrafts[key]; }
      fit();
    });
    // Enter sends and Shift+Enter starts a new line, like other chat apps. Phones and tablets keep Enter as a new line.
    var finePointer = !!(root.matchMedia && root.matchMedia('(pointer:fine)').matches);
    note.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !finePointer) return;
      event.preventDefault();
      if (!sendText.disabled) sendText.click();
    });
    var actions = el('div', null, 'conversation-actions');
    var sendText = el('button', 'Send message', 'conversation-send'); sendText.type = 'button';
    // Same recorder as recorded instructions: red dot, MM:SS timer, sound meter, Cancel, 15 s / 100 KB limits.
    var recorder = voiceRecorder({ feedback: feedback, tell: tell, host: box,
      onStart: function () { sendText.disabled = true; },
      onEnd: function () { sendText.disabled = false; },
      onRecorded: async function (voiceDataURL) {
        var typed = note.value.trim();
        await send(typed ? { voiceDataURL: voiceDataURL, text: typed } : { voiceDataURL: voiceDataURL }, 'Voice note sent.');
        note.value = ''; return 'Voice note sent.';
      } });
    var record = recorder.button, panel = recorder.panel;
    var hint = el('span', 'Enter to send · Shift+Enter for a new line', 'conversation-hint');
    async function send(payload, notice) {
      await options.send(Object.assign({ action: 'comment' }, payload));
      note.value = ''; fit();
      if (key) { openThreads[key] = true; threadNotices[key] = notice; delete threadDrafts[key]; } // the page may redraw this box
      // The message is already sent; a failed refresh afterwards must not say it wasn't.
      if (options.onSent) { try { await options.onSent(); } catch (e) { /* the next refresh will show it */ } }
    }
    sendText.onclick = async function () {
      if (!note.value.trim()) { tell('Type a message, or record a voice note, before sending.', 'error'); note.focus(); return; }
      sendText.disabled = true; tell('Sending…');
      try { await send({ text: note.value.trim() }, 'Message sent.'); tell('Message sent.', 'good'); }
      catch (error) { tell(error.message || 'Message could not be sent.', 'error'); }
      finally { sendText.disabled = false; }
    };
    actions.append(record, hint, sendText); compose.append(note, actions, panel, feedback);
    content.append(compose); box.append(content);
    if (note.value) setTimeout(fit, 0);
    return box;
  }
  root.HomeworkCommon = { API: API, TYPES: TYPES, STATUS: STATUS, ACTIVITY_URLS: ACTIVITY_URLS,
    isStagingRuntime: function () { return isStagingRuntime; }, isAllowedRuntime: function () { return isStagingRuntime || isLiveRuntime; }, activityUrl: activityUrl, el: el, call: call, when: when,
    dueFromInput: dueFromInput, assignedFromInput: assignedFromInput, inputFromDue: inputFromDue, conversation: conversation,
    unreadCount: unreadCount, teacherStatusCounts: teacherStatusCounts, dayLabel: dayLabel, voiceRecorder: voiceRecorder, instructionPlayer: instructionPlayer };
  if (root.document && root.document.head) addConversationStyles(); // "N new" tags can show before any notes box
  if (typeof module === 'object' && module.exports) module.exports = root.HomeworkCommon;
})(typeof window !== 'undefined' ? window : globalThis);
