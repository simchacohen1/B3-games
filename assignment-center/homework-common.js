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
  var openThreads = {}, threadNotices = {};
  function unreadCount(messages, role) {
    return (messages || []).filter(function (m) { return m && m.unread && m.role !== role; }).length;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return two(Math.floor(s / 60)) + ':' + two(s % 60); }
  // "00:04 · 00:11 left": elapsed time, then what is left of the 15 second limit.
  function recClock(elapsed) { return clock(Math.floor(Math.min(elapsed, VOICE_MAX_MS) / 1000) * 1000) + ' · ' + clock(VOICE_MAX_MS - elapsed) + ' left'; }
  function sentAt(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
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
      '.conversation-who{display:flex;align-items:center;flex-wrap:wrap;gap:6px}',
      '.conversation-time{font-size:12px;color:#6b7c93}',
      '.conversation-new,.conversation-unread{display:inline-block;padding:1px 8px;border-radius:999px;background:#f0b429;color:#3d2a00;font-size:12px;font-weight:800}',
      '.conversation-unread{margin-left:8px;vertical-align:middle}',
      '.conversation-toggle.has-unread{background:#fff3c4!important;border-color:#f0b429!important;color:#5c3b00!important;font-weight:800}',
      '.conversation-message.unread{border-color:#f0b429!important;background:#fffaeb!important}',
      '.conversation-message.theirs.from-teacher strong{color:#1d4ed8}',
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
      '.message-picker{display:flex;flex-direction:column;gap:6px;margin:8px 0 12px}',
      '.message-picker select{max-width:100%}',
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
    function toggleText() {
      if (unread && !marked) return '💬 ' + unread + ' new ' + (unread === 1 ? 'message' : 'messages') + ' from your teacher';
      return messages.length ? '💬 Read messages · ' + messages.length : '💬 Message your teacher';
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
    if (key && threadNotices[key]) { feedback.textContent = threadNotices[key]; delete threadNotices[key]; }
    messages.slice(-30).forEach(function (message) {
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
            if (type && player.canPlayType && !player.canPlayType(type)) feedback.textContent = cantPlay;
            player.onerror = function () { feedback.textContent = cantPlay; };
            player.src = audio.voiceDataURL;
            listen.replaceWith(player);
            var playing = player.play && player.play();
            if (playing && playing.catch) playing.catch(function () { /* the player controls are there to press */ });
          } catch (error) {
            feedback.textContent = error.message || 'This voice note could not play.';
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
    var note = el('textarea'); note.maxLength = 500; note.placeholder = role === 'teacher' ? 'Write a kind note or correction' : 'Ask your teacher a question';
    note.setAttribute('aria-label', 'Write a message');
    var actions = el('div', null, 'conversation-actions');
    var sendText = el('button', 'Send message', 'conversation-send'); sendText.type = 'button';
    var record = el('button', '🎙 Record voice note', 'conversation-record sec'); record.type = 'button';
    // Recording panel: pulsing red dot, time left, live sound meter, cancel.
    var panel = el('div', null, 'conversation-recording'); panel.hidden = true;
    var recLabel = el('span', 'Recording', 'rec-label'), recTime = el('span', recClock(0), 'rec-time');
    recTime.setAttribute('role', 'timer');
    var meter = el('span', null, 'rec-meter'), meterBar = el('span');
    meter.append(meterBar); meter.setAttribute('aria-hidden', 'true');
    var cancel = el('button', 'Cancel', 'sec conversation-cancel'); cancel.type = 'button';
    panel.append(el('span', null, 'rec-dot'), recLabel, recTime, meter, cancel);
    async function send(payload, notice) {
      await options.send(Object.assign({ action: 'comment' }, payload));
      if (key) { openThreads[key] = true; threadNotices[key] = notice; } // the page may redraw this box
      if (options.onSent) await options.onSent();
    }
    sendText.onclick = async function () {
      if (!note.value.trim()) { feedback.textContent = 'Type a message, or record a voice note, before sending.'; note.focus(); return; }
      sendText.disabled = true;
      try { await send({ text: note.value.trim() }, 'Message sent.'); note.value = ''; feedback.textContent = 'Message sent.'; }
      catch (error) { feedback.textContent = error.message || 'Message could not be sent.'; }
      finally { sendText.disabled = false; }
    };
    var rec = null;
    function stopRecording(cancelled) {
      if (!rec) return;
      rec.cancelled = rec.cancelled || !!cancelled;
      if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    }
    cancel.onclick = function () { stopRecording(true); };
    record.onclick = async function () {
      if (rec) { stopRecording(false); return; }
      if (!root.navigator?.mediaDevices?.getUserMedia || !root.MediaRecorder) {
        feedback.textContent = 'Voice notes are not supported in this browser. You can send a written message.'; return;
      }
      record.disabled = true; feedback.textContent = 'Starting the microphone…';
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
          record.dataset.recording = 'false'; record.textContent = '🎙 Record voice note'; sendText.disabled = false;
          if (r.cancelled) { feedback.textContent = 'Recording cancelled. Nothing was sent.'; record.disabled = false; return; }
          record.disabled = true;
          try {
            if (Date.now() - r.started < 700) throw new Error('That was too short. Press Record, speak, then press Stop & send.');
            var type = audioType(recorder.mimeType || (r.chunks[0] && r.chunks[0].type) || mime || 'audio/webm');
            var blob = new Blob(r.chunks, { type: type });
            if (!blob.size) throw new Error('Nothing was recorded. Check your microphone and try again.');
            if (blob.size > VOICE_MAX_BYTES) throw new Error('That recording was too large. Please try a shorter note.');
            feedback.textContent = 'Sending voice note…';
            var voiceDataURL = await new Promise(function (resolve, reject) {
              var reader = new FileReader(); reader.onload = function () { resolve(reader.result); }; reader.onerror = reject; reader.readAsDataURL(blob);
            });
            var typed = note.value.trim();
            await send(typed ? { voiceDataURL: voiceDataURL, text: typed } : { voiceDataURL: voiceDataURL }, 'Voice note sent.');
            note.value = ''; feedback.textContent = 'Voice note sent.';
          } catch (error) { feedback.textContent = error.message || 'Voice note could not be sent.'; }
          finally { record.disabled = false; }
        };
        recorder.start(1000);
        r.started = Date.now();
        record.dataset.recording = 'true'; record.disabled = false; record.textContent = '■ Stop & send'; sendText.disabled = true;
        panel.hidden = false; recTime.textContent = recClock(0);
        feedback.textContent = 'Recording now. Speak your note, then press Stop & send.';
        r.stopMeter = startMeter(stream, function (level) {
          if (level > r.peak) r.peak = level;
          meterBar.style.transform = 'scaleX(' + level.toFixed(3) + ')';
        });
        meter.hidden = !r.stopMeter;
        r.tick = setInterval(function () {
          if (!box.isConnected) { stopRecording(true); return; } // the page re-drew: never leave the mic on
          var elapsed = Date.now() - r.started;
          recTime.textContent = recClock(elapsed);
          if (r.stopMeter && elapsed > 3000 && r.peak < 0.03)
            feedback.textContent = 'We can’t hear anything yet. Check that your microphone is on and not muted.';
          if (elapsed >= VOICE_MAX_MS && recorder.state === 'recording') recorder.stop();
        }, 250);
      } catch (error) {
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        rec = null; panel.hidden = true;
        record.dataset.recording = 'false'; record.textContent = '🎙 Record voice note'; record.disabled = false; sendText.disabled = false;
        feedback.textContent = error.name === 'NotAllowedError' ? 'Allow microphone access to record a note.' : 'Could not start recording. You can send a written message.';
      }
    };
    actions.append(sendText, record); content.append(note, actions, panel, feedback); box.append(content);
    return box;
  }
  root.HomeworkCommon = { API: API, TYPES: TYPES, STATUS: STATUS, ACTIVITY_URLS: ACTIVITY_URLS,
    isStagingRuntime: function () { return isStagingRuntime; }, isAllowedRuntime: function () { return isStagingRuntime || isLiveRuntime; }, activityUrl: activityUrl, el: el, call: call, when: when,
    dueFromInput: dueFromInput, assignedFromInput: assignedFromInput, inputFromDue: inputFromDue, conversation: conversation,
    unreadCount: unreadCount, teacherStatusCounts: teacherStatusCounts };
  if (root.document && root.document.head) addConversationStyles(); // "N new" tags can show before any notes box
  if (typeof module === 'object' && module.exports) module.exports = root.HomeworkCommon;
})(typeof window !== 'undefined' ? window : globalThis);
