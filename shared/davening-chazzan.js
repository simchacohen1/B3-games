/* global tracks, audio, load, index, speed, firebase */
(async function () {
  const classId = location.pathname.includes('_wt/') ? 'wt' : 'et';
  let student = false, teacher = false;
  const panel = document.createElement('section');
  panel.className = 'davening-feature-panel';
  panel.style.cssText = 'max-width:980px;width:calc(100% - 24px);margin:18px auto;padding:18px;border:1px solid #dfe4ee;border-radius:22px;background:linear-gradient(135deg,#fff,#f2f6ff);box-shadow:0 10px 30px #15203312';
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.style.cssText = 'font-weight:800;text-align:center;color:#3150a2;margin:2px 0 12px';
  const heading = document.createElement('h2');
  heading.textContent = '🎤 I Want to Be Chazzan!';
  heading.style.cssText = 'text-align:center;font-size:clamp(22px,4vw,32px);color:#173e87;margin:0 0 8px';
  const style = document.createElement('style');
  style.textContent = '@keyframes chazzanSpin{to{transform:rotate(1080deg)}}.chazzan-spin-wheel{width:150px;height:150px;border:8px solid #fff;border-radius:50%;background:conic-gradient(#facc15 0 45deg,#fb7185 45deg 90deg,#a78bfa 90deg 135deg,#38bdf8 135deg 180deg,#34d399 180deg 225deg,#f97316 225deg 270deg,#60a5fa 270deg 315deg,#e879f9 315deg);box-shadow:0 9px 22px #315efb40;color:#12224a;font-size:18px;font-weight:900;cursor:pointer}.chazzan-spin-wheel.spinning{animation:chazzanSpin 1.25s cubic-bezier(.18,.74,.18,1)}.chazzan-spin-wheel:disabled{opacity:.75}';
  panel.append(style, heading, status, controls);
  document.querySelector('main').before(panel);
  let session, token, busy = false, applying = false, roster = [], rosterLoading = false, rosterLoaded = false;
  // A teacher playback change made while another request is in flight is sent
  // right after it, so the class never stays on a stale play/pause/speed.
  let playbackQueued = false;
  const pending = new Map();

  async function request(action, fields = {}, { renderResponse = true } = {}) {
    const project = window.B3_FIREBASE_CONFIG?.projectId;
    if (!/^(?:b3-games|fun-torah-tools-staging)$/.test(project || '')
      || (location.hostname.includes('staging') && project !== 'fun-torah-tools-staging')) {
      throw new Error('Davening Firebase configuration is unavailable.');
    }
    const response = await fetch(`https://us-central1-${project}.cloudfunctions.net/daveningChazzan`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + await token.getIdToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, classId, sessionId: session?.id, ...fields })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Davening could not connect.');
    if (Object.hasOwn(result, 'session')) {
      session = result.session;
      if (renderResponse) render();
    }
    return result;
  }

  // A press that lands during the background refresh waits for it instead of being lost.
  async function whenFree() {
    while (busy) await new Promise(resolve => setTimeout(resolve, 100));
  }

  function button(label, action, fields = {}) {
    const element = document.createElement('button');
    element.textContent = label;
    element.className = 'btn';
    element.onclick = async () => {
      if (element.disabled) return;
      element.disabled = true;
      await whenFree();
      const key = JSON.stringify([session?.id, action, fields]);
      const requestId = pending.get(key) || crypto.randomUUID();
      pending.set(key, requestId);
      busy = true;
      try {
        await request(action, { requestId, ...fields });
        pending.delete(key);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        element.disabled = false;
        if (playbackQueued) sendPlayback();
      }
    };
    controls.append(element);
    return element;
  }

  function render() {
    controls.replaceChildren();
    const parts = session?.parts || {};
    const playback = session?.playback;
    const active = parts[playback?.part];
    status.textContent = active?.name ? `Current chazzan: ${active.name}` : 'Class Davening';
    heading.hidden = !student;
    if (teacher) {
      if (!session || session.phase === 'ended') button('🎤 Open Chazzan sign-up', 'open');
      else {
        if (session.phase !== 'active') button(session.phase === 'signup' ? 'Close sign-up' : 'Reopen sign-up', 'registration', {
          open: session.phase !== 'signup'
        });
        if (session.phase !== 'active') button('▶ Start davening', 'playback', {
        partId: `part-${index + 1}`, position: audio.currentTime || 0, speed: audio.playbackRate, playing: false
        });
        if (session.phase !== 'ended') button('Finish davening session', 'finish');
      }
      if (!rosterLoaded && !rosterLoading && session && session.phase !== 'ended') {
        rosterLoading = true;
        request('roster').then(result => { roster = result.roster || []; rosterLoaded = true; render(); })
          .catch(() => {}).finally(() => { rosterLoading = false; });
      }
    } else if (student && session?.phase === 'signup') {
      const available = tracks.filter((_, i) => !parts[`part-${i + 1}`]?.name);
      const ownCount = Object.values(parts).filter(p => p.mine).length;
      if (available.length && ownCount < 2) {
        const wheel = document.createElement('button');
        wheel.type = 'button';
        wheel.className = 'chazzan-spin-wheel';
        wheel.textContent = '🎡 Spin for my part!';
        wheel.setAttribute('aria-label', 'Spin the wheel to receive a Davening section');
        wheel.onclick = async () => {
          if (wheel.disabled) return;
          wheel.disabled = true;
          await whenFree();
          busy = true;
          wheel.classList.add('spinning');
          try {
            const before = new Set(Object.keys(session.parts || {}).filter(id => session.parts[id].mine));
            const result = await request('spin', { requestId: crypto.randomUUID() }, { renderResponse: false });
            const assigned = Object.entries(result.session?.parts || {}).find(([id, part]) => part.mine && !before.has(id));
            await new Promise(resolve => setTimeout(resolve, 1250));
            render();
            status.textContent = assigned ? `🌟 ${tracks[Number(assigned[0].split('-')[1]) - 1]?.name || 'Your part'} is yours!` : '🌟 Your section is assigned!';
          } catch (error) {
            wheel.textContent = '🎡 Spin again';
            wheel.disabled = false;
            status.textContent = error.message;
          } finally {
            busy = false;
          }
        };
        controls.append(wheel);
        const hint = document.createElement('p');
        hint.textContent = `You can receive up to ${2 - ownCount} more part${ownCount ? '' : 's'} · ${available.length} still available`;
        hint.style.cssText = 'width:100%;text-align:center;color:#667085;font-weight:700;margin:0';
        controls.append(hint);
      } else {
        const message = document.createElement('p');
        message.textContent = ownCount >= 2 ? 'You have two assigned parts. Yasher koach!' : 'All parts are assigned. Ask your teacher if you need help.';
        message.style.cssText = 'width:100%;text-align:center;font-weight:800;color:#667085';
        controls.append(message);
      }
    } else if (student && (!session || session.phase === 'ready')) {
      const message = document.createElement('p');
      message.textContent = 'Sign-up opens when your teacher is ready.';
      message.style.cssText = 'width:100%;text-align:center;font-weight:800;color:#667085';
      controls.append(message);
    }
    if (student && playback && active?.mine && active.changes < 2) {
      const label = document.createElement('p');
      label.textContent = `Speed changes left: ${2 - active.changes}`;
      controls.append(label);
      for (let rate = 11; rate <= 18; rate++) {
        button(`${rate / 10}×`, 'speed', { partId: playback.part, speed: rate / 10 });
      }
    }
    const list = document.createElement('ul');
    list.style.cssText = 'list-style:none;padding:8px 0 0;margin:14px auto 0;max-width:760px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:7px';
    tracks.forEach((track, i) => {
      const part = parts[`part-${i + 1}`];
      const row = document.createElement('li');
      row.style.cssText = 'padding:9px 12px;border-radius:12px;background:#f7f9fd;font-weight:700';
      row.textContent = part?.name ? `${track.name} — ${part.name}` : `${track.name} — ${session?.phase === 'signup' ? 'Available' : 'Not assigned'}`;
      list.append(row);
      if (teacher && session && session.phase !== 'ended') {
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Assign ${track.name}`);
        select.style.cssText = 'max-width:135px;margin-left:6px;padding:4px;border:1px solid #cdd6e6;border-radius:8px';
        const clear = document.createElement('option'); clear.value = ''; clear.textContent = 'Unassigned'; select.append(clear);
        roster.forEach(person => { const option = document.createElement('option'); option.value = person.id; option.textContent = person.name; select.append(option); });
        select.value = part?.studentId || '';
        row.append(select);
        const assign = document.createElement('button'); assign.type = 'button'; assign.textContent = 'Save'; assign.className = 'btn'; assign.style.cssText = 'padding:4px 8px;margin-left:5px';
        assign.onclick = () => request('assign', { partId: `part-${i + 1}`, studentId: select.value || null }).catch(error => { status.textContent = error.message; });
        row.append(assign);
      }
      // The award stays available after the teacher finishes the session.
      if (teacher && session) {
        if (part?.started && part.studentId && (part.completed || session.phase === 'ended')) {
          const reward = document.createElement('button'); reward.type = 'button'; reward.className = 'btn';
          reward.style.cssText = 'padding:4px 8px;margin-left:5px;background:#fff5cf';
          reward.textContent = part.awarded ? '✓ 1 point awarded' : '⭐ Award 1 Rewards point';
          reward.disabled = Boolean(part.awarded);
          reward.onclick = async () => {
            if (reward.disabled) return;
            reward.disabled = true;
            await whenFree();
            busy = true;
            try { await request('award', { partId: `part-${i + 1}`, requestId: crypto.randomUUID() }); }
            catch (error) { status.textContent = error.message; reward.disabled = false; }
            finally { busy = false; }
          };
          row.append(reward);
        }
      }
    });
    controls.append(list);
    if (!playback) {
      if (student) audio.pause();
      return;
    }
    applying = true;
    const track = Number(playback.part.split('-')[1]) - 1;
    if (student && track !== index) load(track, false);
    if (audio.playbackRate !== playback.speed && !(teacher && playbackQueued)) {
      speed.value = String(playback.speed);
      audio.playbackRate = playback.speed;
    }
    if (student) {
      const position = playback.position + (playback.playing
        ? Math.max(0, Date.now() - playback.updatedAt) / 1000 * playback.speed : 0);
      if (audio.readyState && Math.abs(audio.currentTime - position) > 1.5) {
        audio.currentTime = Math.min(position, audio.duration || position);
      }
      if (playback.playing) audio.play().catch(() => { status.textContent += ' · Tap the page to enable audio.'; });
      else audio.pause();
    }
    applying = false;
  }

  window.addEventListener('keydown', event => { if (student) event.stopImmediatePropagation(); }, true);
  panel.addEventListener('click', () => {
    if (student && session?.playback?.playing) audio.play().catch(() => {});
  });
  for (const event of ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata', 'ended']) {
    audio.addEventListener(event, () => {
      if (!teacher || applying || session?.phase !== 'active') return;
      if (event === 'ratechange' && audio.playbackRate === session.playback?.speed) return;
      sendPlayback();
    });
  }

  async function sendPlayback() {
    if (!teacher || session?.phase !== 'active') { playbackQueued = false; return; }
    if (busy) { playbackQueued = true; return; }
    busy = true;
    playbackQueued = false;
    try {
      await request('playback', {
        partId: `part-${index + 1}`, position: audio.currentTime || 0,
        speed: audio.playbackRate, playing: !audio.paused && !audio.ended
      });
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      if (playbackQueued) sendPlayback();
    }
  }

  async function refresh() {
    if (busy || !token || document.hidden) return;
    busy = true;
    try { await request('read'); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; if (playbackQueued) sendPlayback(); }
  }

  try {
    const config = window.B3_FIREBASE_CONFIG;
    if (!firebase.apps.length) firebase.initializeApp(config);
    firebase.auth().onAuthStateChanged(async user => {
      token = user;
      if (!user) {
        student = false; teacher = false;
        status.textContent = 'Sign in to join class Davening.';
        return;
      }
      const claims = (await user.getIdTokenResult(true)).claims || {};
      student = claims.b3StudentRole === 'student';
      teacher = !student;
      if (student) {
        document.body.classList.add('davening-student-mode');
        document.querySelectorAll('.controls,.secondary,.list,.header-actions,.kbd').forEach(node => { node.hidden = true; });
        for (const id of ['playBtn','prevBtn','nextBtn','back10Btn','restartBtn','forward10Btn','startBtn','fullscreenBtn']) {
          const node = document.getElementById(id); if (node) node.disabled = true;
        }
      }
      await refresh();
    });
    setInterval(refresh, 5000);
  } catch (error) {
    status.textContent = error.message;
  }
})();
