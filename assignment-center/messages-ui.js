/* Chat panel shared by the student and teacher message pages.
 * HomeworkMessages.mount(container, { call(body) -> Promise, role: 'student'|'teacher', readOnly, title })
 * - Nothing is kept in localStorage: history lives on the server, so a shared computer keeps no messages.
 * - Every send has a client id, so a repeat tap or a retry after a dropped connection never duplicates. */
(function (root) {
  'use strict';
  var MAX_SECONDS = 60, MAX_BYTES = 480 * 1024; // server accepts 512 KB
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  function newId() {
    var a = new Uint8Array(9); (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return 'c' + Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function clock(ms) {
    var d = new Date(ms), now = new Date();
    var t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? t : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t;
  }
  function pickMime() {
    if (!root.MediaRecorder) return '';
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(function (m) { return MediaRecorder.isTypeSupported(m); }) || '';
  }
  function toBase64(blob) {
    return new Promise(function (ok, bad) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { bad(new Error('Could not read the recording.')); };
      r.readAsDataURL(blob);
    });
  }

  function mount(box, opts) {
    var call = opts.call, role = opts.role;
    var state = { messages: [], pending: [], oldest: null, hasMore: false, studentReadAt: 0, teacherReadAt: 0, replyTo: null, timer: null, busy: false };
    box.replaceChildren();
    var list = el('div', null, 'msg-list'); list.setAttribute('aria-live', 'polite');
    var more = el('button', 'Show older messages', 'msg-btn sec'); more.type = 'button'; more.style.display = 'none';
    var status = el('div', null, 'msg-status');
    var replyBar = el('div', null, 'msg-replybar'); replyBar.style.display = 'none';
    var compose = el('div', null, 'msg-compose');
    var input = el('textarea'); input.maxLength = 1000; input.rows = 2; input.placeholder = 'Type a message'; input.setAttribute('aria-label', 'Message');
    var send = el('button', 'Send', 'msg-btn');
    status.setAttribute('aria-live', 'polite'); send.type = 'button';
    var mic = el('button', '🎙 Voice', 'msg-btn sec'); mic.type = 'button';
    var recBox = el('div', null, 'msg-rec'); recBox.style.display = 'none';
    compose.append(input, send, mic);
    if (opts.readOnly) { compose.style.display = 'none'; status.textContent = 'Read-only view (safeguarding). You cannot send from here.'; }
    box.append(more, list, replyBar, recBox, compose, status);

    function say(m, bad) { status.textContent = m || ''; status.className = 'msg-status' + (bad ? ' bad' : ''); }

    function bubble(m, mine, pend) {
      var b = el('div', null, 'msg-bubble' + (mine ? ' mine' : '') + (pend && pend.failed ? ' failed' : ''));
      b.append(el('div', m.senderName || (mine ? 'You' : (role === 'student' ? 'Teacher' : 'Student')), 'msg-who'));
      if (m.replyTo) b.append(el('div', (m.replyTo.senderName || '') + ': ' + (m.replyTo.preview || 'message'), 'msg-quote'));
      if (m.type === 'voice') {
        if (m.voiceExpired) b.append(el('div', 'This voice message was removed after one year.', 'msg-muted'));
        else b.append(voicePlayer(m, pend));
      }
      if (m.text) b.append(el('div', m.text, 'msg-text'));
      var meta = el('div', null, 'msg-meta');
      var seenBy = mine ? (role === 'student' ? state.teacherReadAt : state.studentReadAt) : 0;
      var label = pend ? (pend.failed ? 'Not sent. ' : 'Sending… ') : clock(m.createdAt) + (mine ? (m.createdAt <= seenBy ? ' · Seen' : ' · Sent') : '');
      meta.append(el('span', label));
      if (pend && pend.failed) {
        var r = el('button', 'Try again', 'msg-link'); r.type = 'button'; r.onclick = function () { pend.failed = false; render(); transmit(pend); };
        var d = el('button', 'Delete', 'msg-link'); d.type = 'button'; d.onclick = function () { state.pending = state.pending.filter(function (p) { return p !== pend; }); render(); };
        meta.append(r, d);
      } else if (!pend) {
        var rep = el('button', 'Reply', 'msg-link'); rep.type = 'button'; rep.onclick = function () { setReply(m); };
        meta.append(rep);
        if (!mine) { var fl = el('button', 'Report', 'msg-link'); fl.type = 'button'; fl.onclick = function () { reportMsg(m); }; meta.append(fl); }
      }
      b.append(meta);
      return b;
    }
    function voicePlayer(m, pend) {
      var wrap = el('div', null, 'msg-voice');
      if (pend && pend.blobUrl) { var a0 = el('audio'); a0.controls = true; a0.src = pend.blobUrl; wrap.append(el('span', '🎙 ' + pend.seconds + 's '), a0); return wrap; }
      var btn = el('button', '▶ Play voice message (' + (m.voice ? m.voice.seconds : '?') + 's)', 'msg-btn sec'); btn.type = 'button';
      btn.onclick = async function () {
        btn.disabled = true; btn.textContent = 'Loading…';
        try {
          var v = await call({ action: 'voice', messageId: m.id });
          var bytes = Uint8Array.from(atob(v.data), function (c) { return c.charCodeAt(0); });
          var url = URL.createObjectURL(new Blob([bytes], { type: v.mime }));
          var au = el('audio'); au.controls = true; au.src = url; au.onended = function () { URL.revokeObjectURL(url); };
          wrap.replaceChildren(au); au.play().catch(function () {});
        } catch (e) { btn.disabled = false; btn.textContent = '▶ Play voice message'; say(e.message, true); }
      };
      wrap.append(btn); return wrap;
    }
    var lastSig = '';
    function render(force) {
      var sig = state.messages.map(function (m) { return m.id + (m.voiceExpired ? 'x' : ''); }).join(',') + '|' + state.pending.map(function (p) { return p.clientId + (p.failed ? 'f' : ''); }).join(',') + '|' + state.studentReadAt + '|' + state.teacherReadAt + '|' + state.hasMore;
      if (!force && sig === lastSig) return;
      lastSig = sig;
      var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      list.replaceChildren();
      if (!state.messages.length && !state.pending.length) list.append(el('p', 'No messages yet. Say hello!', 'msg-muted'));
      state.messages.forEach(function (m) { list.append(bubble(m, m.senderRole === role, null)); });
      state.pending.forEach(function (p) { list.append(bubble({ type: p.voice ? 'voice' : 'text', text: p.text, replyTo: p.replyQuote, senderName: 'You' }, true, p)); });
      more.style.display = state.hasMore ? '' : 'none';
      if (nearBottom || state.pending.length) list.scrollTop = list.scrollHeight;
    }
    function setReply(m) {
      state.replyTo = m;
      replyBar.replaceChildren(el('span', 'Replying to ' + (m.senderName || '') + ': ' + (m.type === 'voice' ? '🎙 Voice message' : m.text.slice(0, 60))));
      var x = el('button', '✕', 'msg-link'); x.type = 'button'; x.setAttribute('aria-label', 'Cancel reply'); x.onclick = function () { state.replyTo = null; replyBar.style.display = 'none'; };
      replyBar.append(x); replyBar.style.display = ''; input.focus();
    }
    async function reportMsg(m) {
      var why = root.prompt('Why are you reporting this message? (optional)'); if (why === null) return;
      try { await call({ action: 'report', messageId: m.id, reason: why }); say('Thank you. The school was told.'); } catch (e) { say(e.message, true); }
    }

    async function load(olderThan) {
      try {
        var body = { action: 'list', limit: 30 }; if (olderThan) body.before = olderThan;
        var r = await call(body);
        state.studentReadAt = r.studentReadAt; state.teacherReadAt = r.teacherReadAt;
        if (olderThan) { state.messages = r.messages.concat(state.messages); state.hasMore = r.hasMore; state.oldest = r.oldest || state.oldest; }
        else {
          // keep older pages already shown; replace the newest page
          var ids = {}; r.messages.forEach(function (m) { ids[m.id] = 1; });
          var firstNew = r.messages.length ? r.messages[0].id : null;
          var olderKept = firstNew ? state.messages.filter(function (m) { return m.id < firstNew; }) : [];
          state.messages = olderKept.concat(r.messages);
          if (!olderKept.length) { state.hasMore = r.hasMore; state.oldest = r.oldest; }
        }
        state.pending = state.pending.filter(function (p) { return !(p.done); });
        render(); say('');
        if (!olderThan && !opts.readOnly && document.visibilityState === 'visible' && r.unread > 0) call({ action: 'read' }).catch(function () {});
      } catch (e) { say(e.status === 401 || e.status === 403 ? e.message : 'Cannot reach the school server. Showing what is already here.', true); }
    }
    more.onclick = function () { if (state.oldest) load(state.oldest); };

    async function transmit(p) {
      if (p.sending) return; p.sending = true;
      try {
        var body = { action: 'send', clientId: p.clientId, text: p.text || '' };
        if (p.replyTo) body.replyTo = p.replyTo;
        if (p.voice) body.voice = { mime: p.voice.mime, seconds: p.seconds, data: await toBase64(p.voice.blob) };
        await call(body);
        p.done = true; if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
        state.pending = state.pending.filter(function (x) { return x !== p; });
        await load();
      } catch (e) { p.failed = true; say(e.message, true); render(); }
      finally { p.sending = false; }
    }
    function queue(p) {
      p.clientId = newId();
      if (state.replyTo) { p.replyTo = state.replyTo.id; p.replyQuote = { senderName: state.replyTo.senderName, preview: state.replyTo.type === 'voice' ? '🎙 Voice message' : state.replyTo.text.slice(0, 80) }; state.replyTo = null; replyBar.style.display = 'none'; }
      state.pending.push(p); render(); transmit(p);
    }
    send.onclick = function () { var t = input.value.trim(); if (!t) return; input.value = ''; queue({ text: t }); };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } });

    // ---- voice recorder ----
    var rec = null;
    mic.onclick = async function () {
      var mime = pickMime();
      if (!navigator.mediaDevices || !mime) { say('Voice recording is not available in this browser. You can still type.', true); return; }
      var stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { say(e && e.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it in your browser settings, then try again.' : 'No microphone was found.', true); return; }
      var chunks = [], t0 = Date.now(), mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 });
      rec = { mr: mr, cancelled: false };
      var total = 0;
      mr.ondataavailable = function (e) { if (e.data && e.data.size) { chunks.push(e.data); total += e.data.size; if (total >= MAX_BYTES && mr.state === 'recording') mr.stop(); } };
      mr.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); }); clearInterval(tick);
        compose.style.display = ''; recBox.style.display = 'none'; recBox.replaceChildren();
        if (rec.cancelled) { rec = null; return; }
        var seconds = Math.max(1, Math.min(MAX_SECONDS, Math.round((Date.now() - t0) / 1000)));
        var blob = new Blob(chunks, { type: mime.split(';')[0] }); rec = null;
        if (!blob.size) { say('Nothing was recorded. Try again.', true); return; }
        if (blob.size > MAX_BYTES + 32 * 1024) { say('That recording is too long to send. Please record a shorter message.', true); return; }
        review(blob, seconds);
      };
      mr.start(1000); compose.style.display = 'none'; recBox.style.display = '';
      var clock0 = el('strong', '🔴 Recording 0:00'); var stop = el('button', 'Stop', 'msg-btn'); var cancel = el('button', 'Cancel', 'msg-btn sec'); stop.type = cancel.type = 'button';
      recBox.replaceChildren(clock0, stop, cancel);
      var tick = setInterval(function () { var s = Math.round((Date.now() - t0) / 1000); clock0.textContent = '🔴 Recording ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); if (s >= MAX_SECONDS) mr.stop(); }, 250);
      stop.onclick = function () { mr.stop(); };
      cancel.onclick = function () { rec.cancelled = true; mr.stop(); };
    };
    function review(blob, seconds) { // listen before sending
      var url = URL.createObjectURL(blob), au = el('audio'); au.controls = true; au.src = url;
      var ok = el('button', 'Send voice message', 'msg-btn'), no = el('button', 'Throw away', 'msg-btn sec'); ok.type = no.type = 'button';
      compose.style.display = 'none'; recBox.style.display = ''; recBox.replaceChildren(el('span', 'Listen, then send (' + seconds + 's) '), au, ok, no);
      var done = function () { compose.style.display = ''; recBox.style.display = 'none'; recBox.replaceChildren(); };
      ok.onclick = function () { done(); queue({ voice: { blob: blob, mime: blob.type }, seconds: seconds, blobUrl: url }); };
      no.onclick = function () { URL.revokeObjectURL(url); done(); };
    }

    function poll() { if (document.visibilityState === 'visible') load(); }
    state.timer = setInterval(poll, 30000);
    document.addEventListener('visibilitychange', poll);
    load();
    return { reload: load, stop: function () { clearInterval(state.timer); }, state: state };
  }
  root.HomeworkMessages = { mount: mount, STYLE: '' };
})(window);
