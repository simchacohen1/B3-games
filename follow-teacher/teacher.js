/* Follow Teacher: authenticated, class-scoped teacher control. */
(function() {
  'use strict';
  const C = window.FTTFollowTeacherCore, api = window.B3SiteSettings;
  const WS = window.B3_APP_CONTEXT?.workspaceId || 'b3-2026';
  const q = id => document.getElementById(id);
  const valid = C.validId;
  if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
  const db = firebase.database(), auth = firebase.auth();
  let serverOffset = 0;
  db.ref('.info/serverTimeOffset').on('value', snap => {
    serverOffset = Number(snap.val()) || 0;
  });
  const clock = () => Date.now() + serverOffset;
  async function publicTeacherKey(uid) {
    // Keep the teacher's actual Firebase UID out of the class-visible record.
    const bytes = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode('FTT-follow-v1:' + uid));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
  }

  let teacher = null, assigned = [], current = '', classRow = null, stateRef = null;
  let unlisten = null, heartbeat = null, currentState = null, ownRevision = null;
  let generation = 0;

  function status(message, error = false) {
    q('status').textContent = message;
    q('status').style.color = error ? '#ae2525' : '#13613d';
  }
  function error(message) { status(message, true); }
  function endWatching() {
    clearInterval(heartbeat); heartbeat = null; ownRevision = null;
    if (unlisten) {unlisten();unlisten = null;}
    stateRef = null; currentState = null;
  }
  function safeTeacher() {
    if (!teacher?.user || !auth.currentUser ||
        auth.currentUser.uid !== teacher.user.uid) throw Error('Your teacher sign-in changed. Please sign in again.');
    if (!valid(current) || !assigned.includes(current)) throw Error('Choose an assigned class.');
  }
  // Until the private student-targeting path is hardened, never broadcast
  // individual student identifiers under the publicly readable class path.
  function selected() {return 'all';}
  function mode() {return document.querySelector('input[name=mode]:checked')?.value || C.MODES.FREE;}
  function renderSubdestinations() {
    const sections = C.SUBDESTINATIONS[q('destination').value];
    q('subdestinationRow').classList.toggle('hidden', !sections);
    q('subdestination').replaceChildren(...Object.entries({'': 'Activity home', ...sections}).map(([value,label]) => {
      const option=document.createElement('option');option.value=value;option.textContent=label;return option;
    }));
    const pointer = q('destination').value === 'class-pointer';
    q('pointerWorkspaceRow').classList.toggle('hidden', !pointer);
    const frame=q('pointerWorkspace'), link=q('openClassPointer');
    if (pointer && frame.getAttribute('src') !== link.getAttribute('href')) frame.src=link.getAttribute('href');
    if (!pointer) frame.removeAttribute('src');
  }
  function renderState(state) {
    currentState = state;
    const validState = state && C.fresh(state, clock());
    const msg = !validState || state.mode === C.MODES.INDEPENDENT
      ? 'Students are free to choose their activities.'
      : state.mode === C.MODES.LOCKED
        ? '🔒 Follow Teacher — Locked · ' + (C.DESTINATIONS[state.destination]?.label || 'Activity')
        : '↪ Follow once · ' + (C.DESTINATIONS[state.destination]?.label || 'Activity') + ' (free afterward)';
    q('state').textContent = msg;
    if (validState && state.subdestination && C.SUBDESTINATIONS[state.destination]?.[state.subdestination])
      q('state').textContent += ' · ' + C.SUBDESTINATIONS[state.destination][state.subdestination];
    q('state').style.background = validState && state.mode === C.MODES.LOCKED ? '#fff2cf' : '#ebf4ff';
  }
  async function loadClass(id) {
    safeTeacher();
    if (!assigned.includes(id)) throw Error('This class is not assigned to you.');
    const myGeneration = ++generation;
    endWatching();
    const snap = await db.ref('b3Games/workspaces/' + WS + '/classes/' + id).once('value');
    const row = snap.val();
    const settings = (await db.ref('b3Games/siteSettings').once('value')).val() || {};
    if (myGeneration !== generation) return;
    if (!row || row.active === false) throw Error('This class is disabled.');
    classRow = row; current = id;
    const pointerLink = q('openClassPointer');
    if (pointerLink) pointerLink.href = '../class-pointer-prototype/classroom.html?dashboard=teacher&followTeacherWhiteboard=1&class=' + encodeURIComponent(id);
    q('destination').replaceChildren(...Object.entries(C.DESTINATIONS).filter(([tool]) =>
      (['et','wt'].includes(id) || row.toolGrants?.[tool] === true) &&
      settings.games?.[tool] !== false && settings.classGames?.[id]?.[tool] !== false).map(([tool,entry]) => {
        const option=document.createElement('option'); option.value=tool; option.textContent=entry.label; return option;
      })); q('classSelect').value = id;
    renderSubdestinations();
    stateRef = db.ref('b3Games/workspaces/' + WS + '/classes/' + id + '/access/followTeacher');
    const listener = snapshot => {
      if (myGeneration !== generation) return;
      renderState(snapshot.val());
      if (ownRevision && snapshot.val()?.revision !== ownRevision) {
        clearInterval(heartbeat); heartbeat = null; ownRevision = null;
      }
    };
    stateRef.on('value', listener, e => error('Could not load class navigation: ' + e.message));
    unlisten = () => stateRef.off('value', listener);
    status('Ready. Choose where students should go, then send them.');
  }

  async function publish(forceMode) {
    try {
      safeTeacher();
      const serial=generation, classId=current, uid=teacher.user.uid;
      q('apply').disabled=q('unlock').disabled=q('classSelect').disabled=true;
      const m = forceMode || mode(), destination = q('destination').value;
      const subdestination = q('subdestination').value;
      if (m !== C.MODES.INDEPENDENT) {
        if (!Object.prototype.hasOwnProperty.call(C.DESTINATIONS, destination)) throw Error('This destination is not supported.');
        if (!['et','wt'].includes(current) && classRow?.toolGrants?.[destination] !== true)
          throw Error(C.DESTINATIONS[destination].label + ' is not enabled for this class.');
      }
      if (m !== C.MODES.INDEPENDENT) {
        const latest = (await db.ref('b3Games/siteSettings').once('value')).val() || {};
        const latestClass = (await db.ref('b3Games/workspaces/' + WS + '/classes/' + current).once('value')).val();
        if (!latestClass || latestClass.active === false ||
            (!['et','wt'].includes(current) && latestClass.toolGrants?.[destination] !== true) ||
            latest.games?.[destination] === false || latest.classGames?.[current]?.[destination] === false)
          throw Error('This activity is no longer enabled for the class.');
      }
      const targets = m === C.MODES.INDEPENDENT ? 'all' : selected();
      if (currentState && C.fresh(currentState, clock()) &&
          currentState.mode !== C.MODES.INDEPENDENT &&
          currentState.teacherUid !== teacher.publicKey)
        throw Error('Another teacher currently controls this class. Ask them to unlock first.');
      q('apply').disabled = q('unlock').disabled = true;
      const now = clock(), revision = crypto.randomUUID();
      const row = C.propose({workspaceId:WS,classId:current,teacherUid:teacher.publicKey,
        mode:m,destination,subdestination,targets,revision,issuedAt:now,heartbeatAt:now,
        expiresAt:now + C.MAX_HEARTBEAT_AGE_MS});
      // RTDB security rules permit class access writes only to an assigned,
      // active teacher or administrator. Do not bypass those rules.
      safeTeacher();
      if(serial!==generation || current!==classId || teacher.user.uid!==uid)
        throw Error('Your class or sign-in changed. Please send again.');
      await stateRef.set(row);
      if(serial!==generation)return;
      clearInterval(heartbeat); heartbeat = null;
      ownRevision = m === C.MODES.INDEPENDENT ? null : revision;
      if (ownRevision) {
        const ref = stateRef, classId = current, uid = teacher.user.uid, publicKey = teacher.publicKey;
        heartbeat = setInterval(async () => {
          try {
            if (!auth.currentUser || auth.currentUser.uid !== uid ||
                current !== classId || stateRef !== ref) {clearInterval(heartbeat);heartbeat=null;return;}
            const snapshot = await ref.once('value'), active = snapshot.val();
            if (!active || active.revision !== revision || active.teacherUid !== publicKey ||
                active.mode === C.MODES.INDEPENDENT) {
              clearInterval(heartbeat);heartbeat=null;ownRevision=null;return;
            }
            const time = clock();
            await ref.update({issuedAt:time,heartbeatAt:time,expiresAt:time + C.MAX_HEARTBEAT_AGE_MS});
          } catch (e) {
            clearInterval(heartbeat);heartbeat=null;ownRevision=null;
            error('Could not renew following. Students automatically unlock when the session expires.');
          }
        }, 20000);
      }
      status(m === C.MODES.INDEPENDENT ? 'Everyone unlocked.' :
        m === C.MODES.LOCKED ? 'Follow Locked sent. Keep this page open while teaching.' :
          'Sent once. Students are free to navigate afterward.');
    } catch (e) { error(e.message || 'Could not change the class mode.'); }
    finally {q('apply').disabled = q('unlock').disabled = q('classSelect').disabled = false;}
  }

  q('apply').addEventListener('click', () => void publish());
  q('destination').addEventListener('change', renderSubdestinations);
  q('unlock').addEventListener('click', () => void publish(C.MODES.INDEPENDENT));
  q('classSelect').addEventListener('change', () => {
    // Set current only inside loadClass once the class has been verified.
    const target = q('classSelect').value;
    void loadClass(target).catch(e => error(e.message));
  });
  api.onAuthStateChanged(async (user, authorized, access) => {
    try {
      if (!user || !authorized || !['admin','teacher'].includes(access?.role)) {
        ++generation;endWatching();teacher=null;
        q('pointerWorkspace').removeAttribute('src');
        q('app').classList.add('hidden');
        q('gate').textContent = 'Sign in with your authorized teacher Google account from Fun Torah Tools.';
        return;
      }
      const classes = access.role === 'admin'
        ? Object.keys((await db.ref('b3Games/workspaces/' + WS + '/classes').once('value')).val() || {})
        : (access.classIds || []);
      assigned = [...new Set(classes.filter(valid))];
      teacher = {user,access,publicKey:await publicTeacherKey(user.uid)};
      if (!assigned.length) throw Error('No classes are assigned to your teacher account.');
      q('classSelect').replaceChildren(...assigned.map(id => {
        const option = document.createElement('option');option.value=id;option.textContent=id.toUpperCase();return option;
      }));
      // Class selection stays available inside the Follow Teacher panel.
      q('classSelect').disabled = false;
      q('classSelect').title = '';
      q('gate').classList.add('hidden');q('app').classList.remove('hidden');
      const preferred = new URLSearchParams(location.search).get('class');
      const id = preferred && assigned.includes(preferred) ? preferred : assigned[0];
      current = id; await loadClass(id);
    } catch (e) {
      ++generation;endWatching();
      q('app').classList.add('hidden');
      q('gate').textContent = e.message || 'Could not verify teacher access.';
    }
  });
  window.addEventListener('pagehide', endWatching);
})();
