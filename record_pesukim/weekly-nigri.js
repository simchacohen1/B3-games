/* Posuk Practice teacher page: "Weekly marks to Nigri".
   For one class (East or West Track) and one week the teacher previews, per boy:
     - Posuk Practice Scroll average   (teacher grades, x10 = %)   -> Nigri topic Chumash
     - Chumash chidon average                                      -> Nigri topic Chumash Comprehension
     - Rashi reading average                                       -> Nigri topic Chumash-Rashi
   then sends each mark with the same NigriConnect path the Weekly Quiz uses (each teacher's own Nigri login).
   A week that was already sent for a class cannot be sent again ("already sent").
   Calculations live in ../shared/weekly-practice-marks-core.js. Loaded by teacher.html after its own script. */
(function () {
  'use strict';
  const C = window.WeeklyPracticeMarks;
  if (!C || typeof db === 'undefined') return;
  const ROSTER = window.WEEKLY_NIGRI_ROSTER || null;             // null on staging: fictional class, sending off
  const STAGING_OFF = !ROSTER || !!(window.B3_STAGING_FEATURES && window.B3_STAGING_FEATURES.nigriSync === false);
  const MARKS_ROOT = 'b3Quiz/weeklyPracticeNigri';
  const REWARDS_API = 'https://us-central1-b3-games.cloudfunctions.net/studentRewardsAutoAward';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let state = null; // { cls, range, rows, unmatched, ungraded, sent }

  function injectUi() {
    if ($('wpnBtn')) return;
    const style = document.createElement('style');
    style.textContent = '#wpnBtn{margin-top:8px;padding:8px 14px;border-radius:10px;border:2px solid #2d6ea3;background:#fff;color:#18324a;font-weight:800;cursor:pointer}' +
      '#wpnModal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px}' +
      '#wpnModal.hidden{display:none}#wpnBox{background:#fff;border-radius:14px;max-width:880px;width:100%;padding:18px;box-sizing:border-box}' +
      '#wpnBox table{border-collapse:collapse;width:100%;margin:10px 0}#wpnBox th,#wpnBox td{border:1px solid #d5e0e9;padding:6px 8px;text-align:center}#wpnBox td:first-child,#wpnBox th:first-child{text-align:left}' +
      '#wpnBox .wpn-none{color:#8a96a3}#wpnBox .wpn-warn{background:#fff4cf;border:1px solid #d9b94a;border-radius:8px;padding:8px 10px;margin:8px 0}' +
      '#wpnBox .wpn-sent{color:#1d6b2f;font-weight:700}#wpnBox .wpn-err{color:#a12d12;font-weight:700}#wpnBox label{font-weight:700;margin-right:12px}' +
      '#wpnBox button{padding:8px 14px;border-radius:9px;border:0;background:#2d6ea3;color:#fff;font-weight:700;cursor:pointer;margin:4px 6px 4px 0}#wpnBox button:disabled{opacity:.45;cursor:not-allowed}#wpnBox button.wpn-x{background:#6b7785}';
    document.head.appendChild(style);
    const btn = document.createElement('button');
    btn.id = 'wpnBtn'; btn.type = 'button'; btn.textContent = '📤 Weekly marks to Nigri'; btn.hidden = true;
    const header = document.querySelector('header'); (header || document.body).appendChild(btn);
    const modal = document.createElement('div'); modal.id = 'wpnModal'; modal.className = 'hidden';
    modal.innerHTML = '<div id="wpnBox" role="dialog" aria-label="Weekly marks to Nigri"></div>';
    document.body.appendChild(modal);
    btn.addEventListener('click', openModal);
    // Only the owner and teachers whose school syncs to Nigri see the button (staging: shown, sending is off).
    if (STAGING_OFF) btn.hidden = false;
    else if (window.B3NigriGate) window.B3NigriGate.ready.then(r => { btn.hidden = !(r && r.allowed); });
  }

  function classKeys() { return ROSTER ? Object.keys(ROSTER.rosters) : ['test']; }
  const classLabel = k => (ROSTER ? ROSTER.classSections[k] : 'Staging test class');

  async function openModal() {
    const box = $('wpnBox'); $('wpnModal').classList.remove('hidden');
    const today = C.nyDateIso(Date.now());
    const lastWeek = C.addDays(C.sundayOf(today), -7);
    box.innerHTML = '<h2 style="margin-top:0">Weekly marks to Nigri</h2>' +
      '<p class="small">One average per boy for Posuk Practice, Chidon and Rashi reading. A boy who did nothing in a tool that week gets no mark for it. Weeks run Sunday to Saturday (New York time) and the mark is dated that Friday.</p>' +
      '<div><label>Class <select id="wpnClass">' + classKeys().map(k => '<option value="' + k + '">' + esc(classLabel(k)) + '</option>').join('') + '</select></label>' +
      '<label>Any day in the week <input type="date" id="wpnDate" value="' + lastWeek + '"></label>' +
      '<button type="button" id="wpnPreview">Preview</button><button type="button" class="wpn-x" id="wpnClose">Close</button></div>' +
      (STAGING_OFF ? '<div class="wpn-warn">Staging: Nigri sending is switched off. You can preview and test the numbers only.</div>' : '') +
      '<div id="wpnOut" aria-live="polite"></div>';
    $('wpnClose').onclick = () => $('wpnModal').classList.add('hidden');
    $('wpnPreview').onclick = preview;
  }

  async function rashiForWeek(ids, range, cls) {
    if (STAGING_OFF && !ROSTER) { /* staging server has the same action; fall through and tolerate failure */ }
    try {
      const user = firebase.auth().currentUser; if (!user) throw new Error('not signed in');
      const token = await user.getIdToken();
      const res = await fetch(REWARDS_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ action: 'rashi-week-grades', classId: new URLSearchParams(location.search).get('class') || '', studentIds: ids, from: range.from, to: range.to }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the Rashi grades.');
      return { byStudent: data.students || {}, error: '' };
    } catch (e) { return { byStudent: {}, error: e.message || String(e) }; }
  }

  async function preview() {
    const out = $('wpnOut'), cls = $('wpnClass').value, dateVal = $('wpnDate').value, range = C.weekRange(dateVal);
    if (!range) { out.innerHTML = '<p class="wpn-err">Choose a date.</p>'; return; }
    if (range.to > Date.now() + 1000 && C.nyDateIso(Date.now()) <= range.end && !confirm('This week is not over yet. Preview it anyway?')) { out.textContent = ''; state = null; return; }
    out.textContent = 'Loading…';
    try {
      if (!Object.keys(studentsMap || {}).length && typeof loadStudents === 'function') await loadStudents();
      // Which practice students belong to the chosen class, and their Nigri names.
      const nigriNames = ROSTER ? ROSTER.names : Object.assign({}, studentsMap);
      const people = []; const unmatched = [];
      Object.entries(studentsMap || {}).forEach(([id, name]) => {
        if (!ROSTER) { people.push({ id, sid: id }); return; }
        const sid = C.matchRosterId(id, name, ROSTER.rosters[cls], ROSTER.names);
        if (sid) people.push({ id, sid }); else if (!Object.values(ROSTER.rosters).some(r => r.includes(id))) unmatched.push(name || id);
      });
      const ids = people.map(p => p.id);
      const [subs, atts, rashi, sent] = await Promise.all([
        scopedStudentData('posukPractice/submissions', ids), scopedStudentData('posukPractice/attempts', ids),
        rashiForWeek(ids, range, cls), db.ref(MARKS_ROOT + '/' + cls + '/' + range.start).once('value').catch(() => null)]);
      const subVal = subs.val() || {}, attVal = atts.val() || {};
      const rows = people.map(p => ({ sid: p.sid, id: p.id, name: nigriNames[p.sid] || studentsMap[p.id] || p.id,
        result: C.collectStudent({ submissions: subVal[p.id], attempts: attVal[p.id], rashi: (rashi.byStudent[p.id] || {}).graded,
          rashiPending: (rashi.byStudent[p.id] || {}).pending }, range,
          typeof effComprehensionScore === 'function' ? { chidonScore: effComprehensionScore } : {}) }));
      state = { cls, range, rows, nigriNames, sent: (sent && sent.val()) || {}, rashiError: rashi.error };
      render(unmatched);
    } catch (e) { out.innerHTML = '<p class="wpn-err">Could not build the preview: ' + esc(e.message || e) + '</p>'; }
  }

  function cell(r) { return r.mark === null ? '<span class="wpn-none">–</span>' : r.mark + '% <span class="wpn-none">(' + r.n + ')</span>'; }

  function render(unmatched) {
    const out = $('wpnOut'), s = state, ungraded = s.rows.reduce((n, r) => n + r.result.ungraded, 0);
    let html = '<h3>' + esc(classLabel(s.cls)) + ' · week ' + esc(C.weekLabel(s.range)) + ' · dated ' + esc(s.range.friday) + '</h3>';
    if (ungraded) html += '<div class="wpn-warn">⚠️ ' + ungraded + ' recording' + (ungraded === 1 ? ' is' : 's are') + ' still waiting to be graded this week. Ungraded work is left out of the averages. Grade it first if you want it counted.</div>';
    if (s.rashiError) html += '<div class="wpn-warn">⚠️ Rashi grades could not be loaded (' + esc(s.rashiError) + '). Rashi marks cannot be sent until this works.</div>';
    if (unmatched && unmatched.length) html += '<div class="wpn-warn">Not in the ' + esc(classLabel(s.cls)) + ' roster and skipped: ' + esc(unmatched.join(', ')) + '</div>';
    html += '<table><thead><tr><th>Boy</th><th>Posuk Practice</th><th>Chidon</th><th>Rashi reading</th></tr></thead><tbody>' +
      (s.rows.length ? s.rows.map(r => '<tr><td>' + esc(r.name) + '</td><td>' + cell(r.result.posuk) + '</td><td>' + cell(r.result.chidon) + '</td><td>' + cell(r.result.rashi) + '</td></tr>').join('') : '<tr><td colspan="4">No students found for this class on this page.</td></tr>') +
      '</tbody></table><p class="small">Percent shown, with how many results were averaged in brackets.</p><div id="wpnSend">';
    C.KIND_ORDER.forEach(k => {
      const count = s.rows.filter(r => r.result[k].mark !== null).length, done = s.sent[k];
      const disabled = STAGING_OFF || !count || !!done || (k === 'rashi' && s.rashiError);
      html += '<div><button type="button" data-kind="' + k + '" ' + (disabled ? 'disabled' : '') + '>' +
        (done ? 'Already sent: ' : 'Send ') + esc(C.KINDS[k].label) + ' (' + count + ' boy' + (count === 1 ? '' : 's') + ')</button>' +
        '<span id="wpnS_' + k + '" class="' + (done ? 'wpn-sent' : 'small') + '">' +
        (done ? 'Already sent ' + (done.at ? new Date(Number(done.at)).toLocaleDateString() : '') + (done.testId ? ' (mark #' + esc(done.testId) + ')' : '') : (!count ? 'Nothing to send this week.' : '')) + '</span></div>';
    });
    html += '</div>';
    out.innerHTML = html;
    out.querySelectorAll('button[data-kind]').forEach(b => { b.onclick = () => send(b.dataset.kind); });
  }

  async function send(kind) {
    const s = state, status = $('wpnS_' + kind), btn = document.querySelector('button[data-kind="' + kind + '"]');
    if (STAGING_OFF) { status.textContent = 'Nigri sending is off on staging.'; return; }
    const item = C.nigriBodies(s.rows, s.range, ROSTER.classSections[s.cls], s.nigriNames).find(b => b.kind === kind);
    if (!item) { status.textContent = 'Nothing to send.'; return; }
    const blocked = window.NigriConnect ? await window.NigriConnect.cannotSync()
      : (window.B3NigriGate && (window.B3NigriGate.result || {}).reason !== 'owner' ? 'The Nigri sync helper did not load. Refresh the page.' : null);
    if (blocked) { status.className = 'wpn-err'; status.textContent = blocked; return; }
    const b = item.body;
    if (!confirm('Save "' + b.test_name + '" to Nigri as ' + b.topic + ' (' + b.class_section + ', ' + b.date + ') for ' + b.students.length + ' boys?\n\nIt cannot be sent again for this week.')) return;
    btn.disabled = true; status.className = 'small'; status.textContent = 'Checking this week was not already sent…';
    const ref = db.ref(MARKS_ROOT + '/' + s.cls + '/' + s.range.start + '/' + kind);
    // Claim the week first (only one tab / teacher can), so a double click or two teachers cannot send twice.
    let claim;
    try { claim = await ref.transaction(cur => (cur === null ? { state: 'sending', at: firebase.database.ServerValue.TIMESTAMP } : undefined)); }
    catch (e) { status.className = 'wpn-err'; status.textContent = 'Could not check or reserve this week: ' + e.message; btn.disabled = false; return; }
    if (!claim.committed) {
      const cur = claim.snapshot.val() || {};
      status.className = 'wpn-sent'; status.textContent = cur.state === 'sending' ? 'Already being sent right now.' : 'Already sent.'; btn.textContent = 'Already sent: ' + C.KINDS[kind].label; return;
    }
    status.textContent = 'Saving to Nigri… this can take under a minute, please wait.';
    try {
      const hdr = { 'Content-Type': 'application/json' };
      let res;
      if (window.NigriConnect && (await window.NigriConnect.ready).role !== 'owner') res = (await window.NigriConnect.sendMarks(b)).response; // the teacher's own Nigri login
      else if (window.NigriAuth) res = (await window.NigriAuth.request('/sync-marks', { method: 'POST', headers: hdr, body: JSON.stringify(b) }, ROSTER && ROSTER.syncKey)).response; // owner: Google sign-in first, the old key only if the server answers 401 (same as the Weekly Quiz)
      else throw Object.assign(new Error('The Nigri sync helper did not load. Refresh the page.'), { preSend: true });
      if (!res) throw Object.assign(new Error('Please sign in with your Google account first.'), { preSend: true });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the Rashi grades.');
      return { byStudent: data.students || {}, error: '' };
    } catch (e) { return { byStudent: {}, error: e.message || String(e) }; }
  }

  async function preview() {
    const out = $('wpnOut'), cls = $('wpnClass').value, dateVal = $('wpnDate').value, range = C.weekRange(dateVal);
    if (!range) { out.innerHTML = '<p class="wpn-err">Choose a date.</p>'; return; }
    if (range.to > Date.now() + 1000 && C.nyDateIso(Date.now()) <= range.end && !confirm('This week is not over yet. Preview it anyway?')) { out.textContent = ''; state = null; return; }
    out.textContent = 'Loading…';
    try {
      if (!Object.keys(studentsMap || {}).length && typeof loadStudents === 'function') await loadStudents();
      // Which practice students belong to the chosen class, and their Nigri names.
      const nigriNames = ROSTER ? ROSTER.names : Object.assign({}, studentsMap);
      const people = []; const unmatched = [];
      Object.entries(studentsMap || {}).forEach(([id, name]) => {
        if (!ROSTER) { people.push({ id, sid: id }); return; }
        const sid = C.matchRosterId(id, name, ROSTER.rosters[cls], ROSTER.names);
        if (sid) people.push({ id, sid }); else if (!Object.values(ROSTER.rosters).some(r => r.includes(id))) unmatched.push(name || id);
      });
      const ids = people.map(p => p.id);
      const [subs, atts, rashi, sent] = await Promise.all([
        scopedStudentData('posukPractice/submissions', ids), scopedStudentData('posukPractice/attempts', ids),
        rashiForWeek(ids, range, cls), db.ref(MARKS_ROOT + '/' + cls + '/' + range.start).once('value').catch(() => null)]);
      const subVal = subs.val() || {}, attVal = atts.val() || {};
      const rows = people.map(p => ({ sid: p.sid, id: p.id, name: nigriNames[p.sid] || studentsMap[p.id] || p.id,
        result: C.collectStudent({ submissions: subVal[p.id], attempts: attVal[p.id], rashi: (rashi.byStudent[p.id] || {}).graded,
          rashiPending: (rashi.byStudent[p.id] || {}).pending }, range,
          typeof effComprehensionScore === 'function' ? { chidonScore: effComprehensionScore } : {}) }));
      state = { cls, range, rows, nigriNames, sent: (sent && sent.val()) || {}, rashiError: rashi.error };
      render(unmatched);
    } catch (e) { out.innerHTML = '<p class="wpn-err">Could not build the preview: ' + esc(e.message || e) + '</p>'; }
  }

  function cell(r) { return r.mark === null ? '<span class="wpn-none">–</span>' : r.mark + '% <span class="wpn-none">(' + r.n + ')</span>'; }

  function render(unmatched) {
    const out = $('wpnOut'), s = state, ungraded = s.rows.reduce((n, r) => n + r.result.ungraded, 0);
    let html = '<h3>' + esc(classLabel(s.cls)) + ' · week ' + esc(C.weekLabel(s.range)) + ' · dated ' + esc(s.range.friday) + '</h3>';
    if (ungraded) html += '<div class="wpn-warn">⚠️ ' + ungraded + ' recording' + (ungraded === 1 ? ' is' : 's are') + ' still waiting to be graded this week. Ungraded work is left out of the averages. Grade it first if you want it counted.</div>';
    if (s.rashiError) html += '<div class="wpn-warn">⚠️ Rashi grades could not be loaded (' + esc(s.rashiError) + '). Rashi marks cannot be sent until this works.</div>';
    if (unmatched && unmatched.length) html += '<div class="wpn-warn">Not in the ' + esc(classLabel(s.cls)) + ' roster and skipped: ' + esc(unmatched.join(', ')) + '</div>';
    html += '<table><thead><tr><th>Boy</th><th>Posuk Practice</th><th>Chidon</th><th>Rashi reading</th></tr></thead><tbody>' +
      (s.rows.length ? s.rows.map(r => '<tr><td>' + esc(r.name) + '</td><td>' + cell(r.result.posuk) + '</td><td>' + cell(r.result.chidon) + '</td><td>' + cell(r.result.rashi) + '</td></tr>').join('') : '<tr><td colspan="4">No students found for this class on this page.</td></tr>') +
      '</tbody></table><p class="small">Percent shown, with how many results were averaged in brackets.</p><div id="wpnSend">';
    C.KIND_ORDER.forEach(k => {
      const count = s.rows.filter(r => r.result[k].mark !== null).length, done = s.sent[k];
      const disabled = STAGING_OFF || !count || !!done || (k === 'rashi' && s.rashiError);
      html += '<div><button type="button" data-kind="' + k + '" ' + (disabled ? 'disabled' : '') + '>' +
        (done ? 'Already sent: ' : 'Send ') + esc(C.KINDS[k].label) + ' (' + count + ' boy' + (count === 1 ? '' : 's') + ')</button>' +
        '<span id="wpnS_' + k + '" class="' + (done ? 'wpn-sent' : 'small') + '">' +
        (done ? 'Already sent ' + (done.at ? new Date(Number(done.at)).toLocaleDateString() : '') + (done.testId ? ' (mark #' + esc(done.testId) + ')' : '') : (!count ? 'Nothing to send this week.' : '')) + '</span></div>';
    });
    html += '</div>';
    out.innerHTML = html;
    out.querySelectorAll('button[data-kind]').forEach(b => { b.onclick = () => send(b.dataset.kind); });
  }

  async function send(kind) {
    const s = state, status = $('wpnS_' + kind), btn = document.querySelector('button[data-kind="' + kind + '"]');
    if (STAGING_OFF) { status.textContent = 'Nigri sending is off on staging.'; return; }
    const item = C.nigriBodies(s.rows, s.range, ROSTER.classSections[s.cls], s.nigriNames).find(b => b.kind === kind);
    if (!item) { status.textContent = 'Nothing to send.'; return; }
    const blocked = window.NigriConnect ? await window.NigriConnect.cannotSync()
      : (window.B3NigriGate && (window.B3NigriGate.result || {}).reason !== 'owner' ? 'The Nigri sync helper did not load. Refresh the page.' : null);
    if (blocked) { status.className = 'wpn-err'; status.textContent = blocked; return; }
    const b = item.body;
    if (!confirm('Save "' + b.test_name + '" to Nigri as ' + b.topic + ' (' + b.class_section + ', ' + b.date + ') for ' + b.students.length + ' boys?\n\nIt cannot be sent again for this week.')) return;
    btn.disabled = true; status.className = 'small'; status.textContent = 'Checking this week was not already sent…';
    const ref = db.ref(MARKS_ROOT + '/' + s.cls + '/' + s.range.start + '/' + kind);
    // Claim the week first (only one tab / teacher can), so a double click or two teachers cannot send twice.
    let claim;
    try { claim = await ref.transaction(cur => (cur === null ? { state: 'sending', at: firebase.database.ServerValue.TIMESTAMP } : undefined)); }
    catch (e) { status.className = 'wpn-err'; status.textContent = 'Could not check or reserve this week: ' + e.message; btn.disabled = false; return; }
    if (!claim.committed) {
      const cur = claim.snapshot.val() || {};
      status.className = 'wpn-sent'; status.textContent = cur.state === 'sending' ? 'Already being sent right now.' : 'Already sent.'; btn.textContent = 'Already sent: ' + C.KINDS[kind].label; return;
    }
    status.textContent = 'Saving to Nigri… this can take under a minute, please wait.';
    try {
      const res = (await window.NigriConnect.sendMarks(b, async () => fetch('https://nigrisync.onrender.com/sync-marks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Key': window.WEEKLY_NIGRI_OWNER_KEY || '' }, body: JSON.stringify(b) }))).response;
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'success') {
        const failed = (data.results || []).filter(r => String(r).includes('FAILED'));
        await ref.set({ state: 'sent', at: firebase.database.ServerValue.TIMESTAMP, testId: String(data.test_id || ''), name: b.test_name, boys: b.students.length });
        s.sent[kind] = { at: Date.now(), testId: data.test_id };
        status.className = 'wpn-sent'; status.textContent = 'Saved to Nigri! (mark #' + data.test_id + ')' + (failed.length ? ' — but check these: ' + failed.join('; ') : '');
        btn.textContent = 'Already sent: ' + C.KINDS[kind].label;
      } else {
        await ref.remove().catch(() => {});
        status.className = 'wpn-err'; status.textContent = 'Nigri did not save this: ' + (data.detail || data.error || 'Unknown error (' + res.status + ').');
        btn.disabled = false;
      }
    } catch (e) {
      if (e.preSend) { await ref.remove().catch(() => {}); status.className = 'wpn-err'; status.textContent = e.message; btn.disabled = false; return; }
      // The request may or may not have reached Nigri: keep the week locked and tell the teacher to check Nigri.
      status.className = 'wpn-err'; status.textContent = 'Could not confirm the save (' + e.message + '). The week stays locked. Check Nigri before asking the owner to unlock it.';
    }
  }

  injectUi();
})();
