/* "Preview sync" for the Classtime review. READ-ONLY: it asks the server what a save WOULD do and shows the answer.
   It never saves anything to Nigri. It signs in with the owner's Google sign-in only (no key, no fallback). */
(function () {
  'use strict';
  const TOPICS = ['Shoroshim', 'Chumash Comprehension', 'Chumash Translation', 'Chumash', 'Chumash-Rashi', 'Halacha-Yahadus', 'Parsha'];
  const TYPES = [['Quiz', 'quiz'], ['Test/Project', 'test'], ['Classwork', 'classwork'], ['Homework', 'homework']];
  const $ = id => document.getElementById(id);
  let current = null, busy = false, generation = 0;

  // Same default the server suggests: the Classtime title plus the session code.
  function defaultName(result) { return (String(result.session_name || 'Classtime') + ' (' + result.session_code + ')').slice(0, 120); }
  // Pick the topic whose name appears in the session title (longest first), otherwise Shoroshim.
  function guessTopic(result) {
    const title = String(result.session_name || '').toLowerCase();
    return [...TOPICS].sort((a, b) => b.length - a.length).find(t => title.includes(t.toLowerCase())) || TOPICS[0];
  }
  function today() { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  function plainDuplicate(check) {
    if (check.status === 'skipped') return {text: 'Duplicates are not checked in Nigri. Check Nigri yourself before saving this session again.', kind: 'warn'};
    if (check.status === 'clear') return {text: 'Not saved yet: no mark for this session was found in Nigri.', kind: 'good'};
    if (check.status === 'duplicate') return {text: 'Already saved: Nigri already has a mark for this session' + (check.matches && check.matches.length ? ' ("' + check.matches[0] + '")' : '') + '. A real save would refuse.', kind: 'warn'};
    return {text: 'Could not check whether this session is already saved' + (check.detail ? ' (' + check.detail + ')' : '') + '. A real save would refuse until it can check.', kind: 'warn'};
  }

  // Plain-language summary lines for a server answer.
  function summarize(data) {
    const c = data.counts || {}, lines = [];
    lines.push({text: 'Preview only. Nothing was saved to Nigri.', kind: 'good'});
    lines.push(plainDuplicate(data.duplicate_check || {}));
    lines.push({text: (c.will_save || 0) + (c.will_save === 1 ? ' boy' : ' boys') + ' would be saved.', kind: (c.will_save || 0) ? 'good' : 'warn'});
    if (c.left_blank_no_score) lines.push({text: c.left_blank_no_score + (c.left_blank_no_score === 1 ? ' boy has' : ' boys have') + ' no score and would be left blank (never sent as 0).', kind: 'muted'});
    if (c.skipped_unmatched) lines.push({text: c.skipped_unmatched + (c.skipped_unmatched === 1 ? ' boy is' : ' boys are') + ' not matched to a Nigri student and would be skipped.', kind: 'warn'});
    const pdfProblems = (data.blockers || []).filter(b => /PDF|report/i.test(b)), others = (data.blockers || []).filter(b => !/PDF|report/i.test(b) && !/already saved|already exists/i.test(b));
    pdfProblems.forEach(b => lines.push({text: 'Problem with a report: ' + b + '.', kind: 'warn'}));
    others.forEach(b => lines.push({text: 'Problem: ' + b + '.', kind: 'warn'}));
    if (!(data.blockers || []).length) lines.push({text: 'No problems found. (Saving is still switched off.)', kind: 'good'});
    return lines;
  }

  function rowText(row) {
    if (row.action === 'save') return {action: 'Would save', detail: (row.mark_percent === null ? '' : row.mark_percent + '% (' + row.points + ' / ' + row.maximum_points + '). ') + (row.report ? 'Report attached (' + row.report.kb + ' KB).' : 'No verified report!')};
    if (row.action === 'blank') return {action: 'Left blank', detail: 'No score. Not sent as 0.'};
    return {action: 'Skipped', detail: 'Not matched to a Nigri student.'};
  }

  function errorText(status, data) {
    if (status === 401) return 'Sign-in refused. Use your owner Google account (the Test Nigri sign-in button checks this).';
    if (status === 404) return 'This review has expired (reviews last one hour). Load the session again.';
    if (status === 409) return 'The review is not ready yet. Wait for it to finish loading.';
    if (status === 400) return (data && data.error) || 'The choices were not accepted.';
    return 'The preview could not be made (the server answered ' + status + ').';
  }

  function say(text, kind) { const e = $('previewStatus'); e.textContent = text; e.className = 'small ' + (kind || 'muted'); }

  function show(data) {
    const box = $('previewResult'); box.replaceChildren();
    summarize(data).forEach(line => { const p = document.createElement('p'); p.textContent = line.text; p.className = 'small ' + line.kind; box.append(p); });
    const table = document.createElement('table'), head = table.createTHead().insertRow();
    ['Classtime student', 'What would happen', 'Details'].forEach(h => { const th = document.createElement('th'); th.textContent = h; head.append(th); });
    const body = table.createTBody();
    (data.students || []).forEach(row => {
      const t = rowText(row), tr = body.insertRow();
      [row.classtime_name, t.action, t.detail].forEach(v => { tr.insertCell().textContent = v; });
    });
    const wrap = document.createElement('div'); wrap.className = 'tablewrap'; wrap.append(table); box.append(wrap);
  }

  async function run() {
    if (busy || !current) return;
    busy = true; const mine = generation, review = current; $('previewBtn').disabled = true; $('previewResult').replaceChildren();
    document.dispatchEvent(new CustomEvent('classtime:preview-start'));
    try {
      if (!window.NigriAuth || !(await window.NigriAuth.getToken())) { say('Not signed in. Use "Sign in with Google" above first.', 'warn'); return; }
      say('Checking Nigri… this can take up to a minute.', 'muted');
      const body = {topic: $('previewTopic').value, type: $('previewType').value, date: $('previewDate').value, test_name: $('previewName').value.trim() || undefined};
      // Google sign-in only: no key is passed, so there is no fallback.
      const {response} = await window.NigriAuth.request('/classtime/reviews/' + encodeURIComponent(current.id) + '/sync-preview',
        {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      if (mine !== generation) return;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { say(errorText(response.status, data), 'warn'); return; }
      say('', 'muted'); show(data);
      // Tell the Save section which review and which choices this successful preview was for.
      if (data.dry_run === true) document.dispatchEvent(new CustomEvent('classtime:preview-ok', {detail: {id: review.id, result: review.result,
        choices: {topic: body.topic, type: body.type, date: body.date, test_name: body.test_name || ''}, data}}));
    } catch (error) { if (mine === generation) say('Could not reach the server.', 'warn'); }
    finally { busy = false; $('previewBtn').disabled = false; }
  }

  function setup() {
    const topic = $('previewTopic'), type = $('previewType');
    TOPICS.forEach(t => topic.append(new Option(t, t)));
    TYPES.forEach(([label, value]) => type.append(new Option(label, value)));
    $('previewDate').value = today();
    $('previewBtn').addEventListener('click', run);
    document.addEventListener('classtime:review', event => {
      generation++; current = event.detail; $('preview').hidden = false; $('previewResult').replaceChildren(); say('', 'muted');
      $('previewName').value = defaultName(current.result); topic.value = guessTopic(current.result);
    });
    document.addEventListener('classtime:review-cleared', () => { generation++; current = null; $('preview').hidden = true; $('previewResult').replaceChildren(); say('', 'muted'); });
  }

  window.ClasstimePreview = {TOPICS, TYPES, defaultName, guessTopic, summarize, rowText, errorText, plainDuplicate};
  if (document.getElementById('previewBtn')) setup();
})();
