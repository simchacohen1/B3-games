/* Chazara AI Practice — student side (#688).
 * Adds an "AI Practice" panel to the existing Chazara chart. It never touches
 * the chart's own recordings, counts, events or points: AI Practice audio is sent
 * once to the checker and is not saved anywhere, and no points are requested.
 * The checker's result is shown as-is; nothing in the browser can change it.
 */
(function () {
  'use strict';
  var ENDPOINT = window.CHAZARA_AI_ENDPOINT || 'https://us-central1-b3-games.cloudfunctions.net/chazaraAiPractice';
  var MIN_SEGMENT_MS = 3000, MAX_SEGMENT_MS = 60000;
  var OUTCOME_EMOJI = { excellent: '🌟', almost: '💪', try_again: '📖', unclear: '🎧', unavailable: '⏳' };
  var PREVIEW_ITEMS = [{
    id: 'preview_ai', title: 'Sample AI Practice', mode: 'ai', perek: 18, from: 1, to: 2,
    pesukim: [
      { id: '18_1', perek: 18, posuk: 1, label: 'פרק יח · פסוק א', hebrew: 'וַיֵּרָא אֵלָיו ה׳ בְּאֵלֹנֵי מַמְרֵא וְהוּא יֹשֵׁב פֶּתַח הָאֹהֶל כְּחֹם הַיּוֹם' },
      { id: '18_2', perek: 18, posuk: 2, label: 'פרק יח · פסוק ב', hebrew: 'וַיִּשָּׂא עֵינָיו וַיַּרְא וְהִנֵּה שְׁלֹשָׁה אֲנָשִׁים נִצָּבִים עָלָיו וַיַּרְא וַיָּרָץ לִקְרָאתָם מִפֶּתַח הָאֹהֶל וַיִּשְׁתַּחוּ אָרְצָה' }
    ],
    progress: null
  }];
  var PREVIEW_RESULTS = {
    excellent: { outcome: 'excellent', title: 'Excellent!', message: 'Excellent job! You read and explained the pasuk beautifully!', tips: [], pesukim: [] },
    almost: { outcome: 'almost', title: 'Almost There!', message: "Great effort! You're getting closer. Practice a little more and try again!", tips: ['Next time, explain what the pasuk means too.'], pesukim: [] },
    try_again: { outcome: 'try_again', title: "Let's Try Again!", message: "Let's try again! Remember to read the pasuk and explain what it means.", tips: ['Read the Hebrew words first, then say what they mean.'], pesukim: [] },
    unclear: { outcome: 'unclear', title: "Couldn't Hear Clearly", message: "I couldn't hear you clearly. Please try recording again!", tips: ['Try a quieter spot, away from other voices.'], pesukim: [] }
  };

  var state = { preview: false, items: [], aiEnabled: false, panel: null };
  var session = null; // the open practice screen

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function hebNumSafe(n) { try { return typeof hebNum === 'function' ? hebNum(n) : String(n); } catch (_) { return String(n); } }
  function rangeLabel(a) {
    return 'פרק ' + hebNumSafe(a.perek) + ' · ' + (a.to > a.from ? 'פסוקים ' + hebNumSafe(a.from) + '–' + hebNumSafe(a.to) : 'פסוק ' + hebNumSafe(a.from));
  }
  function isPreview() {
    try { return (typeof teacherPreview !== 'undefined' && teacherPreview) || !!(window.B3Guest && window.B3Guest.isGuest()); } catch (_) { return false; }
  }
  function currentSid() { try { return typeof sid !== 'undefined' ? sid : ''; } catch (_) { return ''; } }

  async function idToken() {
    if (window.B3GameGateAuthReady) { try { await Promise.race([window.B3GameGateAuthReady, new Promise(function (r) { setTimeout(r, 8000); })]); } catch (_) {} }
    var user = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!user) throw Object.assign(new Error('Please sign in again from the Fun Torah Tools home page.'), { status: 401 });
    return user.getIdToken();
  }

  async function api(body, timeoutMs) {
    var token = await idToken();
    var isForm = body instanceof FormData;
    var res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: isForm ? { Authorization: 'Bearer ' + token } : { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs || 20000) : undefined
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
    return data;
  }

  // ---------- panel on the chart page ----------

  function renderPanel() {
    var ai = state.items.filter(function (a) { return a.mode === 'ai'; });
    var regular = state.items.filter(function (a) { return a.mode !== 'ai'; });
    if (!state.panel) {
      state.panel = el('section', { class: 'aip-panel', id: 'aiPracticePanel', 'aria-labelledby': 'aipHeading' });
      var app = document.getElementById('app');
      var anchor = app && app.querySelector('.record-help');
      if (anchor && anchor.nextSibling) app.insertBefore(state.panel, anchor.nextSibling); else if (app) app.appendChild(state.panel);
    }
    var p = state.panel;
    p.innerHTML = '';
    if (!ai.length && !regular.length) { p.hidden = true; return; }
    p.hidden = false;
    if (ai.length) {
      p.appendChild(el('h2', { id: 'aipHeading' }, ['🤖 AI Practice ', el('span', { class: 'aip-badge', text: 'Practice on your own' })]));
      p.appendChild(el('p', { class: 'aip-sub', text: 'Read the pasuk, say what it means, and find out right away how you did. You can try as many times as you like. This is just for practice — no points.' }));
      if (!state.aiEnabled && !state.preview) p.appendChild(el('p', { class: 'aip-sub', text: '⏳ AI Practice is not switched on yet. Ask your teacher.' }));
      var list = el('div', { class: 'aip-list' });
      ai.forEach(function (a) {
        var pr = a.progress;
        var progress = pr && pr.excellent ? '⭐ You got Excellent! Practice again anytime.' : pr && pr.attempts ? '🔁 Practiced ' + pr.attempts + (pr.attempts === 1 ? ' time' : ' times') : '✨ New';
        list.appendChild(el('button', { type: 'button', class: 'aip-card', 'data-aip-id': a.id, onclick: function () { openPractice(a); } }, [
          el('span', { class: 'aip-card-title', text: a.title }),
          el('span', { class: 'aip-card-ref', text: rangeLabel(a), lang: 'he' }),
          el('span', { class: 'aip-card-progress', text: progress }),
          el('span', { class: 'aip-card-go', text: '🎙️ Start Practice' })
        ]));
      });
      p.appendChild(list);
    }
    if (regular.length) {
      var box = el('div', { class: ai.length ? 'aip-regular' : '' });
      box.appendChild(el('h2', ai.length ? {} : { id: 'aipHeading' }, ['📋 Chazara from your teacher ', el('span', { class: 'aip-badge regular', text: 'Teacher listens' })]));
      box.appendChild(el('p', { class: 'aip-sub', text: 'Do these pesukim in your Chazara chart below. Record them so your teacher can listen.' }));
      regular.forEach(function (a) {
        var item = el('div', { class: 'aip-regular-item' }, [el('b', { text: a.title + ' — ' + rangeLabel(a) })]);
        a.pesukim.forEach(function (ps) { if (ps.hebrew) item.appendChild(el('div', { class: 'aip-hebrew', lang: 'he', text: ps.hebrew })); });
        box.appendChild(item);
      });
      p.appendChild(box);
    }
  }

  async function load() {
    state.preview = isPreview();
    if (state.preview) { state.items = PREVIEW_ITEMS; state.aiEnabled = true; renderPanel(); return; }
    try {
      var data = await api({ action: 'studentList' }, 15000);
      state.items = Array.isArray(data.assignments) ? data.assignments : [];
      state.aiEnabled = !!data.aiEnabled;
      renderPanel();
    } catch (e) {
      // AI Practice is optional: if it cannot load, the chart works exactly as before.
      console.warn('AI Practice list unavailable:', e && e.message);
    }
  }

  // ---------- practice screen ----------

  function preferredMime() {
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < types.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) return types[i];
    return '';
  }
  function extFor(m) { m = String(m || ''); return m.indexOf('mp4') >= 0 ? 'mp4' : m.indexOf('ogg') >= 0 ? 'ogg' : 'webm'; }
  function newRequestId() {
    var a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function openPractice(a) {
    try { if (typeof recorderState !== 'undefined' && recorderState) { alert('Finish the Chazara recording in your chart first.'); return; } } catch (_) {}
    if (session) return;
    var overlay = el('div', { class: 'aip-overlay' });
    var dialog = el('div', { class: 'aip-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'aipTitle' });
    var live = el('div', { class: 'aip-sr', 'aria-live': 'polite', id: 'aipLive' });
    var body = el('div', { class: 'aip-body' });
    var close = el('button', { type: 'button', class: 'aip-close', 'aria-label': 'Close AI Practice', text: '✕', onclick: function () { closePractice(); } });
    dialog.append(close, el('h2', { id: 'aipTitle', text: '🤖 ' + a.title }), live, body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    session = { a: a, overlay: overlay, dialog: dialog, body: body, live: live, close: close, index: 0, blobs: [], stream: null, recorder: null, chunks: [], segStart: 0, timer: null, raf: null, audioCtx: null, analyser: null, mime: preferredMime(), busy: false, requestId: null, lastFocus: document.activeElement };
    overlay.addEventListener('keydown', onKeydown);
    document.documentElement.style.overflow = 'hidden';
    renderReady(); // focuses the big Start Recording button
  }

  function onKeydown(e) {
    if (!session) return;
    if (e.key === 'Escape' && !session.recorder && !session.busy) { e.preventDefault(); closePractice(); return; }
    if (e.key === 'Tab') { // keep focus inside the dialog
      var f = session.dialog.querySelectorAll('button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function say(text) { if (session) { session.live.textContent = ''; setTimeout(function () { if (session) session.live.textContent = text; }, 30); } }

  function stopAll() {
    if (!session) return;
    clearInterval(session.timer); session.timer = null;
    if (session.raf) cancelAnimationFrame(session.raf); session.raf = null;
    try { if (session.recorder && session.recorder.state !== 'inactive') { session.recorder.onstop = null; session.recorder.stop(); } } catch (_) {}
    session.recorder = null;
    try { session.stream && session.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
    session.stream = null;
    try { session.audioCtx && session.audioCtx.close(); } catch (_) {}
    session.audioCtx = null;
  }

  function closePractice() {
    if (!session) return;
    if (session.busy) return;
    if (session.recorder && !confirm('Stop recording and close?')) return;
    stopAll();
    var back = session.lastFocus;
    session.overlay.remove();
    document.documentElement.style.overflow = '';
    session = null;
    if (back && back.focus) try { back.focus(); } catch (_) {}
    if (!state.preview) load();
  }

  function stepsList() {
    return el('ol', { class: 'aip-steps' }, [
      el('li', {}, [el('span', { text: '1' }), '📖 Read the pasuk in Hebrew']),
      el('li', {}, [el('span', { text: '2' }), '💬 Say what it means (English or Yiddish)'])
    ]);
  }
  function progressDots() {
    var n = session.a.pesukim.length;
    if (n < 2) return null;
    var row = el('div', { class: 'aip-progress', 'aria-hidden': 'true' });
    for (var i = 0; i < n; i++) row.appendChild(el('span', { class: 'aip-dot' + (i < session.index ? ' done' : i === session.index ? ' now' : '') }));
    return row;
  }
  function pasukCard(ps, idx, total) {
    return el('div', { class: 'aip-pasuk' }, [
      el('div', { class: 'aip-label', lang: 'he', text: (total > 1 ? '(' + (idx + 1) + '/' + total + ') ' : '') + ps.label }),
      el('div', { class: 'aip-hebrew', lang: 'he', dir: 'rtl', text: ps.hebrew || '' })
    ]);
  }
  function micStatus(kind, text) { return el('div', { class: 'aip-mic ' + kind, role: 'status' }, [el('span', { class: 'aip-mic-dot', 'aria-hidden': 'true' }), el('span', { text: text })]); }

  function renderReady(note) {
    var s = session, b = s.body, total = s.a.pesukim.length;
    b.innerHTML = '';
    b.appendChild(stepsList());
    if (total > 1) b.appendChild(el('p', { class: 'aip-sub', text: 'There are ' + total + ' pesukim. Do them one at a time — press "Next Pasuk" after each one.' }));
    s.a.pesukim.forEach(function (ps, i) { b.appendChild(pasukCard(ps, i, total)); });
    b.appendChild(micStatus('', 'Microphone is off'));
    if (note) b.appendChild(el('p', { class: 'aip-note', text: note }));
    var start = el('button', { type: 'button', class: 'aip-btn rec big-rec', text: '🎙️ Start Recording', onclick: startRecording });
    b.appendChild(el('div', { class: 'aip-actions' }, [start]));
    start.focus();
  }

  async function startRecording() {
    var s = session;
    if (!s || s.recorder) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      renderReady('Recording does not work on this browser. Please try another device.'); return;
    }
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      s.body.innerHTML = '';
      s.body.append(micStatus('blocked', 'The microphone is blocked'),
        el('p', { class: 'aip-note', text: 'Please allow the microphone (tap the 🔒 or 🎙️ next to the web address), then try again.' }),
        el('div', { class: 'aip-actions' }, [el('button', { type: 'button', class: 'aip-btn next', text: 'Try Again', onclick: function () { renderReady(); } })]));
      say('The microphone is blocked.');
      return;
    }
    if (!session) { try { s.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {} return; }
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      s.audioCtx = new Ctx();
      s.analyser = s.audioCtx.createAnalyser(); s.analyser.fftSize = 512;
      s.audioCtx.createMediaStreamSource(s.stream).connect(s.analyser);
    } catch (_) { s.analyser = null; }
    s.index = 0; s.blobs = []; s.requestId = newRequestId();
    beginSegment();
  }

  function beginSegment() {
    var s = session;
    s.chunks = [];
    s.recorder = new MediaRecorder(s.stream, s.mime ? { mimeType: s.mime } : undefined);
    s.recorder.ondataavailable = function (e) { if (e.data && e.data.size) s.chunks.push(e.data); };
    s.recorder.start(250);
    s.segStart = performance.now();
    renderRecording();
    say('Recording pasuk ' + (s.index + 1) + '. Read it, then say what it means.');
  }

  function renderRecording(note) {
    var s = session, b = s.body, total = s.a.pesukim.length, last = s.index === total - 1;
    b.innerHTML = '';
    var dots = progressDots(); if (dots) b.appendChild(dots);
    b.appendChild(pasukCard(s.a.pesukim[s.index], s.index, total));
    b.appendChild(micStatus('on', 'Recording — read, then explain'));
    var meter = el('div', { class: 'aip-meter', 'aria-hidden': 'true' });
    for (var i = 0; i < 12; i++) meter.appendChild(el('i'));
    var timer = el('div', { class: 'aip-timer', text: '0:00' });
    b.append(meter, timer, el('p', { class: 'aip-note', text: note || '' }));
    var main = el('button', { type: 'button', class: 'aip-btn ' + (last ? 'finish' : 'next'), text: last ? '✅ Finish Recording' : 'Next Pasuk ➜', onclick: function () { endSegment(false); } });
    var restart = el('button', { type: 'button', class: 'aip-btn soft', text: '↺ Start over', onclick: function () { stopAll(); renderReady(); } });
    b.appendChild(el('div', { class: 'aip-actions' }, [main, restart]));
    main.focus();
    clearInterval(s.timer);
    s.timer = setInterval(function () {
      var ms = performance.now() - s.segStart, sec = Math.floor(ms / 1000);
      timer.textContent = Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2);
      if (ms >= MAX_SEGMENT_MS) { say('Time is up for this pasuk.'); endSegment(true); }
    }, 250);
    var bars = meter.querySelectorAll('i'), buf = s.analyser ? new Uint8Array(s.analyser.fftSize) : null;
    (function draw() {
      if (!session || !s.recorder || !buf) return;
      s.analyser.getByteTimeDomainData(buf);
      var sum = 0; for (var k = 0; k < buf.length; k++) { var v = (buf[k] - 128) / 128; sum += v * v; }
      var level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
      for (var j = 0; j < bars.length; j++) bars[j].style.height = Math.max(6, Math.round(36 * level * (0.55 + 0.45 * Math.sin((j + 1) * 1.7 + performance.now() / 160)))) + 'px';
      s.raf = requestAnimationFrame(draw);
    })();
  }

  function endSegment(forced) {
    forced = forced === true;
    var s = session;
    if (!s || !s.recorder) return;
    var ms = performance.now() - s.segStart;
    if (!forced && ms < MIN_SEGMENT_MS) { renderRecordingNote('Keep going! Read the whole pasuk and say what it means.'); return; }
    var rec = s.recorder;
    clearInterval(s.timer); s.timer = null;
    rec.onstop = function () {
      s.blobs[s.index] = new Blob(s.chunks, { type: rec.mimeType || s.mime || 'audio/webm' });
      s.recorder = null;
      if (s.index < s.a.pesukim.length - 1) { s.index++; beginSegment(); }
      else { stopAll(); submit(); }
    };
    rec.stop();
  }
  function renderRecordingNote(text) { var n = session && session.body.querySelector('.aip-note'); if (n) n.textContent = text; say(text); }

  function renderChecking() {
    var b = session.body;
    b.innerHTML = '';
    b.appendChild(el('div', { class: 'aip-checking', role: 'status' }, [
      el('div', { class: 'aip-books', 'aria-hidden': 'true' }, [el('span', { text: '📖' }), el('span', { text: '⭐' }), el('span', { text: '📖' })]),
      el('h3', { text: 'Checking your Chazara…' }),
      el('p', { class: 'aip-sub', text: 'Listening to your reading and your explanation.' })
    ]));
    say('Checking your Chazara.');
  }

  async function submit() {
    var s = session;
    s.busy = true; s.close.disabled = true;
    renderChecking();
    var result;
    try {
      if (state.preview) {
        await new Promise(function (r) { setTimeout(r, 1800); });
        s.busy = false; s.close.disabled = false;
        return renderPreviewPicker();
      }
      var form = new FormData();
      form.append('action', 'evaluate');
      form.append('assignmentId', s.a.id);
      form.append('requestId', s.requestId);
      s.blobs.forEach(function (blob, i) { form.append('audio' + i, blob, 'pasuk' + i + '.' + extFor(blob.type)); });
      result = await api(form, 100000);
    } catch (e) {
      result = e && e.status === 429 || (e && e.status >= 400 && e.status < 500)
        ? { outcome: 'unavailable', title: 'One moment…', message: (e && e.message) || 'Please try again.', tips: [], pesukim: [], canResend: e && e.status === 429 }
        : { outcome: 'unavailable', title: 'Taking a short break', message: 'The checker could not answer right now. Your recording is still here — press "Check Again".', tips: [], pesukim: [], canResend: true };
    }
    if (!session) return;
    s.busy = false; s.close.disabled = false;
    renderResult(result);
  }

  function renderPreviewPicker() {
    var b = session.body;
    b.innerHTML = '';
    b.append(el('h3', { text: 'Preview: nothing was sent or saved.' }),
      el('p', { class: 'aip-sub', text: 'Choose a result to see what a student would see:' }));
    var row = el('div', { class: 'aip-actions' });
    Object.keys(PREVIEW_RESULTS).forEach(function (k) {
      row.appendChild(el('button', { type: 'button', class: 'aip-btn soft', text: PREVIEW_RESULTS[k].title, onclick: function () { renderResult(PREVIEW_RESULTS[k]); } }));
    });
    b.appendChild(row);
    row.querySelector('button').focus();
  }

  function confetti() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var box = el('div', { class: 'aip-confetti', 'aria-hidden': 'true' });
    var colors = ['#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#ef4444'];
    for (var i = 0; i < 70; i++) {
      var c = el('i');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = (Math.random() * 0.8) + 's';
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3800);
  }

  function renderResult(r) {
    var s = session, b = s.body, outcome = r.outcome || 'unavailable';
    b.innerHTML = '';
    var card = el('div', { class: 'aip-result ' + outcome, role: 'status' }, [
      el('div', { class: 'aip-emoji', 'aria-hidden': 'true', text: OUTCOME_EMOJI[outcome] || '⭐' }),
      el('h3', { text: r.title || '' }),
      el('p', { text: r.message || '' })
    ]);
    var stars = (r.pesukim || []).filter(function (p) { return p && p.status; });
    if (stars.length > 1) {
      var row = el('div', { class: 'aip-stars' });
      stars.forEach(function (p) { row.appendChild(el('span', { lang: 'he', text: (p.status === 'great' ? '⭐ ' : '📖 ') + (p.label || '') })); });
      card.appendChild(row);
    }
    if (r.tips && r.tips.length) {
      var tips = el('ul', { class: 'aip-tips' });
      r.tips.forEach(function (t) { tips.appendChild(el('li', { text: '💡 ' + t })); });
      card.appendChild(tips);
    }
    b.appendChild(card);
    var actions = el('div', { class: 'aip-actions' });
    if (r.canResend && s.blobs.length === s.a.pesukim.length) actions.appendChild(el('button', { type: 'button', class: 'aip-btn finish', text: '🔄 Check Again', onclick: submit }));
    actions.appendChild(el('button', { type: 'button', class: 'aip-btn ' + (outcome === 'excellent' ? 'soft' : 'rec'), text: outcome === 'excellent' ? '🎙️ Practice Again' : '🎙️ Try Again', onclick: function () { renderReady(); } }));
    actions.appendChild(el('button', { type: 'button', class: 'aip-btn ' + (outcome === 'excellent' ? 'finish' : 'soft'), text: 'Done', onclick: closePractice }));
    b.appendChild(actions);
    say((r.title || '') + ' ' + (r.message || ''));
    actions.querySelector('button').focus();
    if (outcome === 'excellent') confetti();
  }

  // Wait for the chart page to finish signing the student in, then load once.
  function whenReady(tries) {
    var app = document.getElementById('app');
    if (currentSid() && app && !app.classList.contains('hidden')) return load();
    if (tries > 150) return;
    setTimeout(function () { whenReady(tries + 1); }, 100);
  }
  window.ChazaraAiPractice = { reload: load, _state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { whenReady(0); }); else whenReady(0);
})();
