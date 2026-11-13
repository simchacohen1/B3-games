(async function () {
  'use strict';
  const C = window.KriahCore, API = window.KriahClient, $ = id => document.getElementById(id);
  const state = { generation: 0, role: '', classId: '', studentId: '', students: [], library: [], records: [], next: null, record: null, marks: [], undo: [], dirty: false, recording: null, blob: null, urls: [], tab: 'attempts', assignId: '' };
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const field = (label, input) => { const l = el('label', label); l.append(input); return l; };
  const button = (text, fn, cls) => { const b = el('button', text, cls); b.type = 'button'; b.onclick = () => run(fn); return b; };
  const select = values => { const s = el('select'); values.forEach(v => { const o = el('option', v.label); o.value = v.value; s.append(o); }); return s; };
  const input = (type = 'text', value = '') => { const n = el('input'); n.type = type; n.value = value; return n; };
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  async function run(fn) { try { await fn(); } catch (error) { if (!error.stale) status(error.message, true); } }
  async function call(body, options) {
    const gen = state.generation;
    try {
      const result = await API.call({ classId: state.classId, studentId: state.studentId || undefined, ...body }, options);
      if (gen !== state.generation) throw Object.assign(new Error('Class or account changed.'), { stale: true });
      return result;
    } catch (error) {
      if (gen !== state.generation) error.stale = true;
      else if ([401, 403].includes(error.status)) {
        state.generation++; release(); state.records = []; state.library = []; state.students = [];
        $('tabs').hidden = true; ['library', 'attempts', 'reports'].forEach(id => $(id).hidden = true);
        $('attemptList').replaceChildren(); $('libraryList').replaceChildren(); $('reportBody').replaceChildren();
      }
      throw error;
    }
  }
  function release() { state.recording?.cancel(); state.recording = null; state.urls.forEach(URL.revokeObjectURL); state.urls = []; state.blob = null; state.record = null; state.dirty = false; $('assessment').replaceChildren(); $('assessment').hidden = true; }
  function safeToLeave() { return !state.dirty && !state.blob && !['requesting', 'recording', 'stopping'].includes(state.recording?.state) || confirm('Leave this assessment? Recovery drafts stay on this device until submitted or cleared.'); }
  function tabs(name) {
    state.tab = name;
    ['library', 'attempts', 'reports'].forEach(id => { $(id).hidden = id !== name; });
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'reports') renderReport();
  }
  function options(node, rows, id = '') { node.replaceChildren(); rows.forEach(r => { const o = el('option', r.name); o.value = r.id; node.append(o); }); if (rows.some(r => r.id === id)) node.value = id; }
  window.KriahMagic.trail($('trailLetters'), $('trailName'));
  C.TYPES.forEach(t => { const o = el('option', t); o.value = t; $('type').append(o); });
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => tabs(b.dataset.tab));
  window.addEventListener('beforeunload', event => { if (state.dirty || state.blob || state.recording?.state === 'recording') { event.preventDefault(); event.returnValue = ''; } });

  async function identityChanged() {
    state.generation++; release(); state.records = []; state.library = []; state.students = []; state.classId = ''; state.studentId = ''; state.role = '';
    $('tabs').hidden = true; ['library', 'attempts', 'reports'].forEach(id => $(id).hidden = true);
    $('attemptList').replaceChildren(); document.getElementById('gradeQueueList')?.replaceChildren(); $('libraryList').replaceChildren(); $('reportBody').replaceChildren(); $('exerciseForm').hidden = true; $('assignPanel').hidden = true;
    options($('classSelect'), []); options($('studentSelect'), []);
    $('signIn').hidden = API.fixture || !!API.uid(); $('studentSignIn').hidden = API.fixture || !!API.uid(); $('signOut').hidden = API.fixture || !API.uid();
    $('fixtureLogin').hidden = !API.staging || !!API.uid();
    if (!API.uid()) { status('Sign in with a fictional staging account to begin.'); return; }
    status('Checking your assigned classes…');
    let result;
    try { result = await call({ action: 'classes' }); }
    catch (error) { if (error.status === 403) error.message = 'You are signed in, but this account is not set up for the Kriah center on staging yet. (' + error.message + ') Use a fictional Kriah test account, or ask the site owner to add this account to a Kriah test class.'; throw error; }
    state.role = result.role; document.body.dataset.role = state.role;
    state.studentId = result.studentId || '';
    options($('classSelect'), result.classes);
    state.classId = $('classSelect').value;
    $('studentLabel').hidden = state.role === 'student';
    document.querySelector('[data-tab="library"]').hidden = state.role === 'student';
    if (!state.classId) { status('No enabled fictional Kriah test classes are assigned to this account.'); return; }
    $('tabs').hidden = false;
    await openClass();
  }
  async function openClass() {
    if (state.role === 'teacher') {
      const data = await call({ action: 'openClass', studentId: undefined }); state.students = data.students; state.library = data.library;
      options($('studentSelect'), data.students, state.studentId); state.studentId = $('studentSelect').value;
      renderLibrary();
    }
    await loadRecords(); tabs('attempts');
  }
  async function loadRecords(older = false) {
    if (!state.studentId) { state.records = []; renderAttempts(); status('This class has no active fictional students.'); return; }
    const data = await call({ action: 'list', before: older ? state.next : undefined });
    state.records = older ? [...state.records, ...data.records] : data.records; state.next = data.next;
    renderAttempts(); if (state.tab === 'reports') renderReport();
    status('Loaded ' + state.records.length + ' assessment(s)' + (state.next ? ' · More history available.' : '.'));
  }
  $('classSelect').onchange = () => run(async () => { if (!safeToLeave()) { $('classSelect').value = state.classId; return; } state.generation++; release(); state.classId = $('classSelect').value; state.records = []; state.studentId = state.role === 'student' ? state.studentId : ''; $('gradeQueueList').replaceChildren(); $('exerciseForm').hidden = true; $('assignPanel').hidden = true; await openClass(); });
  $('studentSelect').onchange = () => run(async () => { if (!safeToLeave()) { $('studentSelect').value = state.studentId; return; } state.generation++; release(); state.studentId = $('studentSelect').value; state.records = []; await loadRecords(); });
  $('refresh').onclick = () => run(async () => { if (safeToLeave()) { release(); await identityChanged(); } });
  $('more').onclick = () => run(() => loadRecords(true));
  $('signIn').onclick = () => run(() => API.signIn());
  $('fixtureLogin').onsubmit = event => { event.preventDefault(); run(async () => {
    const email = $('fixtureEmail').value.trim(), password = $('fixturePassword').value;
    $('fixturePassword').value = '';
    await API.fixtureSignIn(email, password);
  }); };
  $('signOut').onclick = () => run(async () => { if (safeToLeave()) { release(); await API.signOut(); } });
  $('actor').onchange = () => run(async () => { if (!safeToLeave()) return; release(); await API.chooseActor($('actor').value); await identityChanged(); });

  function renderLibrary() {
    const box = $('libraryList'); box.replaceChildren();
    if (!state.library.length) box.append(el('p', 'Create your first exercise, then assign it to one or more students.'));
    state.library.forEach(ex => {
      const card = el('article', null, 'card'); card.append(el('div', ex.type === 'Letter recognition' ? 'א ב' : ex.unitType === 'nekudah' ? 'אָ בֵּ' : 'אַבָּא', 'exercise-emblem')); card.append(el('h2', ex.title), el('p', ex.type + ' · ' + ex.level), el('p', ex.text, 'hebrew'));
      card.lastChild.dir = 'rtl'; card.lastChild.lang = 'he';
      card.append(button('Edit', () => editExercise(ex), 'secondary'), button('Assign', () => assignPanel(ex))); box.append(card);
    });
  }
  function editExercise(ex = {}) {
    $('exerciseForm').hidden = false; $('formTitle').textContent = ex.id ? 'Edit library exercise' : 'Create exercise';
    const values = { exerciseId: ex.id || '', title: ex.title || '', level: ex.level || '', type: ex.type || C.TYPES[0], unitType: ex.unitType || 'letter', hebrew: ex.text || '', pronunciation: ex.pronunciation || '' };
    Object.entries(values).forEach(([id, v]) => $(id).value = v); $('selfCorrection').checked = ex.countSelfCorrection === true; $('title').focus();
  }
  $('newExercise').onclick = () => editExercise();
  $('starters').onclick = () => run(async () => {
    $('starters').disabled = true;
    try {
      for (let i = 0; i < C.STARTERS.length; i++) {
        const exerciseId = 'starter-' + i;
        if (!state.library.some(ex => ex.id === exerciseId)) await call({ action: 'saveExercise', studentId: undefined, exerciseId, exercise: C.STARTERS[i] });
      }
      const data = await call({ action: 'openClass', studentId: undefined }); state.library = data.library; renderLibrary(); status('Starter exercises added. Customize the levels and pronunciation for your class.');
    } finally { $('starters').disabled = false; }
  });
  $('cancelExercise').onclick = () => { $('exerciseForm').hidden = true; };
  $('exerciseForm').onsubmit = event => { event.preventDefault(); run(async () => {
    const exercise = C.exercise({ title: $('title').value, level: $('level').value, type: $('type').value, unitType: $('unitType').value, text: $('hebrew').value, pronunciation: $('pronunciation').value, countSelfCorrection: $('selfCorrection').checked });
    await call({ action: 'saveExercise', studentId: undefined, exerciseId: $('exerciseId').value || undefined, exercise });
    $('exerciseForm').hidden = true; const data = await call({ action: 'openClass', studentId: undefined }); state.library = data.library; renderLibrary(); status('Exercise saved. Existing assignments keep their original text.');
  }); };
  function assignPanel(ex) {
    state.assignId = ex.id; $('assignPanel').hidden = false; $('assignTitle').textContent = ex.title + ' · ' + ex.level;
    const list = $('assignStudents'); list.replaceChildren();
    if (!state.students.length) list.append(el('p', 'This class has no active students yet.'));
    if (state.students.length > 1) {
      const all = input('checkbox'); all.id = 'assignAll'; const label = field('Select all students', all); label.className = 'check select-all';
      all.onchange = () => list.querySelectorAll('input[data-student]').forEach(c => { c.checked = all.checked; });
      list.append(label);
    }
    state.students.forEach(s => { const check = input('checkbox'); check.value = s.id; check.dataset.student = s.id; const label = field(s.name, check); label.className = 'check'; list.append(label); });
    // The panel sits below the whole library; bring it into view so the click visibly did something.
    $('assignPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('assign').onclick = () => run(async () => {
    const studentIds = [...$('assignStudents').querySelectorAll('input[data-student]:checked')].map(c => c.value);
    if (!studentIds.length) throw new Error('Select at least one student.');
    $('assign').disabled = true;
    try { const result = await call({ action: 'assign', studentId: undefined, exerciseId: state.assignId, studentIds }); $('assignPanel').hidden = true; await loadRecords(); status('Assigned to ' + result.assigned.length + ' student(s). Students see it under “My reading assignments”.'); }
    finally { $('assign').disabled = false; }
  });
  // Teacher grading queue: one explicit, bounded load (latest 25 per student,
  // like the class summary) instead of opening every student one by one.
  const queue = el('div', null, 'grade-queue'); queue.id = 'gradeQueue'; queue.hidden = true;
  const queueList = el('div'); queueList.id = 'gradeQueueList';
  const findWork = el('button', 'Show work waiting to be graded (all students)', 'secondary'); findWork.type = 'button'; findWork.id = 'findUngraded';
  findWork.onclick = () => run(async () => {
    const gen = state.generation, found = []; findWork.disabled = true;
    try {
      for (const s of state.students) {
        const data = await call({ action: 'list', studentId: s.id, limit: 25 });
        if (gen !== state.generation) return;
        data.records.filter(r => r.status === 'submitted' || r.status === 'in_progress').forEach(r => found.push({ s, r }));
      }
    } finally { findWork.disabled = false; }
    queueList.replaceChildren(el('h2', found.length ? found.length + ' recording(s) waiting to be graded' : 'Nothing is waiting to be graded.'));
    found.sort((a, b) => String(a.r.submittedAt || a.r.createdAt).localeCompare(String(b.r.submittedAt || b.r.createdAt))).forEach(({ s, r }) => {
      const row = el('article', null, 'row'), text = el('div');
      text.append(el('strong', s.name + ' · ' + r.exercise.title), el('p', 'Sent ' + new Date(r.submittedAt || r.createdAt).toLocaleString()), el('span', statusLabel(r.status), 'tag tag-' + r.status));
      row.append(text, button('Grade', async () => {
        if (!safeToLeave()) return;
        state.generation++; release(); state.studentId = s.id; $('studentSelect').value = s.id; state.records = [];
        await loadRecords(); await openAssessment(r.id);
      })); queueList.append(row);
    });
    status(found.length ? 'Oldest first. Press Grade to open one.' : 'Nothing is waiting to be graded in the latest 25 assessments per student.');
  });
  queue.append(findWork, queueList); $('attemptList').before(queue);
  function renderAttempts() {
    queue.hidden = state.role !== 'teacher' || !state.students.length;
    $('attemptList').replaceChildren(); $('more').hidden = !state.next;
    $('attemptHeading').textContent = state.role === 'teacher' ? 'Assessments · ' + ($('studentSelect').selectedOptions[0]?.textContent || '') : 'My reading quests';
    if (!state.records.length) $('attemptList').append(el('p', 'No assessments assigned yet.'));
    if (state.role === 'student' && !state.records.length) $('attemptList').lastChild.textContent = 'No reading quests yet. Your teacher will send you one soon!';
    state.records.forEach(r => {
      const row = el('article', null, 'row'), text = el('div');
      if (state.role === 'student') {
        // Child-facing quest card: same record, friendlier words.
        const todo = r.status === 'assigned', badge = el('div', todo ? '📖' : r.status === 'reviewed' ? '💌' : '⭐', 'quest-badge');
        badge.setAttribute('aria-hidden', 'true'); row.classList.add('quest', 'quest-' + r.status);
        text.append(el('strong', r.exercise.title), el('p', todo ? 'Ready when you are. Read it out loud!' : r.status === 'reviewed' ? 'Your teacher listened. Open it to see!' : 'Sent! Your teacher will listen soon.'), el('span', statusLabel(r.status), 'tag tag-' + r.status));
        row.append(badge, text, button(todo ? 'Start reading' : 'Open my reading', () => openAssessment(r.id), todo ? 'quest-go' : 'secondary')); $('attemptList').append(row);
        return;
      }
      text.append(el('strong', r.exercise.title), el('p', new Date(r.createdAt).toLocaleString() + ' · ' + r.exercise.level), el('span', statusLabel(r.status), 'tag tag-' + r.status));
      row.append(text, button('Open assessment', () => openAssessment(r.id), 'secondary')); $('attemptList').append(row);
    });
  }
  function statusLabel(s) {
    const labels = state.role === 'student' ? { assigned: 'Ready to read', submitted: 'Sent to teacher', in_progress: 'Sent to teacher', reviewed: 'Teacher listened' } : { assigned: 'Not recorded', submitted: 'Ungraded', in_progress: 'Review in progress', reviewed: 'Reviewed' };
    return labels[s] || s;
  }
  const clock = seconds => { const whole = Math.max(0, Math.round(seconds)); return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0'); };
  // Put a recording in the player and find its real length. MediaRecorder files
  // carry no length of their own, so the player is measured (waiting for its
  // end-seek to finish) and the audio is also fully decoded. If the player
  // cannot show the full decoded length, it plays a plain WAV copy instead, so
  // the listener always hears and can seek the whole recording. The stored
  // original is never changed.
  async function loadAudio(player, blob, gen) {
    const url = URL.createObjectURL(blob); state.urls.push(url);
    const inspecting = KriahRecorder.inspect(blob);
    player.preload = 'auto'; player.src = url; player.hidden = false;
    const [shown, decoded] = await Promise.all([KriahRecorder.resolveDuration(player), inspecting]);
    if (gen !== state.generation) return null;
    let seconds = shown, copy = false;
    if (decoded && (!shown || shown + 1.5 < decoded.duration)) {
      const wav = URL.createObjectURL(decoded.toWav()); state.urls.push(wav);
      player.src = wav; seconds = decoded.duration; copy = true;
    }
    return { seconds: seconds || null, copy };
  }
  const draftKey = () => state.classId + ':' + state.studentId + ':' + state.record.id;
  let draftQueue = Promise.resolve();
  function draftValue() { return { revision: state.record.revision, marks: state.marks, feedback: $('feedback')?.value || '', recommendation: $('recommendation')?.value || '', shareFeedback: $('shareFeedback')?.checked || false, countSelfCorrection: $('countSelf')?.checked || false, timing: $('confirmTiming')?.checked ? { confirmed: true, seconds: Number($('timing')?.value) } : null }; }
  async function persistGrade() {
    const gen = state.generation, key = draftKey(), value = draftValue(); state.dirty = true;
    draftQueue = draftQueue.catch(() => {}).then(async () => { if (gen === state.generation) await API.draft(key + ':grade', value); });
    await draftQueue;
  }
  async function openAssessment(id) {
    if (!safeToLeave()) return; release();
    const gen = state.generation;
    const { record } = await call({ action: 'get', id }); state.record = record; state.marks = record.marks || []; state.undo = [];
    const box = $('assessment'); box.hidden = false;
    const meta = el('p', record.exercise.type + ' · ' + record.exercise.level + ' · ' + statusLabel(record.status)); meta.id = 'assessmentMeta';
    box.append(el('h2', record.exercise.title), meta, el('p', record.exercise.pronunciation || 'No pronunciation notes provided.'));
    // An empty 0:00 player before anything exists is confusing; show it once it has audio.
    const player = el('audio'); player.id = 'player'; player.controls = true; player.preload = 'none'; player.hidden = true; box.append(player);
    if (record.audio) { const load = button('Load original recording', async () => {
      const data = await call({ action: 'audioRead', id });
      const bytes = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
      load.hidden = true; status('Loading the original recording…');
      const loaded = await loadAudio(player, new Blob([bytes], { type: data.type }), gen);
      if (!loaded) return;
      const expected = Number(record.audio?.duration), actual = loaded.seconds;
      const length = el('p', null, 'audio-length'); length.id = 'audioLength';
      length.textContent = actual ? 'Recording length: ' + clock(actual) + (Number.isFinite(expected) ? ' · the student recorded for ' + clock(expected) : '') : 'This browser could not measure the recording length. Press play to listen.';
      player.after(length);
      if (Number.isFinite(expected) && expected >= 3 && actual && actual + Math.max(2, expected * 0.12) < expected) status('Warning: playback is only ' + Math.round(actual) + ' seconds, but the original was reported as ' + Math.round(expected) + ' seconds. This recording may be incomplete; do not grade it as complete.', true);
      else if (Number.isFinite(expected) && expected < 3) { length.classList.add('short'); length.textContent += ' · This is a very short clip. It was recorded this short (for example a test clip); nothing was cut off.'; status('Original recording loaded. It is only ' + Math.max(1, Math.round(expected)) + ' second(s) long because that is all that was recorded.'); }
      else status('Original recording loaded. Full length ' + (actual ? clock(actual) : Math.round(record.audio?.duration || 0) + 's') + (loaded.copy ? ' (playing a compatible copy so the whole recording can be heard).' : '.') + ' No automatic word alignment.');
    }, 'secondary'); box.append(load); }
    if (state.role === 'student') await studentAssessment(box, record, player, gen);
    else await teacherAssessment(box, record, gen);
    if (gen === state.generation) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function studentAssessment(box, record, player, gen) {
    box.classList.add('quest-open');
    box.append(el('p', record.audio ? 'Here is what you read. Tap a letter to light it up.' : 'Read these out loud, starting on the right. Tap a letter to light it up as you go.', 'read-hint'));
    box.append(window.KriahMagic.passage(record.exercise.text, C));
    if (record.feedback || record.recommendation) box.append(el('h3', 'Teacher feedback'), el('p', record.feedback), el('p', record.recommendation));
    if (record.summary) box.append(scorePanel(record.summary));
    if (record.audio) {
      box.append(el('p', record.status === 'reviewed' ? '✓ Your teacher has reviewed this reading. Well done!' : '✓ Your recording was sent. Your teacher will listen and review it. You are done with this one. Great job!', 'done-note'));
      box.append(button('Start a new attempt', async () => {
        if (!confirm('Record this reading again as a new attempt? Your teacher keeps the recording you already sent, too.')) return;
        const result = await call({ action: 'retry', id: record.id }); await loadRecords(); await openAssessment(result.id);
      }, 'secondary'));
      return;
    }
    const steps = el('ol', null, 'quest-steps'); ['Tick the box', 'Press the microphone', 'Read out loud', 'Stop, listen, and send'].forEach(step => steps.append(el('li', step))); box.append(steps);
    const consent = input('checkbox'), consentLabel = field('I am using a fictional test reading. Record my voice and share it with my assigned teacher.', consent); consentLabel.className = 'check'; box.append(consentLabel);
    const timer = el('p', 'Up to 5 minutes · 2 MiB maximum. Nothing is sent until you press Submit.', 'subtle'); timer.id = 'recordTimer'; box.append(timer);
    const actions = el('div', null, 'actions');
    // One place decides which controls make sense right now, so a student
    // cannot record over a take by accident or press buttons that do nothing.
    let uploading = false;
    function sync() {
      if (gen !== state.generation) return;
      const busy = ['requesting', 'recording', 'stopping'].includes(recorder.state), locked = !!state.blob?.uploadStarted;
      recordButton.disabled = uploading || busy || !!state.blob;
      stop.hidden = cancel.hidden = !busy; stop.disabled = recorder.state !== 'recording';
      retry.hidden = !state.blob; retry.disabled = uploading || busy || locked;
      submit.disabled = uploading || busy || !state.blob;
    }
    const recordButton = button('Record reading', async () => {
      if (state.blob?.uploadStarted) throw new Error('Retry submitting the same original recording first.');
      if (!consent.checked) { consentLabel.classList.add('attention'); throw new Error('Tick the permission box above first, then press Record.'); }
      status('Waiting for microphone permission…');
      try { const starting = recorder.start(); sync(); await starting; if (gen !== state.generation) return; sync(); if (recorder.state === 'recording') status('Recording… Press Stop when you finish reading.'); }
      catch (e) { sync(); throw e; }
    });
    const stop = button('Stop recording', () => { recorder.stop(); sync(); }, 'danger');
    const retry = button('Retry recording', async () => {
      if (state.blob?.uploadStarted) throw new Error('Upload may already have started. Submit the same original bytes again.');
      if (state.blob && !confirm('Discard this local recording and try again?')) return;
      recorder.cancel(); await API.draft(draftKey() + ':audio', null).catch(() => {}); state.blob = null; player.removeAttribute('src'); player.hidden = true; timer.className = 'subtle'; timer.textContent = 'Up to 5 minutes · 2 MiB maximum. Nothing is sent until you press Submit.'; sync(); status('Ready to record again.');
    }, 'secondary');
    const cancel = button('Cancel recording', () => { if (!['requesting', 'recording', 'stopping'].includes(recorder.state)) return; recorder.cancel(); timer.className = 'subtle'; sync(); status('Recording cancelled. Nothing was uploaded.'); }, 'secondary');
    const submit = button('Submit recording', async () => {
      if (!state.blob || !consent.checked) { if (!consent.checked) consentLabel.classList.add('attention'); throw new Error('Record and confirm permission before submitting.'); }
      uploading = true; sync();
      try {
        const captured = state.blob; captured.uploadStarted = true; await API.draft(draftKey() + ':audio', captured).catch(() => {}); const audio = await API.blob64(captured.blob);
        if (gen !== state.generation) return;
        await call({ action: 'submit', id: record.id, audio, type: captured.blob.type, duration: captured.duration }, { progress: percent => { if (gen === state.generation) status('Uploading ' + percent + '% · Waiting for server confirmation…'); } });
        await API.draft(draftKey() + ':audio', null).catch(() => {}); state.blob = null; await loadRecords(); await openAssessment(record.id); status('Recording submitted. ' + window.KriahMagic.cheer() + ' Your teacher will listen soon.'); window.KriahMagic.burst($('assessment'));
      } catch (error) {
        if (error.status === 400 && state.blob) { state.blob.uploadStarted = false; await API.draft(draftKey() + ':audio', state.blob); }
        throw error;
      } finally { uploading = false; sync(); }
    });
    consent.onchange = () => consentLabel.classList.remove('attention');
    const recorder = new KriahRecorder({ onTick: seconds => { timer.textContent = '● Recording · ' + Math.floor(seconds) + ' seconds / 300'; timer.className = 'recording'; }, onError: error => { if (gen === state.generation) { status(error.message, true); timer.className = 'subtle'; sync(); } }, onComplete: async value => {
      if (gen !== state.generation) return;
      await KriahRecorder.verifyPlayableDuration(value.blob, value.duration);
      if (gen !== state.generation) return;
      state.blob = value; loadAudio(player, value.blob, gen);
      timer.className = 'subtle'; timer.textContent = Math.round(value.duration) + ' seconds recorded · Listen, then press Submit (or Retry to record again).' + (value.duration < 2 ? ' That was very short. If you meant to read more, press Retry.' : ''); sync();
      await API.draft(draftKey() + ':audio', value); status('Recording saved on this device for recovery. Listen, retry, or submit.');
    } });
    state.recording = recorder; recordButton.classList.add('record-primary'); recordButton.setAttribute('aria-label', 'Record reading'); actions.append(recordButton, stop, cancel, retry, submit); box.append(actions); sync();
    const recovered = await API.draft(draftKey() + ':audio').catch(error => { status(error.message, true); return null; });
    if (gen !== state.generation) return;
    if (recovered?.blob) { state.blob = recovered; loadAudio(player, recovered.blob, gen); sync(); timer.textContent = 'Recovered an unsent recording from this device. ' + (recovered.uploadStarted ? 'Upload may have started; submit these same original bytes again.' : 'Listen, confirm permission and submit, or retry.'); }
  }
  function scorePanel(summary) {
    const panel = el('div', null, 'score');
    [['Correct', summary.correct], ['Assessed', summary.attempted], ['Not assessed', summary.notAssessed], ['Accuracy', summary.percent == null ? '—' : summary.percent + '%'], ['Words / minute', summary.wpm == null ? 'Not timed' : summary.wpm]].forEach(([label, value]) => { const m = el('div', null, 'metric'); m.append(el('strong', value), el('span', label)); panel.append(m); });
    return panel;
  }
  async function teacherAssessment(box, record, gen) {
    if (!record.audio) { const passage = el('p', record.exercise.text, 'hebrew passage'); passage.dir = 'rtl'; passage.lang = 'he'; box.append(passage, el('p', 'Waiting for the student to submit a recording.')); return; }
    const parsed = C.units(record.exercise.text);
    box.append(el('p', 'Click a letter. Shift-click another to select a span. Choose a letter, nekudah or word below. Timestamps are optional teacher taps; playback is not auto-aligned.', 'subtle'));
    const passage = el('div', null, 'hebrew passage'); passage.dir = 'rtl'; passage.lang = 'he'; passage.id = 'markPassage'; box.append(passage);
    let start = 0, end = 0;
    const picker = el('div', null, 'mark-panel'), target = el('select'); target.id = 'markTarget';
    const category = select(C.CATEGORIES.map(v => ({ value: v, label: v.replaceAll('-', ' ') }))); category.id = 'category';
    const correction = input(), note = input(), timestamp = input('number'); correction.maxLength = 100; note.maxLength = 300; timestamp.min = 0; timestamp.max = 300; timestamp.step = '.1';
    correction.id = 'correction'; note.id = 'markNote'; timestamp.id = 'markTime';
    const grid = el('div', null, 'grid'); grid.append(field('Selected unit / span', target), field('Mark', category), field('Correction (optional)', correction), field('Short note (optional)', note), field('Manual timestamp in seconds (optional)', timestamp)); picker.append(grid);
    function selectedUnits() {
      if (target.value.startsWith('span:')) return parsed.units.filter(u => u.kind === target.value.slice(5) && (u.kind === 'word' ? parsed.clusters.some(c => c.word === u.word && c.index >= start && c.index <= end) : u.cluster >= start && u.cluster <= end));
      return parsed.units.filter(u => u.id === target.value);
    }
    function pick(a, b) {
      start = Math.min(a, b); end = Math.max(a, b); target.replaceChildren();
      const us = parsed.units.filter(u => u.kind === 'word' ? parsed.clusters.some(c => c.word === u.word && c.index >= start && c.index <= end) : u.cluster >= start && u.cluster <= end);
      // Say exactly what a span mark will cover: one click on בָּ selects two
      // nekudah units (kamatz and dagesh), and both would get the same mark.
      for (const kind of ['letter', 'nekudah', 'word']) { const of = us.filter(u => u.kind === kind); if (!of.length) continue; const o = el('option', (of.length === 1 ? 'The selected ' + kind : 'All ' + of.length + ' selected ' + kind + ' units') + (kind === 'nekudah' ? ' (' + of.map(u => u.label).join(', ') + ')' : '')); o.value = 'span:' + kind; target.append(o); }
      us.forEach(u => { const o = el('option', u.kind + ' · ' + (u.symbol ? '◌' + u.symbol + ' ' : '') + u.label + ' · position ' + (u.cluster == null ? u.word + 1 : u.cluster + 1)); o.value = u.id; target.append(o); });
      target.value = us.some(u => u.kind === record.exercise.unitType) ? 'span:' + record.exercise.unitType : target.options[0].value;
      renderPassage();
    }
    function renderPassage() {
      passage.replaceChildren(); parsed.words.forEach((word, wi) => {
        const wrap = el('span', null, 'word'); const clusters = parsed.clusters.filter(c => c.word === wi);
        if (!clusters.length) { wrap.textContent = word; passage.append(wrap, document.createTextNode(' ')); return; }
        wrap.append(document.createTextNode(word.match(/^[^\u05d0-\u05ea]*/u)?.[0] || ''));
        clusters.forEach(c => {
          const b = el('button', c.text, 'cluster'); b.type = 'button'; b.setAttribute('aria-label', 'Letter ' + c.letter + ', position ' + (c.index + 1)); b.dataset.cluster = c.index;
          const marks = state.marks.filter(m => parsed.units.some(u => u.id === m.unitId && (u.cluster === c.index || u.kind === 'word' && u.word === c.word)));
          if (marks.length) b.classList.add(marks.some(m => m.category !== 'correct' && (m.category !== 'self-correction' || $('countSelf')?.checked)) ? 'mark-error' : 'mark-correct');
          if (c.index >= start && c.index <= end) b.classList.add('selected');
          b.onclick = event => pick(event.shiftKey ? start : c.index, c.index); wrap.append(b); if (c.suffix) wrap.append(document.createTextNode(c.suffix));
        }); passage.append(wrap, document.createTextNode(' '));
      });
    }
    async function changed() { renderPassage(); renderMarks(); await persistGrade(); }
    const scoring = record.exercise.unitType, plural = { letter: 'letters', nekudah: 'nekudos', word: 'words' }[scoring] || scoring + ' units';
    const order = new Map(parsed.units.map((u, i) => [u.id, i]));
    const position = u => u.kind === 'word' ? 'word ' + (u.word + 1) : 'position ' + (u.cluster + 1);
    const unitName = u => u.kind + ' ' + (u.symbol ? '◌' + u.symbol + ' ' : '') + u.label + ' (' + position(u) + ')';
    const unmarked = () => parsed.units.filter(u => u.kind === scoring && !state.marks.some(m => m.unitId === u.id));
    // Accuracy counts only marked units. A teacher who marks just the mistakes
    // would otherwise finalize 0% for a nearly perfect reading.
    async function markRestCorrect() {
      const rest = unmarked(); if (!rest.length) return 0;
      state.undo.push(structuredClone(state.marks));
      state.marks = C.marks(record.exercise, [...state.marks, ...rest.map(u => ({ unitId: u.id, category: 'correct', correction: '', note: '', time: null }))]);
      await changed(); return rest.length;
    }
    const mark = button('Apply mark to selected unit(s)', async () => {
      const units = selectedUnits(); if (!units.length) return;
      const time = timestamp.value === '' ? null : Number(timestamp.value);
      const changes = units.map(u => ({ unitId: u.id, category: category.value, correction: correction.value, note: note.value, time }));
      const next = C.marks(record.exercise, [...state.marks.filter(m => !units.some(u => u.id === m.unitId)), ...changes]);
      state.undo.push(structuredClone(state.marks)); state.marks = next; await changed(); status('Mark added. Recovery draft saved locally; press Save draft to save to the server.');
    });
    const restButton = button('Mark all unmarked ' + plural + ' correct', async () => { const n = await markRestCorrect(); status(n ? 'Marked ' + n + ' remaining ' + plural + ' correct. Recovery draft saved locally; press Save draft or Finalize.' : 'Every ' + scoring + ' already has a mark.'); }, 'secondary');
    restButton.id = 'markRest';
    picker.append(button('Use current playback time', () => { timestamp.value = $('player').currentTime.toFixed(1); }, 'secondary'), document.createTextNode(' '), mark, document.createTextNode(' '), restButton);
    picker.append(el('p', 'Quick way: mark only the mistakes, then press “Mark all unmarked ' + plural + ' correct”.', 'subtle'));
    box.append(picker);
    const list = el('ol', null, 'mark-list'); list.id = 'markList'; const summaryBox = el('div'); summaryBox.id = 'scoreBox';
    const progress = el('p', null, 'mark-progress'); progress.id = 'markProgress';
    function renderMarks() {
      list.replaceChildren(); [...state.marks].sort((a, b) => order.get(a.unitId) - order.get(b.unitId)).forEach(m => {
        const u = parsed.units.find(u => u.id === m.unitId), item = el('li');
        item.append(el('span', unitName(u) + ': ' + m.category.replaceAll('-', ' ') + (m.correction ? ' → ' + m.correction : '') + (m.note ? ' · ' + m.note : '') + (m.time == null ? '' : ' · ' + m.time + 's')));
        if (m.category !== 'correct') item.className = 'mark-item-error';
        item.append(button('Edit', () => { const cluster = u.cluster ?? parsed.clusters.find(c => c.word === u.word)?.index ?? 0; pick(cluster, cluster); target.value = u.id; category.value = m.category; correction.value = m.correction; note.value = m.note; timestamp.value = m.time ?? ''; }, 'secondary'), button('Remove', async () => { state.undo.push(structuredClone(state.marks)); state.marks = state.marks.filter(v => v.unitId !== m.unitId); await changed(); }, 'secondary')); list.append(item);
      });
      const ex = { ...record.exercise, countSelfCorrection: $('countSelf')?.checked || false };
      const total = parsed.units.filter(u => u.kind === scoring).length, left = unmarked().length;
      progress.textContent = 'Marked ' + (total - left) + ' of ' + total + ' ' + plural + (left ? ' · ' + left + ' not marked yet (not counted in accuracy)' : ' · all marked');
      progress.classList.toggle('complete', !left); restButton.disabled = !left;
      summaryBox.replaceChildren(progress, scorePanel(C.summary(ex, state.marks, $('confirmTiming')?.checked ? { confirmed: true, seconds: Number($('timing').value) } : null)));
    }
    const feedback = el('textarea'); feedback.id = 'feedback'; feedback.maxLength = 1000; feedback.value = record.feedback || '';
    const recommendation = el('textarea'); recommendation.id = 'recommendation'; recommendation.maxLength = 500; recommendation.value = record.recommendation || '';
    const share = input('checkbox'); share.id = 'shareFeedback'; share.checked = record.shareFeedback === true;
    const self = input('checkbox'); self.id = 'countSelf'; self.checked = record.exercise.countSelfCorrection;
    const timing = input('number', record.timing?.seconds || ''); timing.id = 'timing'; timing.min = 1; timing.max = 300;
    const confirmTiming = input('checkbox'); confirmTiming.id = 'confirmTiming'; confirmTiming.checked = record.timing?.confirmed === true;
    box.append(button('Undo last marking change', async () => { if (state.undo.length) { state.marks = state.undo.pop(); await changed(); } }, 'secondary'), list, summaryBox, field('Teacher feedback', feedback), field('Next practice recommendation', recommendation));
    for (const [label, control] of [['Count self-correction as an error', self], ['Share final feedback and summary with student', share], ['I timed the entire passage myself (required for WPM)', confirmTiming]]) { const l = field(label, control); l.className = 'check'; box.append(l); }
    box.append(field('Teacher-confirmed full-passage seconds (optional)', timing), el('p', 'Accuracy = correct ÷ explicitly assessed ' + record.exercise.unitType + ' units. Unmarked units are not assessed. Other unit types remain in skill reports. WPM uses the whole passage and your confirmed timing.', 'subtle'));
    [feedback, recommendation, share, self, timing, confirmTiming].forEach(n => n.oninput = () => run(async () => { renderPassage(); renderMarks(); await persistGrade(); }));
    const saveActions = el('div', null, 'actions');
    async function save(final) {
      // Freeze controls while saving so a later edit cannot be discarded when
      // the earlier server response clears its recovery draft.
      const controls = [...box.querySelectorAll('button,input,select,textarea')].map(n => [n, n.disabled]);
      controls.forEach(([n]) => n.disabled = true);
      const payload = draftValue(); await draftQueue.catch(() => {});
      try {
        const result = await call({ action: 'grade', id: record.id, ...payload, final });
        record.revision = result.record.revision; state.record = result.record; $('assessmentMeta').textContent = record.exercise.type + ' · ' + record.exercise.level + ' · ' + statusLabel(result.record.status); state.dirty = false; await API.draft(draftKey() + ':grade', null).catch(() => {}); await loadRecords(); status(final ? 'Final assessment saved.' : 'Assessment draft saved to the server.');
      } finally { if (gen === state.generation) controls.forEach(([n, disabled]) => n.disabled = disabled); }
    }
    async function finalize() {
      const left = unmarked().length, total = parsed.units.filter(u => u.kind === scoring).length;
      if (left) {
        if (confirm(left + ' of ' + total + ' ' + plural + ' have no mark yet.\n\nOK: mark them all correct, then finalize.\nCancel: other choices.')) await markRestCorrect();
        else if (!confirm('Finalize with ' + left + ' ' + plural + ' not assessed?\n\nAccuracy will count only the ' + (total - left) + ' ' + plural + ' you marked.')) { status('Not finalized. Mark the remaining ' + plural + ', then finalize.'); return; }
      }
      if (!share.checked && !confirm('The student will not see this result, because “Share final feedback and summary with student” is not ticked.\n\nOK: finalize anyway (private).\nCancel: go back.')) { status('Not finalized. Tick “Share final feedback and summary with student” if the student should see it.'); return; }
      await save(true);
    }
    saveActions.append(button('Save draft', () => save(false)), button('Finalize assessment', finalize), button('Delete assessment & original audio', async () => {
      if (!confirm('Permanently delete this fictional assessment and its original recording?')) return;
      await call({ action: 'delete', id: record.id, confirm: record.id }); await API.draft(draftKey() + ':grade', null).catch(() => {}); release(); await loadRecords(); status('Assessment and original recording deleted.');
    }, 'danger')); box.append(saveActions);
    const recovered = await API.draft(draftKey() + ':grade').catch(error => { status(error.message, true); return null; });
    if (gen !== state.generation) return;
    if (recovered) {
      if (recovered.revision === record.revision && confirm('Restore the unsaved marking draft from this device?')) {
        state.marks = C.marks(record.exercise, recovered.marks); feedback.value = recovered.feedback; recommendation.value = recovered.recommendation; share.checked = recovered.shareFeedback; self.checked = recovered.countSelfCorrection; confirmTiming.checked = recovered.timing?.confirmed || false; timing.value = recovered.timing?.seconds || ''; state.dirty = true;
      } else if (recovered.revision !== record.revision) status('A local draft exists for an older server revision. It was not applied. Reload and review the current assessment.', true);
    }
    pick(0, 0); renderMarks();
  }
  function table(headings, rows, caption) {
    const wrap = el('div', null, 'table-wrap'), t = el('table'); if (caption) t.append(el('caption', caption));
    const head = el('thead'), tr = el('tr'); headings.forEach(h => tr.append(el('th', h))); head.append(tr); t.append(head);
    const body = el('tbody'); rows.forEach(row => { const r = el('tr'); row.forEach(value => { const td = el('td'); if (value instanceof Node) td.append(value); else td.textContent = String(value); r.append(td); }); body.append(r); }); t.append(body); wrap.append(t); return wrap;
  }
  function reportData(records) {
    const skills = {}, reviewed = records.filter(r => r.status === 'reviewed' && r.summary);
    reviewed.forEach(r => r.summary.skills.forEach(u => { const k = u.kind + ':' + u.label; const row = skills[k] || (skills[k] = { ...u, assessed: 0, errors: 0, notAssessed: 0 }); ['assessed', 'errors', 'notAssessed'].forEach(k => row[k] += u[k]); }));
    return { reviewed, skills: Object.values(skills) };
  }
  function renderReport() {
    const box = $('reportBody'); box.replaceChildren();
    const who = state.role === 'teacher' ? $('studentSelect').selectedOptions[0]?.textContent : 'My reading';
    $('reportScope').textContent = who + ' · ' + state.records.length + ' loaded attempts' + (state.next ? ' · Partial history: load older assessments for more.' : ' · All available history loaded.');
    const data = reportData(state.records); box.append(el('p', data.reviewed.length + ' reviewed with report access · ' + state.records.filter(r => r.status === 'assigned').length + ' not recorded. Student reports include only shared final assessments.'));
    box.append(table(['Date', 'Passage / level', 'Status', 'Correct / assessed', 'Not assessed', 'Accuracy / trend', 'Feedback / next practice'], state.records.map(r => {
      const s = r.status === 'reviewed' ? r.summary : null;
      const bar = el('div'); bar.append(el('span', s?.percent == null ? 'Not assessed' : s.percent + '%')); if (s?.percent != null) { const track = el('div', null, 'bar'), fill = el('span'); fill.style.width = s.percent + '%'; track.append(fill); bar.append(track); }
      return [new Date(r.createdAt).toLocaleDateString(), r.exercise.title + ' / ' + r.exercise.level, statusLabel(r.status), s ? s.correct + ' / ' + s.attempted + ' ' + s.unitType : '—', s ? s.notAssessed : '—', bar, [r.feedback, r.recommendation].filter(Boolean).join(' · ') || '—'];
    }), 'Attempt history and accuracy trend · newest first'));
    const filter = $('skillFilter').value;
    box.append(table(['Skill', 'Assessed', 'Errors', 'Not assessed', 'Observed result'], data.skills.filter(s => filter === 'all' || s.kind === filter).map(s => [s.kind + ' · ' + s.label, s.assessed, s.errors, s.notAssessed, !s.assessed ? 'Not assessed' : s.errors ? 'Needs practice' : 'Correct on assessed units']), 'Letter and nekudah observations · teacher decides mastery'));
    const masteryBox = el('div'); box.append(masteryBox);
    const generation = state.generation, studentId = state.studentId;
    run(async () => {
      const response = await call({ action: 'skills' });
      if (generation !== state.generation || studentId !== state.studentId || !masteryBox.isConnected) return;
      const skills = new Map(data.skills.map(s => [C.skillId(s.kind, s.label), s]));
      Object.entries(response.skills).forEach(([id, s]) => { if (!skills.has(id)) skills.set(id, s); });
      const rows = [...skills].filter(([, s]) => filter === 'all' || s.kind === filter).map(([id, s]) => {
        const saved = response.skills[id];
        if (state.role === 'student') return [s.kind + ' · ' + s.label, saved?.state || 'No shared teacher decision'];
        const control = el('div'), decision = select([{ value: 'not-assessed', label: 'Not assessed / no mastery decision' }, { value: 'needs-practice', label: 'Needs practice' }, { value: 'mastered', label: 'Mastered (teacher decision)' }]); decision.value = saved?.state || 'not-assessed';
        const shared = input('checkbox'); shared.checked = saved?.shared === true; const label = field('Share decision with student', shared); label.className = 'check';
        control.append(decision, label, button('Save skill decision', async () => { await call({ action: 'setSkill', kind: s.kind, label: s.label, state: decision.value, shared: shared.checked }); status('Teacher mastery decision saved.'); }, 'secondary'));
        return [s.kind + ' · ' + s.label, control];
      });
      masteryBox.append(table(['Skill', 'Teacher mastery decision'], rows, 'Explicit teacher decisions · independent of automatic observation counts'));
    });
    const cats = {}; data.reviewed.forEach(r => Object.entries(r.summary.categories).forEach(([k, v]) => cats[k] = (cats[k] || 0) + v));
    box.append(table(['Mark category', 'Count'], Object.entries(cats), 'Categories in loaded final reviews'));
    if (state.role === 'teacher') box.append(button('Load class summary (latest 25 per student)', async () => {
      const rows = [];
      for (const s of state.students) { const data = await call({ action: 'list', studentId: s.id, limit: 25 }); const reviewed = data.records.filter(r => r.status === 'reviewed' && r.summary); const total = reviewed.reduce((n, r) => n + r.summary.attempted, 0); rows.push([s.name, data.records.length + (data.next ? '+' : ''), reviewed.length, total, reviewed.reduce((n, r) => n + r.summary.incorrect, 0), reviewed.filter(r => r.summary.notAssessed > 0).length]); }
      box.append(table(['Student', 'Attempts', 'Reviewed', 'Assessed units', 'Errors', 'Reviews with unassessed units'], rows, 'Class summary · bounded latest 25 per student · scoring units may differ; no combined percentage'));
    }, 'secondary'));
  }
  $('skillFilter').onchange = renderReport; $('print').onclick = () => window.print();
  try { $('fixtureLabel').hidden = !API.fixture; await API.init(() => run(identityChanged)); }
  catch (error) { status(error.message, true); }
})();
