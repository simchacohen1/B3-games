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
  var API = null, bar = null, select = null, lock = null, follow = null, pointer = null;
  var homeFollow = null, homePointer = null, modal = null, modalTitle = null, modalClassSelect = null;
  var accessFrame = null, followFrame = null, activePanel = '';
  var classes = [], selected = '', identity = 0, authorized = false;
  var lastFollowClass = '';
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
  // Class Pointer needs screen sharing and PeerJS, so it opens in its own named
  // tab (reused on repeat clicks), never in the panel iframe.
  function openPointer() {
    var id = currentClass();
    if (onPointerPage() || !classIsValid(id)) return;
    window.open(classUrl(POINTER_PATH, id), 'classPointer');
  }
  function syncPointerButtons() {
    var ok = classIsValid(currentClass());
    [pointer, homePointer].forEach(function(btn) {
      if (!btn) return;
      btn.hidden = !ok;
      btn.disabled = !ok;
      if (onPointerPage()) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
  }
  function getPreferred() {
    try { return localStorage.getItem('b3ControlClass') || ''; } catch (_) { return ''; }
  }
  function remember(id) {
    selected = id;
    try { localStorage.setItem('b3ControlClass', id); } catch (_) {}
  }
  function chosenLabel() {
    var row = classes.find(function(c) { return c.id === currentClass(); });
    return row ? row.name : currentClass().toUpperCase();
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
    modal.hidden = false;
    modalTitle.textContent = which === 'access' ? '🔒 Class Access' : '👣 Follow the Teacher';
    if (modalClassSelect) modalClassSelect.value = id;
    accessFrame.hidden = which !== 'access';
    followFrame.hidden = which !== 'follow';
    if (which === 'access') {
      applySource(accessFrame, classUrl('admin.html', id, {tab:'access',embed:'1'}));
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
  function setupUi() {
    if (bar) return;
    var style = el('style');
    style.textContent = [
      '#fttTeacherQuickBar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99980;display:flex;align-items:center;gap:6px;background:#fff;border:0;padding:5px 6px 5px 14px;border-radius:999px;box-shadow:0 7px 22px #0f172a29;font:700 14px Arial,sans-serif;color:#1e293b;max-width:calc(100vw - 20px)}',
      '#fttTeacherQuickBar[hidden],#fttTeacherQuickModal[hidden]{display:none!important}',
      '#fttTeacherQuickBar label{font-size:13px;font-weight:800}',
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
    bar.append(lock, follow, pointer);
    document.body.appendChild(bar);
    select.addEventListener('change', function () { updatePanelClass(select.value); });
    lock.addEventListener('click', function(){ openPanel('access'); });
    follow.addEventListener('click', function(){ openPanel('follow'); });
    pointer.addEventListener('click', openPointer);

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
    var popout = el('button','ftt-quick-popout','↗ Separate window'); popout.type = 'button';
    popout.title = 'Keep Follow running in its own window while you visit other teacher pages';
    var dismiss = el('button','ftt-quick-close','✕ Close'); dismiss.type = 'button';
    actions.append(popout,dismiss);head.append(modalTitle,actions);
    accessFrame = el('iframe');accessFrame.title = 'Class Access';accessFrame.hidden = true;
    followFrame = el('iframe');followFrame.title = 'Follow the Teacher controls';followFrame.hidden = true;
    card.append(head,accessFrame,followFrame);modal.appendChild(card);document.body.appendChild(modal);
    dismiss.addEventListener('click',closePanel);
    modal.addEventListener('click',function(e){if(e.target===modal)closePanel();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!modal.hidden)closePanel();});
    popout.addEventListener('click',function(){
      var url=activePanel==='follow'?classUrl('follow-teacher/teacher.html',currentClass()):classUrl('admin.html',currentClass(),{tab:'access'});
      window.open(url,'_blank','noopener');
    });
  }
  function syncClassPicker() {
    if (!select) return;
    select.replaceChildren();
    classes.forEach(function(row){
      var opt = el('option','',row.name); opt.value=row.id;select.appendChild(opt);
    });
    select.value = selected;
    if (modalClassSelect) {
      modalClassSelect.replaceChildren();
      classes.forEach(function(row) { var opt = el('option','',row.name);opt.value=row.id;modalClassSelect.appendChild(opt); });
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
      homeFollow.addEventListener('click',function(){openPanel('follow');});
      homeBar.appendChild(homeFollow);
    }
    if (!homePointer || !homeBar.contains(homePointer)) {
      homePointer = el('button','ftt-home-follow','👆');
      homePointer.type = 'button';homePointer.title = 'Open Class Pointer for the selected class';
      homePointer.setAttribute('aria-label','Open Class Pointer for the selected class');
      homePointer.addEventListener('click',openPointer);
      homeBar.appendChild(homePointer);
    }
    if (homeBar && !homeBar.__fttPointerWatch) {
      homeBar.__fttPointerWatch = true;
      homeBar.addEventListener('change', function(){ syncPointerButtons(); });
    }
    syncPointerButtons();
  }
  function reset() {
    authorized = false; identity++; classes = []; selected = '';
    if (bar) bar.hidden = true;
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
        rows = (access.classIds||[]).filter(function(id){return ID.test(id);}).map(function(id){
          return {id:id,name:(id==='et'||id==='wt')?id.toUpperCase():id};
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
      remember(ids.includes(requested)?requested:ids.includes(preferred)?preferred:ids[0]);
      authorized=true;
      setupUi();
      syncClassPicker();
      syncHomeButton(access);
    } catch(e) {
      if (serial===identity) reset();
      console.warn('Teacher quick controls unavailable:',e);
    }
  }
  function connect() {
    if (document.readyState === 'loading' || !document.body) {document.addEventListener('DOMContentLoaded',connect,{once:true});return;}
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
    var ticker=setInterval(ready,100);
    ready();
  }
  connect();
})();