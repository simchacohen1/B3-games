/* Mishnayos Practice: one recording per line, drafts, one Submit (issue #692).
 *
 * Each line of the mishna has its own record button. One recording covers
 * reading the line and translating it. Recordings are drafts saved to the
 * student's own space, so he can leave and come back. Nothing goes to the
 * teacher until he presses Submit. He does not have to record every line:
 * Submit sends the lines he recorded. After that he cannot re-record until the
 * teacher grades it; a gold-standard mishna stays locked for a month.
 *
 * Loaded after the main script of student.html and uses its globals:
 * db, storage, studentId, teacherPreview, firebaseConfig, MASECHES_KEY,
 * SEFORIM, selectedSefer, perekName, hebrewNumeral, hebrewLetters,
 * PEREK_ORDINALS, escapeMishnahHtml.
 */
(function(){
  'use strict';
  const ROOT = 'posukPractice/mishnayos';
  const MAX_RECORD_MS = 120000;
  const MIN_RECORD_MS = 700;
  const LOCK_DAYS = 30;
  const submitUrl = () => 'https://us-central1-' + firebaseConfig.projectId + '.cloudfunctions.net/mishnayosSubmissions';

  let cur = null;          // {key, perek, mishnah, lineCount, label}
  let drafts = {};         // line index -> {path, mime, durationMs, savedAt}
  let localUrls = {};      // line index -> object URL of a recording made in this tab
  let sub = null;          // this mishna's submission record
  let subLoaded = false, draftsLoaded = false;
  let rec = null;          // the recording in progress
  let saving = {};         // line index -> true while uploading
  let listeners = [];
  let player = null, playingLine = -1;
  let noticesStarted = false;
  let fitTimer = 0;

  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const keyFor = (perek, mishnah) => MASECHES_KEY + '_' + perek + '_' + mishnah;
  const labelFor = (perek, mishnah) => (SEFORIM[selectedSefer] ? SEFORIM[selectedSefer].hebrew : '') + ' ' + hebrewNumeral(perek) + ':' + hebrewNumeral(mishnah);
  const dateText = ms => new Date(Number(ms)).toLocaleDateString(undefined, { month:'long', day:'numeric' });
  const live = () => !teacherPreview && !!studentId;

  function state(){
    if(!sub) return 'open';
    if(sub.status === 'submitted' || sub.status === 'submitting') return 'waiting';
    if(Number(sub.lockedUntil) > Date.now()) return 'locked';
    return 'open';
  }
  function recordedCount(){
    let n = 0;
    for(let i = 0; i < (cur ? cur.lineCount : 0); i++) if(drafts[i] || localUrls[i]) n++;
    return n;
  }

  /* ---------- The page: every line on its own row with its own buttons ---------- */
  function pageHtml(perekNum, info){
    const name = perekName(perekNum);
    const heading =
      '<div class="mishnah-heading">' +
        '<span class="mishnah-maseches">מסכת ' + escapeMishnahHtml(SEFORIM[selectedSefer].hebrew) + '</span>' +
        '<span class="mishnah-perek">פרק ' + (PEREK_ORDINALS[perekNum - 1] || hebrewNumeral(perekNum)) + (name ? ' · ' + escapeMishnahHtml(name) : '') +
        ' · משנה ' + hebrewNumeral(info.mishnah) + '</span>' +
      '</div>';
    const rows = info.mishnahLines.map((line, i) => {
      let html = escapeMishnahHtml(line);
      if(i === 0){
        const sp = line.indexOf(' ');
        html = '<span class="mishnah-letter inline" aria-label="משנה ' + hebrewNumeral(info.mishnah) + '">' + hebrewLetters(info.mishnah) + '</span>' +
          '<b class="mishnah-first-word">' + escapeMishnahHtml(sp > 0 ? line.slice(0, sp) : line) + '</b>' + escapeMishnahHtml(sp > 0 ? line.slice(sp) : '');
      }
      return '<div class="line-row" data-line="' + i + '">' +
        '<div class="line-text">' + html + '</div>' +
        '<div class="line-tools">' +
          '<button type="button" class="line-rec" data-line="' + i + '" aria-label="Record line ' + (i + 1) + '" title="Record this line: read it, then say what it means">🎙️</button>' +
          '<button type="button" class="line-play hidden" data-line="' + i + '" aria-label="Play line ' + (i + 1) + '" title="Listen to your recording">▶️</button>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="mishnah-page lines-page">' + heading + '<div class="mishnah-body">' + rows + '</div></div>';
  }

  /* Each line stays on one row: use the largest Hebrew size (the same for
     every line) at which every line fits. On a narrow phone some long lines
     cannot fit even at the smallest readable size; then use the largest size
     that makes no MORE lines wrap than that, and only those lines wrap. */
  function fitLines(){
    const page = document.querySelector('#posukText .lines-page');
    if(!page) return;
    const rows = Array.from(page.querySelectorAll('.line-row'));
    rows.forEach(r => r.classList.remove('wraps'));
    const MAX = 30, FLOOR = 18;
    const overflowing = size => {
      page.style.setProperty('--line-size', size + 'px');
      return rows.filter(r => { const t = r.querySelector('.line-text'); return t.scrollWidth > t.clientWidth + 1; });
    };
    const mustWrap = overflowing(FLOOR).length;
    let size = MAX;
    while(size > FLOOR && overflowing(size).length > mustWrap) size -= 1;
    overflowing(size).forEach(r => r.classList.add('wraps'));
  }
  window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitLines, 120); });

  /* ---------- Opening and closing a mishna ---------- */
  function stopListeners(){ listeners.forEach(off => { try{ off(); }catch(_){} }); listeners = []; }
  function close(){
    cancelRecording();
    stopPlayback();
    stopListeners();
    Object.values(localUrls).forEach(u => { try{ URL.revokeObjectURL(u); }catch(_){} });
    cur = null; drafts = {}; localUrls = {}; sub = null; saving = {}; subLoaded = draftsLoaded = false;
    document.body.classList.remove('lines-mode');
    const panel = $('lineRecorder'); if(panel) panel.classList.add('hidden');
  }
  function open(perekNum, info){
    close();
    document.body.classList.add('lines-mode');
    cur = { key: keyFor(perekNum, info.mishnah), perek: perekNum, mishnah: info.mishnah, lineCount: info.mishnahLines.length, label: labelFor(perekNum, info.mishnah) };
    $('posukText').innerHTML = pageHtml(perekNum, info);
    $('posukText').querySelectorAll('.line-rec').forEach(b => b.onclick = () => onRecordTap(Number(b.dataset.line)));
    $('posukText').querySelectorAll('.line-play').forEach(b => b.onclick = () => togglePlay(Number(b.dataset.line)));
    $('lineRecorder').classList.remove('hidden');
    $('submitMsg').textContent = '';
    fitLines();
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(fitLines);
    setTimeout(fitLines, 400);
    if(live()){
      const key = cur.key;
      const subRef = db.ref(ROOT + '/submissions/' + studentId + '/' + key);
      const draftRef = db.ref(ROOT + '/drafts/' + studentId + '/' + key + '/lines');
      const onSub = subRef.on('value', s => { if(!cur || cur.key !== key) return; sub = s.val(); subLoaded = true; render(); },
        err => { console.error('Mishnayos: could not read submission', err); subLoaded = true; render(); });
      const onDraft = draftRef.on('value', s => { if(!cur || cur.key !== key) return; const v = s.val() || {}; drafts = Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [i, x]).filter(([, x]) => x)) : v; draftsLoaded = true; render(); },
        err => { console.error('Mishnayos: could not read drafts', err); draftsLoaded = true; render(); });
      listeners.push(() => subRef.off('value', onSub), () => draftRef.off('value', onDraft));
    }else{
      subLoaded = draftsLoaded = true;
    }
    render();
  }

  /* ---------- Drawing the current state ---------- */
  function render(){
    if(!cur) return;
    const st = state(), ready = subLoaded && draftsLoaded;
    const rows = $('posukText').querySelectorAll('.line-row');
    rows.forEach(row => {
      const i = Number(row.dataset.line);
      const has = !!(drafts[i] || localUrls[i]);
      const isRec = rec && rec.line === i;
      row.classList.toggle('recorded', has && st === 'open');
      row.classList.toggle('recording', !!isRec);
      row.classList.toggle('locked', st !== 'open');
      const recBtn = row.querySelector('.line-rec'), playBtn = row.querySelector('.line-play');
      recBtn.disabled = !ready || st !== 'open' || !!saving[i] || (!!rec && !isRec);
      recBtn.classList.toggle('recording', !!isRec);
      recBtn.classList.toggle('done', has && !isRec);
      recBtn.textContent = isRec ? '⏹' : saving[i] ? '⏳' : '🎙️';
      recBtn.title = isRec ? 'Stop recording' : has ? 'Record this line again' : 'Record this line: read it, then say what it means';
      playBtn.classList.toggle('hidden', !has || st !== 'open' || !!isRec);
      playBtn.textContent = playingLine === i ? '⏸' : '▶️';
    });
    const n = recordedCount(), total = cur.lineCount;
    $('lineCount').textContent = n + ' of ' + total + ' lines recorded';
    $('lineCountBar').style.width = Math.round(100 * n / total) + '%';
    const status = $('lineStatus');
    let html = '', cls = '';
    if(!ready){ html = 'Loading your recordings…'; }
    else if(st === 'waiting'){
      cls = 'waiting';
      html = '⏳ <b>Sent to your teacher.</b> You can record this mishna again after your teacher grades it.';
    }else if(st === 'locked'){
      cls = 'gold';
      html = '🏅 <b>Gold standard!</b> This mishna is done until ' + esc(dateText(sub.lockedUntil)) + '.' + gradeLine(sub.grade);
    }else if(sub && sub.status === 'graded' && sub.grade && !sub.grade.gold){
      cls = 'retry';
      html = '🔁 <b>Your teacher wants you to try this mishna again.</b>' + gradeLine(sub.grade) + ' Record the lines again and submit.';
    }else if(sub && sub.status === 'graded' && sub.grade && sub.grade.gold){
      html = '🏅 You earned gold standard on this mishna. You can practice it again.';
    }
    status.className = 'line-status' + (cls ? ' ' + cls : '') + (html ? '' : ' hidden');
    status.innerHTML = html;
    const btn = $('submitMishnaBtn');
    btn.classList.toggle('hidden', st !== 'open');
    btn.disabled = !ready || n < 1 || !!rec || Object.keys(saving).length > 0 || !live();
    $('lineHelp').classList.toggle('hidden', st !== 'open');
    if(!live()) $('submitMsg').textContent = teacherPreview ? 'Preview: recordings stay in this tab and nothing is sent.' : '';
  }
  function gradeLine(g){
    if(!g) return '';
    const parts = [];
    parts.push(g.mistakes ? g.mistakes + ' mistake' + (g.mistakes === 1 ? '' : 's') : 'no mistakes');
    const comment = g.comment ? ' <span class="teacher-comment">“' + esc(g.comment) + '”</span>' : '';
    return ' <span class="grade-detail">(' + parts.join(', ') + ')</span>' + comment;
  }

  /* ---------- Recording ---------- */
  function pickMime(){
    if(!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  }
  const extFor = mime => /mp4|aac|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';

  async function onRecordTap(i){
    if(!cur || state() !== 'open') return;
    if(rec && rec.line === i){ finishRecording(); return; }
    if(rec || saving[i]) return;
    stopPlayback();
    let stream;
    try{ stream = await navigator.mediaDevices.getUserMedia({ audio:true }); }
    catch(err){ $('submitMsg').textContent = '🎙️ The microphone is not available. Allow the microphone and try again.'; return; }
    const mime = pickMime();
    let recorder;
    try{ recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch(err){ stream.getTracks().forEach(t => t.stop()); $('submitMsg').textContent = 'Recording is not supported in this browser.'; return; }
    const chunks = [];
    recorder.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    const key = cur.key;
    rec = { line: i, recorder, stream, chunks, startedAt: Date.now(), key, cancelled: false,
      timer: setTimeout(() => finishRecording(), MAX_RECORD_MS) };
    recorder.onstop = () => onRecorderStop(rec && rec.recorder === recorder ? rec : null, recorder, chunks, i, key);
    recorder.start(250);
    render();
  }
  function finishRecording(){
    if(!rec) return;
    clearTimeout(rec.timer);
    try{ rec.recorder.state !== 'inactive' ? rec.recorder.stop() : null; }catch(_){}
  }
  function cancelRecording(){
    if(!rec) return;
    rec.cancelled = true;
    finishRecording();
    try{ rec.stream.getTracks().forEach(t => t.stop()); }catch(_){}
    rec = null;
  }
  async function onRecorderStop(r, recorder, chunks, i, key){
    const startedAt = r ? r.startedAt : Date.now();
    const cancelled = !r || r.cancelled;
    try{ recorder.stream.getTracks().forEach(t => t.stop()); }catch(_){}
    if(rec && rec.recorder === recorder) rec = null;
    const durationMs = Date.now() - startedAt;
    if(cancelled || !cur || cur.key !== key){ render(); return; }
    if(durationMs < MIN_RECORD_MS || !chunks.length){ $('submitMsg').textContent = 'That recording was too short. Try again.'; render(); return; }
    const mime = (recorder.mimeType || chunks[0].type || 'audio/webm');
    const blob = new Blob(chunks, { type: mime });
    if(localUrls[i]) URL.revokeObjectURL(localUrls[i]);
    localUrls[i] = URL.createObjectURL(blob);
    if(!live()){ render(); return; }
    await saveDraft(i, key, blob, mime, durationMs);
  }
  async function saveDraft(i, key, blob, mime, durationMs){
    saving[i] = true; render();
    const old = drafts[i] && drafts[i].path;
    const path = 'posukPractice/' + studentId + '/mishnayosDrafts/' + key + '/line' + (i + 1) + '_' + Date.now() + '.' + extFor(mime);
    try{
      await storage.ref(path).put(blob, { contentType: mime.split(';')[0] });
      try{
        await db.ref(ROOT + '/drafts/' + studentId + '/' + key).update({
          ['lines/' + i]: { path, mime: mime.slice(0, 59), durationMs: Math.round(durationMs), savedAt: Date.now() },
          updatedAt: Date.now()
        });
      }catch(err){
        storage.ref(path).delete().catch(() => {});
        throw err;
      }
      if(old && old !== path) storage.ref(old).delete().catch(() => {});
      $('submitMsg').textContent = '';
    }catch(err){
      console.error('Mishnayos: could not save line', err);
      if(cur && cur.key === key){
        if(localUrls[i]){ URL.revokeObjectURL(localUrls[i]); delete localUrls[i]; }
        $('submitMsg').textContent = state() === 'open' ? '⚠️ Line ' + (i + 1) + ' did not save. Check your internet and record it again.' : '';
      }
    }finally{
      delete saving[i];
      render();
    }
  }

  /* ---------- Playback ---------- */
  function stopPlayback(){
    if(player){ try{ player.pause(); }catch(_){} }
    player = null; playingLine = -1;
  }
  async function togglePlay(i){
    if(playingLine === i){ stopPlayback(); render(); return; }
    stopPlayback();
    let url = localUrls[i];
    if(!url && drafts[i] && drafts[i].path){
      try{ url = await storage.ref(drafts[i].path).getDownloadURL(); }
      catch(err){ $('submitMsg').textContent = 'Could not play that recording.'; return; }
    }
    if(!url) return;
    const a = new Audio(url);
    player = a; playingLine = i;
    a.onended = a.onerror = () => { if(player === a){ player = null; playingLine = -1; render(); } };
    a.play().catch(() => { if(player === a){ player = null; playingLine = -1; render(); } });
    render();
  }

  /* ---------- Submit ---------- */
  async function submit(){
    if(!cur || !live() || state() !== 'open') return;
    const total = cur.lineCount, n = recordedCount();
    if(n < 1) return;
    const what = n === total ? 'all ' + total + ' lines' : n + ' of ' + total + ' lines';
    const skipped = n === total ? '' : '\n\nThe lines you did not record will not be sent. To earn gold standard you need to record every line.';
    if(!confirm('Send ' + what + ' to your teacher?' + skipped + '\n\nYou cannot record this mishna again until your teacher grades it.')) return;
    const btn = $('submitMishnaBtn'), msg = $('submitMsg');
    btn.disabled = true; msg.textContent = 'Sending to your teacher…';
    try{
      const user = firebase.auth().currentUser;
      if(!user) throw new Error('Please sign in again from Fun Torah Tools.');
      const r = await fetch(submitUrl(), { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + await user.getIdToken() },
        body: JSON.stringify({ action:'submit', key: cur.key }) });
      const data = await r.json().catch(() => ({}));
      if(!r.ok) throw new Error(data.error || 'That did not go through. Please try again.');
      Object.values(localUrls).forEach(u => { try{ URL.revokeObjectURL(u); }catch(_){} });
      localUrls = {};
      msg.textContent = '';
    }catch(err){
      msg.textContent = '⚠️ ' + (err.message || 'That did not go through. Please try again.');
    }finally{
      render();
    }
  }

  /* ---------- Notices: "sent, +5 points" and "your teacher graded it" ---------- */
  function noticeHtml(n){
    if(n.kind === 'submitted'){
      return '<h2>📤 Sent to your teacher!</h2><p>' + esc(n.label || '') + '</p>' +
        (n.points ? '<div class="notice-points">+' + n.points + ' points</div>' : '') +
        (n.pointsNotAdded ? '<p class="notice-small">Your points could not be added to Student Rewards. Tell your teacher.</p>' : '');
    }
    const lines = [];
    if(n.gold) lines.push('Gold standard: +' + (n.gradePoints || 0) + (n.mistakes ? ' (10 minus ' + n.mistakes + ' mistake' + (n.mistakes === 1 ? '' : 's') + ')' : ''));
    else lines.push('Not gold standard yet' + (n.mistakes ? ' · ' + n.mistakes + ' mistake' + (n.mistakes === 1 ? '' : 's') : '') + '. You can try again.');
    if(n.bonus) lines.push('Teacher bonus: +' + n.bonus);
    return '<h2>' + (n.gold ? '🏅 Gold standard!' : '🔁 Your teacher graded it') + '</h2>' +
      '<p>' + esc(n.label || '') + '</p>' +
      '<ul class="notice-list">' + lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' +
      (n.points ? '<div class="notice-points">+' + n.points + ' points</div>' : '') +
      (n.comment ? '<p class="teacher-comment">“' + esc(n.comment) + '”</p>' : '') +
      (n.gold && n.lockedUntil ? '<p class="notice-small">This mishna is done until ' + esc(dateText(n.lockedUntil)) + '.</p>' : '') +
      (n.pointsNotAdded ? '<p class="notice-small">Your points could not be added to Student Rewards. Tell your teacher.</p>' : '');
  }
  let shownNotice = '';
  function showNextNotice(all){
    const modal = $('noticeModal');
    if(!modal || modal.classList.contains('show')) return;
    const next = Object.entries(all || {}).filter(([, n]) => n && !n.seen).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))[0];
    if(!next || next[0] === shownNotice) return;
    shownNotice = next[0];
    $('noticeBody').innerHTML = noticeHtml(next[1]);
    modal.classList.add('show');
    $('noticeOkBtn').onclick = () => {
      modal.classList.remove('show');
      db.ref(ROOT + '/notices/' + studentId + '/' + next[0] + '/seen').set(true).catch(err => console.error('Mishnayos: notice', err));
    };
  }
  function startNotices(){
    if(noticesStarted || !live()) return;
    noticesStarted = true;
    db.ref(ROOT + '/notices/' + studentId).limitToLast(15).on('value', s => showNextNotice(s.val()),
      err => console.error('Mishnayos: could not read notices', err));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('submitMishnaBtn'); if(btn) btn.onclick = submit;
  });
  if(document.readyState !== 'loading'){ const btn = $('submitMishnaBtn'); if(btn) btn.onclick = submit; }

  /* True while a line is being recorded or a draft is still uploading. */
  const busy = () => !!rec || Object.keys(saving).length > 0;

  window.MishnayosLines = { open, close, startNotices, fitLines, busy, LOCK_DAYS };
})();
