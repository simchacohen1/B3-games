/* Owner Admin: split the legacy classes ET and WT into morning and afternoon
 * classes, and retire ET and WT later (Issue #728).
 *
 * This file only draws the card and collects the owner's ticks. Every decision
 * and every write is made by funTorahManageStudents (class-split-core.cjs),
 * owner only, which checks everything again.
 */
(function (root) {
  'use strict';
  const SESSIONS = ['morning', 'afternoon'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // ---- pure helpers (unit tested) -------------------------------------------

  // Which class each missing slot should use. A slot with same-named classes
  // already on the site has no default: the owner must choose.
  function defaultChoices(preview) {
    const out = {};
    (preview.sources || []).forEach(s => {
      SESSIONS.forEach(x => {
        const t = s.targets[x];
        if (!t.ready) (out[s.source] = out[s.source] || {})[x] = t.candidates.length ? '' : 'new';
      });
    });
    return out;
  }
  function missingChoices(preview, choices) {
    const names = [];
    (preview.sources || []).forEach(s => SESSIONS.forEach(x => {
      const t = s.targets[x];
      if (!t.ready && !((choices[s.source] || {})[x])) names.push(t.name);
    }));
    return names;
  }
  // ticks: { "<studentId>:<session>": true|false } for the boxes on screen.
  // Every listed student is sent, so the server remembers the ones left out.
  function collectPicks(source, ticks) {
    const picks = {};
    source.students.forEach(r => {
      const pick = {};
      SESSIONS.forEach(x => { pick[x] = (r[x] === 'add' || r[x] === 'out') && ticks[r.studentId + ':' + x] === true; });
      picks[r.studentId] = pick;
    });
    return picks;
  }
  function countPicks(picks) {
    let students = 0, places = 0;
    Object.keys(picks).forEach(id => {
      const n = SESSIONS.filter(x => picks[id][x]).length;
      if (n) { students++; places += n; }
    });
    return { students: students, places: places };
  }
  const allReady = s => SESSIONS.every(x => s.targets[x].ready);

  function targetLine(s, t, schoolName) {
    if (t.ready) {
      const warn = [];
      if (!t.active) warn.push('turned off');
      if (t.others) warn.push(plural(t.others, 'student here is', 'students here are') + ' not in ' + s.label);
      if (!t.teachers) warn.push('no teacher yet');
      if (!t.toolsOn) warn.push('no tools turned on yet');
      return '<li><b>&#10003; ' + esc(t.className) + '</b> <small>(' + esc(t.classId) + ')</small> &middot; ' + plural(t.members, 'student', 'students') +
        (warn.length ? ' <small class="warn" style="display:inline;color:#b45309">&middot; ' + esc(warn.join(' · ')) + '</small>' : '') + '</li>';
    }
    if (!t.candidates.length) return '<li><b>' + esc(t.name) + '</b> &mdash; will be created' + (s.schoolId ? ' in ' + esc(schoolName(s.schoolId)) : ' (' + esc(s.label) + ' has no school yet, so it will have none either)') + '</li>';
    return '<li><b>' + esc(t.name) + '</b> &mdash; ' + plural(t.candidates.length, 'class', 'classes') + ' with this name already ' + (t.candidates.length === 1 ? 'exists' : 'exist') + '. Choose: ' +
      '<select data-split-choice="' + esc(s.source + ':' + t.session) + '" aria-label="Class to use for ' + esc(t.name) + '" style="width:auto;max-width:100%"><option value="">Choose&hellip;</option>' +
      t.candidates.map(c => '<option value="' + esc(c.classId) + '">Use ' + esc(c.name) + ' (' + esc(c.classId) + ') &middot; ' + plural(c.members, 'student', 'students') +
        (c.sameSchool ? '' : ' &middot; other school') + (c.active ? '' : ' &middot; turned off') + '</option>').join('') +
      '<option value="new">Create a new class</option></select></li>';
  }

  function cell(r, x) {
    const st = r[x];
    if (st === 'in') return '<td style="text-align:center;color:#15803d">&#10003; already in</td>';
    if (st === 'blocked') return '<td style="text-align:center;color:#b45309">turned off there</td>';
    return '<td style="text-align:center"><input type="checkbox" style="width:22px;height:22px;padding:0" data-split-tick="' + esc(r.studentId + ':' + x) + '"' + (r.tick[x] ? ' checked' : '') +
      ' aria-label="' + esc(r.name + ', ' + x) + '">' + (st === 'out' ? '<br><small>taken out earlier</small>' : '') + '</td>';
  }

  function sourceHtml(s, schoolName) {
    if (!s.exists) return '<h3 style="margin-top:22px">' + esc(s.label) + '</h3><p>The class ' + esc(s.label) + ' is not on this site.</p>';
    const ready = allReady(s), fmt = t => t ? new Date(t).toLocaleString() : '';
    let html = '<h3 style="margin-top:22px">' + esc(s.label) + ' &rarr; ' + esc(s.targets.morning.name) + ' + ' + esc(s.targets.afternoon.name) + '</h3>' +
      '<p class="hint" style="margin:0 0 6px">' + esc(s.name) + ' is ' + (s.schoolId ? 'in ' + esc(schoolName(s.schoolId)) : 'not in a school yet') + ' &middot; ' + plural(s.students.length, 'student', 'students') +
      (s.active ? '' : ' &middot; <b>turned off</b>') + '</p><ul style="margin:4px 0 10px;padding-left:20px">' + SESSIONS.map(x => targetLine(s, s.targets[x], schoolName)).join('') + '</ul>';
    if (ready) {
      html += '<details open><summary><b>Students</b> &mdash; untick a session a student does not attend</summary>' +
        (s.students.length ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr><th style="text-align:left">Student</th>' +
          SESSIONS.map(x => '<th>' + esc(s.targets[x].className) + '</th>').join('') + '</tr></thead><tbody>' +
          s.students.map(r => '<tr style="border-top:1px solid #e2e8f0"><td>' + esc(r.name) + '</td>' + SESSIONS.map(x => cell(r, x)).join('') + '</tr>').join('') + '</tbody></table></div>' +
          '<div class="formrow" style="margin-top:10px"><button type="button" data-split-enroll="' + esc(s.source) + '">Enroll ' + esc(s.label) + ' students in the ticked classes</button></div>'
          : '<p>No students to enroll.</p>') +
        (s.skipped.length ? '<details style="margin-top:6px"><summary>Not included (' + s.skipped.length + ')</summary><ul style="margin:4px 0 10px;padding-left:20px">' +
          s.skipped.map(k => '<li>' + esc(k.name) + ' &mdash; ' + esc(k.reason) + '</li>').join('') + '</ul></details>' : '') + '</details>';
      if (s.retired) {
        html += '<div class="notice" style="margin-top:10px"><b>' + esc(s.label) + ' was retired' + (s.retired.at ? ' on ' + esc(fmt(s.retired.at)) : '') + '.</b> Nothing was deleted: its students, homework, records and passcodes are all still saved.' +
          '<div class="formrow" style="margin-top:8px"><button type="button" data-split-restore="' + esc(s.source) + '">Bring ' + esc(s.label) + ' back</button></div></div>';
      } else if (s.active) {
        html += '<details style="margin-top:10px"><summary><b>Later: retire ' + esc(s.label) + '</b></summary><div class="notice" style="margin-top:8px;background:#fef2f2;border-color:#fecaca">' +
          'Do this only once the new classes are working. Retiring turns ' + esc(s.label) + ' off, so students and teachers no longer see it. <b>Nothing is deleted</b>: its students, homework, records and passcodes stay saved, and you can bring it back from here.' +
          (s.stranded.length ? '<p style="margin:8px 0 4px"><b>' + plural(s.stranded.length, 'student has', 'students have') + ' no other class</b> and could not use the site after this: ' + s.stranded.map(k => esc(k.name)).join(', ') + '.</p>' +
            '<label class="classtick"><input type="checkbox" data-split-anyway="' + esc(s.source) + '"> Retire anyway</label>' : '') +
          '<div class="formrow" style="margin-top:8px"><input data-split-confirm="' + esc(s.source) + '" placeholder="RETIRE ' + esc(s.label) + '" aria-label="Type RETIRE ' + esc(s.label) + ' to confirm">' +
          '<button type="button" class="danger" data-split-retire="' + esc(s.source) + '">Retire ' + esc(s.label) + '</button></div></div></details>';
      }
    }
    return html;
  }

  function render(preview, schoolName) {
    schoolName = schoolName || (id => id);
    const sources = preview.sources || [], needCreate = sources.some(s => s.exists && !allReady(s));
    return (needCreate ? '<div class="notice" style="margin-top:10px"><b>Step 1.</b> Make the new classes. They go in the same school as ET and WT. ET and WT are not changed.' +
        '<div class="formrow" style="margin-top:8px"><button type="button" data-split-create>Create the new classes</button></div></div>'
        : '<div class="notice" style="margin-top:10px"><b>Before you enroll:</b> a new class starts with no teacher and no tools. Give each new class a teacher and its tools (under Classes) first. ' +
        'Once enrolled, students are in ET or WT <i>and</i> their new classes: at sign-in they usually start in a new class and can switch back to ET or WT from the class menu.</div>') +
      sources.map(s => '<div data-split-source="' + esc(s.source) + '">' + sourceHtml(s, schoolName) + '</div>').join('');
  }

  // ---- the card (browser only) ----------------------------------------------

  function mount(opts) {
    const area = opts.area, call = opts.call, say = opts.notify || function () {};
    const reload = opts.reload || (async function () {});
    let preview = null;
    const find = id => preview.sources.find(s => s.source === id);
    function show(p, note) {
      preview = p;
      area.innerHTML = (note ? '<p><b>' + esc(note) + '</b></p>' : '') + render(p, opts.schoolName);
    }
    async function run(button, work) {
      if (button) button.disabled = true;
      try { await work(); }
      catch (err) { console.error(err); say(err.message || 'Could not do this. Please try again.'); if (button) button.disabled = false; }
    }
    opts.openButton.onclick = () => run(null, async () => { area.innerHTML = '<p>Checking ET and WT&hellip;</p>'; try { show(await call({ action: 'classSplitPreview' })); } catch (err) { area.innerHTML = ''; throw err; } });
    area.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !preview) return;
      if (b.hasAttribute('data-split-create')) return run(b, async () => {
        const choices = defaultChoices(preview);
        area.querySelectorAll('[data-split-choice]').forEach(sel => { const k = sel.dataset.splitChoice.split(':'); choices[k[0]][k[1]] = sel.value; });
        const missing = missingChoices(preview, choices);
        if (missing.length) { say('Choose which class to use for ' + missing.join(', ') + '.'); b.disabled = false; return; }
        const r = await call({ action: 'classSplitCreate', choices: choices });
        show(r, r.created.length ? plural(r.created.length, 'class', 'classes') + ' created.' : 'Classes chosen.'); await reload();
      });
      const enroll = b.dataset.splitEnroll, retire = b.dataset.splitRetire, restore = b.dataset.splitRestore;
      if (enroll) return run(b, async () => {
        const s = find(enroll), ticks = {};
        area.querySelector('[data-split-source="' + enroll + '"]').querySelectorAll('[data-split-tick]').forEach(box => { ticks[box.dataset.splitTick] = box.checked; });
        const picks = collectPicks(s, ticks), n = countPicks(picks);
        if (!n.students) { say('No students are ticked for a new class.'); b.disabled = false; return; }
        if (!confirm('Enroll ' + plural(n.students, 'student', 'students') + ' from ' + s.label + ' into the ticked new classes (' + plural(n.places, 'place', 'places') + ')? ' + s.label + ' itself is not changed.')) { b.disabled = false; return; }
        const r = await call({ action: 'classSplitEnroll', source: enroll, picks: picks, planHash: s.planHash });
        show(r, plural(r.counts.students, 'student', 'students') + ' enrolled from ' + s.label + (r.counts.failed ? '; ' + r.counts.failed + ' could not be saved: press the button again to finish.' : '.'));
        await reload();
      });
      if (retire) return run(b, async () => {
        const s = find(retire), box = area.querySelector('[data-split-anyway="' + retire + '"]');
        const r = await call({ action: 'classSplitRetire', source: retire, planHash: s.planHash, allowNoClass: !!(box && box.checked), confirmText: area.querySelector('[data-split-confirm="' + retire + '"]').value });
        show(r, s.label + ' is retired. Nothing was deleted.'); await reload();
      });
      if (restore) return run(b, async () => {
        const s = find(restore);
        if (!confirm('Bring ' + s.label + ' back? It will be turned on again exactly as it was.')) { b.disabled = false; return; }
        const r = await call({ action: 'classSplitRestore', source: restore });
        show(r, s.label + ' is back.'); await reload();
      });
    });
  }

  const api = { render: render, defaultChoices: defaultChoices, missingChoices: missingChoices, collectPicks: collectPicks, countPicks: countPicks, mount: mount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FTTClassSplit = api;
})(typeof window === 'object' ? window : globalThis);
