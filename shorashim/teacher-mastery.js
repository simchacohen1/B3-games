/* Shorashim teacher page: the Mastery tab.
   One row per word (merged by Hebrew spelling), one column per stage, filterable by boy,
   class, list and stage, with a per-boy summary.  Loaded after teacher.js (uses its global
   `state`, `itemFor`, `esc`, `$`) and mastery-core.js. */
(function () {
  'use strict';
  const M = window.ShorashimMastery;
  const ROW_LIMIT = 400;
  let classes = [], classesLoaded = false, dirty = true, showAll = false, fallbackStudents = null;
  const f = { boy: '', cls: '', list: '', stage: '', mode: 'any', q: '', flagged: false };

  const style = document.createElement('style');
  style.textContent = `
  .tm-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:10px 0 14px}
  .tm-filters label{display:flex;flex-direction:column;gap:4px;font-weight:800;font-size:.8rem}
  .tm-filters .tm-check{flex-direction:row;align-items:center;gap:6px}
  .tm-wrap{overflow:auto;max-height:70vh;border:1px solid #e5e7eb;border-radius:12px}
  .tm-table{border-collapse:collapse;width:100%;font-size:.88rem}
  .tm-table th,.tm-table td{padding:7px 9px;border-bottom:1px solid #eef0f4;text-align:center;white-space:nowrap}
  .tm-table th{position:sticky;top:0;background:#f8fafc;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;z-index:1}
  .tm-table td.tm-l,.tm-table th.tm-l{text-align:left}
  .tm-he{font-size:1.25rem;font-weight:800;direction:rtl}
  .tm-en{white-space:normal;max-width:240px;text-align:left}
  .tm-yes{background:#dcfce7;color:#14532d;font-weight:800}
  .tm-part{background:#fef9c3;color:#713f12;font-weight:800}
  .tm-no{color:#94a3b8}
  .tm-flag{display:inline-block;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:999px;padding:1px 7px;font-size:.72rem;font-weight:800;cursor:help;margin-left:4px}
  .tm-note{font-size:.82rem;color:#6b7280;margin:6px 0}
  .tm-sum td:first-child{font-weight:800;text-align:left}`;
  document.head.appendChild(style);

  const stageLabel = id => (M.STAGES.find(s => s.id === id) || {}).label || id;

  function listLabel(item, track) {
    if (item.bookletWeek) return 'Booklet (3rd grade)';
    const base = item.listName || 'Main List';
    if (track === 'prefix') return 'Prefixes' + (base === 'Main List' ? '' : ' – ' + base);
    if (track === 'suffix') return 'Suffixes' + (base === 'Main List' ? '' : ' – ' + base);
    return base;
  }

  // Every word in the class lists (not hidden), plus any word a boy has worked on.
  function allItems() {
    const out = [], seen = new Set();
    const add = (key, track, item) => { if (!item || seen.has(key)) return; seen.add(key); out.push({ key, track, front: item.front || item.hebrew || '', english: item.english || '', list: listLabel(item, track) }); };
    ['shorashim', 'prefix', 'suffix'].forEach(track => ((state.catalog && state.catalog[track]) || []).forEach(it => { if (it && !it.hidden) add(track + ':' + it.id, track, it); }));
    Object.values(studentMap()).forEach(s => {
      const keys = new Set([...Object.keys((s && s.cards) || {}), ...Object.keys((s && s.practice) || {})]);
      keys.forEach(k => { if (!seen.has(k)) { const it = itemFor(k); if (it) add(k, k.split(':')[0], it); } });
    });
    return out;
  }

  // Stricter database rules refuse the whole class student list, but a teacher may still read each
  // of their own class's students one by one. Use the class roster in that case.
  function studentMap() { return state.students && Object.keys(state.students).length ? state.students : (fallbackStudents || {}); }
  async function loadRosterStudents() {
    if (fallbackStudents || (state.students && Object.keys(state.students).length) || !classes.length) return;
    const ids = [...new Set(classes.flatMap(c => c.studentIds || []))];
    const got = {};
    await Promise.all(ids.map(async id => { try { const v = (await db.ref(`${SPACE}/students/${id}`).once('value')).val(); if (v) got[id] = v; } catch (e) { /* not readable: skip */ } }));
    fallbackStudents = got;
  }
  function boysInScope() {
    let list = Object.entries(studentMap()).filter(([, s]) => s && typeof s === 'object').map(([id, s]) => ({ id, name: s.name || id, rec: s }));
    if (f.cls) { const c = classes.find(x => x.id === f.cls); const ids = new Set((c && c.studentIds) || []); list = list.filter(b => ids.has(b.id)); }
    if (f.boy) list = list.filter(b => b.id === f.boy);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const classNamesOf = id => classes.filter(c => (c.studentIds || []).includes(id)).map(c => c.name).join(', ');

  function cell(boys, group, stageId) {
    if (boys.length === 1) {
      const n = M.wordCounts(boys[0].rec, group, stageId);
      return n > 0 ? `<td class="tm-yes">${n}×</td>` : '<td class="tm-no">–</td>';
    }
    const per = boys.map(b => ({ name: b.name, n: M.wordCounts(b.rec, group, stageId) }));
    const done = per.filter(p => p.n > 0).length;
    const tip = per.map(p => `${p.name}: ${p.n}×`).join('\n');
    const cls = !boys.length ? 'tm-no' : done === boys.length ? 'tm-yes' : done ? 'tm-part' : 'tm-no';
    return `<td class="${cls}" title="${esc(tip)}">${boys.length ? `${done}/${boys.length}` : '–'}</td>`;
  }

  function render() {
    const host = $('masteryBody'); if (!host) return;
    const items = allItems(), groups = M.groupWords(items);
    const lists = [...new Set(items.map(i => i.list))].sort((a, b) => a.localeCompare(b));
    const allBoys = Object.entries(studentMap()).filter(([, s]) => s && typeof s === 'object').map(([id, s]) => ({ id, name: s.name || id })).sort((a, b) => a.name.localeCompare(b.name));
    const boys = boysInScope();

    let scoped = groups;
    if (f.list) scoped = scoped.filter(g => g.lists.includes(f.list));
    if (f.q) { const q = f.q.toLowerCase(), qc = M.consonantKey(f.q); scoped = scoped.filter(g => g.english.toLowerCase().includes(q) || (qc && M.consonantKey(g.front).includes(qc))); }
    if (f.flagged) scoped = scoped.filter(g => g.flags.length);
    const rows = scoped.filter(g => M.stagePasses(boys.map(b => b.rec), g, f.stage, f.mode));

    const opts = (arr, cur, first) => `<option value="">${first}</option>` + arr.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const flaggedTotal = groups.filter(g => g.flags.length).length;

    const sumRows = boys.map(b => {
      const s = M.summarizeStudent(b.rec, scoped);
      return `<tr class="tm-sum"><td>${esc(b.name)}</td><td>${esc(classNamesOf(b.id)) || '–'}</td><td>${s.words}</td><td class="tm-yes">${s.mastered}</td><td>${s.started}</td><td class="${s.notStarted ? 'tm-part' : 'tm-no'}">${s.notStarted}</td>${M.STAGE_IDS.map(id => `<td>${s.stages[id]}</td>`).join('')}</tr>`;
    }).join('');

    const shown = showAll ? rows : rows.slice(0, ROW_LIMIT);
    const wordRows = shown.map(g => {
      const flag = g.flags.length ? `<span class="tm-flag" title="${esc(g.flags.join('\n'))}">⚠ possible duplicate</span>` : '';
      return `<tr><td class="tm-l"><span class="tm-he" dir="rtl">${esc(g.front)}</span></td><td class="tm-l tm-en">${esc(g.english)}${flag}</td><td class="tm-l tm-en">${esc(g.lists.join(', '))}${g.keys.length > 1 ? ` <span class="tm-note">(${g.keys.length} entries merged)</span>` : ''}</td>${M.STAGE_IDS.map(id => cell(boys, g, id)).join('')}</tr>`;
    }).join('');

    host.innerHTML = `
      <div class="tm-filters">
        <label>Boy<select id="tmBoy">${opts(allBoys.map(b => [b.id, b.name]), f.boy, 'All boys')}</select></label>
        <label>Class<select id="tmClass">${opts(classes.map(c => [c.id, c.name]), f.cls, classes.length ? 'All classes' : 'All (class list unavailable)')}</select></label>
        <label>List<select id="tmList">${opts(lists.map(l => [l, l]), f.list, 'All lists')}</select></label>
        <label>Stage<select id="tmStage">${opts(M.STAGES.map(s => [s.id, s.label]), f.stage, 'Any stage')}</select></label>
        <label>Show words<select id="tmMode"><option value="any"${f.mode === 'any' ? ' selected' : ''}>(no stage filter)</option><option value="done"${f.mode === 'done' ? ' selected' : ''}>done by everyone shown</option><option value="notdone"${f.mode === 'notdone' ? ' selected' : ''}>not done by someone shown</option><option value="none"${f.mode === 'none' ? ' selected' : ''}>done by nobody shown</option></select></label>
        <label>Search<input id="tmSearch" type="search" placeholder="Hebrew or English" value="${esc(f.q)}"></label>
        <label class="tm-check"><input id="tmFlagged" type="checkbox"${f.flagged ? ' checked' : ''}> Only possible duplicates (${flaggedTotal})</label>
      </div>
      <h3>Per boy</h3>
      <div class="tm-note"><b>Mastered</b> = Learned, Tracing, Multiple choice and Matching all done at least once. <b>Not started</b> = no stage done at all. Numbers are words, out of the ${scoped.length} word${scoped.length === 1 ? '' : 's'} in the chosen list.</div>
      <div class="tm-wrap"><table class="tm-table"><thead><tr><th class="tm-l">Boy</th><th>Class</th><th>Words</th><th>Mastered</th><th>Started</th><th>Not started</th>${M.STAGES.map(s => `<th title="Words with this stage done">${esc(s.short)}</th>`).join('')}</tr></thead><tbody>${sumRows || '<tr><td colspan="15" class="tm-no">No boys match.</td></tr>'}</tbody></table></div>
      <h3 style="margin-top:22px">Words <span class="tm-note">(${rows.length} shown${boys.length === 1 ? '' : ', cells show how many boys did each stage — hover for names'})</span></h3>
      <div class="tm-wrap"><table class="tm-table"><thead><tr><th class="tm-l">Hebrew</th><th class="tm-l">English</th><th class="tm-l">List</th>${M.STAGES.map(s => `<th>${esc(s.short)}</th>`).join('')}</tr></thead><tbody>${wordRows || `<tr><td colspan="${3 + M.STAGES.length}" class="tm-no">No words match these filters.</td></tr>`}</tbody></table></div>
      ${rows.length > shown.length ? `<div class="tm-note">Showing the first ${ROW_LIMIT} of ${rows.length}. <button id="tmAll" class="ghost" type="button">Show all</button></div>` : ''}`;

    const bind = (id, key, ev = 'onchange', get = el => el.value) => { const el = $(id); if (el) el[ev] = () => { f[key] = get(el); showAll = false; render(); }; };
    bind('tmBoy', 'boy'); bind('tmClass', 'cls'); bind('tmList', 'list'); bind('tmStage', 'stage'); bind('tmMode', 'mode'); bind('tmFlagged', 'flagged', 'onchange', el => el.checked);
    const sb = $('tmSearch'); if (sb) { sb.oninput = () => { f.q = sb.value; showAll = false; clearTimeout(render._t); render._t = setTimeout(() => { render(); const n = $('tmSearch'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); }; }
    const all = $('tmAll'); if (all) all.onclick = () => { showAll = true; render(); };
    dirty = false;
  }

  async function loadClasses() {
    if (classesLoaded) return; classesLoaded = true;
    try {
      if (window.B3TeacherClassRosters && B3TeacherClassRosters.load) {
        const r = await B3TeacherClassRosters.load();
        classes = ((r && r.classes) || []).map(c => ({ id: c.id, name: c.name, studentIds: c.studentIds || [] }));
      }
    } catch (e) { console.warn('Mastery: class list unavailable', e); }
    if (visible()) render();
  }
  const visible = () => { const t = $('tab-mastery'); return !!t && !t.classList.contains('hidden'); };

  // Called by teacher.js whenever the class data changes.
  window.renderShorashimMastery = function () { if (visible()) render(); else dirty = true; };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-tab="mastery"]');
    if (b) { setTimeout(async () => { render(); await loadClasses(); fallbackStudents = null; try { await loadRosterStudents(); } catch (e) { /* keep what we have */ } render(); }, 0); }
  });
  window.__shorashimMasteryFilters = f; // test hook
})();
