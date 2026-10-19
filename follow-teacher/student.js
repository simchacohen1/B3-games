/* Follow Teacher student listener — no screen capture, no remote control. */
(function(root) {
  'use strict';
  if (root.FTTFollowStudent) return;
  const C = root.FTTFollowTeacherCore;
  if (!C) return;

  let active = null, generation = 0, checking = false;
  const appliedKey = 'fttFollowTeacherLastApplied';
  let banner = null;

  function notice(message, locked) {
    if (!document.body) return;
    if (!message) { if (banner) banner.remove(); banner = null; return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'fttFollowTeacherNotice';
      banner.setAttribute('role', 'status');
      banner.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483500;max-width:min(620px,calc(100% - 20px));background:#fff7df;color:#593b03;border:2px solid #eab308;border-radius:12px;box-shadow:0 8px 28px #0003;padding:12px 20px;font:700 15px system-ui;text-align:center';
      document.body.appendChild(banner);
    }
    banner.textContent = message;
    banner.dataset.locked = locked ? 'true' : 'false';
  }

  function stop() {
    generation++;
    if (active) {
      active.ref.off('value', active.handler);
      clearInterval(active.timer);
      clearTimeout(active.redirectTimer);
      active = null;
    }
    notice('');
  }

  async function permitted(session) {
    if (!session || !active) return false;
    const {db, studentId, classId, workspaceId} = session;
    const auth = root.firebase?.auth?.();
    const user = auth?.currentUser;
    if (!user) return false;
    const token = await user.getIdTokenResult();
    if (token.claims.b3StudentRole !== 'student' ||
        token.claims.b3StudentId !== studentId ||
        token.claims.b3ClassId !== classId) return false;
    if (sessionStorage.getItem('b3Games_studentId') !== studentId ||
        sessionStorage.getItem('b3Games_studentClass') !== classId) return false;

    const classRoot = 'b3Games/workspaces/' + workspaceId + '/classes/' + classId;
    const [member, profile, enabled, access, globalSettings] = await Promise.all([
      db.ref(classRoot + '/members/' + studentId).once('value'),
      db.ref('b3Games/students/' + studentId + '/profile/active').once('value'),
      db.ref(classRoot + '/toolGrants/shorashim').once('value'),
      db.ref(classRoot + '/active').once('value'),
      db.ref('b3Games/siteSettings').once('value')
    ]);
    if (!access.exists() || access.val() === false ||
        !member.exists() || member.child('active').val() === false ||
        profile.val() === false || member.child('toolAccess/shorashim').val() === false) return false;
    if (!['et', 'wt'].includes(classId) && enabled.val() !== true) return false;
    const site = globalSettings.val() || {};
    if (site.games?.shorashim === false || site.classGames?.[classId]?.shorashim === false) return false;
    return true;
  }

  async function evaluate() {
    const run = active;
    if (!run || checking) return;
    checking = true;
    try {
      const state = run.state;
      if (!state || !C.fresh(state, Date.now()) ||
          state.mode === C.MODES.INDEPENDENT) {
        notice('');
        clearTimeout(run.redirectTimer);
        return;
      }
      if (!(await permitted(run))) { notice(''); clearTimeout(run.redirectTimer); return; }
      if (active !== run) return;
      const lastAppliedKey = sessionStorage.getItem(appliedKey) || '';
      const decision = C.decide(state, {
        studentAuthorized: true, workspaceId: run.workspaceId,
        classId: run.classId, studentId: run.studentId,
        currentUrl: location.href, allowedTools: {shorashim: true},
        lastAppliedKey, now: Date.now()
      });
      if (decision.action === 'none') { notice(''); clearTimeout(run.redirectTimer); return; }
      if (decision.action === 'stay') {
        clearTimeout(run.redirectTimer);
        if (decision.mode === C.MODES.FREE) sessionStorage.setItem(appliedKey, decision.applyKey);
        notice(decision.mode === C.MODES.LOCKED ? 'Following your teacher · Shorashim' : '');
        return;
      }
      if (decision.action === 'navigate') {
        const timerKey = decision.applyKey + ':' + decision.mode;
        if (run.pendingKey === timerKey && run.redirectTimer) return;
        clearTimeout(run.redirectTimer);
        run.pendingKey = timerKey;
        notice('Your teacher is bringing the class to Shorashim. Save your work now.', decision.mode === C.MODES.LOCKED);
        run.redirectTimer = setTimeout(async () => {
          run.redirectTimer = null;
          if (active !== run || !C.fresh(run.state, Date.now()) ||
              run.state.revision !== state.revision) return;
          if (!(await permitted(run))) {notice(''); return;}
          // Activities may cancel this event to finish saving current work.
          const leaving = new CustomEvent('ftt:before-follow-navigation', {
            cancelable: true, detail: {destination: decision.destination, mode: decision.mode}
          });
          if (!window.dispatchEvent(leaving)) {
            notice('Finish saving your work before following the teacher.', true);
            return;
          }
          if (decision.mode === C.MODES.FREE) sessionStorage.setItem(appliedKey, decision.applyKey);
          location.assign(new URL(decision.destination, location.origin).href);
        }, 3500);
      }
    } catch (e) {
      // A lost Firebase/auth connection never grants permission or a redirect.
      console.warn('Follow Teacher could not check student access', e);
      notice('');
      if (run) clearTimeout(run.redirectTimer);
    } finally { checking = false; }
  }

  async function start({workspaceId, classId, studentId}) {
    if (![workspaceId,classId,studentId].every(C.validId)) {stop(); return;}
    const auth = root.firebase?.auth?.();
    if (!auth?.currentUser) {stop(); return;}
    const user = auth.currentUser, claims = (await user.getIdTokenResult()).claims;
    if (claims.b3StudentRole !== 'student' || claims.b3StudentId !== studentId ||
        claims.b3ClassId !== classId) {stop();return;}
    if (active && active.classId === classId && active.studentId === studentId &&
        active.workspaceId === workspaceId && active.uid === user.uid) return;
    stop();
    const db = root.firebase.database(), ref = db.ref('b3Games/workspaces/' +
      workspaceId + '/classes/' + classId + '/access/followTeacher');
    const run = {uid:user.uid,db,ref,workspaceId,classId,studentId,
      state:null,redirectTimer:null,pendingKey:''};
    active = run;
    const serial = ++generation;
    run.handler = snapshot => {
      if (active !== run || serial !== generation) return;
      run.state = snapshot.val();
      void evaluate();
    };
    ref.on('value', run.handler, e => {
      if (active === run) { notice(''); console.warn('Follow Teacher unavailable', e); }
    });
    run.timer = setInterval(() => {
      if (auth.currentUser?.uid !== user.uid ||
          sessionStorage.getItem('b3Games_studentId') !== studentId ||
          sessionStorage.getItem('b3Games_studentClass') !== classId) {stop(); return;}
      void evaluate();
    }, 15000);
  }

  root.FTTFollowStudent = Object.freeze({start,stop});
  window.addEventListener('pagehide', stop);
})(window);
