/* Homework Portal browser helpers (shared by student.html and teacher.html). */
(function (root) {
  'use strict';
  var STAGING_PROJECT = 'fun-torah-tools-staging';
  var STAGING_HOST = 'fun-torah-tools-staging.web.app';
  var STAGING_PREVIEW_HOST = /^fun-torah-tools-staging--homework-406-preview-[a-z0-9]+\.web\.app$/;
  var projectId = root.B3_FIREBASE_CONFIG && root.B3_FIREBASE_CONFIG.projectId;
  var host = root.location && root.location.hostname ? root.location.hostname.toLowerCase() : '';
  var localPreview = /^(localhost|127\.0\.0\.1)$/.test(host) &&
    root.location.search.indexOf('local-staging=1') !== -1;
  var isStagingRuntime = projectId === STAGING_PROJECT &&
    (host === STAGING_HOST || STAGING_PREVIEW_HOST.test(host) || localPreview);
  var API = isStagingRuntime
    ? (localPreview && /^http:\/\/(localhost|127\.0\.0\.1):5001\//.test(root.B3_HOMEWORK_API_URL || '')
      ? root.B3_HOMEWORK_API_URL
      : 'https://us-central1-' + STAGING_PROJECT + '.cloudfunctions.net/homeworkPortal')
    : '';
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
    if (!API) throw new Error('This assignment preview is locked to the isolated staging site.');
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
  function conversation(options) {
    var box = el('section', null, 'home-conversation');
    var messages = options.messages || [];
    var heading = options.role === 'teacher' ? 'Notes with this student' : 'Notes with your teacher';
    box.append(el('h4', heading));
    var toggle = null, content = el('div', null, 'conversation-content');
    if (options.collapsed) {
      toggle = el('button', (messages.length ? '💬 Read messages' : '💬 Message your teacher') + (messages.length ? ' · ' + messages.length : ''), 'conversation-toggle sec');
      toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
      toggle.onclick = function () { var open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(open)); content.hidden = !open; };
      box.append(toggle); content.hidden = true;
    }
    var history = el('div', null, 'conversation-history');
    messages.slice(-30).forEach(function (message) {
      var item = el('article', null, 'conversation-message ' + (message.role === options.role ? 'mine' : 'theirs'));
      item.append(el('strong', message.role === 'teacher' ? 'Teacher' : 'Student'));
      if (message.text) item.append(el('p', message.text));
      if (message.voice) {
        var listen = el('button', '▶ Listen to voice note', 'conversation-listen'); listen.type = 'button';
        listen.onclick = async function () {
          listen.disabled = true;
          try { var audio = await options.send({ action: 'voiceRead', messageId: message.id });
            var player = el('audio'); player.controls = true; player.preload = 'none'; player.src = audio.voiceDataURL;
            listen.replaceWith(player);
          } catch (error) { feedback.textContent = error.message || 'This voice note could not play.'; }
          finally { listen.disabled = false; }
        };
        item.append(listen);
      }
      history.append(item);
    });
    if (!(options.messages || []).length) history.append(el('p', 'No notes yet. Send a message if you have a question.', 'muted'));
    content.append(history);
    var note = el('textarea'); note.maxLength = 500; note.placeholder = options.role === 'teacher' ? 'Write a kind note or correction' : 'Ask your teacher a question';
    note.setAttribute('aria-label', 'Write a message');
    var actions = el('div', null, 'conversation-actions');
    var sendText = el('button', 'Send message', 'conversation-send'); sendText.type = 'button';
    var record = el('button', '🎙 Record voice note', 'conversation-record sec'); record.type = 'button';
    var feedback = el('p', null, 'conversation-feedback'); feedback.setAttribute('aria-live', 'polite');
    async function send(payload) {
      await options.send(Object.assign({ action: 'comment' }, payload));
      if (options.onSent) await options.onSent();
    }
    sendText.onclick = async function () {
      if (!note.value.trim()) { feedback.textContent = 'Write a message first.'; note.focus(); return; }
      sendText.disabled = true;
      try { await send({ text: note.value.trim() }); note.value = ''; feedback.textContent = 'Message sent.'; }
      catch (error) { feedback.textContent = error.message || 'Message could not be sent.'; }
      finally { sendText.disabled = false; }
    };
    record.onclick = async function () {
      if (record.dataset.recording === 'true') { record._recorder.stop(); return; }
      if (!root.navigator?.mediaDevices?.getUserMedia || !root.MediaRecorder) {
        feedback.textContent = 'Voice notes are not supported in this browser. You can send a written message.'; return;
      }
      record.disabled = true;
      var stream;
      try {
        stream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
        var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(function (type) {
          return !root.MediaRecorder.isTypeSupported || root.MediaRecorder.isTypeSupported(type);
        });
        var recorder = new root.MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [];
        record._recorder = recorder; record.dataset.recording = 'true'; record.disabled = false;
        record.textContent = '■ Stop & send'; feedback.textContent = 'Recording… up to 15 seconds.';
        recorder.ondataavailable = function (event) { if (event.data?.size) chunks.push(event.data); };
        recorder.onstop = async function () {
          clearTimeout(record._recordTimer); stream.getTracks().forEach(function (track) { track.stop(); });
          record.dataset.recording = 'false'; record.textContent = '🎙 Record voice note'; record.disabled = true;
          try {
            var blob = new Blob(chunks, { type: (recorder.mimeType || 'audio/webm').split(';')[0] });
            if (!blob.size || blob.size > 100000) throw new Error('That recording was too large. Please try a shorter note.');
            var voiceDataURL = await new Promise(function (resolve, reject) {
              var reader = new FileReader(); reader.onload = function () { resolve(reader.result); }; reader.onerror = reject; reader.readAsDataURL(blob);
            });
            await send({ voiceDataURL: voiceDataURL }); feedback.textContent = 'Voice note sent.';
          } catch (error) { feedback.textContent = error.message || 'Voice note could not be sent.'; }
          finally { record.disabled = false; }
        };
        record._recordTimer = setTimeout(function () { if (recorder.state === 'recording') recorder.stop(); }, 15000);
      } catch (error) {
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        record.dataset.recording = 'false'; record.disabled = false;
        feedback.textContent = error.name === 'NotAllowedError' ? 'Allow microphone access to record a note.' : 'Could not start recording. You can send a written message.';
      }
    };
    actions.append(sendText, record); content.append(note, actions, feedback); box.append(content);
    return box;
  }
  root.HomeworkCommon = { API: API, TYPES: TYPES, STATUS: STATUS, ACTIVITY_URLS: ACTIVITY_URLS,
    isStagingRuntime: function () { return isStagingRuntime; }, activityUrl: activityUrl, el: el, call: call, when: when,
    dueFromInput: dueFromInput, assignedFromInput: assignedFromInput, inputFromDue: inputFromDue, conversation: conversation,
    teacherStatusCounts: teacherStatusCounts };
  if (typeof module === 'object' && module.exports) module.exports = root.HomeworkCommon;
})(typeof window !== 'undefined' ? window : globalThis);
