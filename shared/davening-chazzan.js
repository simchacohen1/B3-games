/* global tracks, audio, load, index, speed, firebase */
(async function () {
  const student = new URLSearchParams(location.search).get('student') === '1';
  const classId = location.pathname.includes('_wt/') ? 'wt' : 'et';
  const panel = document.createElement('section');
  const controls = document.createElement('div');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  panel.append(status, controls);
  document.querySelector('main').before(panel);
  if (student) document.querySelector('main').hidden = true;
  let session, token, studentId, busy = false, applying = false;
  const pending = new Map();

  async function request(action, fields = {}) {
    const project = window.B3_FIREBASE_CONFIG?.projectId;
    if (!['b3-games', 'fun-torah-tools-staging'].includes(project)
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
    session = result.session;
    render();
  }

  function button(label, action, fields = {}) {
    const element = document.createElement('button');
    element.textContent = label;
    element.onclick = async () => {
      if (busy) return;
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
      }
    };
    controls.append(element);
  }

  function render() {
    controls.replaceChildren();
    const parts = session?.parts || {};
    const playback = session?.playback;
    const active = parts[playback?.part];
    status.textContent = active?.name ? `Current chazzan: ${active.name}` : 'Class Davening';
    if (!student) {
      if (!session || session.phase === 'ended') button('Open Chazzan wheel', 'open');
      else button('Finish session', 'finish');
      if (session?.phase === 'signup') button('Start davening', 'playback', {
        partId: `part-${index + 1}`, position: audio.currentTime || 0, speed: audio.playbackRate, playing: false
      });
    } else if (session?.phase === 'signup') {
      const available = tracks.filter((_, i) => !parts[`part-${i + 1}`]?.studentId);
      if (available.length && Object.values(parts).filter(p => p.studentId === studentId).length < 2) {
        button('I Want to Be Chazzan', 'spin');
        const wheel = document.createElement('p');
        wheel.textContent = available.map(track => track.name).join(' · ');
        controls.append(wheel);
      }
    }
    if (student && playback && active?.studentId === studentId && active.changes < 2) {
      const label = document.createElement('p');
      label.textContent = `Speed changes left: ${2 - active.changes}`;
      controls.append(label);
      for (let rate = 11; rate <= 18; rate++) {
        button(`${rate / 10}×`, 'speed', { partId: playback.part, speed: rate / 10 });
      }
    }
    const list = document.createElement('ul');
    tracks.forEach((track, i) => {
      const part = parts[`part-${i + 1}`];
      if (!part?.name) return;
      const row = document.createElement('li');
      row.textContent = `${track.name} — ${part.name}`;
      list.append(row);
    });
    controls.append(list);
    if (!playback) {
      if (student) audio.pause();
      return;
    }
    applying = true;
    const track = Number(playback.part.split('-')[1]) - 1;
    if (student && track !== index) load(track, false);
    if (audio.playbackRate !== playback.speed) {
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

  if (student) {
    window.addEventListener('keydown', event => event.stopImmediatePropagation(), true);
    panel.addEventListener('click', () => {
      if (session?.playback?.playing) audio.play().catch(() => {});
    });
  }
  for (const event of ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata', 'ended']) {
    audio.addEventListener(event, async () => {
      if (student || applying || busy || session?.phase !== 'active') return;
      if (event === 'ratechange' && audio.playbackRate === session.playback?.speed) return;
      busy = true;
      try {
        await request('playback', {
          partId: `part-${index + 1}`, position: audio.currentTime || 0,
          speed: audio.playbackRate, playing: !audio.paused && !audio.ended
        });
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
      }
    });
  }

  async function refresh() {
    if (busy || !token || document.hidden) return;
    busy = true;
    try { await request('read'); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; }
  }

  try {
    const config = window.B3_FIREBASE_CONFIG;
    if (!firebase.apps.length) firebase.initializeApp(config);
    firebase.auth().onAuthStateChanged(async user => {
      token = user;
      if (!user) {
        status.textContent = 'Sign in to join class Davening.';
        return;
      }
      studentId = (await user.getIdTokenResult()).claims.b3StudentId;
      await refresh();
    });
    setInterval(refresh, 2500);
  } catch (error) {
    status.textContent = error.message;
  }
})();
