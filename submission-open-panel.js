/* "Open for sending" controls for the teacher, shown under the Class Access lock panel.

   Boys can always record, practice and mark themselves. They can only SEND a posuk or Rashi recording to the teacher
   when it is open here: for the whole class, or for one boy. Everything starts closed.
   The server decides what is allowed (funTorahClassAccess); this page only asks it to open or close items.

   admin.html calls B3SubmissionOpenPanel.mount(hostElement, { classId, className, call, students }) after each time it
   redraws the class panel. The panel keeps its own element, so what the teacher is typing is not lost on a redraw. */
(function (root) {
  'use strict';
  const CSS = '.so-card{max-width:720px;margin:16px auto 0;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;box-shadow:0 4px 14px rgba(15,23,42,.06);border-left:6px solid #16a34a}'
    + '.so-card h3{margin:0 0 4px;font-size:20px}.so-card p{margin:4px 0 12px;color:#64748b;font-size:15px;line-height:1.4}'
    + '.so-state{border-radius:12px;padding:10px 12px;font-weight:800;margin:0 0 12px}.so-state.none{background:#f1f5f9;color:#475569}.so-state.some{background:#e3f6e8;color:#14532d}.so-state.all{background:#dcfce7;color:#166534}'
    + '.so-bulk{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.so-bulk button{flex:1 1 180px}'
    + '.so-card button{font:inherit;font-weight:800;border-radius:12px;border:2px solid #cbd5e1;background:#fff;padding:10px 12px;cursor:pointer;min-height:44px}'
    + '.so-card button:disabled{opacity:.5;cursor:default}.so-card button.go{background:#16a34a;border-color:#16a34a;color:#fff}.so-card button.stop{background:#fff;border-color:#dc2626;color:#b91c1c}'
    + '.so-card button.on{background:#0f172a;color:#fff;border-color:#0f172a}'
    + '.so-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.so-row label{font-weight:700;min-width:70px}'
    + '.so-card select,.so-card input[type=number]{font:inherit;padding:9px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;max-width:100%}.so-card input[type=number]{width:84px}'
    + '.so-tabs{display:flex;gap:8px;margin:12px 0 6px}.so-tabs button{flex:1}'
    + '.so-list{margin-top:14px}.so-list h4{margin:0 0 6px;font-size:15px}.so-chips{display:flex;gap:6px;flex-wrap:wrap}'
    + '.so-chip{display:inline-flex;gap:6px;align-items:center;background:#e3f6e8;color:#14532d;border:1px solid #86efac;border-radius:999px;padding:4px 6px 4px 12px;font-weight:700;font-size:14px}'
    + '.so-chip button{min-height:28px!important;padding:0 8px!important;border-radius:999px!important;border:0!important;background:#fff!important;color:#b91c1c!important;line-height:1}'
    + '.so-picklist{max-height:300px;overflow:auto;border:1px solid #cbd5e1;border-radius:12px;padding:6px 10px;margin:8px 0;background:#f8fafc}.so-pick-head{font-weight:800;margin:10px 0 4px;color:#0f172a}'
    + '.so-pick{display:block;padding:5px 2px;font-weight:600;cursor:pointer}.so-pick.done{color:#166534}.so-pick input{margin-right:6px}'
    + '.so-empty{color:#64748b;font-weight:600}.so-msg{min-height:1.4em;margin-top:10px;font-weight:700}.so-msg.err{color:#b91c1c}'
    + '.so-boys{margin-top:10px;font-size:14px;color:#334155}.so-boys b{color:#0f172a}';
  const RASHI_SECTIONS = [
    ['zayin', 'Mission 1 (ז) words'], ['bet', 'Mission 2 (בּ / ב) words'], ['tsadi', 'Mission 3 (צ) words'], ['alef', 'Mission 4 (א) words'],
    ['tsadisofit', 'Mission 5 (ץ) words'], ['memsofit', 'Mission 6 (ם) words'], ['shin', 'Mission 7 (שׁ / שׂ) words'], ['samech', 'Mission 8 (ס) words'],
    ['finalreview', 'Final review words'], ['words2', '2-letter words'], ['words3', '3-letter words'], ['words4', '4-letter words']
  ];
  const esc = v => { const d = root.document.createElement('div'); d.textContent = String(v == null ? '' : v); return d.innerHTML; };

  let state = null; // the one panel: { el, classId, className, call, students, data, who, kind, busy, msg, ... }

  function ensureStyle() {
    if (root.document.getElementById('soStyle')) return;
    const style = root.document.createElement('style'); style.id = 'soStyle'; style.textContent = CSS; root.document.head.appendChild(style);
  }

  function setMsg(text, isErr) {
    state.msg = text || ''; state.msgErr = !!isErr;
    const box = state.el.querySelector('.so-msg');
    if (box) { box.textContent = state.msg; box.className = 'so-msg' + (state.msgErr ? ' err' : ''); }
  }

  async function run(label, action) {
    if (state.busy) return;
    state.busy = true; draw();
    try { await action(); await refresh(); setMsg(label + ' ✓'); }
    catch (err) { setMsg((err && err.message) || 'Could not save. Try again.', true); }
    finally { state.busy = false; draw(); }
  }

  function change(fields) {
    const forBoy = state.who && state.who !== 'class' ? { studentId: state.who } : {};
    return state.call('submissionOpenChange', Object.assign({}, fields, forBoy));
  }

  async function refresh() {
    try { state.data = await state.call('submissionOpenRead', {}); state.loadError = ''; }
    catch (err) { state.loadError = (err && err.message) || 'Could not load what is open.'; }
    draw();
  }

  function parshaOptions(seferName) {
    const sefer = (root.B3ChumashParshiyos || []).find(s => s.name === seferName) || (root.B3ChumashParshiyos || [])[0];
    return sefer ? sefer.parshiyos : [];
  }

  function chipsHtml(rules, removable) {
    if (!rules.length) return '<span class="so-empty">Nothing is open.</span>';
    return '<div class="so-chips">' + rules.map(r => '<span class="so-chip">' + esc(r.label) +
      (removable ? '<button type="button" data-so-close="' + esc(r.rule) + '" title="Close this" aria-label="Close ' + esc(r.label) + '"' + (state.busy ? ' disabled' : '') + '>✕</button>' : '') + '</span>').join('') + '</div>';
  }

  function openRulesOfView() {
    const d = state.data;
    if (!d) return [];
    const view = state.who !== 'class' ? ((d.students && d.students[state.who]) || { rules: [] }) : d;
    const all = (d.rules || []).concat(state.who !== 'class' ? (view.rules || []) : []);
    return all.map(r => r.rule);
  }

  function pickerHtml() {
    if (state.kind === 'rashi') {
      const passages = state.vayeira || [];
      const perakim = [...new Set(passages.map(p => p.perek))];
      const open = openRulesOfView();
      const covered = rule => open.some(r => r === rule || (rule.indexOf(r + '-') === 0));
      const box = (rule, label, extra) => {
        const done = covered(rule);
        return '<label class="so-pick' + (done ? ' done' : '') + '"' + (extra ? ' style="' + extra + '"' : '') + '><input type="checkbox" data-so-pick="' + esc(rule) + '"' +
          (done ? ' disabled checked' : (state.picks[rule] ? ' checked' : '')) + (state.busy ? ' disabled' : '') + '> ' + esc(label) + (done ? ' <small>✅ open</small>' : '') + '</label>';
      };
      const rows = ['<div class="so-pick-head">Letter missions and word sets</div>'].concat(RASHI_SECTIONS.map(([id, label]) => box('r:' + id, label)));
      if (perakim.length) {
        rows.push('<div class="so-pick-head">Vayeira Rashi</div>', box('r:vayeira', 'All of Vayeira'));
        perakim.forEach(perek => {
          rows.push(box('r:vayeira-' + perek, 'Perek ' + perek + ' (all)'));
          passages.filter(p => p.perek === perek).forEach(p => rows.push(box('r:' + p.id, 'Vayeira ' + p.perek + ':' + p.pasuk, 'margin-left:22px')));
        });
      }
      const count = Object.keys(state.picks).filter(rule => state.picks[rule] && !covered(rule)).length;
      return '<div class="so-picklist" role="group" aria-label="Rashi items">' + rows.join('') + '</div>' +
        '<div class="so-row"><button type="button" class="go" data-so-open-rashi' + (state.busy || !count ? ' disabled' : '') + '>Open selected' + (count ? ' (' + count + ')' : '') + '</button>' +
        '<small>Tick one or more items, then press Open selected.</small></div>';
    }
    const sefarim = root.B3ChumashParshiyos || [];
    const parshiyos = parshaOptions(state.sefer);
    const parsha = parshiyos.find(p => p.slug === state.parsha) || parshiyos[0];
    return '<div class="so-row"><label for="soSefer">Sefer</label><select id="soSefer">' + sefarim.map(s => '<option value="' + esc(s.name) + '"' + (s.name === state.sefer ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></div>' +
      '<div class="so-row"><label for="soParsha">Parsha</label><select id="soParsha">' + parshiyos.map(p => '<option value="' + esc(p.slug) + '"' + (parsha && p.slug === parsha.slug ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></div>' +
      '<div class="so-row"><label for="soPerek">Perek</label><select id="soPerek"><option value="">Whole parsha</option>' +
        (parsha ? parsha.perakim.map(n => '<option value="' + n + '"' + (String(n) === String(state.perek) ? ' selected' : '') + '>Perek ' + n + '</option>').join('') : '') + '</select>' +
        '<span id="soRange"' + (state.perek ? '' : ' hidden') + '>Posuk <input type="number" id="soFrom" min="1" max="200" placeholder="from" value="' + esc(state.from || '') + '"> to <input type="number" id="soTo" min="1" max="200" placeholder="to" value="' + esc(state.to || '') + '"> <small>(leave empty for the whole perek)</small></span>' +
        '<button type="button" class="go" data-so-open-posuk' + (state.busy ? ' disabled' : '') + '>Open</button></div>';
  }

  function draw() {
    if (!state) return;
    const d = state.data, cls = String(state.className || state.classId).toUpperCase();
    const students = state.students() || [];
    const boyName = id => (students.find(s => s.id === id) || {}).name || id;
    const forWho = state.who === 'class' ? null : state.who;
    const view = forWho ? ((d && d.students && d.students[forWho]) || { all: false, rules: [] }) : (d || { all: false, rules: [] });
    let status = 'none', statusText = 'Everything is practice-only. Nothing is open for sending.';
    if (d) {
      const boysOpen = Object.keys(d.students || {}).length;
      if (d.all) { status = 'all'; statusText = '✅ Everything is open for sending for ' + cls + '.'; }
      else if ((d.rules || []).length || boysOpen) {
        status = 'some';
        statusText = '✅ Open for ' + cls + ': ' + (d.rules || []).length + ' item' + ((d.rules || []).length === 1 ? '' : 's') + (boysOpen ? ' · plus items for ' + boysOpen + ' boy' + (boysOpen === 1 ? '' : 's') : '') + '. Everything else is practice-only.';
      }
    }
    let list;
    if (state.loadError) list = '<div class="so-empty">' + esc(state.loadError) + '</div>';
    else if (!d) list = '<div class="so-empty">Loading…</div>';
    else {
      list = '<h4>' + (forWho ? 'Open for ' + esc(boyName(forWho)) + ' only' : 'Open for the whole class') + (view.all ? ' · <b>everything</b>' : '') + '</h4>' + (view.all && forWho ? '' : chipsHtml(view.rules || [], true));
      if (forWho) list += '<div class="so-boys">Items open for the whole class also apply to him.</div>';
      else {
        const boys = Object.entries(d.students || {});
        if (boys.length) list += '<div class="so-boys"><b>Also open for individual boys:</b><br>' + boys.map(([id, v]) => esc(boyName(id)) + ': ' + (v.all ? 'everything' : (v.rules || []).map(r => esc(r.label)).join(', '))).join('<br>') + '</div>';
      }
    }
    const whoWord = forWho ? esc(boyName(forWho)) : cls;
    state.el.innerHTML = '<h3>📤 Open for sending</h3>' +
      '<p>Boys can always record, practice and mark themselves. They can only <b>send</b> to you what you open here. Everything starts closed.</p>' +
      '<div class="so-state ' + status + '">' + esc(statusText) + '</div>' +
      '<div class="so-bulk"><button type="button" class="go" data-so-all="open"' + (state.busy ? ' disabled' : '') + '>✅ Open ALL for ' + whoWord + '</button>' +
      '<button type="button" class="stop" data-so-all="close"' + (state.busy ? ' disabled' : '') + '>⛔ Close ALL for ' + whoWord + '</button></div>' +
      '<div class="so-row"><label for="soWho">Open for</label><select id="soWho"><option value="class"' + (!forWho ? ' selected' : '') + '>The whole class (' + esc(cls) + ')</option>' +
        students.map(s => '<option value="' + esc(s.id) + '"' + (s.id === forWho ? ' selected' : '') + '>Only ' + esc(s.name) + '</option>').join('') + '</select></div>' +
      '<div class="so-tabs"><button type="button" data-so-kind="posuk" class="' + (state.kind === 'posuk' ? 'on' : '') + '">📜 Posuk</button><button type="button" data-so-kind="rashi" class="' + (state.kind === 'rashi' ? 'on' : '') + '">✍️ Rashi</button></div>' +
      pickerHtml() +
      '<div class="so-list">' + list + '</div>' +
      '<div class="so-msg' + (state.msgErr ? ' err' : '') + '" role="status">' + esc(state.msg) + '</div>';
    bind();
  }

  function bind() {
    const el = state.el, q = sel => el.querySelector(sel);
    const who = q('#soWho'); if (who) who.onchange = () => { state.who = who.value; state.picks = {}; setMsg(''); draw(); };
    el.querySelectorAll('[data-so-kind]').forEach(b => b.onclick = () => { state.kind = b.dataset.soKind; draw(); });
    const sefer = q('#soSefer'); if (sefer) sefer.onchange = () => { state.sefer = sefer.value; state.parsha = ''; state.perek = ''; draw(); };
    const parsha = q('#soParsha'); if (parsha) parsha.onchange = () => { state.parsha = parsha.value; state.perek = ''; state.from = state.to = ''; draw(); };
    const perek = q('#soPerek'); if (perek) perek.onchange = () => { state.perek = perek.value; state.from = state.to = ''; draw(); };
    const from = q('#soFrom'), to = q('#soTo');
    if (from) from.oninput = () => { state.from = from.value; };
    if (to) to.oninput = () => { state.to = to.value; };
    el.querySelectorAll('[data-so-close]').forEach(b => b.onclick = () => run('Closed', () => change({ op: 'close', rule: b.dataset.soClose })));
    el.querySelectorAll('[data-so-all]').forEach(b => b.onclick = () => {
      const open = b.dataset.soAll === 'open', forWho = state.who !== 'class';
      const target = forWho ? (state.students().find(s => s.id === state.who) || {}).name || 'this boy' : String(state.className || state.classId).toUpperCase();
      const ok = open ? root.confirm('Open EVERY posuk and Rashi for ' + target + '? They will be able to send anything to you.')
        : root.confirm('Close ALL for ' + target + '? ' + (forWho ? 'Everything opened just for him closes.' : 'Everything closes, including items opened for individual boys.') + ' Recordings already sent stay in your marking list.');
      if (!ok) return;
      run(open ? 'Everything opened for ' + target : 'Everything closed for ' + target, () => change({ op: open ? 'openAll' : 'closeAll' }));
    });
    const openPosuk = q('[data-so-open-posuk]');
    if (openPosuk) openPosuk.onclick = () => {
      const parshaSlug = (q('#soParsha') || {}).value, perekVal = (q('#soPerek') || {}).value;
      let rule = 'p:' + parshaSlug;
      if (perekVal) {
        rule += '_' + perekVal;
        const a = Number((q('#soFrom') || {}).value), b = Number((q('#soTo') || {}).value);
        if (a || b) {
          const start = a || b, end = b || a;
          if (!(start >= 1 && end >= start && end <= 200)) return setMsg('The posuk range is not valid. "From" must not be bigger than "to".', true);
          rule += '_' + start + '-' + end;
        }
      }
      run('Opened', () => change({ op: 'open', rule }));
    };
    el.querySelectorAll('[data-so-pick]').forEach(box => box.onchange = () => {
      state.picks[box.dataset.soPick] = box.checked;
      const btn = q('[data-so-open-rashi]');
      if (btn) {
        const n = Object.keys(state.picks).filter(rule => state.picks[rule]).length;
        btn.disabled = !n || state.busy; btn.textContent = 'Open selected' + (n ? ' (' + n + ')' : '');
      }
    });
    const openRashi = q('[data-so-open-rashi]');
    if (openRashi) openRashi.onclick = () => {
      const rules = Object.keys(state.picks).filter(rule => state.picks[rule]);
      if (!rules.length) return;
      run(rules.length === 1 ? 'Opened' : rules.length + ' items opened', async () => {
        for (const rule of rules) await change({ op: 'open', rule });
        state.picks = {};
      });
    };
  }

  async function loadVayeira() {
    try {
      const res = await root.fetch('rashi-letters/data/vayeira-rashi.json');
      if (res.ok) state.vayeira = ((await res.json()).passages || []).map(p => ({ id: p.id, perek: p.perek, pasuk: p.pasuk }));
    } catch (_e) { state.vayeira = []; }
    draw();
  }

  /* Put the panel inside `host` (it moves, never rebuilds, while the class stays the same). */
  function mount(host, options) {
    ensureStyle();
    if (!state) {
      state = { el: root.document.createElement('section'), kind: 'posuk', who: 'class', sefer: '', parsha: '', perek: '', from: '', to: '', data: null, vayeira: [], picks: {}, busy: false, msg: '', msgErr: false, loadError: '' };
      state.el.className = 'so-card'; state.el.id = 'submissionOpenCard';
      state.sefer = ((root.B3ChumashParshiyos || [])[0] || {}).name || '';
      loadVayeira();
    }
    const changedClass = state.classId !== options.classId;
    state.classId = options.classId; state.className = options.className;
    state.call = options.call; state.students = options.students || (() => []);
    if (host && state.el.parentNode !== host) host.insertBefore(state.el, options.before && options.before.parentNode === host ? options.before : null);
    if (changedClass) { state.who = 'class'; state.picks = {}; state.data = null; state.msg = ''; state.loadError = ''; draw(); refresh(); }
    else if (!state.data && !state.loadError) { draw(); refresh(); }
    return state.el;
  }

  root.B3SubmissionOpenPanel = { mount, redraw: function () { if (state) draw(); }, RASHI_SECTIONS };
})(typeof self !== 'undefined' ? self : this);
