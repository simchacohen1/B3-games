/* Chazara AI Practice — teacher controls (#688).
 * Adds one panel to the existing Chazara teacher page. It reads the class the
 * page already verified (teacherScope) and talks only to the chazaraAiPractice
 * function, which re-checks the teacher's class access on every request.
 * Existing recordings, approvals and points on this page are not touched.
 */
(function () {
  'use strict';
  var ENDPOINT = window.CHAZARA_AI_ENDPOINT || 'https://us-central1-b3-games.cloudfunctions.net/chazaraAiPractice';
  var SEFARIM = [['Bereishis', 'Genesis'], ['Shemos', 'Exodus'], ['Vayikra', 'Leviticus'], ['Bamidbar', 'Numbers'], ['Devarim', 'Deuteronomy']];
  var OUTCOME_WORDS = { excellent: '⭐ Excellent', almost: 'Almost there', try_again: 'Try again', unclear: "Couldn't hear" };
  var ui = { panel: null, classId: '', data: null, editing: null, scopeSig: '' };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'value') n.value = attrs[k];
      else if (k === 'checked' || k === 'disabled') n[k] = !!attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function scope() { try { return typeof teacherScope !== 'undefined' ? teacherScope : null; } catch (_) { return null; } }
  function studentName(id) { var s = scope(); return (s && s.students && s.students[id] && s.students[id].name) || id; }
  function classStudents(classId) {
    var s = scope(); if (!s || !s.students) return [];
    return Object.keys(s.students).filter(function (id) { return s.students[id].classId === classId; });
  }
  function hebNum(n) {
    var ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    n = Number(n); if (n === 15) return 'טו'; if (n === 16) return 'טז';
    var h = n >= 100 ? 'ק' : ''; n %= 100; return h + (tens[Math.floor(n / 10)] || '') + (ones[n % 10] || '');
  }
  function rangeText(a) { return a.sefer + ' ' + a.perek + ':' + a.from + (a.to > a.from ? '–' + a.to : ''); }

  async function api(body) {
    var user = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!user) throw new Error('Please sign in with your teacher Google account.');
    var token = await user.getIdToken();
    var res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'Could not reach AI Practice (HTTP ' + res.status + ').');
    return data;
  }

  // ---------- Sefaria (same edition sources Posuk Practice uses) ----------
  function stripTags(html) { var d = document.createElement('div'); d.innerHTML = String(html || ''); return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
  function abbreviateShaimos(text) {
    var P = '[\\u0591-\\u05C7]*';
    return text.replace(new RegExp('י' + P + 'ה' + P + 'ו' + P + 'ה' + P, 'g'), 'ה׳');
  }
  async function fetchPesukim(sefer, perek) {
    var book = (SEFARIM.filter(function (s) { return s[0] === sefer; })[0] || SEFARIM[0])[1];
    var he = await fetch('https://www.sefaria.org/api/texts/' + book + '.' + perek + '?context=0&pad=0').then(function (r) { if (!r.ok) throw new Error('Sefaria ' + r.status); return r.json(); });
    var hebrew = (he.he || []).map(function (h) { return abbreviateShaimos(stripTags(h)).replace(/[׃]/g, '').trim(); });
    return { hebrew: hebrew };
  }

  // ---------- rendering ----------
  function ensurePanel() {
    if (ui.panel) return ui.panel;
    var app = document.getElementById('teacherApp');
    if (!app) return null;
    ui.panel = el('div', { class: 'panel', id: 'aiPracticeTeacherPanel', style: 'border:2px solid #c7d2fe' });
    var after = document.getElementById('recordingsPanel');
    if (after && after.parentElement === app) app.insertBefore(ui.panel, after.nextSibling); else app.appendChild(ui.panel);
    return ui.panel;
  }

  function badge(mode) {
    return mode === 'ai'
      ? el('span', { class: 'pill', style: 'background:#ede9fe;color:#5b21b6', text: '🤖 AI Practice' })
      : el('span', { class: 'pill', style: 'background:#e0f2fe;color:#075985', text: '👂 Regular — you review' });
  }

  function render(message) {
    var p = ensurePanel(); if (!p) return;
    p.innerHTML = '';
    var s = scope(), classIds = s ? Object.keys(s.classes || {}) : [];
    var head = el('div', { class: 'approval-head' }, [
      el('div', {}, [
        el('h2', { text: '📋 Chazara Assignments & 🤖 AI Practice' }),
        el('div', { class: 'sub', text: 'Regular Chazara stays exactly as it is: students record and you review. AI Practice is optional: students get instant feedback on their reading and translation, with no teacher review and no points.' })
      ]),
      el('button', { type: 'button', class: 'approve-all', text: '+ New assignment', onclick: function () { openEditor(null); } })
    ]);
    p.appendChild(head);
    if (classIds.length > 1) {
      var sel = el('select', { 'aria-label': 'Class for Chazara assignments', onchange: function () { ui.classId = sel.value; refresh(); } });
      classIds.forEach(function (id) { var o = el('option', { value: id, text: s.classes[id].name || id }); if (id === ui.classId) o.selected = true; sel.appendChild(o); });
      p.appendChild(el('label', { style: 'display:block;margin:8px 0;font-weight:bold' }, ['Class: ', sel]));
    }
    if (message) p.appendChild(el('div', { class: 'approval-status', role: 'status', text: message }));
    if (!ui.data) { p.appendChild(el('div', { class: 'approval-empty', text: 'Loading assignments…' })); return; }
    if (!ui.data.aiEnabled) p.appendChild(el('div', { class: 'record-help', style: 'background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px;margin:8px 0', text: '⏳ AI checking is not switched on yet (owner setting). You can prepare AI Practice assignments now; students will see "not switched on yet" until it is enabled.' }));
    if (ui.editing) p.appendChild(editorView());
    var list = ui.data.assignments || [];
    if (!list.length) { p.appendChild(el('div', { class: 'approval-empty', text: 'No Chazara assignments yet. Press "+ New assignment".' })); return; }
    list.forEach(function (a) { p.appendChild(assignmentRow(a)); });
  }

  function assignmentRow(a) {
    var row = el('div', { class: 'request-row', style: 'border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin:8px 0;' + (a.active === false ? 'opacity:.6' : '') });
    var top = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between' }, [
      el('div', {}, [el('b', { text: a.title + ' ' }), badge(a.mode), a.active === false ? el('span', { class: 'pill bad', text: ' Hidden from students' }) : null,
        el('div', { class: 'sub', text: rangeText(a) })]),
      el('div', { style: 'display:flex;gap:6px' }, [
        el('button', { type: 'button', text: 'Edit', onclick: function () { openEditor(a); } }),
        el('button', { type: 'button', text: a.active === false ? 'Show to students' : 'Hide', onclick: function () { setActive(a, a.active === false); } })
      ])
    ]);
    row.appendChild(top);
    if (a.mode === 'ai') {
      var ids = classStudents(ui.classId), comp = a.completion || {};
      var practiced = ids.filter(function (id) { return comp[id] && comp[id].attempts; }).length;
      var excellent = ids.filter(function (id) { return comp[id] && comp[id].excellent; }).length;
      var details = el('details', {}, [el('summary', { text: excellent + ' of ' + ids.length + ' students reached Excellent · ' + practiced + ' practiced' })]);
      var table = el('table', {}, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Student' }), el('th', { text: 'Tries' }), el('th', { text: 'Latest result' }), el('th', { text: 'Reached Excellent' })])])]);
      var tb = el('tbody');
      ids.sort(function (x, y) { return studentName(x).localeCompare(studentName(y)); }).forEach(function (id) {
        var c = comp[id] || {};
        tb.appendChild(el('tr', { style: 'cursor:default' }, [el('td', { text: studentName(id) }), el('td', { text: String(c.attempts || 0) }),
          el('td', { text: c.lastOutcome ? (OUTCOME_WORDS[c.lastOutcome] || c.lastOutcome) + (c.lastAt ? ' · ' + new Date(c.lastAt).toLocaleDateString() : '') : '—' }),
          el('td', { text: c.excellent ? '✓' : '' })]));
      });
      table.appendChild(tb);
      details.appendChild(el('p', { class: 'sub', text: 'Practice information only — not a grade. Recordings are not saved and do not need review.' }));
      details.appendChild(table);
      row.appendChild(details);
    }
    return row;
  }

  function openEditor(a) {
    var copy = a ? JSON.parse(JSON.stringify(a)) : { title: '', mode: 'regular', sefer: 'Bereishis', perek: '', from: '', to: '', pesukim: [], active: true };
    var map = {};
    (copy.pesukim || []).forEach(function (p) { map[p.perek + '_' + p.posuk] = { hebrew: p.hebrew || '' }; });
    ui.editing = { id: a ? a.id : null, form: copy, pesukim: map, checked: false, status: '' };
    render();
    var f = ui.panel.querySelector('#aipTitleInput'); if (f) f.focus();
  }

  function editorView() {
    var e = ui.editing, f = e.form;
    var box = el('fieldset', { style: 'border:2px solid #e0e7ff;border-radius:14px;padding:12px;margin:10px 0' }, [el('legend', { style: 'font-weight:900', text: e.id ? 'Edit assignment' : 'New Chazara assignment' })]);
    var grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;align-items:end' });
    function field(label, input) { return el('label', { style: 'display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:bold;color:#475569' }, [label, input]); }
    var title = el('input', { id: 'aipTitleInput', value: f.title || '', maxlength: '120', placeholder: 'e.g. Vayeira pasuk 1–3', oninput: function () { f.title = title.value; } });
    var sefer = el('select', { onchange: function () { f.sefer = sefer.value; } });
    SEFARIM.forEach(function (s) { var o = el('option', { value: s[0], text: s[0] }); if (s[0] === f.sefer) o.selected = true; sefer.appendChild(o); });
    var perek = el('input', { type: 'number', min: '1', max: '50', value: f.perek || '', oninput: function () { f.perek = Number(perek.value); } });
    var from = el('input', { type: 'number', min: '1', max: '200', value: f.from || '', oninput: function () { f.from = Number(from.value); } });
    var to = el('input', { type: 'number', min: '1', max: '200', value: f.to || '', oninput: function () { f.to = Number(to.value); } });
    grid.append(field('Title', title), field('Sefer', sefer), field('Perek', perek), field('From pasuk', from), field('To pasuk', to));
    box.appendChild(grid);

    var modes = el('div', { role: 'radiogroup', 'aria-label': 'Chazara type', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin:12px 0' });
    [['regular', '👂 Regular Chazara', 'Students record in their chart and you review the recording (same as today).'],
     ['ai', '🤖 AI Practice', 'Students record the reading + translation and get instant, friendly feedback. No teacher review, no points.']].forEach(function (m) {
      var radio = el('input', { type: 'radio', name: 'aipMode', value: m[0], checked: f.mode === m[0], onchange: function () { f.mode = m[0]; render(); } });
      modes.appendChild(el('label', { style: 'display:flex;gap:8px;align-items:flex-start;border:2px solid ' + (f.mode === m[0] ? '#6366f1' : '#e5e7eb') + ';border-radius:12px;padding:10px;cursor:pointer' }, [radio, el('span', {}, [el('b', { text: m[1] }), el('br'), el('span', { class: 'sub', text: m[2] })])]));
    });
    box.appendChild(modes);

    var load = el('button', { type: 'button', text: '📖 Load the pesukim text', onclick: function () { loadText(load); } });
    box.appendChild(el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [load,
      el('span', { class: 'sub', text: 'Loads the Hebrew text so students see it. Please check it.' })]));

    var n = Number(f.to || f.from) - Number(f.from) + 1;
    if (f.perek && f.from && n >= 1 && n <= 6) {
      for (var v = Number(f.from); v <= Number(f.to || f.from); v++) {
        (function (k, v) {
          var row = e.pesukim[k] || (e.pesukim[k] = { hebrew: '' });
          var heb = el('textarea', { dir: 'rtl', lang: 'he', rows: '2', style: 'width:100%;font-size:20px;font-family:"Noto Serif Hebrew","Times New Roman",serif', 'aria-label': 'Hebrew text for pasuk ' + v, oninput: function () { row.hebrew = heb.value; } });
          heb.value = row.hebrew;
          var block = el('div', { style: 'background:#f8fafc;border-radius:12px;padding:10px;margin:8px 0' }, [
            el('div', { style: 'direction:rtl;text-align:right;font-weight:900', text: 'פרק ' + hebNum(f.perek) + ' · פסוק ' + hebNum(v) }), heb]);
          box.appendChild(block);
        })(f.perek + '_' + v, v);
      }
    } else if (f.from) {
      box.appendChild(el('p', { class: 'sub', text: 'Choose up to 6 pesukim.' }));
    }
    if (f.mode === 'ai') {
      var chk = el('input', { type: 'checkbox', checked: e.checked, onchange: function () { e.checked = chk.checked; } });
      box.appendChild(el('label', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0;font-weight:bold' }, [chk, 'I checked the Hebrew text. Students\' readings are compared with it.']));
    }
    var save = el('button', { type: 'button', class: 'approve-all', text: e.id ? 'Save changes' : 'Create assignment', onclick: function () { saveEditor(save); } });
    var cancel = el('button', { type: 'button', text: 'Cancel', onclick: function () { ui.editing = null; render(); } });
    box.appendChild(el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [save, cancel]));
    if (e.status) box.appendChild(el('div', { class: 'approval-status', role: 'status', text: e.status }));
    return box;
  }

  async function loadText(btn) {
    var e = ui.editing, f = e.form;
    if (!f.perek || !f.from) { e.status = 'Choose the perek and pesukim first.'; return render(); }
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
      var t = await fetchPesukim(f.sefer, f.perek);
      for (var v = Number(f.from); v <= Number(f.to || f.from); v++) {
        var k = f.perek + '_' + v, row = e.pesukim[k] || (e.pesukim[k] = { hebrew: '' });
        if (!row.hebrew && t.hebrew[v - 1]) row.hebrew = t.hebrew[v - 1];
      }
      e.status = 'Loaded. Please check the text.';
    } catch (err) { e.status = 'Could not load the text (' + err.message + '). You can type or paste it instead.'; }
    render();
  }

  async function saveEditor(btn) {
    var e = ui.editing, f = e.form;
    if (f.mode === 'ai' && !e.checked) { e.status = 'Please tick the box to confirm you checked the Hebrew text.'; return render(); }
    var pesukim = {};
    for (var v = Number(f.from); v <= Number(f.to || f.from); v++) { var k = f.perek + '_' + v; pesukim[k] = { hebrew: (e.pesukim[k] || {}).hebrew || '' }; }
    btn.disabled = true;
    try {
      await api({ action: 'teacherSave', classId: ui.classId, assignmentId: e.id || undefined,
        assignment: { title: f.title, mode: f.mode, sefer: f.sefer, perek: Number(f.perek), from: Number(f.from), to: Number(f.to || f.from), pesukim: pesukim, active: f.active !== false } });
      ui.editing = null;
      await refresh('Saved.');
    } catch (err) { e.status = err.message; btn.disabled = false; render(); }
  }

  async function setActive(a, active) {
    try { await api({ action: 'teacherArchive', classId: ui.classId, assignmentId: a.id, active: active }); await refresh(active ? 'Shown to students.' : 'Hidden from students.'); }
    catch (err) { render(err.message); }
  }

  async function refresh(message) {
    if (!ui.classId) return;
    ui.data = null; render(message);
    try { ui.data = await api({ action: 'teacherList', classId: ui.classId }); render(message); }
    catch (err) { ui.data = { assignments: [], aiEnabled: false }; render(err.message); }
  }

  // Follow the page's verified class scope; reload when it changes.
  function watch() {
    var s = scope(), app = document.getElementById('teacherApp');
    var ready = s && s.classes && app && !app.classList.contains('hidden');
    var sig = ready ? Object.keys(s.classes).sort().join(',') + '|' + (s.selected || '') : '';
    if (sig && sig !== ui.scopeSig) {
      ui.scopeSig = sig;
      var ids = Object.keys(s.classes);
      ui.classId = s.selected && ids.indexOf(s.selected) >= 0 ? s.selected : (ids.indexOf(ui.classId) >= 0 ? ui.classId : ids[0] || '');
      if (window.B3_READ_ONLY_TEACHER_PREVIEW === true) { ensurePanel(); ui.data = { assignments: [], aiEnabled: false }; render('Read-only preview: AI Practice assignments are managed from the teacher\'s own account.'); }
      else refresh();
    }
    setTimeout(watch, 2000);
  }
  window.ChazaraAiPracticeTeacher = { refresh: refresh, _ui: ui };
  watch();
})();
