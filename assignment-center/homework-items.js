/* Homework checklist items (shared by teacher.html and student.html).
   One homework can hold several items. Each item is an activity plus its exact
   details, e.g. Posuk Practice, Bereishis perek 18, pesukim 12-14. Students open
   an item in the real activity in "homework mode" (see homework-mode.js); the
   activity reports back when the item is done.
   The server re-checks everything (backend/functions/homework-items-core.cjs). */
(function (root) {
  'use strict';
  var MAX_ITEMS = 12;
  var TYPES = {
    posuk: { name: 'Posuk Practice', icon: '📖', url: '../record_pesukim/student.html' },
    rashiLetters: { name: 'Rashi Letters', icon: '🔤', url: '../rashi-letters/student.html' },
    chazara: { name: 'Chazara', icon: '🔁', url: '../chazara/index.html' },
    shorashim: { name: 'Shorashim practice', icon: '🌱', url: '../shorashim/index.html' },
    weeklyQuiz: { name: 'Weekly Quiz', icon: '❓', url: '../weekly-quiz/index.html' },
    workbook: { name: 'Workbook page', icon: '📒', url: '' },
    other: { name: 'Other', icon: '⭐', url: '' }
  };
  var ORDER = ['posuk', 'rashiLetters', 'chazara', 'shorashim', 'weeklyQuiz', 'workbook', 'other'];
  var SEFORIM = [['Bereishis', 'בראשית'], ['Shemos', 'שמות'], ['Vayikra', 'ויקרא'], ['Bamidbar', 'במדבר'], ['Devarim', 'דברים']];
  var SKILLS = [['reading', 'Reading'], ['translate', 'Translate'], ['understand', 'Understand']];
  var RASHI = [['zayin', 'ז'], ['bet', 'בּ / ב'], ['tsadi', 'צ'], ['alef', 'א'], ['tsadisofit', 'ץ'], ['memsofit', 'ם'],
    ['shin', 'שׁ / שׂ'], ['samech', 'ס'], ['finalreview', 'שׁ / שׂ review']];

  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function hebNum(n) {
    n = Number(n);
    var ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'], hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
    var s = (hundreds[Math.floor(n / 100)] || ''), r = n % 100;
    s += r === 15 ? 'טו' : r === 16 ? 'טז' : (tens[Math.floor(r / 10)] || '') + (ones[r % 10] || '');
    return s.length === 1 ? s + '׳' : s.slice(0, -1) + '״' + s.slice(-1);
  }
  // Keeps Hebrew pieces from scrambling the English around them (Unicode first-strong isolate).
  function iso(text) { return '\u2068' + text + '\u2069'; }
  function lookup(list, key) { for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1]; return key; }
  function rangeText(d) {
    return iso('פרק ' + hebNum(d.perek)) + ' · ' + (d.to && d.to !== d.from
      ? 'pesukim ' + iso(hebNum(d.from) + '–' + hebNum(d.to)) + ' (' + d.from + '–' + d.to + ')'
      : 'posuk ' + iso(hebNum(d.from)) + ' (' + d.from + ')');
  }
  // One line a teacher or student can read, e.g. "Bereishis · פרק י״ח · pesukim י״ב–י״ד (12–14) · Reading, Translate".
  function describe(item) {
    var d = (item && item.details) || {};
    if (item.type === 'posuk' && d.perek) {
      return (d.sefer || 'Bereishis') + ' · ' + rangeText(d) + ' · ' + (d.skills || ['reading']).map(function (s) { return lookup(SKILLS, s); }).join(', ');
    }
    if (item.type === 'chazara' && d.perek) return rangeText(d) + ' · ' + (d.times > 1 ? d.times + ' times each' : 'once each');
    if (item.type === 'rashiLetters' && d.letters && d.letters.length) return 'Letters: ' + d.letters.map(function (l) { return iso(lookup(RASHI, l)); }).join('  ');
    return '';
  }
  function title(item) { var t = TYPES[item.type]; return t ? t.name : 'Activity'; }

  // Link that opens the real activity in homework mode at the assigned spot.
  function itemUrl(assignment, item, base) {
    var t = TYPES[item.type];
    if (!t || !t.url) return '';
    var u = new URL(t.url, base || root.location.href), d = item.details || {}, p = u.searchParams;
    p.set('hw', assignment.id); p.set('hwItem', item.id);
    if (assignment.classId) p.set('hwClass', assignment.classId); // students in several classes
    p.set('hwTitle', String(assignment.title || '').slice(0, 80));
    if (assignment.assignedAt != null) p.set('hwSince', String(assignment.assignedAt));
    if (item.type === 'posuk') {
      p.set('sefer', d.sefer || 'Bereishis'); p.set('perek', d.perek); p.set('posuk', d.from);
      if (d.to && d.to > d.from) p.set('endPosuk', d.to);
      var skills = d.skills && d.skills.length ? d.skills : ['reading'];
      p.set('hwSkills', skills.join(','));
      p.set('tab', skills[0] === 'understand' ? 'comprehension' : skills[0]);
    } else if (item.type === 'chazara') {
      p.set('hwPerek', d.perek); p.set('hwFrom', d.from); p.set('hwTo', d.to || d.from); p.set('hwTimes', d.times || 1);
    } else if (item.type === 'rashiLetters') {
      p.set('hwLetters', (d.letters || []).join(','));
    }
    return u.href;
  }

  function addStyles() {
    if (document.getElementById('homework-items-styles')) return;
    var s = document.createElement('style'); s.id = 'homework-items-styles';
    s.textContent = [
      '.hwi-list{list-style:none;margin:10px 0;padding:0;display:grid;gap:8px}',
      '.hwi-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1.5px solid #d6e4f5;border-radius:12px;padding:10px 12px;background:#fff}',
      '.hwi-row.done{background:#f0fbf4;border-color:#8fd8ac}',
      '.hwi-num{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#e8f0fb;color:#1f4f8a;font-weight:800}',
      '.hwi-row.done .hwi-num{background:#1f9d55;color:#fff}',
      '.hwi-main{flex:1 1 200px;min-width:0}',
      '.hwi-main strong{display:block}',
      '.hwi-main small{display:block;color:#5b6b80;font-size:14px;line-height:1.4;overflow-wrap:anywhere}',
      '.hwi-main em{display:block;color:#7b5700;font-style:normal;font-size:14px}',
      '.hwi-tools{display:flex;gap:6px;flex-wrap:wrap}',
      '.hwi-tools button{margin:0;padding:6px 10px;min-height:36px;font-size:14px}',
      '.hwi-editor{border:2px solid #7fb2ef;border-radius:14px;padding:14px;background:#f6faff;margin-top:10px;display:grid;gap:10px}',
      '.hwi-editor label{font-weight:700;margin:0}',
      '.hwi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}',
      '.hwi-checks{display:flex;flex-wrap:wrap;gap:8px}',
      '.hwi-checks label{display:inline-flex;align-items:center;gap:6px;border:1.5px solid #d6e4f5;border-radius:10px;padding:6px 10px;background:#fff;font-weight:600;cursor:pointer}',
      '.hwi-checks input{width:auto;margin:0}',
      '.hwi-letter{font-size:20px;direction:rtl}',
      '.hwi-empty{color:#5b6b80;border:2px dashed #d6e4f5;border-radius:12px;padding:12px;text-align:center}',
      '.hwi-msg{color:#b42318;font-weight:700;min-height:1em}',
      '.hwi-open{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:8px 16px;border-radius:11px;background:#1d63c9;color:#fff;font-weight:800;text-decoration:none}',
      '.hwi-open.again{background:#e8f0fb;color:#1f4f8a}',
      '.hwi-progress{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#e8f0fb;color:#1f4f8a;font-size:12px;font-weight:800}',
      '.hwi-progress.all{background:#dcf5e5;color:#13643a}'
    ].join('\n');
    document.head.append(s);
  }

  // ---------- Teacher: build, edit, reorder and remove items ----------
  function builder(container, options) {
    addStyles();
    options = options || {};
    var items = [], editing = -1;
    var list = el('ol', null, 'hwi-list'), editorBox = el('div'), msg = el('p', null, 'hwi-msg');
    var add = el('button', '＋ Add an item', 'sec'); add.type = 'button';
    msg.setAttribute('aria-live', 'polite');
    container.replaceChildren(list, editorBox, add, msg);
    function changed() { render(); if (options.onChange) options.onChange(items.slice()); }
    function render() {
      list.replaceChildren();
      if (!items.length) list.append(el('li', 'No items yet. Add the first thing students should do.', 'hwi-empty'));
      items.forEach(function (item, i) {
        var row = el('li', null, 'hwi-row'), main = el('div', null, 'hwi-main'), tools = el('div', null, 'hwi-tools');
        row.append(el('span', String(i + 1), 'hwi-num'));
        main.append(el('strong', (TYPES[item.type] ? TYPES[item.type].icon + ' ' : '') + title(item)));
        var line = describe(item); if (line) main.append(el('small', line));
        if (item.note) main.append(el('em', item.note));
        function tool(text, label, fn, disabled) { var b = el('button', text, 'sec'); b.type = 'button'; b.setAttribute('aria-label', label); b.disabled = !!disabled; b.onclick = fn; tools.append(b); }
        tool('↑', 'Move item ' + (i + 1) + ' up', function () { var x = items[i]; items[i] = items[i - 1]; items[i - 1] = x; changed(); }, i === 0);
        tool('↓', 'Move item ' + (i + 1) + ' down', function () { var x = items[i]; items[i] = items[i + 1]; items[i + 1] = x; changed(); }, i === items.length - 1);
        tool('Edit', 'Edit item ' + (i + 1), function () { openEditor(i); });
        tool('Remove', 'Remove item ' + (i + 1), function () { items.splice(i, 1); if (editing === i) closeEditor(); changed(); });
        row.append(main, tools); list.append(row);
      });
      add.hidden = editing !== -1 || items.length >= MAX_ITEMS;
    }
    function closeEditor() { editing = -1; editorBox.replaceChildren(); msg.textContent = ''; render(); }
    function field(labelText, input) { var w = el('div'), l = el('label', labelText); var id = 'hwi-' + Math.random().toString(36).slice(2); input.id = id; l.htmlFor = id; w.append(l, input); return w; }
    function number(value, min, max) { var i = el('input'); i.type = 'number'; i.min = min; i.max = max; i.inputMode = 'numeric'; if (value != null) i.value = value; return i; }
    function openEditor(index) {
      editing = index;
      var start = index >= 0 ? items[index] : { type: 'posuk', details: {} };
      var box = el('div', null, 'hwi-editor'), detailBox = el('div');
      box.append(el('strong', index >= 0 ? 'Change item ' + (index + 1) : 'New item'));
      var type = el('select');
      ORDER.forEach(function (k) { var o = el('option', TYPES[k].icon + ' ' + TYPES[k].name); o.value = k; type.append(o); });
      ['Audio recording', 'Video'].forEach(function (n) { var o = el('option', n + ' — not available yet'); o.disabled = true; type.append(o); });
      type.value = start.type;
      box.append(field('Activity', type), detailBox);
      var note = el('input'); note.maxLength = 200; note.placeholder = 'Optional: a short instruction for this item'; note.value = start.note || '';
      box.append(field('Note for students (optional)', note));
      var read = function () { return {}; };
      function drawDetails() {
        detailBox.replaceChildren();
        var d = type.value === start.type ? (start.details || {}) : {};
        if (type.value === 'posuk' || type.value === 'chazara') {
          var grid = el('div', null, 'hwi-grid'), sefer = null;
          if (type.value === 'posuk') {
            sefer = el('select');
            SEFORIM.forEach(function (s) { var o = el('option', s[0] + ' · ' + s[1]); o.value = s[0]; sefer.append(o); });
            sefer.value = d.sefer || 'Bereishis';
            grid.append(field('Sefer', sefer));
          }
          var perek = number(d.perek, 1, 150), from = number(d.from, 1, 200), to = number(d.to, 1, 200);
          perek.placeholder = 'e.g. 18'; from.placeholder = 'e.g. 12'; to.placeholder = 'same';
          grid.append(field('Perek', perek), field('From posuk', from), field('To posuk', to));
          detailBox.append(grid);
          var hint = el('small', '', 'muted'); detailBox.append(hint);
          var hintNow = function () { hint.textContent = perek.value && from.value ? 'Students will see: ' + rangeText({ perek: +perek.value, from: +from.value, to: +(to.value || from.value) }) : ''; };
          [perek, from, to].forEach(function (i) { i.addEventListener('input', hintNow); }); hintNow();
          var extra = null;
          if (type.value === 'posuk') {
            extra = el('div', null, 'hwi-checks'); extra.setAttribute('role', 'group'); extra.setAttribute('aria-label', 'What to practice');
            var chosen = d.skills && d.skills.length ? d.skills : ['reading'];
            SKILLS.forEach(function (s) { var l = el('label'), c = el('input'); c.type = 'checkbox'; c.value = s[0]; c.checked = chosen.indexOf(s[0]) !== -1; l.append(c, document.createTextNode(s[1])); extra.append(l); });
            detailBox.append(el('label', 'What to practice'), extra);
          } else {
            var times = number(d.times || 1, 1, 5);
            detailBox.append(field('How many times for each posuk', times));
            extra = times;
          }
          read = function () {
            var out = { perek: Number(perek.value), from: Number(from.value), to: Number(to.value || from.value) };
            if (!out.perek) throw new Error('Choose a perek.');
            if (!out.from) throw new Error('Choose the first posuk.');
            if (out.to < out.from) throw new Error('The last posuk must come after the first.');
            if (out.to - out.from > 39) throw new Error('Choose 40 pesukim or fewer in one item.');
            if (sefer) {
              out.sefer = sefer.value;
              out.skills = Array.prototype.filter.call(extra.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
              if (!out.skills.length) throw new Error('Choose at least one thing to practice.');
            } else out.times = Math.max(1, Math.min(5, Number(extra.value) || 1));
            return out;
          };
        } else if (type.value === 'rashiLetters') {
          var checks = el('div', null, 'hwi-checks'), have = d.letters || [];
          checks.setAttribute('role', 'group'); checks.setAttribute('aria-label', 'Which letters');
          RASHI.forEach(function (r) { var l = el('label'), c = el('input'); c.type = 'checkbox'; c.value = r[0]; c.checked = have.indexOf(r[0]) !== -1; l.append(c, el('span', r[1], 'hwi-letter')); checks.append(l); });
          detailBox.append(el('label', 'Which letters'), checks);
          read = function () {
            var letters = Array.prototype.filter.call(checks.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
            if (!letters.length) throw new Error('Choose at least one letter.');
            return { letters: letters };
          };
        } else {
          detailBox.append(el('small', type.value === 'workbook' || type.value === 'other'
            ? 'Students tick this item themselves when they finish. Use the note to say exactly what to do.'
            : 'Opens ' + TYPES[type.value].name + ' in homework mode. Students tap “I finished this” when they are done.', 'muted'));
          read = function () { return {}; };
        }
      }
      type.onchange = drawDetails; drawDetails();
      var actions = el('div', null, 'hwi-tools'), save = el('button', index >= 0 ? 'Save item' : 'Add to homework'), cancel = el('button', 'Cancel', 'sec');
      save.type = cancel.type = 'button';
      save.onclick = function () {
        try {
          var item = { id: index >= 0 ? items[index].id : '', type: type.value, details: read() };
          if (note.value.trim()) item.note = note.value.trim();
          if (!item.id) delete item.id;
          if (index >= 0) items[index] = item; else items.push(item);
          closeEditor(); changed();
        } catch (e) { msg.textContent = e.message; }
      };
      cancel.onclick = closeEditor;
      actions.append(save, cancel); box.append(actions);
      editorBox.replaceChildren(box); msg.textContent = ''; render();
      type.focus();
    }
    add.onclick = function () { openEditor(-1); };
    render();
    return {
      get: function () { return items.map(function (x) { return JSON.parse(JSON.stringify(x)); }); },
      set: function (next) { items = (next || []).map(function (x) { return JSON.parse(JSON.stringify(x)); }); closeEditor(); },
      isEditing: function () { return editing !== -1; }
    };
  }

  // ---------- Student: checklist ----------
  function doneCount(items, done) { return (items || []).filter(function (i) { return done && done[i.id]; }).length; }
  function checklist(assignment, options) {
    addStyles();
    options = options || {};
    var items = assignment.items || [], done = assignment.itemsDone || {};
    var box = el('div', null, 'hwi-checklist');
    var n = doneCount(items, done);
    box.append(el('p', n === items.length ? '✅ All ' + items.length + ' items done! Now press Hand In.' : 'Done: ' + n + ' of ' + items.length, 'hwi-count'));
    var list = el('ol', null, 'hwi-list');
    items.forEach(function (item, i) {
      var isDone = !!done[item.id], row = el('li', null, 'hwi-row' + (isDone ? ' done' : '')), main = el('div', null, 'hwi-main');
      row.append(el('span', isDone ? '✓' : String(i + 1), 'hwi-num'));
      main.append(el('strong', (TYPES[item.type] ? TYPES[item.type].icon + ' ' : '') + title(item) + (isDone ? ' — done' : '')));
      var line = describe(item); if (line) main.append(el('small', line));
      if (item.note) main.append(el('em', item.note));
      row.append(main);
      if (options.canOpen) {
        var url = itemUrl(assignment, item);
        if (url) {
          var a = el('a', isDone ? 'Practice again' : 'Open', 'hwi-open' + (isDone ? ' again' : ''));
          a.href = url; a.target = '_blank'; a.rel = 'opener';
          a.setAttribute('data-homework-item', item.id);
          a.setAttribute('aria-label', (isDone ? 'Practice again: ' : 'Open: ') + title(item) + (line ? ', ' + line : ''));
          row.append(a);
        } else if (!isDone && options.markDone) {
          var b = el('button', 'I finished this', 'sec'); b.type = 'button';
          b.onclick = async function () { b.disabled = true; try { await options.markDone(item); } catch (e) { b.disabled = false; alert(e.message); } };
          row.append(b);
        }
      }
      list.append(row);
    });
    box.append(list);
    return box;
  }
  // Teacher table: "2/3 items".
  function progressTag(assignment, student) {
    var total = (assignment.items || []).length, n = doneCount(assignment.items, student && student.itemsDone);
    var tag = el('span', n + '/' + total + ' items', 'hwi-progress' + (n === total ? ' all' : ''));
    tag.title = n + ' of ' + total + ' checklist items done';
    return tag;
  }

  root.HomeworkItems = { MAX_ITEMS: MAX_ITEMS, TYPES: TYPES, describe: describe, title: title, itemUrl: itemUrl, hebNum: hebNum,
    builder: builder, checklist: checklist, progressTag: progressTag, doneCount: doneCount, addStyles: addStyles };
})(typeof window !== 'undefined' ? window : globalThis);
