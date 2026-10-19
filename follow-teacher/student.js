/* Follow Teacher student listener — no screen capture, no remote control. */
(function(root) {
  'use strict';
  if (root.FTTFollowStudent) return;
  const C = root.FTTFollowTeacherCore;
  if (!C) return;

  let active = null, generation = 0, checking = false;
  const appliedKey = 'fttFollowTeacherLastApplied';
  const arrivalKey = 'fttFollowTeacherArrival';
  let banner = null;
  let policySignature = '';
  function policyChanged(run) {
    const state=run?.state;
    const signature=state && C.fresh(state, Date.now() + (run.serverOffset || 0))
      ? [state.revision,state.mode,state.destination].join(':') : '';
    if (signature !== policySignature) { policySignature=signature;
      window.dispatchEvent(new CustomEvent('ftt:follow-policy-changed')); }
  }
  let gateGrant = null;
  function clearGrant() { gateGrant = null; }
  async function allowsLockedActivity(tool) {
    const run = active, state = run?.state;
    if (!run || !state || state.destination !== tool || !Object.prototype.hasOwnProperty.call(C.DESTINATIONS, tool) ||
        !C.fresh(state, Date.now() + (run.serverOffset || 0)) ||
        ![C.MODES.FREE, C.MODES.LOCKED].includes(state.mode)) return false;
    if (!(await permitted(run, tool)) || active !== run || run.state !== state ||
        !C.fresh(state, Date.now() + (run.serverOffset || 0))) return false;
    const decision = C.decide(state, {studentAuthorized:true,workspaceId:run.workspaceId,
      classId:run.classId,studentId:run.studentId,allowedTools:{[tool]:true},
      currentUrl:location.href,now:Date.now() + (run.serverOffset || 0)});
    if (decision.action !== 'stay') return false;
    // Follow Once grants this destination only in the receiving document.
    // Leaving or reloading after it was consumed does not create another bypass.
    if (state.mode === C.MODES.FREE && gateGrant?.revision !== state.revision &&
        sessionStorage.getItem(appliedKey) === decision.applyKey &&
        sessionStorage.getItem(arrivalKey) !== decision.applyKey) return false;
    gateGrant = {revision:state.revision};
    sessionStorage.removeItem(arrivalKey);
    return true;
  }

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
    generation++; clearGrant();
    if (active) {
      active.ref.off('value', active.handler);
      clearInterval(active.timer);
      clearTimeout(active.redirectTimer);
      if (active.offsetRef) active.offsetRef.off('value', active.offsetHandler);
      active = null;
    }
    notice(''); policyChanged(null);
  }

  async function permitted(session, destination) {
    if (!session || !active || !Object.prototype.hasOwnProperty.call(C.DESTINATIONS, destination)) return false;
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
      db.ref(classRoot + '/toolGrants/' + destination).once('value'),
      db.ref(classRoot + '/active').once('value'),
      db.ref('b3Games/siteSettings').once('value')
    ]);
    // A class record with no `active` flag (live ET/WT) is active; only an explicit false blocks.
    if (access.val() === false ||
        !member.exists() || member.child('active').val() === false ||
        profile.val() === false || member.child('toolAccess/' + destination).val() === false) return false;
    if (!['et', 'wt'].includes(classId) && enabled.val() !== true) return false;
    const site = globalSettings.val() || {};
    if (site.games?.[destination] === false || site.classGames?.[classId]?.[destination] === false) return false;
    return auth.currentUser?.uid === user.uid && user.uid === session.uid;
  }

  async function evaluate() {
    const run = active;
    if (!run || checking) return;
    checking = true;
    try {
      const state = run.state;
      policyChanged(run);
      if (!state || !C.fresh(state, Date.now() + (run.serverOffset || 0)) ||
          state.mode === C.MODES.INDEPENDENT) {
        notice('');
        clearTimeout(run.redirectTimer);
        return;
      }
      if (!(await permitted(run, state.destination))) { notice(''); clearTimeout(run.redirectTimer); return; }
      if (active !== run || run.state !== state) return;
      const lastAppliedKey = sessionStorage.getItem(appliedKey) || '';
      const decision = C.decide(state, {
        studentAuthorized: true, workspaceId: run.workspaceId,
        classId: run.classId, studentId: run.studentId,
        currentUrl: location.href, allowedTools: {[state.destination]: true},
        lastAppliedKey, now: Date.now() + (run.serverOffset || 0)
      });
      if (decision.action === 'none') { notice(''); clearTimeout(run.redirectTimer); return; }
      if (decision.action === 'stay') {
        clearTimeout(run.redirectTimer);
        if (decision.mode === C.MODES.FREE) { gateGrant = {revision:state.revision}; sessionStorage.setItem(appliedKey, decision.applyKey); }
        notice(decision.mode === C.MODES.LOCKED ? 'Following your teacher · ' + C.DESTINATIONS[state.destination].label : '');
        return;
      }
      if (decision.action === 'navigate') {
        const timerKey = decision.applyKey + ':' + decision.mode;
        if (run.pendingKey === timerKey && run.redirectTimer) return;
        clearTimeout(run.redirectTimer);
        run.pendingKey = timerKey;
        notice('Your teacher is bringing the class to ' + C.DESTINATIONS[state.destination].label + '. Save your work now.', decision.mode === C.MODES.LOCKED);
        run.redirectTimer = setTimeout(async () => {
          run.redirectTimer = null;
          if (active !== run || !C.fresh(run.state, Date.now() + (run.serverOffset || 0)) ||
              run.state.revision !== state.revision) return;
          if (!(await permitted(run, state.destination)) || active !== run ||
              run.state !== state || !C.fresh(state, Date.now() + (run.serverOffset || 0))) {notice(''); return;}
          // Chazara's recording panel persists through upload and point-save.
          // Never tear down an active recording or pending save. Other activities
          // can use data-ftt-unsaved="true" or veto the event below.
          const busy = document.querySelector?.('.record-bar.recording, .rec-panel, [data-ftt-unsaved="true"], [data-follow-unsaved="true"]');
          if (busy) {
            notice('Finish recording and saving your work before following the teacher.', true);
            return;
          }
          // Activities may cancel this event to finish saving current work.
          const leaving = new CustomEvent('ftt:before-follow-navigation', {
            cancelable: true, detail: {destination: decision.destination, mode: decision.mode}
          });
          if (!window.dispatchEvent(leaving)) {
            notice('Finish saving your work before following the teacher.', true);
            return;
          }
          if (decision.mode === C.MODES.FREE) {
            sessionStorage.setItem(appliedKey, decision.applyKey);
            sessionStorage.setItem(arrivalKey, decision.applyKey);
          }
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
    // Never redirect a teacher preview, embedded lesson, or another iframe.
    if (window.top !== window) return;
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
    run.offsetRef = db.ref('.info/serverTimeOffset');
    run.offsetHandler = snap => {
      run.serverOffset = Number(snap.val()) || 0;
      void evaluate();
    };
    run.offsetRef.on('value', run.offsetHandler);
    const serial = ++generation;
    run.handler = snapshot => {
      if (active !== run || serial !== generation) return;
      run.state = snapshot.val();
      clearTimeout(run.redirectTimer); run.redirectTimer=null;
      policyChanged(run);
      if (!run.state || run.state.mode === C.MODES.INDEPENDENT) notice('');
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

  root.FTTFollowStudent = Object.freeze({start,stop,allowsLockedActivity});
  window.addEventListener('pagehide', stop);
})(window);
