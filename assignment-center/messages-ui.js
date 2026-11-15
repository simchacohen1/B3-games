/* Homework Messages tab (#647): WhatsApp-style one-on-one conversations.
 * Shared by student.html (contacts = my teachers; the principal only after writing first) and teacher.html
 * (contacts = my students, grouped by class). Needs homework-common.js first.
 *
 * HomeworkMessages.create({
 *   role: 'student' | 'teacher',
 *   call(body) -> Promise,            // sends one homeworkPortal request
 *   who(contact) -> body fields,      // which conversation: {teacherId} or {classId, studentId}
 *   onUnread(total),                  // keep a tab/button badge current
 *   onJump(assignmentId, contact),    // open a linked homework post
 * }) -> { root, show(), hide(), refreshUnread(), compose(link) }
 */
(function (root) {
  'use strict';
  var H = root.HomeworkCommon, el = H.el;
  var MAX_MS = 5 * 60 * 1000, SAFE_BYTES = 2800000, MIN_MS = 700;
  var POLL_UNREAD_MS = 60000, POLL_THREAD_MS = 20000;

  function addStyles() {
    if (document.getElementById('homework-dm-styles')) return;
    var s = document.createElement('style'); s.id = 'homework-dm-styles';
    s.textContent = [
      '.dm{background:#fff;border:1px solid #d6e4f5;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(26,39,68,.07)}',
      '.dm button{font:inherit;cursor:pointer}',
      '.dm-search{display:block;width:calc(100% - 24px);margin:12px;padding:10px 12px;border:1.5px solid #d6e4f5;border-radius:10px;font:inherit;font-size:15px}',
      '.dm-group h3{margin:0;padding:10px 16px;font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#5b7290;background:#f4f8fd;border-top:1px solid #e6eef8}',
      '.dm-contact{display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;border:0;border-bottom:1px solid #eef3f9;background:#fff;text-align:left;color:#1a2744;min-height:64px}',
      '.dm-contact:hover{background:#f7faff}',
      '.dm-avatar{flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:18px;color:#fff;background:#4a9eed}',
      '.dm-avatar.principal{background:#8b5cf6}.dm-avatar.student{background:#3dba6e}.dm-avatar.admin{background:#f5a623}',
      '.dm-mid{flex:1;min-width:0}',
      '.dm-name{display:flex;gap:6px;align-items:baseline;font-weight:800;font-size:16px}',
      '.dm-role{font-size:12px;font-weight:700;color:#7c5cd6}',
      '.dm-last{display:block;margin-top:2px;font-size:14px;color:#5b7290;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dm-contact.has-unread .dm-last{color:#1a2744;font-weight:700}',
      '.dm-side{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:12px;color:#5b7290}',
      '.dm-count{min-width:22px;height:22px;padding:0 7px;border-radius:11px;background:#25a55f;color:#fff;font-weight:800;font-size:12px;display:inline-grid;place-items:center}',
      '.dm-empty{padding:28px 18px;text-align:center;color:#5b7290}',
      '.dm-banner{margin:12px;padding:10px 12px;border-radius:10px;background:#fffae8;border:1.5px solid #f5cb3a;color:#5c3b00;font-weight:700;font-size:14px}',
      '.dm-head{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#1a2744;color:#fff}',
      '.dm-back{border:0;background:transparent;color:#fff;font-size:22px;padding:4px 10px;border-radius:8px;min-height:44px}',
      '.dm-head .dm-avatar{width:38px;height:38px;font-size:16px}',
      '.dm-head strong{display:block;font-size:17px}.dm-head small{opacity:.8;font-size:12px}',
      '.dm-thread{background:#efeae2;padding:12px;display:flex;flex-direction:column;gap:6px;height:min(58vh,520px);overflow-y:auto}',
      '.dm-msg{max-width:82%;padding:7px 10px 5px;border-radius:12px;background:#fff;box-shadow:0 1px 1px rgba(0,0,0,.08);align-self:flex-start;font-size:15px;line-height:1.4;word-wrap:break-word}',
      '.dm-msg.mine{align-self:flex-end;background:#d9fdd3}',
      '.dm-msg.new{box-shadow:0 0 0 2px #f0b429}',
      '.dm-msg p{margin:2px 0 0;white-space:pre-wrap}',
      '.dm-time{display:block;text-align:right;font-size:11px;color:#667781;margin-top:2px}',
      '.dm-link{display:flex;align-items:center;gap:6px;width:100%;margin:0 0 4px;padding:6px 8px;border:0;border-left:4px solid #4a9eed;border-radius:6px;background:rgba(74,158,237,.12);color:#1a3f80;font-size:13px;font-weight:800;text-align:left}',
      '.dm-msg.mine .dm-link{border-left-color:#25a55f;background:rgba(37,165,95,.12);color:#15673a}',
      '.dm-link:hover{text-decoration:underline}',
      '.dm-voice{display:flex;align-items:center;gap:8px;min-width:190px}',
      '.dm-play{flex:none;width:38px;height:38px;border-radius:50%;border:0;background:#25a55f;color:#fff;font-size:15px}',
      '.dm-msg:not(.mine) .dm-play{background:#4a9eed}',
      '.dm-bar{flex:1;height:5px;border-radius:3px;background:rgba(0,0,0,.12);overflow:hidden}',
      '.dm-bar span{display:block;height:100%;width:0;background:#25a55f}',
      '.dm-msg:not(.mine) .dm-bar span{background:#4a9eed}',
      '.dm-dur{font-size:12px;color:#667781;font-variant-numeric:tabular-nums}',
      '.dm-compose{background:#f0f2f5;padding:8px}',
      '.dm-chip{display:flex;align-items:center;gap:8px;margin:0 0 6px;padding:6px 8px;border-left:4px solid #4a9eed;border-radius:6px;background:#fff;font-size:13px;font-weight:700;color:#1a3f80}',
      '.dm-chip span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dm-chip button{border:0;background:transparent;font-size:16px;color:#5b7290;min-height:32px}',
      '.dm-row{display:flex;align-items:flex-end;gap:8px}',
      '.dm-row textarea{flex:1;min-width:0;resize:none;height:46px;min-height:0;margin:0;max-height:120px;padding:12px 14px;border:0;border-radius:23px;font:inherit;font-size:16px;background:#fff}',
      '.dm-round{flex:none;width:50px;height:50px;border-radius:50%;border:0;background:#25a55f;color:#fff;font-size:22px;display:grid;place-items:center}',
      '.dm-round:disabled{opacity:.6}',
      '.dm-rec{display:flex;align-items:center;gap:10px;min-height:50px}',
      '.dm-rec[hidden],.dm-row[hidden],.dm-chip[hidden]{display:none}',
      '.dm-cancel{flex:none;border:0;background:#fff;color:#c62828;border-radius:23px;padding:0 16px;height:46px;font-weight:800}',
      '.dm-recbox{flex:1;min-width:0;display:flex;align-items:center;gap:10px;background:#fff;border-radius:23px;height:46px;padding:0 14px;font-weight:800;color:#8a1c1c}',
      '.dm-dot{width:12px;height:12px;border-radius:50%;background:#e02424;flex:none;animation:dmPulse 1.2s ease-out infinite}',
      '@keyframes dmPulse{0%{opacity:1}50%{opacity:.35}100%{opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.dm-dot{animation:none}}',
      '.dm-clock{font-variant-numeric:tabular-nums}',
      '.dm-meter{flex:1;height:8px;border-radius:4px;background:#f7d4d4;overflow:hidden}',
      '.dm-meter span{display:block;height:100%;width:100%;background:linear-gradient(90deg,#16a34a,#eab308 70%,#e02424);transform-origin:left;transform:scaleX(0);transition:transform .08s linear}',
      '.dm-feedback{min-height:18px;margin:4px 6px 0;font-size:13px;color:#5b7290}',
      '.dm-feedback.err{color:#b42318}',
      '.dm-earlier{margin-top:14px}',
      '.dm-earlier>summary{cursor:pointer;font-weight:800;color:#5b7290;padding:8px 2px}',
      '.hw-flash{animation:hwFlash 2s ease-out}',
      '.dm-off .tab-messages,.dm-off .dm-about,.dm-off #dmBox,.dm-off .dm-hint{display:none!important}',
      '@keyframes hwFlash{0%,40%{box-shadow:0 0 0 4px #4a9eed}100%{box-shadow:none}}'
    ].join('\n');
    document.head.append(s);
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function mmss(ms) { var s = Math.max(0, Math.round((ms || 0) / 1000)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function shortTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    try {
      if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  }
  function fullTime(ts) { try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
  function kindLabel(kind) { return kind === 'principal' ? 'Principal' : kind === 'teacher' ? 'Teacher' : kind === 'admin' ? 'Staff' : ''; }
  function audioType(type) {
    type = String(type || '').split(';')[0].toLowerCase();
    if (/mp4|m4a|aac/.test(type)) return 'audio/mp4';
    if (/webm/.test(type)) return 'audio/webm';
    if (/ogg/.test(type)) return 'audio/ogg';
    if (/mpeg|mp3/.test(type)) return 'audio/mpeg';
    return type;
  }
  function startMeter(stream, onLevel) {
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC || !root.requestAnimationFrame) return null;
      var ctx = new AC(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 512; src.connect(an);
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
      var data = new Uint8Array(an.fftSize), frame = 0;
      (function draw() {
        an.getByteTimeDomainData(data);
        var sum = 0; for (var i = 0; i < data.length; i++) { var v = (data[i] - 128) / 128; sum += v * v; }
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
        frame = root.requestAnimationFrame(draw);
      })();
      return function () { root.cancelAnimationFrame(frame); try { src.disconnect(); } catch (e) {} if (ctx.close) ctx.close().catch(function () {}); };
    } catch (e) { return null; }
  }

  function create(opts) {
    addStyles();
    var role = opts.role;
    var box = el('div', null, 'dm'); box.id = 'dmMessages';
    var state = { groups: null, contact: null, messages: [], link: null, filter: '', unread: 0, visible: false, loading: false };
    var pollUnread = 0, pollThread = 0, rec = null, player = null;

    function setUnread(n) { state.unread = n; if (opts.onUnread) opts.onUnread(n); }
    function contactKey(c) { return (c.classId || '') + '/' + c.id; }
    function body(c, extra) { return Object.assign({}, opts.who(c), extra); }
    function allContacts() { return (state.groups || []).reduce(function (a, g) { return a.concat(g.contacts); }, []); }

    // ---------- contact list ----------
    function lastLine(c) {
      if (!c.lastAt) return role === 'student' ? kindLabel(c.kind) : 'No messages yet';
      var who = c.lastRole === role ? 'You: ' : '';
      var what = c.lastVoice ? '🎤 Voice message' + (c.lastDurationMs ? ' (' + mmss(c.lastDurationMs) + ')' : '') : c.lastText;
      return who + (c.lastAssignmentTitle ? '📎 ' : '') + what;
    }
    function contactRow(c) {
      var b = el('button', null, 'dm-contact' + (c.unread ? ' has-unread' : '')); b.type = 'button';
      b.setAttribute('data-contact', contactKey(c));
      var mid = el('span', null, 'dm-mid'), name = el('span', null, 'dm-name');
      name.append(el('span', c.name));
      if (role === 'student' && c.kind === 'principal' && c.lastAt) name.append(el('span', 'Principal', 'dm-role'));
      mid.append(name, el('span', lastLine(c), 'dm-last'));
      var side = el('span', null, 'dm-side');
      side.append(el('span', shortTime(c.lastAt)));
      if (c.unread) { var n = el('span', String(c.unread), 'dm-count'); n.setAttribute('aria-label', c.unread + ' new'); side.append(n); }
      b.append(el('span', initials(c.name), 'dm-avatar ' + c.kind), mid, side);
      b.setAttribute('aria-label', c.name + (c.unread ? ', ' + c.unread + ' new' : ''));
      b.onclick = function () { openThread(c, state.link); };
      return b;
    }
    function renderList() {
      stopRecording(true); stopPlayer();
      box.replaceChildren();
      if (state.link) {
        var banner = el('div', null, 'dm-banner');
        banner.append(document.createTextNode('📎 Choose who to message about “' + state.link.assignmentTitle + '”. '));
        var drop = el('button', 'Cancel', 'sec'); drop.type = 'button'; drop.onclick = function () { state.link = null; renderList(); };
        banner.append(drop); box.append(banner);
      }
      if (!state.groups) { box.append(el('div', state.loading ? 'Loading your messages…' : 'Messages could not load.', 'dm-empty')); return; }
      var count = allContacts().length;
      if (!count) { box.append(el('div', role === 'student' ? 'No teachers are set up for your class yet.' : 'No students are in your classes yet.', 'dm-empty')); return; }
      if (role === 'teacher' && count > 12) {
        var search = el('input', null, 'dm-search'); search.type = 'search'; search.placeholder = 'Find a student'; search.value = state.filter;
        search.setAttribute('aria-label', 'Find a student');
        search.oninput = function () { state.filter = search.value; drawGroups(); };
        box.append(search);
      }
      var groupsBox = el('div'); box.append(groupsBox);
      function drawGroups() {
        groupsBox.replaceChildren();
        var q = state.filter.trim().toLowerCase();
        state.groups.forEach(function (g) {
          var list = g.contacts.filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) !== -1; });
          if (!list.length) return;
          var sec = el('section', null, 'dm-group');
          if (role === 'teacher' || state.groups.length > 1) sec.append(el('h3', g.name));
          list.forEach(function (c) { sec.append(contactRow(c)); });
          groupsBox.append(sec);
        });
        if (!groupsBox.childNodes.length) groupsBox.append(el('div', 'No one matches that name.', 'dm-empty'));
      }
      drawGroups();
    }
    async function loadInbox() {
      state.loading = true;
      try {
        var data = await opts.call({ action: 'dmInbox' });
        state.groups = data.groups || []; setUnread(Number(data.unread) || 0);
      } catch (e) { if (!state.groups) { state.loading = false; box.replaceChildren(el('div', e.message || 'Messages could not load.', 'dm-empty')); return; } }
      state.loading = false;
      if (!state.contact) renderList();
    }

    // ---------- one conversation ----------
    var view = null;
    function openThread(c, link) {
      stopPlayer();
      state.contact = c; state.messages = []; state.link = link || null;
      box.replaceChildren();
      var head = el('div', null, 'dm-head'), back = el('button', '←', 'dm-back'); back.type = 'button';
      back.setAttribute('aria-label', 'Back to contacts');
      back.onclick = function () { closeThread(); };
      var title = el('div'); title.append(el('strong', c.name), el('small', role === 'student' ? kindLabel(c.kind) : (c.className || groupName(c))));
      head.append(back, el('span', initials(c.name), 'dm-avatar ' + c.kind), title);
      var thread = el('div', null, 'dm-thread'); thread.setAttribute('role', 'log'); thread.setAttribute('aria-live', 'polite');
      thread.append(el('div', 'Loading…', 'dm-empty'));
      var compose = el('div', null, 'dm-compose');
      var chip = el('div', null, 'dm-chip'), chipText = el('span'), chipX = el('button', '✕'); chipX.type = 'button';
      chipX.setAttribute('aria-label', 'Do not link this message to the homework');
      chipX.onclick = function () { state.link = null; drawChip(); };
      chip.append(el('b', '📎'), chipText, chipX);
      var row = el('div', null, 'dm-row'), input = el('textarea'); input.rows = 1; input.maxLength = 1000;
      input.placeholder = 'Message'; input.setAttribute('aria-label', 'Type a message');
      var action = el('button', '🎤', 'dm-round'); action.type = 'button';
      row.append(input, action);
      var recBar = el('div', null, 'dm-rec'); recBar.hidden = true;
      var cancel = el('button', '🗑 Cancel', 'dm-cancel'); cancel.type = 'button';
      var recBox = el('div', null, 'dm-recbox'), clock = el('span', '0:00', 'dm-clock'), meter = el('span', null, 'dm-meter'), meterBar = el('span');
      clock.setAttribute('role', 'timer'); meter.append(meterBar); meter.setAttribute('aria-hidden', 'true');
      recBox.append(el('span', null, 'dm-dot'), clock, meter);
      var sendRec = el('button', '➤', 'dm-round'); sendRec.type = 'button'; sendRec.setAttribute('aria-label', 'Send voice message');
      recBar.append(cancel, recBox, sendRec);
      var feedback = el('p', null, 'dm-feedback'); feedback.setAttribute('aria-live', 'polite');
      compose.append(chip, row, recBar, feedback);
      // Older messages to someone who is not the student's teacher: readable, no new sending.
      if (c.readOnly) { row.style.display = 'none'; compose.append(el('p', 'You can read these messages. To send a new message, write to your teacher.', 'dm-feedback')); }
      box.append(head, thread, compose);
      view = { thread: thread, input: input, action: action, row: row, recBar: recBar, clock: clock, meterBar: meterBar, meter: meter,
        cancel: cancel, sendRec: sendRec, feedback: feedback, chip: chip, chipText: chipText };
      function drawChip() { chip.hidden = !state.link || !!c.readOnly; if (state.link) chipText.textContent = 'About: ' + state.link.assignmentTitle; }
      drawChip();
      function syncAction() {
        var typed = !!input.value.trim();
        action.textContent = typed ? '➤' : '🎤';
        action.setAttribute('aria-label', typed ? 'Send message' : 'Record a voice message');
      }
      syncAction();
      input.addEventListener('input', function () { syncAction(); input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) { e.preventDefault(); action.click(); } });
      action.onclick = function () { if (input.value.trim()) sendText(); else startRecording(); };
      cancel.onclick = function () { stopRecording(true); };
      sendRec.onclick = function () { stopRecording(false); };
      loadThread(true);
      clearInterval(pollThread);
      pollThread = setInterval(function () { if (state.visible && !document.hidden && !rec) loadThread(false); }, POLL_THREAD_MS);
    }
    function groupName(c) { var g = (state.groups || []).find(function (x) { return x.id === c.classId; }); return g ? g.name : ''; }
    function closeThread() {
      stopRecording(true); stopPlayer(); clearInterval(pollThread);
      state.contact = null; view = null; state.link = null;
      renderList(); loadInbox();
    }
    function say(msg, bad) { if (!view) return; view.feedback.textContent = msg || ''; view.feedback.className = 'dm-feedback' + (bad ? ' err' : ''); }
    async function loadThread(first) {
      var c = state.contact; if (!c) return;
      try {
        var data = await opts.call(body(c, { action: 'dmThread' }));
        if (state.contact !== c || !view) return;
        var before = state.messages.map(function (m) { return m.id; }).join();
        state.messages = data.messages || [];
        if (first || before !== state.messages.map(function (m) { return m.id; }).join()) drawMessages();
        var unread = state.messages.some(function (m) { return m.unread; });
        if (unread) {
          await opts.call(body(c, { action: 'dmRead' }));
          state.messages.forEach(function (m) { m.unread = false; });
          var was = c.unread || 0; c.unread = 0; setUnread(Math.max(0, state.unread - was));
          if (!was) refreshUnread();
        }
      } catch (e) { if (view && first) { view.thread.replaceChildren(el('div', e.message || 'This conversation could not load.', 'dm-empty')); } }
    }
    function drawMessages() {
      var t = view.thread;
      stopPlayer();
      t.replaceChildren();
      if (!state.messages.length) {
        t.append(el('div', role === 'student' ? 'Say hello! Tap 🎤 to record a voice message, or type below.' : 'No messages yet. Tap 🎤 to record a voice message, or type below.', 'dm-empty'));
        return;
      }
      state.messages.forEach(function (m) { t.append(bubble(m)); });
      t.scrollTop = t.scrollHeight;
    }
    function bubble(m) {
      var mine = m.role === role, b = el('div', null, 'dm-msg' + (mine ? ' mine' : '') + (m.unread ? ' new' : ''));
      if (m.assignmentId) {
        var link = el('button', null, 'dm-link'); link.type = 'button';
        link.append(el('span', '📎'), el('span', (m.assignmentTitle || 'Homework') + ' ›'));
        link.title = 'Open this homework'; link.setAttribute('aria-label', 'Linked to homework: ' + (m.assignmentTitle || '') + '. Open it.');
        link.onclick = function () { if (opts.onJump) opts.onJump(m.assignmentId, state.contact, m.assignmentTitle); };
        b.append(link);
      }
      if (m.voice) b.append(voiceRow(m));
      if (m.text) b.append(el('p', m.text));
      var time = el('span', shortTime(m.createdAt), 'dm-time'); time.title = fullTime(m.createdAt);
      if (m.pending) time.textContent = 'Sending…';
      b.append(time);
      return b;
    }
    function voiceRow(m) {
      var row = el('div', null, 'dm-voice'), play = el('button', '▶', 'dm-play'), bar = el('span', null, 'dm-bar'), fill = el('span'), dur = el('span', mmss(m.durationMs), 'dm-dur');
      play.type = 'button'; play.setAttribute('aria-label', 'Play voice message'); bar.append(fill); row.append(play, bar, dur);
      if (m.pending) { play.disabled = true; return row; }
      var audio = null;
      play.onclick = async function () {
        if (audio) { if (audio.paused) { stopPlayer(audio); audio.play().catch(function () {}); } else audio.pause(); return; }
        play.disabled = true; play.textContent = '…';
        try {
          var data = await opts.call(body(state.contact, { action: 'dmVoice', messageId: m.id }));
          audio = new Audio(); audio.preload = 'auto';
          var type = String(data.voiceDataURL || '').slice(5).split(';')[0];
          if (type && audio.canPlayType && !audio.canPlayType(type)) say('This voice message was recorded on a different kind of device and may not play here. Try Chrome or a computer.', true);
          audio.src = data.voiceDataURL;
          audio.onplay = function () { play.textContent = '❚❚'; play.setAttribute('aria-label', 'Pause'); };
          audio.onpause = audio.onended = function () { play.textContent = '▶'; play.setAttribute('aria-label', 'Play voice message'); };
          audio.onended = function () { play.textContent = '▶'; fill.style.width = '0'; };
          audio.ontimeupdate = function () {
            var total = isFinite(audio.duration) && audio.duration ? audio.duration * 1000 : m.durationMs;
            if (total) fill.style.width = Math.min(100, audio.currentTime * 100000 / total) + '%';
            dur.textContent = mmss(audio.currentTime * 1000) + ' / ' + mmss(total);
          };
          audio.onerror = function () { say('This voice message could not play on this device.', true); };
          stopPlayer(audio);
          play.disabled = false;
          await audio.play().catch(function () { play.textContent = '▶'; });
        } catch (e) { play.disabled = false; play.textContent = '▶'; say(e.message || 'This voice message could not play.', true); }
      };
      return row;
    }
    function stopPlayer(keep) {
      if (player && player !== keep) { try { player.pause(); } catch (e) {} }
      player = keep || null;
    }
    async function deliver(extra, pendingMsg) {
      var c = state.contact, link = state.link;
      if (pendingMsg) { state.messages.push(pendingMsg); drawMessages(); }
      try {
        var payload = body(c, Object.assign({ action: 'dmSend' }, extra, link ? { assignmentId: link.assignmentId } : {}));
        var res = await opts.call(payload);
        if (state.contact !== c) return true;
        state.link = null; if (view) view.chip.hidden = true;
        state.messages = state.messages.filter(function (m) { return m !== pendingMsg; }).concat(res.message ? [res.message] : []);
        if (view) drawMessages();
        say('');
        return true;
      } catch (e) {
        state.messages = state.messages.filter(function (m) { return m !== pendingMsg; });
        if (view) drawMessages();
        say(e.message || 'The message could not be sent. Please try again.', true);
        return false;
      }
    }
    async function sendText() {
      var v = view, txt = v.input.value.trim(); if (!txt) return;
      v.action.disabled = true;
      v.input.value = ''; v.input.dispatchEvent(new Event('input'));
      var ok = await deliver({ text: txt }, { id: 'pending', role: role, text: txt, createdAt: Date.now(), pending: true,
        assignmentId: state.link && state.link.assignmentId, assignmentTitle: state.link && state.link.assignmentTitle });
      if (!ok && view === v && !v.input.value) { v.input.value = txt; v.input.dispatchEvent(new Event('input')); }
      if (view === v) v.action.disabled = false;
    }

    // ---------- recording: tap 🎤 once, it records hands-free; ➤ sends, 🗑 cancels ----------
    async function startRecording() {
      var v = view; if (!v || rec) return;
      if (!root.navigator || !root.navigator.mediaDevices || !root.navigator.mediaDevices.getUserMedia || !root.MediaRecorder) {
        say('Voice messages are not supported in this browser. You can type a message instead.', true); return;
      }
      stopPlayer();
      v.action.disabled = true; say('Starting the microphone…');
      var stream;
      try {
        stream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
        if (view !== v) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(function (t) {
          return !root.MediaRecorder.isTypeSupported || root.MediaRecorder.isTypeSupported(t);
        });
        var recorder = new root.MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
        var r = rec = { recorder: recorder, stream: stream, chunks: [], bytes: 0, started: 0, peak: 0, cancelled: false, capped: false, v: v };
        recorder.ondataavailable = function (e) {
          if (!e.data || !e.data.size) return;
          r.chunks.push(e.data); r.bytes += e.data.size;
          if (r.bytes > SAFE_BYTES && recorder.state === 'recording') { r.capped = true; recorder.stop(); }
        };
        recorder.onstop = function () { finishRecording(r, mime); };
        recorder.start(1000);
        r.started = Date.now();
        v.row.hidden = true; v.recBar.hidden = false; v.action.disabled = false; v.clock.textContent = '0:00';
        say('Recording… tap ➤ to send or 🗑 to cancel.');
        r.stopMeter = startMeter(stream, function (level) { if (level > r.peak) r.peak = level; v.meterBar.style.transform = 'scaleX(' + level.toFixed(3) + ')'; });
        v.meter.hidden = !r.stopMeter;
        r.tick = setInterval(function () {
          if (!box.isConnected || view !== v) { stopRecording(true); return; } // never leave the mic on
          var elapsed = Date.now() - r.started;
          v.clock.textContent = mmss(elapsed);
          if (r.stopMeter && elapsed > 3000 && r.peak < 0.03) say('We can’t hear anything yet. Check that your microphone is on.', true);
          else if (elapsed > MAX_MS - 30000) say('30 seconds left. Voice messages can be up to 5 minutes.');
          if (elapsed >= MAX_MS && recorder.state === 'recording') { r.capped = true; recorder.stop(); }
        }, 250);
        v.sendRec.focus();
      } catch (e) {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        rec = null; v.action.disabled = false; v.row.hidden = false; v.recBar.hidden = true;
        say(e && e.name === 'NotAllowedError' ? 'Allow microphone access to record a voice message.' : 'Could not start the microphone. You can type a message instead.', true);
      }
    }
    function stopRecording(cancelled) {
      if (!rec) return;
      rec.cancelled = rec.cancelled || !!cancelled;
      rec.elapsed = Date.now() - rec.started;
      if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    }
    async function finishRecording(r, mime) {
      clearInterval(r.tick); if (r.stopMeter) r.stopMeter();
      r.stream.getTracks().forEach(function (t) { t.stop(); });
      if (rec === r) rec = null;
      var v = r.v, elapsed = r.elapsed || (Date.now() - r.started);
      if (view === v) { v.row.hidden = false; v.recBar.hidden = true; v.meterBar.style.transform = 'scaleX(0)'; v.action.focus(); }
      if (r.cancelled) { if (view === v) say('Recording cancelled. Nothing was sent.'); return; }
      if (elapsed < MIN_MS) { say('That was too short. Tap 🎤, speak, then tap ➤.', true); return; }
      var type = audioType(r.recorder.mimeType || (r.chunks[0] && r.chunks[0].type) || mime || 'audio/webm');
      var blob = new Blob(r.chunks, { type: type });
      if (!blob.size) { say('Nothing was recorded. Check your microphone and try again.', true); return; }
      var dataURL = await new Promise(function (resolve, reject) { var fr = new FileReader(); fr.onload = function () { resolve(fr.result); }; fr.onerror = reject; fr.readAsDataURL(blob); });
      if (view !== v) return;
      if (r.capped) say('That reached the 5-minute limit, so it was sent.');
      await deliver({ voiceDataURL: dataURL, durationMs: elapsed }, { id: 'pending', role: role, voice: true, durationMs: elapsed, createdAt: Date.now(), pending: true,
        assignmentId: state.link && state.link.assignmentId, assignmentTitle: state.link && state.link.assignmentTitle });
    }

    // ---------- public ----------
    async function refreshUnread() {
      try { var d = await opts.call({ action: 'dmUnread' }); setUnread(Number(d.unread) || 0); document.body.classList.remove('dm-off'); }
      catch (e) { if (e && e.status === 400) document.body.classList.add('dm-off'); } // server not updated yet: hide Messages until it is
    }
    function show() {
      state.visible = true;
      if (!state.contact) { if (!state.groups) state.loading = true; renderList(); loadInbox(); }
    }
    function hide() { state.visible = false; stopRecording(true); stopPlayer(); }
    // Start a message from a homework post: link = {assignmentId, assignmentTitle, contactId, classId?}
    function compose(link) {
      state.link = { assignmentId: link.assignmentId, assignmentTitle: link.assignmentTitle || 'Homework' };
      var go = function () {
        var target = allContacts().find(function (c) { return c.id === link.contactId && (!link.classId || c.classId === link.classId); });
        // A homework post made by the principal or the office goes to the class teacher instead.
        if (!target || target.readOnly) {
          var teachers = allContacts().filter(function (c) { return c.kind === 'teacher' && (!link.classId || c.classId === link.classId); });
          target = teachers.length === 1 ? teachers[0] : null;
        }
        if (target) openThread(target, state.link); else renderList();
      };
      state.visible = true;
      if (state.groups) go(); else { renderList(); loadInbox().then(go); }
    }
    pollUnread = setInterval(function () { if (!document.hidden && !rec) { if (state.visible && !state.contact) loadInbox(); else refreshUnread(); } }, POLL_UNREAD_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshUnread(); });
    return { root: box, show: show, hide: hide, refreshUnread: refreshUnread, compose: compose,
      isOpen: function () { return !!state.contact; }, unread: function () { return state.unread; }, isRecording: function () { return !!rec; } };
  }
  root.HomeworkMessages = { create: create, MAX_MS: MAX_MS };
})(window);
