/* Site-wide teacher control indicator. No student information is stored locally. */
(function () {
  'use strict';
  if (window !== window.top || window.FTTTeacherControlBanner) return;
  window.FTTTeacherControlBanner = true;

  const PREFIX = 'fttTeacherShare:v1:';
  const RELEASE_KEY = 'fttTeacherRelease:v1';
  const TAB_ID = crypto.randomUUID();
  const SHARE_KEY = PREFIX + TAB_ID;
  const WS = window.B3_APP_CONTEXT?.workspaceId || window.B3SiteSettings?.workspaceId || 'b3-2026';
  const validId = value => /^[A-Za-z0-9_-]{1,100}$/.test(value || '') && !['__proto__','constructor','prototype'].includes(value);
  const api = window.B3SiteSettings;
  let teacherKey = '', teacherUser = null, follow = new Map(), listeners = [];
  let pointerHere = false, serverOffset = 0, authRevision = 0, releasing = false, errorText = '';
  let panel = null, label = null;

  function clock() { return Date.now() + serverOffset; }
  function fresh(row) {
    const now = clock();
    return row && Number.isFinite(row.issuedAt) && Number.isFinite(row.heartbeatAt) &&
      Number.isFinite(row.expiresAt) && row.issuedAt <= now &&
      row.issuedAt <= row.heartbeatAt && row.heartbeatAt <= now + 5000 &&
      now - row.heartbeatAt <= 90000 && row.expiresAt > now &&
      row.expiresAt <= row.issuedAt + 600000;
  }
  async function hashedTeacher(uid) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('FTT-follow-v1:' + uid));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function isPointerPage() {
    return location.pathname.endsWith('/class-pointer-prototype/classroom.html');
  }
  function activePointerHere() {
    const bridge = window.ClassPointerBridge;
    return Boolean(isPointerPage() && bridge?.isTeacher && bridge.started?.() && bridge.sharing?.());
  }
  function allPointerShares() {
    const result = [];
    if (!teacherKey) return result;
    if (pointerHere) result.push({tab:TAB_ID, classId:new URLSearchParams(location.search).get('class') || ''});
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        const entry = JSON.parse(localStorage.getItem(key) || 'null');
        if (entry?.teacherKey !== teacherKey || Date.now() - entry.at > 6500 || entry.at > Date.now() + 3000) continue;
        if (!result.some(item => item.tab === key.slice(PREFIX.length)))
          result.push({tab:key.slice(PREFIX.length),classId:entry.classId || ''});
      }
    } catch (_) { /* Local storage may be unavailable; this tab still shows its own state. */ }
    return result;
  }
  function ownedFollow() {
    return [...follow].filter(([, item]) => item?.row?.teacherUid === teacherKey &&
      item.row.mode === 'locked' && fresh(item.row));
  }
  function ensurePanel() {
    if (panel || !document.body) return;
    const style = document.createElement('style');
    style.textContent =
      '#fttTeacherRelease[hidden]{display:none!important}' +
      '#fttTeacherRelease{position:fixed;bottom:16px;right:16px;z-index:2147483600;' +
      'max-width:min(430px,calc(100vw - 24px));width:max-content;padding:13px 17px;' +
      'border:3px solid #fcd34d;border-radius:15px;background:#9f1239;color:white;' +
      'box-shadow:0 8px 30px #0007;cursor:pointer;text-align:left;font:800 15px/1.35 system-ui,sans-serif;' +
      'animation:fttControlPulse 1.4s ease-in-out infinite}' +
      '#fttTeacherRelease:focus-visible{outline:4px solid #2563eb;outline-offset:3px}' +
      '#fttTeacherRelease:disabled{cursor:wait;opacity:.95}' +
      '#fttTeacherRelease small{display:block;font-size:12px;font-weight:650;margin-top:4px}' +
      '@keyframes fttControlPulse{0%,100%{box-shadow:0 7px 25px #9f123999;border-color:#fef3c7}' +
      '50%{box-shadow:0 7px 30px #f59e0b99;border-color:#f59e0b}}' +
      '@media(prefers-reduced-motion:reduce){#fttTeacherRelease{animation:none}}';
    document.head.appendChild(style);
    panel = document.createElement('button');
    panel.id = 'fttTeacherRelease';
    panel.type = 'button';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Teacher control active. Click to release students.');
    panel.innerHTML = '<span>🔴 TEACHER CONTROL ACTIVE — RELEASE STUDENTS</span><small></small>';
    label = panel.querySelector('small');
    panel.addEventListener('click', releaseControls);
    document.body.appendChild(panel);
    document.addEventListener('fullscreenchange', () => {
      (document.fullscreenElement || document.body).appendChild(panel);
    });
  }
  function render() {
    ensurePanel();
    if (!panel) return;
    const follows = ownedFollow();
    const shares = allPointerShares();
    panel.hidden = !teacherKey || !(follows.length || shares.length);
    if (panel.hidden) { errorText = ''; return; }
    const classes = new Set([...follows.map(([id]) => id), ...shares.map(entry => entry.classId)].filter(Boolean));
    const parts = [];
    if (follows.length) parts.push('Follow Teacher locked');
    if (shares.length) parts.push('Teaching screen shared');
    label.textContent = (classes.size ? [...classes].map(id => id.toUpperCase()).join(', ') + ' · ' : '') +
      parts.join(' + ') + (errorText ? ' · ' + errorText : ' · Click to release control');
    panel.disabled = releasing;
    panel.setAttribute('aria-busy', releasing ? 'true' : 'false');
  }
  function syncPointer() {
    const active = !!teacherKey && activePointerHere();
    if (active) {
      try { localStorage.setItem(SHARE_KEY, JSON.stringify({
        teacherKey, classId:new URLSearchParams(location.search).get('class') || '', at:Date.now()
      })); } catch (_) {}
    } else if (pointerHere) {
      try { localStorage.removeItem(SHARE_KEY); } catch (_) {}
    }
    pointerHere = active;
    render();
  }
  function forgetTeacher() {
    for (const off of listeners) off();
    listeners = [];
    follow.clear();
    teacherKey = '';
    teacherUser = null;
    try { localStorage.removeItem(SHARE_KEY); } catch (_) {}
    pointerHere = false;
    render();
  }
  async function beginTeacher(user, access) {
    const revision = ++authRevision;
    forgetTeacher();
    if (!user || !access?.authorized || !['admin', 'teacher'].includes(access.role)) return;
    const key = await hashedTeacher(user.uid);
    if (revision !== authRevision) return;
    teacherKey = key;
    teacherUser = user;
    const db = firebase.database();
    const offsetRef = db.ref('.info/serverTimeOffset');
    const onOffset = snapshot => {serverOffset = Number(snapshot.val()) || 0;render();};
    offsetRef.on('value', onOffset);
    listeners.push(() => offsetRef.off('value', onOffset));
    let ids = (access.classIds || []).filter(validId);
    if (access.role === 'admin') {
      try {
        const snapshot = await db.ref('b3Games/workspaces/' + WS + '/classes').once('value');
        ids = Object.keys(snapshot.val() || {}).filter(validId);
      } catch (_) { ids = []; }
    }
    if (revision !== authRevision) return;
    for (const id of [...new Set(ids)]) {
      const ref = db.ref('b3Games/workspaces/' + WS + '/classes/' + id + '/access/followTeacher');
      const handle = snapshot => {follow.set(id, {row:snapshot.val(), ref});render();};
      ref.on('value', handle, () => {follow.delete(id);render();});
      listeners.push(() => ref.off('value', handle));
    }
    syncPointer();
  }

  // The teacher's original Follow tab will see the changed revision and stop its heartbeat.
  // A transaction avoids accidentally unlocking a session another teacher just began.
  async function unlockFollow(id, entry, currentKey, currentUser) {
    const now = clock(), revision = crypto.randomUUID();
    return entry.ref.transaction(row => {
      if (!row || row.teacherUid !== currentKey || row.mode !== 'locked' || !fresh(row)) return;
      return {version:1, workspaceId:WS, classId:id, teacherUid:currentKey, mode:'independent',
        destination:null, revision, targets:'all', issuedAt:now, heartbeatAt:now, expiresAt:now + 90000};
    }, undefined, false);
  }
  function endPointerOnThisTab() {
    if (window.ClassPointerBridge?.isTeacher && window.ClassPointerBridge.started?.())
      document.dispatchEvent(new Event('ftt:release-teacher-control'));
  }
  async function releaseControls() {
    if (releasing || !teacherKey || !teacherUser) return;
    releasing = true; errorText = ''; render();
    const currentKey = teacherKey, currentUser = teacherUser;
    const own = ownedFollow();
    try {
      if (firebase.auth().currentUser?.uid !== currentUser.uid) throw Error('Teacher sign-in changed');
      // Signal other site tabs to end their classroom sessions, including student share permissions.
      try {
        localStorage.setItem(RELEASE_KEY, JSON.stringify({teacherKey:currentKey, at:Date.now(), id:crypto.randomUUID()}));
      } catch (_) {}
      endPointerOnThisTab();
      const results = await Promise.allSettled(own.map(([id, entry]) => unlockFollow(id, entry, currentKey, currentUser)));
      if (results.some(result => result.status === 'rejected'))
        throw Error('Some classes could not be unlocked');
    } catch (err) {
      errorText = (err.message || 'Release failed') + ' — retry';
    } finally {
      releasing = false; render();
    }
  }
  window.addEventListener('storage', event => {
    if (event.key === RELEASE_KEY) {
      try {
        const message = JSON.parse(event.newValue || 'null');
        if (message?.teacherKey === teacherKey && Math.abs(Date.now() - message.at) < 10000)
          endPointerOnThisTab();
      } catch (_) {}
    }
    if (event.key?.startsWith(PREFIX)) render();
  });
  window.addEventListener('pagehide', () => {
    try { localStorage.removeItem(SHARE_KEY); } catch (_) {}
    pointerHere = false;
    for (const off of listeners) off();
    listeners = [];
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensurePanel, {once:true});
  else ensurePanel();
  setInterval(syncPointer, 1500);
  if (api?.onAuthStateChanged) api.onAuthStateChanged((user, authorized, access) =>
    void beginTeacher(user, {...access, authorized}).catch(() => forgetTeacher()));
})();
