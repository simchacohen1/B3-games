/*
 * Grade themes (Issue #737).
 *
 * The grade is the number after "B" in a class name: "B4 ET 1 · Morning" is grade 4.
 * Each grade band (4-5, 6-7, 8) has a few preset themes. A theme is a set of CSS
 * variables in grade-themes.css, switched on by one class on the root element:
 *   <html class="ftt-themed ftt-theme-g45-sunny">
 * The teacher saves one theme per grade at
 *   b3Games/workspaces/<workspace>/gradeThemes/<grade> = "<theme id>"
 * so every class in that grade uses it. Nothing saved = the band's default.
 * Classes with no grade 4-8 in the name (ET, WT, B3 ...) keep the normal look.
 */
(function (root) {
  'use strict';

  var BANDS = [
    { id: 'g45', label: 'Grades 4-5', grades: [4, 5], defaultTheme: 'g45-sunny', plain: false },
    { id: 'g67', label: 'Grades 6-7', grades: [6, 7], defaultTheme: 'g67-slate', plain: true },
    { id: 'g8', label: 'Grade 8', grades: [8], defaultTheme: 'g8-ink', plain: true }
  ];
  // swatch = [page background, header, accent] for the picker preview only.
  var THEMES = [
    { id: 'g45-sunny', band: 'g45', name: 'Sunny Island', swatch: ['#fffaf0', '#38bdf8', '#f59e0b'] },
    { id: 'g45-candy', band: 'g45', name: 'Candy Pop', swatch: ['#fff5fb', '#f472b6', '#a855f7'] },
    { id: 'g45-jungle', band: 'g45', name: 'Jungle Trek', swatch: ['#f7fdf2', '#16a34a', '#ca8a04'] },
    { id: 'g45-ocean', band: 'g45', name: 'Ocean Splash', swatch: ['#f0fbff', '#0891b2', '#f97316'] },
    { id: 'g67-slate', band: 'g67', name: 'Slate', swatch: ['#f1f5f9', '#334155', '#3b82f6'] },
    { id: 'g67-forest', band: 'g67', name: 'Forest', swatch: ['#f3f6f1', '#2f5d46', '#2f855a'] },
    { id: 'g67-sand', band: 'g67', name: 'Sandstone', swatch: ['#f7f3ec', '#7c5e3c', '#b7791f'] },
    { id: 'g67-dusk', band: 'g67', name: 'Dusk', swatch: ['#111827', '#0b1220', '#818cf8'] },
    { id: 'g8-ink', band: 'g8', name: 'Ink', swatch: ['#fafafa', '#111827', '#2563eb'] },
    { id: 'g8-stone', band: 'g8', name: 'Stone', swatch: ['#eef0ec', '#4b5548', '#556b2f'] },
    { id: 'g8-midnight', band: 'g8', name: 'Midnight', swatch: ['#0b1020', '#060a16', '#38bdf8'] },
    { id: 'g8-charcoal', band: 'g8', name: 'Charcoal', swatch: ['#18181b', '#0f0f11', '#f59e0b'] }
  ];
  // Calmer wording for the older bands. Keys are data-game-group values.
  var PLAIN_TEXT = {
    introTitle: 'Your learning',
    introText: 'Choose a subject.',
    toolsTitle: 'Teacher Tools',
    groups: {
      learn: 'Chumash', roots: 'Shorashim', skills: 'Language Skills',
      'more-learning': 'Beis Midrash', 'class': 'Class', challenge: 'Quizzes and Games'
    }
  };

  function gradeFromName(name) {
    var match = /^\s*B\s*([4-8])(?!\d)/i.exec(String(name == null ? '' : name));
    return match ? Number(match[1]) : null;
  }
  function bandForGrade(grade) {
    var g = Number(grade);
    for (var i = 0; i < BANDS.length; i++) if (BANDS[i].grades.indexOf(g) >= 0) return BANDS[i];
    return null;
  }
  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }
  function themesForGrade(grade) {
    var band = bandForGrade(grade);
    return band ? THEMES.filter(function (t) { return t.band === band.id; }) : [];
  }
  // The theme a grade uses: the saved one if it belongs to that grade's band, else the band default.
  function themeForGrade(grade, saved) {
    var band = bandForGrade(grade);
    if (!band) return null;
    var picked = themeById(saved && saved[String(Number(grade))]);
    return picked && picked.band === band.id ? picked.id : band.defaultTheme;
  }
  function themeForClassName(name, saved) {
    return themeForGrade(gradeFromName(name), saved);
  }

  var api = {
    BANDS: BANDS, THEMES: THEMES, PLAIN_TEXT: PLAIN_TEXT,
    gradeFromName: gradeFromName, bandForGrade: bandForGrade, themeById: themeById,
    themesForGrade: themesForGrade, themeForGrade: themeForGrade, themeForClassName: themeForClassName
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  // ---------------------------------------------------------------- browser
  var doc = root.document, html = doc.documentElement;
  var CACHE_KEY = 'fttGradeThemeClass';
  var saved = null, loading = null;      // gradeThemes map once loaded
  var currentName = null;                // class name the page is showing (root theme)
  var decorated = null;                  // container whose class cards carry their own theme

  function workspaceId() {
    return (root.B3SiteSettings && root.B3SiteSettings.workspaceId) || root.B3_WORKSPACE_ID || 'b3-2026';
  }
  function themesRef() {
    if (!root.firebase || !root.firebase.database) return null;
    try { return root.firebase.database().ref('b3Games/workspaces/' + workspaceId() + '/gradeThemes'); } catch (e) { return null; }
  }
  function load() {
    if (saved) return Promise.resolve(saved);
    if (loading) return loading;
    var ref = themesRef();
    if (!ref) return Promise.resolve({});
    loading = ref.once('value').then(function (snap) { saved = snap.val() || {}; loading = null; return saved; })
      .catch(function () { loading = null; return {}; }); // not cached, so a later call tries again
    return loading;
  }

  function swapText(el, text) {
    if (!el) return;
    if (text == null) {
      if (el.hasAttribute('data-ftt-orig')) { el.innerHTML = el.getAttribute('data-ftt-orig'); el.removeAttribute('data-ftt-orig'); }
      return;
    }
    if (!el.hasAttribute('data-ftt-orig')) el.setAttribute('data-ftt-orig', el.innerHTML);
    if (el.textContent !== text) el.textContent = text;
  }
  function swapHeadings(scope, plain) {
    var within = scope === html ? doc : scope;
    if (!within || !within.querySelectorAll) return;
    // The page-level theme leaves alone anything inside a class card that carries its own theme.
    var mine = function (el) { var owner = el.closest('.ftt-themed'); return scope !== html || !owner || owner === html; };
    var each = function (selector, fn) { Array.prototype.filter.call(within.querySelectorAll(selector), mine).forEach(fn); };
    each('.island-intro h2, .island-intro h3', function (el) { swapText(el, plain ? PLAIN_TEXT.introTitle : null); });
    each('.island-intro p', function (el) { swapText(el, plain ? PLAIN_TEXT.introText : null); });
    each('.teacher-tools-section > h2, .teacher-tools-section > h3', function (el) { swapText(el, plain ? PLAIN_TEXT.toolsTitle : null); });
    each('.game-group[data-game-group]', function (group) {
      var text = PLAIN_TEXT.groups[group.getAttribute('data-game-group')];
      swapText(group.querySelector('.game-group-title'), plain && text ? text : null);
    });
  }
  // Put a theme on an element (the root, or one class card). themeId null removes it.
  function setTheme(el, themeId) {
    if (!el) return;
    var theme = themeById(themeId), wanted = theme ? 'ftt-theme-' + theme.id : '';
    Array.prototype.slice.call(el.classList).forEach(function (c) {
      if (c.indexOf('ftt-theme-') === 0 && c !== wanted) el.classList.remove(c);
    });
    el.classList.toggle('ftt-themed', !!theme);
    if (wanted) el.classList.add(wanted);
    var band = theme && BANDS.filter(function (b) { return b.id === theme.band; })[0];
    if (doc.body) swapHeadings(el, !!(band && band.plain));
    if (el === html) {
      try { if (wanted) root.sessionStorage.setItem(CACHE_KEY, theme.id); else root.sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
    }
  }

  function applyRoot() {
    setTheme(html, currentName ? themeForClassName(currentName, saved || {}) : null);
  }
  // Call whenever the class on screen changes. An empty name puts the normal look back.
  function useClass(name) {
    currentName = String(name == null ? '' : name);
    if (decorated) decorated = null;
    applyRoot();
    if (!saved && gradeFromName(currentName)) load().then(function () { if (!decorated) applyRoot(); });
  }
  // For a page that shows several classes at once: every [data-ftt-class-name]
  // inside the container gets its own grade's theme. The page itself follows
  // them when they all agree, and keeps the normal look when they differ.
  function decorate(container) {
    decorated = container || decorated;
    if (!decorated) return;
    var cards = Array.prototype.slice.call(decorated.querySelectorAll('[data-ftt-class-name]'));
    var paint = function () {
      var ids = cards.map(function (card) { return themeForClassName(card.getAttribute('data-ftt-class-name'), saved || {}); });
      var same = ids.length && ids.every(function (id) { return id === ids[0]; });
      setTheme(html, same ? ids[0] : null);
      cards.forEach(function (card, i) { setTheme(card, ids[i]); });
    };
    paint();
    if (!saved && cards.some(function (card) { return gradeFromName(card.getAttribute('data-ftt-class-name')); })) load().then(paint);
  }
  function refresh() { if (decorated) decorate(); else applyRoot(); }

  function save(grade, themeId) {
    var g = Number(grade), theme = themeById(themeId), band = bandForGrade(g), ref = themesRef();
    if (!band || !theme || theme.band !== band.id) return Promise.reject(new Error('That theme is not available for this grade.'));
    if (!ref) return Promise.reject(new Error('Not connected.'));
    return ref.child(String(g)).set(theme.id).then(function () {
      saved = saved || {};
      saved[String(g)] = theme.id;
      refresh();
    });
  }

  // ------------------------------------------------------------- the picker
  function make(tag, className, text) {
    var el = doc.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }
  /*
   * options.classNames: the teacher's class names; only their grades are listed.
   * options.allGrades:  true lists grades 4 to 8 (owner).
   * options.focusGrade: grade to show first.
   */
  function openPicker(options) {
    options = options || {};
    var names = options.classNames || [], byGrade = {};
    names.forEach(function (name) { var g = gradeFromName(name); if (g) (byGrade[g] = byGrade[g] || []).push(String(name)); });
    var grades = options.allGrades ? [4, 5, 6, 7, 8] : Object.keys(byGrade).map(Number).sort();
    if (options.focusGrade && grades.indexOf(Number(options.focusGrade)) > 0) {
      grades = [Number(options.focusGrade)].concat(grades.filter(function (g) { return g !== Number(options.focusGrade); }));
    }
    var old = doc.getElementById('fttThemePicker');
    if (old) old.remove();
    var overlay = make('div', 'ftt-tp-overlay'); overlay.id = 'fttThemePicker';
    var card = make('div', 'ftt-tp-card');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'fttThemePickerTitle');
    var head = make('div', 'ftt-tp-head');
    var title = make('h2', '', 'Class themes'); title.id = 'fttThemePickerTitle';
    var closeX = make('button', 'ftt-tp-x', '×'); closeX.type = 'button'; closeX.setAttribute('aria-label', 'Close');
    head.appendChild(title); head.appendChild(closeX);
    var intro = make('p', 'ftt-tp-intro', 'Pick one look for each grade. Every class in that grade uses it, for students and teachers.');
    var status = make('p', 'ftt-tp-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    var list = make('div', 'ftt-tp-list');
    card.appendChild(head); card.appendChild(intro); card.appendChild(list); card.appendChild(status);
    var done = make('button', 'ftt-tp-done', 'Done'); done.type = 'button';
    card.appendChild(done);
    overlay.appendChild(card);

    var lastFocus = doc.activeElement;
    function close() {
      overlay.remove(); doc.removeEventListener('keydown', onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    closeX.onclick = close; done.onclick = close;
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    doc.addEventListener('keydown', onKey);

    function draw() {
      list.replaceChildren();
      if (!grades.length) {
        list.appendChild(make('p', 'ftt-tp-empty', 'Themes follow the grade in the class name, such as “B4 ET 1 · Morning”. None of your classes has a grade from 4 to 8 in its name yet.'));
        return;
      }
      grades.forEach(function (grade) {
        var band = bandForGrade(grade), active = themeForGrade(grade, saved || {});
        var row = make('section', 'ftt-tp-grade');
        var heading = make('h3', '', 'Grade ' + grade);
        row.appendChild(heading);
        if (byGrade[grade]) row.appendChild(make('p', 'ftt-tp-classes', byGrade[grade].join(', ')));
        var choices = make('div', 'ftt-tp-choices');
        choices.setAttribute('role', 'radiogroup'); choices.setAttribute('aria-label', 'Theme for grade ' + grade);
        themesForGrade(grade).forEach(function (theme) {
          var button = make('button', 'ftt-tp-choice'); button.type = 'button';
          button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', String(theme.id === active));
          var preview = make('span', 'ftt-tp-preview ftt-theme-' + theme.id); preview.setAttribute('aria-hidden', 'true');
          preview.style.background = theme.swatch[0];
          var bar = make('span', 'ftt-tp-bar'); bar.style.background = theme.swatch[1];
          var tile = make('span', 'ftt-tp-tile'); tile.style.borderColor = theme.swatch[2];
          var tile2 = make('span', 'ftt-tp-tile'); tile2.style.borderColor = theme.swatch[2];
          preview.appendChild(bar); preview.appendChild(tile); preview.appendChild(tile2);
          button.appendChild(preview);
          button.appendChild(make('span', 'ftt-tp-name', theme.name));
          if (theme.id === band.defaultTheme) button.appendChild(make('span', 'ftt-tp-tag', 'Default'));
          button.onclick = function () {
            if (theme.id === themeForGrade(grade, saved || {})) return;
            status.className = 'ftt-tp-status'; status.textContent = 'Saving…';
            Array.prototype.forEach.call(list.querySelectorAll('button'), function (b) { b.disabled = true; });
            save(grade, theme.id).then(function () {
              draw(); status.textContent = 'Saved. Grade ' + grade + ' now uses ' + theme.name + '.';
              if (options.onChange) options.onChange(grade, theme.id);
            }).catch(function () {
              draw(); status.className = 'ftt-tp-status ftt-tp-error';
              status.textContent = 'Could not save the theme. Please try again. If it keeps happening, tell the site owner.';
            });
          };
          choices.appendChild(button);
        });
        row.appendChild(choices);
        list.appendChild(row);
      });
    }
    list.appendChild(make('p', 'ftt-tp-empty', 'Loading…'));
    doc.body.appendChild(overlay);
    closeX.focus();
    load().then(draw);
  }

  // Put the last theme back straight away so the page does not flash the normal look first.
  try {
    var cached = root.sessionStorage.getItem(CACHE_KEY);
    if (themeById(cached)) { html.classList.add('ftt-themed', 'ftt-theme-' + cached); }
  } catch (e) {}
  doc.addEventListener('DOMContentLoaded', function () {
    var current = Array.prototype.filter.call(html.classList, function (c) { return c.indexOf('ftt-theme-') === 0; })[0];
    if (current) setTheme(html, current.slice('ftt-theme-'.length));
  });

  api.load = load; api.save = save; api.useClass = useClass; api.decorate = decorate;
  api.refresh = refresh; api.setTheme = setTheme; api.openPicker = openPicker;
  root.FTTGradeThemes = api;
})(typeof window !== 'undefined' ? window : null);
