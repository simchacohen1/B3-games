/* Class Locks panel (teacher). Opens from the teacher bar on any page. Reads the class's locks live, and sends every
   change to the studentLocks function (which checks that this teacher may, and that only the teacher who has the class
   can start a timed unlock). The rules for what is locked are in ../student-lock-core.js (the same file the students use). */
(function () {
  'use strict';
  var core = window.B3StudentLockCore, site = window.B3SiteSettings;
  var WS = 'b3-2026';
  var FUNCTION_URL = 'https://us-central1-b3-games.cloudfunctions.net/studentLocks';
  var DAY_LABELS = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
  var classId = new URLSearchParams(location.search).get('class') || '';
  function $(id) { return document.getElementById(id); }
  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (props[k] === null || props[k] === undefined) return;
      if (k === 'text') node.textContent = props[k]; else if (k === 'class') node.className = props[k]; else if (k === 'on') Object.keys(props.on).forEach(function (e) { node.addEventListener(e, props.on[e]); }); else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  var state = { locks: {}, teachers: [], me: { uid: '', isAdmin: false }, className: '', offset: 0, draft: null, rows: {}, unsub: null };
  var nowMs = function () { return Date.now() + state.offset; };

  // ---------- talking to the function ----------
  var toastTimer = null;
  function toast(text, isError) {
    var t = $('toast'); t.textContent = text; t.className = isError ? 'err' : ''; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 6000 : 2200);
  }
  async function call(body) {
    var user = firebase.auth().currentUser;
    if (!user) throw new Error('Please sign in again.');
    var token = await user.getIdToken();
    var res = await fetch(FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(Object.assign({ classId: classId }, body)) });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) throw new Error(data.error || 'That did not work (' + res.status + ').');
    return data;
  }
  async function act(body, done) {
    try { var r = await call(body); if (done) toast(done); await refresh(); return r; }
    catch (error) { toast(error.message || 'That did not work.', true); await refresh().catch(function () {}); return null; }
  }
  async function refresh() {
    var s = await call({ action: 'state' });
    state.teachers = s.teachers || []; state.me = s.me; state.className = s.className || classId; state.offset = s.now - Date.now();
    state.locks = s.locks || {};
    render();
  }

  // ---------- words ----------
  function targetLabel(key) {
    if (key === '*') return 'Everything';
    if (key.charAt(0) === '@') { var g = core.GROUPS.filter(function (x) { return x.id === key.slice(1); })[0]; return g ? 'All ' + g.label.toLowerCase() : key; }
    var f = core.FEATURES.filter(function (x) { return x.id === key; })[0]; return f ? f.label : key;
  }
  function minutesLabel(m) { var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'PM' : 'AM'; return ((h + 11) % 12 + 1) + ':' + String(mm).padStart(2, '0') + ' ' + ap; }
  function countdown(until) {
    var s = Math.max(0, Math.round((until - nowMs()) / 1000)), m = Math.floor(s / 60);
    return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ':' + String(s % 60).padStart(2, '0');
  }
  function why(st) {
    if (st.kind === 'manual') return 'Locked by the switch (stays until you turn it off)';
    if (st.kind === 'schedule') return 'Locked by ' + st.schedules.map(function (h) { return h.teacherName || 'a teacher'; }).filter(function (n, i, a) { return a.indexOf(n) === i; }).join(' and ') + '\'s schedule until ' + core.clock(st.until);
    if (st.kind === 'override-open') return 'Unlocked by ' + (st.byName || 'a teacher') + ' for ' + (st.label || 'a while') + ', until ' + core.clock(st.until);
    if (st.kind === 'override-locked') return 'Locked by ' + (st.byName || 'a teacher') + ' until ' + core.clock(st.until);
    return 'Open';
  }
  function nameOf(uid) { var t = state.teachers.filter(function (x) { return x.uid === uid; })[0]; return t ? t.name : 'A teacher'; }

  // ---------- who has the class ----------
  function holder() { return core.holderOf(state.locks, state.teachers.map(function (t) { return t.uid; }), nowMs()); }
  function canChangeTimed() { var h = holder(); return state.me.isAdmin || (h && h.uid === state.me.uid); }
  function renderHolder() {
    var h = holder(), box = $('holder'), mine = h && h.uid === state.me.uid;
    box.className = 'card holder' + (mine ? '' : h ? ' other' : ' none');
    box.textContent = '';
    if (!h) { box.appendChild(el('strong', { text: 'Nobody has this class right now.' })); box.appendChild(el('div', { class: 'muted', text: 'Opening this panel makes you the teacher who has it.' })); return; }
    var reason = h.why === 'scheduled' ? 'his schedule covers right now' : 'opened it most recently';
    if (mine) {
      box.appendChild(el('strong', { text: '✅ You have this class now' }));
      box.appendChild(el('div', { class: 'muted', text: (h.why === 'scheduled' ? 'Your schedule covers right now.' : 'You opened it most recently.') + ' Only you can start timed unlocks or locks for it.' }));
    } else {
      box.appendChild(el('strong', { text: nameOf(h.uid) + ' has this class now' }));
      box.appendChild(el('div', { class: 'muted', text: '(' + reason + ') Only he can start timed unlocks or locks. You can still use the switches and your own schedule.' + (state.me.isAdmin ? ' As an administrator you can change timed unlocks too.' : '') }));
      if (h.why === 'opened') box.appendChild(el('div', { style: 'margin-top:8px' }, [el('button', { type: 'button', text: 'I am teaching this class now', on: { click: function () { act({ action: 'opened' }, 'You have the class now.'); } } })]));
    }
  }

  // ---------- switches and statuses ----------
  function renderFeatures() {
    var box = $('features'); box.textContent = ''; state.rows = {};
    core.GROUPS.forEach(function (g) {
      box.appendChild(el('div', { class: 'group', text: g.icon + ' ' + g.label }));
      core.FEATURES.filter(function (f) { return f.group === g.id; }).forEach(function (f) {
        var input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Lock ' + f.label });
        input.checked = !!(state.locks.features && state.locks.features[f.id] && state.locks.features[f.id].locked);
        input.addEventListener('change', function () { var want = input.checked; act({ action: 'setFeature', featureId: f.id, locked: want }); });
        var chip = el('span', { class: 'chip' }), why = el('div', { class: 'why' });
        box.appendChild(el('div', { class: 'feature' }, [
          el('span', { class: 'icon', text: f.icon, 'aria-hidden': 'true' }),
          el('div', {}, [el('div', { class: 'name', text: f.label }), why]),
          el('div', { class: 'row' }, [chip, el('label', { class: 'switch', title: 'Lock ' + f.label }, [input, el('span', {})])])
        ]));
        state.rows[f.id] = { chip: chip, why: why, input: input };
      });
    });
  }
  function updateStatuses() {
    var now = nowMs();
    core.FEATURES.forEach(function (f) {
      var r = state.rows[f.id]; if (!r) return;
      var st = core.featureState(state.locks, f, now);
      var temp = st.kind === 'override-open' || st.kind === 'override-locked';
      r.chip.className = 'chip ' + (temp ? 'temp' : st.locked ? 'locked' : 'open');
      r.chip.textContent = (st.locked ? '🔒 Locked' : '🔓 Open') + (temp ? ' (timed)' : '');
      r.why.textContent = why(st) + (temp ? ' · ends in ' + countdown(st.until) : '');
    });
    // The timed unlocks list counts down too; one that has run out leaves the list.
    var ended = false;
    Array.prototype.forEach.call(document.querySelectorAll('[data-ends]'), function (n) {
      var until = Number(n.getAttribute('data-ends')); n.textContent = countdown(until); if (until <= now) ended = true;
    });
    if (ended) render();
  }

  // ---------- timed unlocks / locks ----------
  function renderOverrides() {
    var sel = $('ovTarget'), keep = sel.value; sel.textContent = '';
    var add = function (v, t) { sel.appendChild(el('option', { value: v, text: t })); };
    add('*', 'Everything');
    core.GROUPS.forEach(function (g) { add('@' + g.id, g.icon + ' All ' + g.label.toLowerCase()); });
    core.FEATURES.forEach(function (f) { add(f.id, f.icon + ' ' + f.label); });
    if (keep) sel.value = keep;
    var ok = canChangeTimed();
    $('ovHelp').textContent = ok ? 'When the time is up, the schedules and switches take over again.' : 'Only the teacher who has the class right now can start these.';
    var b = $('ovButtons'); b.textContent = '';
    [[15, '15 min'], [30, '30 min'], [45, '45 min']].forEach(function (x) { b.appendChild(el('button', { type: 'button', class: 'fill', text: x[1], on: { click: function () { startOverride({ minutes: x[0] }); } } })); });
    b.appendChild(el('button', { type: 'button', class: 'fill', text: 'Until end of class', on: { click: function () { startOverride({ endOfClass: true }); } } }));
    Array.prototype.forEach.call(b.children, function (btn) { btn.disabled = !ok; });
    var list = $('ovList'); list.textContent = '';
    var now = nowMs(), keys = Object.keys(state.locks.overrides || {}).filter(function (k) { return Number(state.locks.overrides[k].until) > now; });
    keys.forEach(function (k) {
      var o = state.locks.overrides[k];
      list.appendChild(el('div', { class: 'ov' }, [
        el('div', {}, [el('strong', { text: (o.state === 'open' ? '🔓 ' : '🔒 ') + targetLabel(k) + (o.state === 'open' ? ' unlocked' : ' locked') }),
          el('div', { class: 'muted' }, ['by ' + (o.byName || 'a teacher') + ' · ends at ' + core.clock(o.until) + ' (in ', el('span', { 'data-ends': String(o.until), text: countdown(o.until) }), ')'])]),
        el('button', { type: 'button', class: 'danger', text: 'End now', on: { click: function () { act({ action: 'clearOverride', targets: [k] }, 'Ended.'); } }, disabled: ok ? null : 'disabled' })
      ]));
    });
    if (!keys.length) list.appendChild(el('p', { class: 'muted', text: 'No timed unlocks or locks right now.' }));
  }
  function startOverride(duration) {
    var stateValue = document.querySelector('input[name="ovState"]:checked').value, target = $('ovTarget').value;
    act(Object.assign({ action: 'override', targets: [target], state: stateValue }, duration), (stateValue === 'open' ? 'Unlocked' : 'Locked') + ' ' + targetLabel(target).toLowerCase() + '.');
  }

  // ---------- the weekly schedule ----------
  function savedRules() {
    var mine = state.locks.schedules && state.locks.schedules[state.me.uid];
    return core.rulesOf(mine).map(function (r) { return { id: r.id, days: (r.days || []).slice(), start: r.start, end: r.end, targets: (r.targets || []).slice(), label: r.label || '' }; });
  }
  function renderDraft() {
    var box = $('myLines'); box.textContent = '';
    if (!state.draft.length) box.appendChild(el('p', { class: 'muted', text: 'You have no schedule lines. Add one, for example games locked Monday to Thursday 9:00 to 3:00.' }));
    state.draft.forEach(function (line, i) {
      var days = el('div', { class: 'days', role: 'group', 'aria-label': 'Days' });
      core.DAYS.forEach(function (d) {
        var cb = el('input', { type: 'checkbox', 'aria-label': DAY_LABELS[d] }); cb.checked = line.days.indexOf(d) >= 0;
        cb.addEventListener('change', function () { line.days = core.DAYS.filter(function (x) { return x === d ? cb.checked : line.days.indexOf(x) >= 0; }); });
        days.appendChild(el('label', {}, [cb, DAY_LABELS[d]]));
      });
      var start = el('input', { type: 'time', value: line.start || '09:00', 'aria-label': 'From' }), end = el('input', { type: 'time', value: line.end || '15:00', 'aria-label': 'To' });
      start.addEventListener('change', function () { line.start = start.value; }); end.addEventListener('change', function () { line.end = end.value; });
      var targets = el('div', { class: 'targets' });
      var tcb = function (key, text) {
        var cb = el('input', { type: 'checkbox' }); cb.checked = line.targets.indexOf(key) >= 0;
        cb.addEventListener('change', function () { line.targets = line.targets.filter(function (t) { return t !== key; }); if (cb.checked) line.targets.push(key); });
        return el('label', {}, [cb, text]);
      };
      targets.appendChild(tcb('*', 'Everything'));
      core.GROUPS.forEach(function (g) { targets.appendChild(tcb('@' + g.id, g.icon + ' ' + g.label)); });
      var more = el('details', {}, [el('summary', { text: 'Single features' })]), inner = el('div', { class: 'targets' });
      core.FEATURES.forEach(function (f) { inner.appendChild(tcb(f.id, f.icon + ' ' + f.label)); }); more.appendChild(inner);
      box.appendChild(el('div', { class: 'line' }, [
        el('div', { class: 'row' }, [el('strong', { text: 'Lock these:' })]), targets, more,
        el('div', { class: 'row' }, [el('span', { text: 'on' }), days, el('span', { text: 'from' }), start, el('span', { text: 'to' }), end,
          el('button', { type: 'button', class: 'danger', text: 'Delete line', on: { click: function () { state.draft.splice(i, 1); renderDraft(); } } })])
      ]));
    });
  }
  function summaryOf(r) {
    return (r.days || []).map(function (d) { return DAY_LABELS[d]; }).join(', ') + ' ' + minutesLabel(core.minutesOf(r.start)) + '–' + minutesLabel(core.minutesOf(r.end)) + ': ' + (r.targets || []).map(targetLabel).join(', ');
  }
  function renderOthers() {
    var box = $('otherSchedules'); box.textContent = '';
    var any = false;
    Object.keys(state.locks.schedules || {}).forEach(function (uid) {
      if (uid === state.me.uid) return;
      var s = state.locks.schedules[uid], rules = core.rulesOf(s); if (!rules.length) return; any = true;
      box.appendChild(el('div', {}, [el('strong', { text: (s.name || nameOf(uid)) + '\'s schedule' }), el('ul', {}, rules.map(function (r) { return el('li', { text: summaryOf(r) }); }))]));
    });
    if (any) box.insertBefore(el('h3', { text: 'The class\'s other teachers' }), box.firstChild);
  }

  function render() {
    $('className').textContent = state.className ? '· ' + state.className : '';
    renderHolder(); renderOverrides(); renderFeatures(); renderOthers();
    if (state.draft === null) { state.draft = savedRules(); renderDraft(); }
    updateStatuses();
  }

  // ---------- buttons ----------
  function wire() {
    $('lockAll').addEventListener('click', function () { act({ action: 'setAll', locked: true }, 'Everything is locked.'); });
    $('unlockAll').addEventListener('click', function () { act({ action: 'setAll', locked: false }, 'Everything is unlocked (schedules and timed locks still apply).'); });
    $('addLine').addEventListener('click', function () { state.draft.push({ days: ['mon', 'tue', 'wed', 'thu'], start: '09:00', end: '15:00', targets: ['@games'], label: '' }); renderDraft(); });
    $('presetGames').addEventListener('click', function () { state.draft.push({ days: ['mon', 'tue', 'wed', 'thu'], start: '09:00', end: '15:00', targets: ['@games'], label: 'Games' }); renderDraft(); });
    $('saveSchedule').addEventListener('click', async function () {
      var r = await act({ action: 'saveSchedule', rules: state.draft.map(function (l, i) { return Object.assign({ id: 'r' + (i + 1) }, l); }) }, 'Schedule saved.');
      if (r) { state.draft = null; render(); }
    });
    $('signinBtn').addEventListener('click', function () { site.signInWithGoogle().catch(function () { toast('Could not sign in.', true); }); });
  }

  // ---------- start ----------
  function follow() {
    if (state.unsub) { try { state.unsub(); } catch (e) { /* ignore */ } state.unsub = null; }
    var ref = firebase.database().ref('b3Games/workspaces/' + WS + '/classes/' + classId + '/locks');
    var handler = function (snap) {
      var v = snap.val() || {};
      state.locks = { features: v.features || {}, schedules: v.schedules || {}, overrides: v.overrides || {}, opened: v.opened || {} };
      if ($('panel').hidden === false) render();
    };
    ref.on('value', handler, function () { /* the function's answer still refreshes the page */ });
    state.unsub = function () { ref.off('value', handler); };
  }
  site.onAuthStateChanged(async function (user, authorized) {
    if (!classId || !/^[A-Za-z0-9_-]{1,100}$/.test(classId)) { $('app').insertBefore(el('p', { class: 'card', text: 'Choose a class from the teacher bar.' }), $('signin')); return; }
    $('signin').hidden = !!authorized; $('panel').hidden = !authorized;
    if (!authorized) return;
    try {
      await call({ action: 'opened' });          // opening the class is what makes this teacher the one who has it
      await refresh(); follow();
    } catch (error) { toast(error.message || 'Could not load the locks.', true); }
  });
  wire();
  if (classId) { var old = $('oldAccess'); if (old) old.href = '../admin.html?tab=access&class=' + encodeURIComponent(classId); }
  setInterval(function () { if ($('panel').hidden === false) { updateStatuses(); } }, 1000);
  setInterval(function () { if ($('panel').hidden === false) refresh().catch(function () {}); }, 30000);
})();
