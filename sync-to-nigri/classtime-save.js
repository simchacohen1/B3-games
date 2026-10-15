/* "Save to Nigri" for the Classtime review. THIS WRITES TO THE REAL NIGRI GRADEBOOK, so it is deliberately cautious:
   - it appears only after a successful Preview sync for the same choices;
   - for now it saves ONE chosen boy as a test mark named "TEST DELETE ME ..." (the whole-class option stays disabled);
   - a confirmation pop-up shows the class, mark name and number of boys before anything is sent;
   - it uses the owner's Google sign-in only: no key and no fallback;
   - after a save, or if the outcome is unknown, the button locks for that review and nothing is ever retried automatically. */
(function () {
  'use strict';
  const PREFIX = 'TEST DELETE ME';
  const $ = id => document.getElementById(id);
  const locks = new Map();   // review id -> {kind: 'saved' | 'partial' | 'unknown', testId}
  let ctx = null, busy = false;

  // Same rule as the server: a one-boy test mark is always visibly named so it is easy to find and delete in Nigri.
  function effectiveName(name) {
    const clean = String(name || '').trim();
    return (clean.toUpperCase().startsWith(PREFIX) ? clean : PREFIX + ' - ' + clean).slice(0, 120);
  }
  function chooseBoys(data) { return (data.students || []).filter(r => r.action === 'save' && r.report && r.report.attached && r.nigri_name); }
  function needsOverride(data) { const s = (data.duplicate_check || {}).status; return s === 'duplicate' || s === 'could_not_check'; }
  function lockOf() { return ctx ? locks.get(ctx.id) : null; }

  function confirmText(context, who) {
    const boy = chooseBoys(context.data).find(r => r.nigri_name === who);
    return 'Save to Nigri?\n\nClass: ' + context.result.class_section + '\nMark name: ' + effectiveName(context.name) + '\nBoys: 1 (' + (boy ? boy.classtime_name : who) + ')\n\n'
      + 'This writes a real mark to the Nigri gradebook. It will not be retried automatically.'
      + (context.override ? '\n\nNigri may already have this mark. You ticked "Save anyway".' : '');
  }
  function buildBody(context, who) {
    const body = {topic: context.choices.topic, type: context.choices.type, date: context.choices.date, test_name: context.name, only_student: who};
    if (context.override) Object.assign(body, {allow_duplicate: true, confirm_session_code: context.result.session_code, confirm_test_name: effectiveName(context.name)});
    return body;
  }

  function say(text, kind) { const e = $('saveStatus'); e.textContent = text; e.className = 'small ' + (kind || 'muted'); }
  function update() {
    const lock = lockOf(), who = $('saveWho').value;
    const ready = ctx && !busy && !lock && who && who !== '__class__' && (!ctx.override || $('saveAnyway').checked);
    const button = $('saveBtn');
    button.disabled = !ready;
    button.textContent = lock ? (lock.kind === 'saved' ? 'Saved, mark #' + (lock.testId || '?') : lock.kind === 'partial' ? 'Partly saved' + (lock.testId ? ', mark #' + lock.testId : '') + ': check Nigri' : 'Save status unknown: check Nigri') : 'Save to Nigri';
    $('saveWho').disabled = busy || Boolean(lock); $('saveAnyway').disabled = busy || Boolean(lock);
    $('saveAnywayRow').hidden = !(ctx && ctx.override);
  }
  function hide() { ctx = null; $('savePanel').hidden = true; }

  const OUTCOME = {'saved': 'Saved', 'left blank': 'Left blank (no score)', 'skipped': 'Skipped', 'failed': 'FAILED', 'not reached': 'Not reached'};
  function showResult(data) {
    const box = $('saveResult'); box.replaceChildren();
    const add = (text, cls) => { const p = document.createElement('p'); p.textContent = text; p.className = 'small ' + cls; box.append(p); };
    const bad = data.partial_mark_may_exist || !data.saved;
    if (data.message) add(data.message, bad ? 'warn' : 'good');
    if (data.partial_mark_may_exist) add('A partial mark may exist in Nigri. Check Nigri. Do not save again from here.', 'warn');
    (data.warnings || []).forEach(w => add('Warning: ' + w, 'warn'));
    if ((data.per_boy || []).length) {
      const table = document.createElement('table'), head = table.createTHead().insertRow();
      ['Classtime student', 'Result', 'Details'].forEach(h => { const th = document.createElement('th'); th.textContent = h; head.append(th); });
      const body = table.createTBody();
      data.per_boy.forEach(b => { const tr = body.insertRow(); [b.classtime_name, OUTCOME[b.outcome] || b.outcome, b.detail || ''].forEach(v => { tr.insertCell().textContent = v; }); });
      const wrap = document.createElement('div'); wrap.className = 'tablewrap'; wrap.append(table); box.append(wrap);
    }
  }
  function lockNow(kind, testId) { if (ctx) locks.set(ctx.id, {kind, testId}); }

  function errorText(status, data) {
    if (status === 401) return 'Sign-in refused. Use your owner Google account (the Test Nigri sign-in button checks this).';
    if (status === 404) return 'This review has expired (reviews last one hour). Load the session again.';
    return (data && (data.error || data.message)) || 'Nothing was saved (the server answered ' + status + ').';
  }

  function handle(status, data) {
    if (data.saved === true) { lockNow('saved', data.test_id); showResult(data); say('', 'muted'); return; }
    if (data.partial_mark_may_exist === true) { lockNow(data.test_id ? 'partial' : 'unknown', data.test_id); showResult(data); say('', 'muted'); return; }
    // The server refused before writing anything.
    const text = errorText(status, data);
    if (status === 409 && /already saved/i.test(text)) { lockNow('saved', (text.match(/#(\d+)/) || [])[1]); showResult({message: text, saved: false}); return; }
    if (status === 409 && /already running|will not be retried/i.test(text)) { lockNow('unknown'); showResult({message: text, saved: false}); return; }
    if (data && data.can_override && ctx && !ctx.override) { ctx.override = true; say(text + ' Tick "Save anyway" below if you really want to.', 'warn'); return; }
    say(text, 'warn');
  }

  async function run() {
    if (busy || !ctx || lockOf()) return;
    const who = $('saveWho').value;
    if (!who || who === '__class__' || (ctx.override && !$('saveAnyway').checked)) return;
    if (!window.confirm(confirmText(ctx, who))) return;       // nothing is sent unless you confirm
    busy = true; update(); $('saveResult').replaceChildren();
    try {
      if (!window.NigriAuth || !(await window.NigriAuth.getToken())) { say('Not signed in. Use "Sign in with Google" above first.', 'warn'); return; }
      say('Saving to Nigri… this can take a few minutes. Do not click again or close this page.', 'muted');
      // Google sign-in only: no key is passed, so there is no fallback.
      const sent = await window.NigriAuth.request('/classtime/reviews/' + encodeURIComponent(ctx.id) + '/sync-save',
        {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(buildBody(ctx, who))});
      let data = {};
      try { data = await sent.response.json(); } catch (error) { data = {}; }
      handle(sent.response.status, data);
    } catch (error) {
      // We do not know whether the server saved anything. Lock the button; never retry on our own.
      lockNow('unknown'); showResult({message: 'The page lost contact with the server, so it is not known whether the save happened. Check Nigri before doing anything else. It will not be retried automatically.', saved: false, partial_mark_may_exist: true});
      say('', 'muted');
    } finally { busy = false; update(); }
  }

  function open(detail) {
    // The server keeps this feature paused until the owner separately
    // authorizes the first real one-student test. A dry-run preview alone
    // must never reveal an actionable save control.
    if (!detail || !detail.data || detail.data.real_save_enabled !== true) { hide(); return; }
    const boys = chooseBoys(detail.data);
    ctx = {id: detail.id, result: detail.result, choices: detail.choices, data: detail.data, name: detail.choices.test_name || window.ClasstimePreview.defaultName(detail.result), override: needsOverride(detail.data)};
    const who = $('saveWho'); who.replaceChildren();
    who.append(new Option(boys.length ? 'Choose one boy…' : 'No boy available to save', ''));
    boys.forEach(b => who.append(new Option(b.classtime_name, b.nigri_name)));
    const whole = new Option('Whole class: not available yet', '__class__'); whole.disabled = true; who.append(whole);
    who.value = ''; $('saveAnyway').checked = false;
    $('saveSummary').textContent = 'Class ' + ctx.result.class_section + ' · mark name "' + effectiveName(ctx.name) + '" · one boy only (a test mark you can delete in Nigri).';
    if (!lockOf()) { $('saveResult').replaceChildren(); say(boys.length ? '' : 'No boy with a score and a verified report is available.', 'muted'); }
    $('savePanel').hidden = false; update();
  }

  function setup() {
    $('saveWho').addEventListener('change', update); $('saveAnyway').addEventListener('change', update); $('saveBtn').addEventListener('click', run);
    document.addEventListener('classtime:preview-ok', event => open(event.detail));
    document.addEventListener('classtime:preview-start', () => { if (!lockOf() && !busy) hide(); });
    document.addEventListener('classtime:review', () => { hide(); $('saveResult').replaceChildren(); say('', 'muted'); });
    document.addEventListener('classtime:review-cleared', () => { hide(); });
    // Changing a choice after the preview means the preview no longer matches: hide the Save section until you preview again.
    ['previewTopic', 'previewType', 'previewDate', 'previewName'].forEach(id => ['input', 'change'].forEach(type => $(id).addEventListener(type, () => {
      if (ctx && !lockOf() && !busy) { hide(); say('', 'muted'); }
    })));
  }

  window.ClasstimeSave = {effectiveName, chooseBoys, needsOverride, confirmText, buildBody};
  if (document.getElementById('saveBtn')) setup();
})();
