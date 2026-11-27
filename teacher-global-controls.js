/*
 * Shared teacher-only quick controls for Fun Torah Tools.
 * Loaded by firebase-config.js on existing activity pages. UI is authorized
 * via B3SiteSettings; students and student impersonation never see the tools.
 */
(function () {
  'use strict';
  if (window.__fttGlobalTeacherControls || window.self !== window.top) return;
  if (/\/preview-pr\d+\//.test(location.pathname)) return;
  window.__fttGlobalTeacherControls = true;

  var loader = document.currentScript;
  var base = new URL('./', loader && loader.src || location.href);
  var API = null, bar = null, classBtn = null, classMenu = null, select = null, lock = null, follow = null, pointer = null;
  var homeFollow = null, homePointer = null, modal = null, modalTitle = null, modalClassSelect = null;
  var accessFrame = null, followFrame = null, activePanel = '';
  var classes = [], selected = '', identity = 0, authorized = false;
  var lastFollowClass = '';
  // A button pressed before any class is chosen waits here ('access', 'follow'
  // or 'pointer') while the panel asks "Which class?" (issue 769).
  var pending = '', chooser = null, popoutBtn = null;
  // The class the teacher confirmed on this page's own "confirm your class"
  // screen (class-confirm-gate.js), which does not always put it in the link.
  var gateClass = '';
  var ID = /^[A-Za-z0-9_-]{1,100}$/;
  var workspace = 'b3-2026';

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function currentClass() {
    var homeSelect = document.getElementById('homeClassSelect');
    if (homeFollow && homeSelect && ID.test(homeSelect.value)) return homeSelect.value;
    return selected;
  }
  var POINTER_PATH = 'class-pointer-prototype/classroom.html';
  function onPointerPage() {
    return /\/class-pointer-prototype\/classroom\.html$/.test(location.pathname);
  }
  function classIsValid(id) {
    return authorized && ID.test(id) && classes.some(function(row) { return row.id === id; });
  }
  // Some pages define their own global function named open() (the Yiddish app
  // does), which replaces window.open on that page, so window.open cannot be
  // trusted here. A link click opens the tab on every page; the same target
  // name reuses the tab on repeat presses.
  function openWindow(url, name, noOpener) {
    var link = el('a');
    link.href = url; link.target = name;
    if (noOpener) link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  // Class Pointer needs screen sharing and PeerJS, so it opens in its own named
  // tab (reused on repeat clicks), never in the panel iframe.
  function openPointer() {
    var id = currentClass();
    if (onPointerPage() || !classIsValid(id)) return;
    openWindow(classUrl(POINTER_PATH, id, {dashboard:'teacher'}), 'classPointer');
  }
  // The class the buttons act on. Never guessed between several classes: it is
  // the class already chosen, the class named in the link (also when the page
  // adds it after loading), the class confirmed on this page's confirm screen,
  // or the teacher's only class. Otherwise ''.
  function resolveClass() {
    var id = currentClass();
    if (classIsValid(id)) return id;
    var linked = new URLSearchParams(location.search).get('class') || '';
    if (classIsValid(linked)) id = linked;
    else if (classIsValid(gateClass)) id = gateClass;
    else if (authorized && classes.length === 1) id = classes[0].id;
    else return '';
    remember(id);
    if (select) select.value = id;
    if (modalClassSelect) modalClassSelect.value = id;
    return id;
  }
  // Every button press goes through here, so a press always does something:
  // it opens its tool, or asks which class first.
  function act(which) {
    if (!authorized || !modal) return;
    if (which === 'pointer' && onPointerPage()) return;
    if (!resolveClass()) { askClass(which); return; }
    if (which === 'pointer') openPointer(); else openPanel(which);
  }
  function askClass(which) {
    if (!modal.hidden && pending === which) { closePanel(); return; }
    closePanel();
    pending = which;
    modalTitle.textContent = which === 'access' ? '🔒 Class Access' : which === 'follow' ? '👣 Follow the Teacher' : '👆 Class Pointer';
    accessFrame.hidden = true; followFrame.hidden = true;
    popoutBtn.hidden = true;
    if (modalClassSelect) modalClassSelect.value = '';
    chooser.replaceChildren(el('h2', '', 'Which class?'), el('p', '', 'Choose a class to continue.'));
    var last = getPreferred(), list = el('div', 'ftt-quick-classes');
    pickableClasses().forEach(function(row) {
      var btn = el('button', '', row.name + (row.id === last ? ' (last used)' : ''));
      btn.type = 'button';
      btn.addEventListener('click', function() { updatePanelClass(row.id); });
      list.appendChild(btn);
    });
    chooser.appendChild(list);
    chooser.hidden = false;
    modal.hidden = false;
    var first = list.querySelector('button');
    if (first) first.focus();
  }
  function syncPointerButtons() {
    // Always shown to a signed-in teacher: with no class yet, pressing asks.
    var ok = authorized && classes.length > 0;
    [pointer, homePointer].forEach(function(btn) {
      if (!btn) return;
      btn.hidden = !ok;
      btn.disabled = !ok;
      if (onPointerPage()) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
  }
  function gateApi() { return window.B3ClassGate || null; }
  // The owner's class lists show only B3 ET and B3 WT; the class already chosen always stays listed.
  function pickableClasses() {
    var g = gateApi(); if (!g) return classes;
    var ok = g.pickable(classes.map(function(r) { return r.id; }));
    return classes.filter(function(r) { return ok.indexOf(r.id) >= 0 || r.id === selected; });
  }
  // The teacher's site-wide class (single class only; 'all' is not a class a panel can act on).
  function siteClass() {
    var g = gateApi(); if (!g) return '';
    var id = g.getSite();
    if (id === 'all') id = g.getLast();
    return classIsValid(id) ? id : '';
  }
  function getPreferred() {
    try { return localStorage.getItem('b3ControlClass') || ''; } catch (_) { return ''; }
  }
  // A choice made inside a quick panel is for that panel only. The class button
  // (switchClass) is what changes the class for the whole site.
  function remember(id) {
    selected = id;
    try { localStorage.setItem('b3ControlClass', id); } catch (_) {}
  }
  function className(id) {
    var row = classes.find(function(c) { return c.id === id; });
    var g = gateApi();
    return g ? g.label(id, row && row.name) : (row ? row.name : String(id).toUpperCase());
  }
  // What the class button shows: the class this page is actually on.
  function pageClass() {
    var g = gateApi();
    var linked = new URLSearchParams(location.search).get('class') || '';
    var saved = g ? g.getSite() : '';
    if (g && g.effective) {
      // This page uses the class gate: show the site-wide class (or what the page fell back to).
      if (classIsValid(saved)) return saved;
      if (saved === 'all' && g.allowAll) return 'all';
      return g.effective;
    }
    if (classIsValid(linked)) return linked;
    if (saved === 'all' || classIsValid(saved)) return saved;
    return '';
  }
  // A class named in the page link (?class=) is the teacher's class for the whole site.
  function adoptLinkClass() {
    var g = gateApi();
    var linked = new URLSearchParams(location.search).get('class') || '';
    // (Where the choice is "All classes", a link to the latest single class is just that page's fallback.)
    if (g && classIsValid(linked) && g.getSite() !== linked && !(g.getSite() === 'all' && linked === g.getLast())) g.setSite(linked);
  }
  function syncClassButton() {
    if (!classBtn) return;
    var id = pageClass();
    classBtn.textContent = '🏫 ' + (id ? className(id) : 'Choose class') + ' ▾';
    classBtn.title = onPointerPage() ? 'The class cannot change during a live lesson' : 'Class for every teacher page. Click to switch.';
    classBtn.disabled = onPointerPage();
    classBtn.setAttribute('aria-label', 'Class: ' + (id ? className(id) : 'none chosen') + '. Switch class for all teacher pages.');
  }
  function closeClassMenu() {
    if (classMenu) classMenu.hidden = true;
    if (classBtn) classBtn.setAttribute('aria-expanded', 'false');
  }
  function switchClass(id) {
    var g = gateApi();
    closeClassMenu();
    if (!g || (id !== 'all' && !classIsValid(id))) return;
    if (id === pageClass()) return;
    g.setSite(id);
    // A page that follows the choice live (Teacher Home) does not need a reload.
    if (window.__b3ClassLive) { syncClassButton(); return; }
    var url = new URL(location.href);
    if (id === 'all') url.searchParams.delete('class'); else url.searchParams.set('class', id);
    location.assign(url.href);
  }
  function openClassMenu() {
    if (!classMenu || onPointerPage()) return;
    if (!classMenu.hidden) { closeClassMenu(); return; }
    var g = gateApi(), current = pageClass();
    classMenu.replaceChildren();
    var shown = classes.map(function(row) { return row.id; });
    if (g) shown = g.pickable(shown);
    var list = shown.map(function(id) { return {id: id, text: className(id)}; });
    if (g && (g.allowAll || window.__b3ClassLive)) list.push({id: 'all', text: 'All classes'});
    list.forEach(function(item) {
      var b = el('button', '', item.text + (item.id === current ? ' ✓' : ''));
      b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(item.id === current));
      b.addEventListener('click', function() { switchClass(item.id); });
      classMenu.appendChild(b);
    });
    var r = classBtn.getBoundingClientRect();
    classMenu.style.top = Math.round(r.bottom + 6) + 'px';
    classMenu.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 200))) + 'px';
    classMenu.hidden = false;
    classBtn.setAttribute('aria-expanded', 'true');
    var first = classMenu.querySelector('button'); if (first) first.focus();
  }
  function chosenLabel() {
    return className(currentClass());
  }
  function classUrl(path, classId, options) {
    var url = new URL(path, base);
    url.searchParams.set('class', classId);
    Object.keys(options || {}).forEach(function(key) { url.searchParams.set(key, options[key]); });
    return url.href;
  }
  function applySource(frame, src) {
    if (frame.getAttribute('src') !== src) frame.setAttribute('src', src);
  }
  function closePanel() {
    if (!modal) return;
    modal.hidden = true;
    activePanel = '';
    pending = '';
    if (chooser) chooser.hidden = true;
    if (follow) follow.setAttribute('aria-expanded', 'false');
    if (homeFollow) homeFollow.setAttribute('aria-expanded', 'false');
    if (lock) lock.setAttribute('aria-expanded', 'false');
  }
  function updatePanelClass(id) {
    if (!classes.some(function(row) { return row.id === id; })) return;
    remember(id);
    if (select) select.value = id;
    syncPointerButtons();
    if (modalClassSelect) modalClassSelect.value = id;
    if (pending) {
      // The class was just chosen for a waiting button press: carry it out.
      var waiting = pending;
      closePanel();
      if (waiting === 'pointer') openPointer(); else openPanel(waiting);
      return;
    }
    if (!modal || modal.hidden || !activePanel) return;
    var which = activePanel;
    activePanel = '';
    openPanel(which);
  }
  function openPanel(which) {
    var id = currentClass();
    if (!authorized || !ID.test(id) || !classes.some(function(row) { return row.id === id; })) return;
    if (!modal) return;
    if (!modal.hidden && activePanel === which) { closePanel(); return; }
    activePanel = which;
    pending = '';
    if (chooser) chooser.hidden = true;
    if (popoutBtn) popoutBtn.hidden = false;
    modal.hidden = false;
    modalTitle.textContent = which === 'access' ? '🔒 Class Access' : '👣 Follow the Teacher';
    if (modalClassSelect) modalClassSelect.value = id;
    accessFrame.hidden = which !== 'access';
    followFrame.hidden = which !== 'follow';
    if (which === 'access') {
      applySource(accessFrame, classUrl('admin.html', id, {tab:'access',embed:'1'}));   // the one Class Access panel
    } else {
      // Keep an already-running Follow session alive while its panel is closed.
      // Changing class is intentional: its original controller stops on unload.
      if (lastFollowClass !== id) {
        applySource(followFrame, classUrl('follow-teacher/teacher.html', id, {embed:'1'}));
        lastFollowClass = id;
      }
    }
    if (follow) follow.setAttribute('aria-expanded', String(which === 'follow'));
    if (homeFollow) homeFollow.setAttribute('aria-expanded', String(which === 'follow'));
    if (lock) lock.setAttribute('aria-expanded', String(which === 'access'));
  }
  // ---- Where the quick buttons sit ----
  // On the Class Pointer page they live inside its dark top bar (never floating over the lesson, the staging note or the
  // sharing button). Everywhere else they float, but the grip lets the teacher drag them aside and the page remembers.
  var POS_KEY = 'fttTeacherQuickBarPos';
  function readPos() {
    try { var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && isFinite(p.x) && isFinite(p.y) ? p : null; } catch (e) { return null; }
  }
  function savePos(p) { try { if (p) localStorage.setItem(POS_KEY, JSON.stringify(p)); else localStorage.removeItem(POS_KEY); } catch (e) {} }
  function placeBar(x, y) {
    var r = bar.getBoundingClientRect();
    x = Math.max(0, Math.min(Math.max(0, window.innerWidth - r.width), x));
    y = Math.max(0, Math.min(Math.max(0, window.innerHeight - r.height), y));
    bar.style.transform = 'none'; bar.style.left = Math.round(x) + 'px'; bar.style.top = Math.round(y) + 'px';
    return { x: Math.round(x), y: Math.round(y) };
  }
  function applyPos() {
    if (!bar || bar.classList.contains('docked')) return;
    var p = readPos();
    if (!p) { bar.style.left = ''; bar.style.top = ''; bar.style.transform = ''; return; }
    placeBar(p.x, p.y);
  }
  function setupMove(grip) {
    var drag = null;
    grip.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      var r = bar.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
      try { grip.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      placeBar(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      var r = bar.getBoundingClientRect(); savePos({ x: Math.round(r.left), y: Math.round(r.top) });
    }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', function () { savePos(null); applyPos(); });
    grip.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 40 : 10, r = bar.getBoundingClientRect(), x = r.left, y = r.top;
      if (e.key === 'Home') { savePos(null); applyPos(); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft') x -= step; else if (e.key === 'ArrowRight') x += step; else if (e.key === 'ArrowUp') y -= step; else if (e.key === 'ArrowDown') y += step; else return;
      e.preventDefault(); savePos(placeBar(x, y));
    });
    window.addEventListener('resize', applyPos);
    applyPos();
  }
  function dock() {
    if (!bar || location.pathname.slice(-38)!=='class-pointer-prototype/classroom.html') return;
    var top = document.querySelector('.cp-topbar');
    if (!top) return;
    if (bar.parentNode !== top) {
      var spacer = top.querySelector('.cp-topbar-spacer');
      top.insertBefore(bar, spacer || top.children[1] || null);
      bar.classList.add('docked'); document.body.classList.add('ftt-quick-docked'); bar.style.left = ''; bar.style.top = ''; bar.style.transform = '';
    }
  }
  function setupUi() {
    if (bar) return;
    var style = el('style');
    style.textContent = [
      '#fttTeacherQuickBar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99980;display:flex;align-items:center;gap:6px;background:#fff;border:0;padding:5px 6px 5px 10px;border-radius:999px;box-shadow:0 7px 22px #0f172a29;font:700 14px Arial,sans-serif;color:#1e293b;max-width:calc(100vw - 20px)}',
      '#fttTeacherQuickBar[hidden],#fttTeacherQuickModal[hidden]{display:none!important}',
      // The grip on the left moves the buttons (they remember where they were put); on the Class Pointer page they sit inside its dark top bar instead.
      '#fttTeacherQuickBar .ftt-quick-grip{cursor:grab;color:#94a3b8;font:800 14px Arial;letter-spacing:-2px;padding:6px 4px 6px 0;user-select:none;touch-action:none;align-self:stretch;display:inline-flex;align-items:center}',
      '#fttTeacherQuickBar .ftt-quick-grip:focus-visible{outline:3px solid #2563eb;border-radius:6px}',
      '#fttTeacherQuickBar.docked{position:static;transform:none;left:auto;top:auto;z-index:auto;background:transparent;box-shadow:none;padding:0;gap:6px;max-width:none;flex:none}',
      '#fttTeacherQuickBar.docked .ftt-quick-grip{display:none}',
      '#fttTeacherQuickBar.docked{gap:4px}#fttTeacherQuickBar.docked button{width:30px;height:30px;font-size:16px}',
      'body.teacher-view.ftt-quick-docked .cp-topbar.cp-topbar{gap:4px}body.ftt-quick-docked .cp-topbar .cp-topbar-btn,body.ftt-quick-docked .cp-topbar .cp-share-state{padding-left:10px;padding-right:10px}',
      // The picker's word "Class" is spelled out by its aria-label; hiding it gives the three buttons their room in the bar.
      'body.ftt-quick-docked .cp-topbar .pointer-class-picker{font-size:0;gap:0}body.ftt-quick-docked .cp-topbar .pointer-class-picker select{font-size:14px}',
      '#fttTeacherQuickBar.docked button{background:#ffffff26;color:#fff}',
      '#fttTeacherQuickBar.docked #fttTeacherQuickLock{background:#1f2937;box-shadow:0 0 0 1px #ffffff66}',
      '#fttTeacherQuickBar.docked button[aria-expanded=true],#fttTeacherQuickBar.docked button[aria-current=page]{background:#dbeafe;color:#1e3a8a}',
      '#fttTeacherQuickBar label{font-size:13px;font-weight:800}',
      '#fttTeacherQuickBar #fttTeacherClassBtn{width:auto;height:34px;padding:0 12px;background:#e0f2fe;color:#075985;font:800 14px Arial;white-space:nowrap}',
      '#fttTeacherQuickBar #fttTeacherClassBtn:disabled{cursor:default;opacity:.8}',
      '#fttTeacherQuickBar.docked #fttTeacherClassBtn{height:30px;font-size:13px;background:#ffffff26;color:#fff}',
      '#fttTeacherClassMenu{position:fixed;z-index:100400;min-width:170px;max-height:70vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 12px 36px #0f172a40;padding:6px;display:flex;flex-direction:column;gap:2px;font-family:Arial,sans-serif}',
      '#fttTeacherClassMenu[hidden]{display:none!important}',
      '#fttTeacherClassMenu button{width:auto;height:auto;border:0;background:#fff;color:#1e293b;text-align:left;padding:10px 12px;border-radius:9px;font:700 15px Arial;cursor:pointer;display:block}',
      '#fttTeacherClassMenu button:hover,#fttTeacherClassMenu button:focus-visible,#fttTeacherClassMenu button[aria-checked=true]{background:#e0f2fe;outline:none}',
      '#fttTeacherQuickBar select{max-width:170px;min-width:130px;border:1px solid #cbd5e1;border-radius:999px;padding:6px 10px;color:#1e293b;background:#fff;font:700 14px Arial}',
      '#fttTeacherQuickBar button,.ftt-home-follow{border:0;border-radius:999px;width:34px;height:34px;padding:0;background:#f0ebff;color:#5c4592;font:800 18px Arial;cursor:pointer;white-space:nowrap;display:inline-grid;place-items:center}',
      '#fttTeacherQuickBar #fttTeacherQuickLock{background:#1f2937;color:white}',
      '#fttTeacherQuickBar button:focus-visible,.ftt-home-follow:focus-visible{outline:3px solid #2563eb;outline-offset:2px}',
      '#fttTeacherQuickBar button[aria-expanded=true],.ftt-home-follow[aria-expanded=true],#fttTeacherQuickBar button[aria-current=page],.ftt-home-follow[aria-current=page]{background:#dbeafe}',
      '#fttTeacherQuickBar button[hidden],.ftt-home-follow[hidden]{display:none!important}',
      '#fttTeacherQuickBar button[aria-current=page],.ftt-home-follow[aria-current=page]{cursor:default}',
      '.ftt-home-follow{font-size:18px!important;padding:5px 9px!important;border-radius:999px!important}',
      '#fttTeacherQuickModal{position:fixed;inset:0;z-index:100500;background:#0f172a80;display:flex;align-items:center;justify-content:center;padding:12px;font-family:Arial,sans-serif}',
      '#fttTeacherQuickModal .ftt-quick-card{background:#fff;color:#1e293b;border-radius:18px;width:min(980px,100%);height:min(88vh,840px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 65px #0005}',
      '#fttTeacherQuickModal .ftt-quick-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;background:#f8fafc;border-bottom:1px solid #cbd5e1;font-weight:900}',
      '#fttTeacherQuickModal .ftt-quick-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}',
      '#fttTeacherQuickModal .ftt-quick-close,#fttTeacherQuickModal .ftt-quick-popout{padding:8px 12px;border:1px solid #cbd5e1;background:#fff;border-radius:9px;font:700 13px Arial;color:#1e293b;cursor:pointer}',
      '#fttTeacherQuickModal iframe{width:100%;flex:1;min-height:0;border:0;background:#fff}',
      '#fttTeacherQuickModal iframe[hidden]{display:none!important}',
      '#fttTeacherQuickModal .ftt-quick-choose{flex:1;overflow:auto;padding:28px 18px;text-align:center}',
      '#fttTeacherQuickModal .ftt-quick-choose[hidden],#fttTeacherQuickModal .ftt-quick-popout[hidden]{display:none!important}',
      '#fttTeacherQuickModal .ftt-quick-choose h2{margin:0 0 6px;font:900 24px Arial,sans-serif}',
      '#fttTeacherQuickModal .ftt-quick-choose p{margin:0 0 18px;color:#475569;font:400 16px Arial,sans-serif}',
      '#fttTeacherQuickModal .ftt-quick-classes{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:640px;margin:0 auto}',
      '#fttTeacherQuickModal .ftt-quick-classes button{min-width:150px;padding:14px 18px;border:2px solid #1d4ed8;border-radius:12px;background:#fff;color:#1d4ed8;font:700 17px Arial,sans-serif;cursor:pointer}',
      '#fttTeacherQuickModal .ftt-quick-classes button:hover,#fttTeacherQuickModal .ftt-quick-classes button:focus-visible{background:#1d4ed8;color:#fff}',
      '@media(max-width:620px){#fttTeacherQuickBar{top:8px;bottom:auto;right:auto;left:50%;transform:translateX(-50%)}#fttTeacherQuickBar label{display:block}#fttTeacherQuickBar select{min-width:100px}#fttTeacherQuickBar button{padding:0;font-size:18px}#fttTeacherQuickModal{padding:0}#fttTeacherQuickModal .ftt-quick-card{width:100%;height:100%;border-radius:0}}'
    ].join('\n');
    document.head.appendChild(style);

    bar = el('nav'); bar.id = 'fttTeacherQuickBar'; bar.hidden = true;
    bar.setAttribute('aria-label', 'Teacher class, Follow and Class Pointer controls');
    var label = el('label', '', 'Class'); label.htmlFor = 'fttTeacherQuickClass';
    select = el('select'); select.id = 'fttTeacherQuickClass'; select.setAttribute('aria-label','Teaching class');
    lock = el('button', '', '🔒'); lock.id='fttTeacherQuickLock'; lock.setAttribute('aria-label','Open Class Access'); lock.type = 'button'; lock.title = 'Open Class Access for the selected class'; lock.setAttribute('aria-expanded','false');
    follow = el('button', '', '👣'); follow.setAttribute('aria-label','Open or close Follow the Teacher'); follow.type = 'button'; follow.title = 'Open or close Follow the Teacher'; follow.setAttribute('aria-expanded','false');
    pointer = el('button', '', '👆'); pointer.id = 'fttTeacherQuickPointer'; pointer.type = 'button';
    pointer.setAttribute('aria-label','Open Class Pointer for the selected class'); pointer.title = 'Open Class Pointer for the selected class';
    var grip = el('span', 'ftt-quick-grip', '⋮⋮'); grip.setAttribute('role','button'); grip.tabIndex = 0;
    grip.title = 'Drag to move these buttons. Double-click to put them back.';
    grip.setAttribute('aria-label','Move the teacher buttons. Use the arrow keys, or drag. Press Home to put them back.');
    classBtn = el('button', '', '🏫 Choose class ▾'); classBtn.id = 'fttTeacherClassBtn'; classBtn.type = 'button';
    classBtn.setAttribute('aria-haspopup', 'menu'); classBtn.setAttribute('aria-expanded', 'false');
    classMenu = el('div'); classMenu.id = 'fttTeacherClassMenu'; classMenu.hidden = true; classMenu.setAttribute('role', 'menu');
    classMenu.setAttribute('aria-label', 'Switch class for every teacher page');
    classBtn.addEventListener('click', openClassMenu);
    document.addEventListener('click', function(e) { if (classMenu && !classMenu.hidden && e.target !== classBtn && !classMenu.contains(e.target)) closeClassMenu(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && classMenu && !classMenu.hidden) { closeClassMenu(); classBtn.focus(); } });
    window.addEventListener('b3-class-changed', syncClassButton);
    bar.append(grip, classBtn, lock, follow, pointer);
    document.body.appendChild(bar); document.body.appendChild(classMenu);
    setupMove(grip);
    setInterval(dock, 500); dock();
    select.addEventListener('change', function () { updatePanelClass(select.value); });
    lock.addEventListener('click', function(){ act('access'); });
    follow.addEventListener('click', function(){ act('follow'); });
    pointer.addEventListener('click', function(){ act('pointer'); });

    modal = el('div'); modal.id = 'fttTeacherQuickModal'; modal.hidden = true;
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-label','Teacher quick controls');
    var card = el('div','ftt-quick-card'), head = el('div','ftt-quick-head');
    modalTitle = el('span', '', 'Teacher controls');
    var actions = el('div','ftt-quick-actions');
    var classLabel = el('label', '', 'Class'); classLabel.htmlFor = 'fttTeacherModalClass';
    modalClassSelect = el('select'); modalClassSelect.id = 'fttTeacherModalClass';
    modalClassSelect.setAttribute('aria-label','Choose class for teacher controls');
    modalClassSelect.style.cssText = 'max-width:180px;padding:8px;border:1px solid #cbd5e1;border-radius:9px;background:white;color:#1e293b;font:700 14px Arial';
    modalClassSelect.addEventListener('change', function(){ updatePanelClass(modalClassSelect.value); });
    actions.append(classLabel, modalClassSelect);
    var popout = popoutBtn = el('button','ftt-quick-popout','↗ Separate window'); popout.type = 'button';
    popout.title = 'Keep Follow running in its own window while you visit other teacher pages';
    var dismiss = el('button','ftt-quick-close','✕ Close'); dismiss.type = 'button';
    actions.append(popout,dismiss);head.append(modalTitle,actions);
    accessFrame = el('iframe');accessFrame.title = 'Class Access';accessFrame.hidden = true;
    followFrame = el('iframe');followFrame.title = 'Follow the Teacher controls';followFrame.hidden = true;
    chooser = el('div','ftt-quick-choose'); chooser.hidden = true;
    card.append(head,chooser,accessFrame,followFrame);modal.appendChild(card);document.body.appendChild(modal);
    dismiss.addEventListener('click',closePanel);
    modal.addEventListener('click',function(e){if(e.target===modal)closePanel();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!modal.hidden)closePanel();});
    popout.addEventListener('click',function(){
      var url=activePanel==='follow'?classUrl('follow-teacher/teacher.html',currentClass()):classUrl('admin.html',currentClass(),{tab:'access'});
      openWindow(url,'_blank',true);
    });
  }
  function syncClassPicker() {
    if (!select) return;
    select.replaceChildren();
    var blank = el('option','','Choose a class\u2026'); blank.value=''; select.appendChild(blank);
    pickableClasses().forEach(function(row){
      var opt = el('option','',row.name); opt.value=row.id;select.appendChild(opt);
    });
    select.value = selected;
    if (modalClassSelect) {
      modalClassSelect.replaceChildren();
      var blank2 = el('option','','Choose a class\u2026'); blank2.value=''; modalClassSelect.appendChild(blank2);
      pickableClasses().forEach(function(row) { var opt = el('option','',row.name);opt.value=row.id;modalClassSelect.appendChild(opt); });
      modalClassSelect.value = selected;
    }
  }
  function syncHomeButton(access) {
    var homeBar = document.getElementById('homeClassBar');
    // Use the existing owner home bar, not a second duplicate toolbar.
    var useHome = Boolean(homeBar && access.role === 'admin' &&
      new URLSearchParams(location.search).get('adminPage') !== '1' &&
      new URLSearchParams(location.search).get('preview') !== '1');
    if (!useHome) {
      if (homeFollow) homeFollow.remove();
      homeFollow = null;
      if (homePointer) homePointer.remove();
      homePointer = null;
      bar.hidden = false;
      syncPointerButtons();
      return;
    }
    bar.hidden = true;
    if (!homeFollow || !homeBar.contains(homeFollow)) {
      homeFollow = el('button','ftt-home-follow','👣');
      homeFollow.type = 'button';homeFollow.title = 'Open or close Follow the Teacher';
      homeFollow.setAttribute('aria-label','Open or close Follow the Teacher tools');
      homeFollow.setAttribute('aria-expanded','false');
      homeFollow.addEventListener('click',function(){act('follow');});
      homeBar.appendChild(homeFollow);
    }
    if (!homePointer || !homeBar.contains(homePointer)) {
      homePointer = el('button','ftt-home-follow','👆');
      homePointer.type = 'button';homePointer.title = 'Open Class Pointer for the selected class';
      homePointer.setAttribute('aria-label','Open Class Pointer for the selected class');
      homePointer.addEventListener('click',function(){act('pointer');});
      homeBar.appendChild(homePointer);
    }
    if (homeBar && !homeBar.__fttPointerWatch) {
      homeBar.__fttPointerWatch = true;
      homeBar.addEventListener('change', function(){ syncPointerButtons(); });
    }
    syncPointerButtons();
  }
  // Shared drawing toolbar: a teacher always has the pencil button (class-pointer-prototype/annotation-toolbar.js).
  var annotateLoading = null;
  function teacherAnnotate(on) {
    if (!on) { if (window.FTTAnnotate) window.FTTAnnotate.setRole(null); return; }
    if (window.FTTAnnotate) { window.FTTAnnotate.setRole('teacher'); return; }
    if (annotateLoading) return;
    annotateLoading = document.createElement('script');
    annotateLoading.src = new URL('class-pointer-prototype/annotation-toolbar.js?v=20261125-wb3', base).href;
    annotateLoading.async = true;
    annotateLoading.onload = function() { if (authorized && window.FTTAnnotate) window.FTTAnnotate.setRole('teacher'); };
    annotateLoading.onerror = function() { annotateLoading = null; };
    document.head.appendChild(annotateLoading);
  }
  function reset() {
    teacherAnnotate(false);
    authorized = false; identity++; classes = []; selected = '';
    if (bar) bar.hidden = true;
    closeClassMenu();
    if (homeFollow) {homeFollow.remove();homeFollow=null;}
    if (homePointer) {homePointer.remove();homePointer=null;}
    if (accessFrame) accessFrame.removeAttribute('src');
    if (followFrame) followFrame.removeAttribute('src');
    lastFollowClass = '';
    closePanel();
  }
  async function onAuth(user, ok, access) {
    var serial = ++identity;
    if (!user || !ok || !access || !access.authorized ||
      (access.role !== 'admin' && access.role !== 'teacher') ||
      (API.getActingStudent && API.getActingStudent())) {reset();return;}
    try {
      workspace = API.workspaceId || 'b3-2026';
      var db = firebase.database();
      var rows = [];
      if (access.role === 'admin') {
        var all = (await db.ref('b3Games/workspaces/'+workspace+'/classes').once('value')).val() || {};
        rows = Object.keys(all).filter(function(id){return ID.test(id) && all[id] && all[id].active !== false;}).map(function(id){
          return {id:id,name:(id==='et'||id==='wt')?id.toUpperCase():String(all[id].name||id)};
        });
      } else {
        var own = (access.classIds||[]).filter(function(id){return ID.test(id) && id !== '*';});
        var names = await Promise.all(own.map(function(id){
          return db.ref('b3Games/workspaces/'+workspace+'/classes/'+id+'/name').once('value').then(function(s){return s.val();}).catch(function(){return null;});
        }));
        rows = own.map(function(id,i){
          return {id:id,name:(id==='et'||id==='wt')?id.toUpperCase():String(names[i]||id)};
        });
      }
      if (serial !== identity) return;
      rows.sort(function(a,b) {
        var rank=function(id){return id==='et'?0:id==='wt'?1:2;};
        return rank(a.id)-rank(b.id)||a.name.localeCompare(b.name);
      });
      if (!rows.length) {reset();return;}
      classes=rows;
      var requested = new URLSearchParams(location.search).get('class');
      var preferred = getPreferred();
      var ids=rows.map(function(row){return row.id;});
      // The panels act on the class in the link, else the teacher's site-wide class.
      authorized=true;
      teacherAnnotate(true);
      selected = ids.includes(requested) ? requested : siteClass();
      adoptLinkClass();
      setupUi();
      syncClassPicker();
      syncHomeButton(access);
      syncClassButton();
    } catch(e) {
      if (serial===identity) reset();
      console.warn('Teacher quick controls unavailable:',e);
    }
  }
  function watchClassGate() {
    if (!window.MutationObserver) return;
    new MutationObserver(function(changes) {
      changes.forEach(function(change) {
        Array.prototype.forEach.call(change.removedNodes, function(node) {
          if (node.id !== 'b3ClassGate') return;
          var g = gateApi();
          gateClass = g && g.effective && g.effective !== 'all' ? g.effective : '';
          syncClassButton();
        });
      });
    }).observe(document.body, {childList:true});
  }
  function connect() {
    if (document.readyState === 'loading' || !document.body) {document.addEventListener('DOMContentLoaded',connect,{once:true});return;}
    watchClassGate();
    var tries = 0;
    function ready() {
      API = window.B3SiteSettings;
      if (API && typeof API.onAuthStateChanged === 'function' && window.firebase) {
        clearInterval(ticker);
        API.onAuthStateChanged(onAuth);
      } else if (++tries >= 150) clearInterval(ticker);
    }
    // Most tools already import site-settings.js. Load it only where missing.
    if (!window.B3SiteSettings && !Array.from(document.scripts).some(function(s){return /(?:^|\/)site-settings\.js(?:\?|$)/.test(s.src||'');})) {
      var script=el('script');script.src=new URL('site-settings.js?v=20261020-quickbar',base).href;
      document.head.appendChild(script);
    }
    // The shared class gate holds the site-wide class; load it where the page has not.
    if (!window.B3ClassGate && !Array.from(document.scripts).some(function(s){return /(?:^|\/)class-confirm-gate\.js(?:\?|$)/.test(s.src||'');})) {
      var gs=el('script');gs.src=new URL('class-confirm-gate.js?v=20261126-site-class',base).href;
      gs.onload=function(){if(authorized){adoptLinkClass();if(!selected)selected=siteClass();syncClassButton();}};document.head.appendChild(gs);
    }
    var ticker=setInterval(ready,100);
    ready();
  }
  connect();
})();