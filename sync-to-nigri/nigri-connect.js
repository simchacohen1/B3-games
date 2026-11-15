/* "Connect your Nigri account" + sending School Marks with the teacher's own Nigri login (issue 550, PR #631).
 *
 * Needs (load first): nigri-school-gate.js (window.B3NigriGate) and nigri-auth.js (window.NigriAuth).
 * Put <div data-nigri-connect></div> where the box should appear. It is shown only to teachers whose school has
 * "Syncs to Nigri" on. The owner never sees it: the owner's sync is unchanged (the service's own account).
 *
 * The password goes to NigriSync once, in one PUT over HTTPS, and is never stored, logged or shown again here.
 * The server keeps it encrypted (b3Private/nigriLogins/<uid>) and answers only {saved, hint, updatedAt}.
 *
 * NigriConnect.sendMarks(body, ownerSend):
 *   - owner: calls ownerSend() exactly as the page did before (returns that Response);
 *   - teacher: posts to /sync-marks with his Google sign-in only (never the old key); the server logs in to Nigri
 *     with his own saved login and refuses if his school does not sync.
 */
(function () {
  'use strict';
  if (window.NigriConnect) return;
  const listeners = [];
  const state = { role: 'unknown', saved: false, hint: '', ready: false };
  let settleReady;
  const ready = new Promise(r => { settleReady = r; });

  function base() {
    const custom = String(window.NIGRI_LOGIN_SERVER || '').replace(/\/+$/, '');
    if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(custom) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(custom)) return custom;
    return (window.NigriAuth && window.NigriAuth.BASE) || 'https://nigrisync.onrender.com';
  }
  function describe(status, body) {
    if (status === 401) return 'Please sign in with your teacher Google account first.';
    if (status === 404) return 'Connecting your own Nigri account is not turned on yet. Ask the owner.';
    if (status === 429) return 'Too many tries. Wait a minute.';
    if (body && typeof body.error === 'string' && status < 500) return body.error;
    return 'Could not do that right now. Try again in a minute.';
  }
  async function call(method, payload) {
    const token = window.NigriAuth && await window.NigriAuth.getToken();
    if (!token) return { ok: false, message: describe(401) };
    let res;
    try {
      res = await fetch(base() + '/nigri-login', {
        method, cache: 'no-store', credentials: 'omit',
        headers: Object.assign({ Authorization: 'Bearer ' + token }, payload ? { 'Content-Type': 'application/json' } : {}),
        body: payload ? JSON.stringify(payload) : undefined
      });
    } catch (e) { return { ok: false, message: 'Could not reach the Nigri sync service.' }; }
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) return { ok: false, status: res.status, message: describe(res.status, body) };
    return { ok: true, saved: !!(body && body.saved), hint: String((body && body.hint) || '') };
  }
  function set(next) {
    Object.assign(state, next);
    listeners.forEach(fn => { try { fn(Object.assign({}, state)); } catch (e) {} });
    render();
  }

  // ---------- the box ----------
  const CSS = '.ftt-nc{background:#fff;border:2px solid #bdd5e8;border-radius:14px;padding:16px 18px;margin:14px 0;font-family:inherit;color:#18324a}' +
    '.ftt-nc h3{margin:0 0 4px;font-size:19px}.ftt-nc p{margin:4px 0 10px;color:#4a6274;font-size:14px;line-height:1.4}' +
    '.ftt-nc .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ftt-nc input{flex:1 1 180px;padding:10px;border:1px solid #bdd5e8;border-radius:9px;font:inherit}' +
    '.ftt-nc button{padding:10px 16px;border-radius:9px;border:0;background:#2d6ea3;color:#fff;font:inherit;font-weight:700;cursor:pointer}' +
    '.ftt-nc button.plain{background:#fff;color:#2d6ea3;border:1px solid #bdd5e8}.ftt-nc button.danger{background:#fff;color:#b91c1c;border:1px solid #fecaca}' +
    '.ftt-nc .ok{color:#1e7a46;font-weight:800}.ftt-nc .msg{min-height:1.2em;font-size:14px;margin-top:8px}.ftt-nc .err{color:#b91c1c;font-weight:700}' +
    '.ftt-nc.connected{border-color:#9fd7b5}';
  let editing = false;
  function boxes() { return Array.from(document.querySelectorAll('[data-nigri-connect]')); }
  function render() {
    boxes().forEach(host => {
      if (state.role !== 'teacher') { host.hidden = true; host.textContent = ''; return; }
      host.hidden = false;
      if (!document.getElementById('fttNcCss')) { const s = document.createElement('style'); s.id = 'fttNcCss'; s.textContent = CSS; document.head.appendChild(s); }
      const box = document.createElement('section');
      box.className = 'ftt-nc' + (state.saved ? ' connected' : '');
      const h = document.createElement('h3'); h.textContent = 'Connect your Nigri account'; box.appendChild(h);
      const p = document.createElement('p');
      p.textContent = 'Marks you sync are saved to Nigri with your own Nigri login. It is stored locked on the sync service; nobody, not even the owner, can see your password.';
      box.appendChild(p);
      const msg = document.createElement('div'); msg.className = 'msg';
      if (!state.ready) {
        msg.textContent = 'Checking…'; box.appendChild(msg);
      } else if (state.saved && !editing) {
        const row = document.createElement('div'); row.className = 'row';
        const ok = document.createElement('span'); ok.className = 'ok'; ok.textContent = 'Connected ✓ (username ending …' + state.hint + ')';
        const replace = button('Replace', 'plain', () => { editing = true; render(); });
        const remove = button('Disconnect', 'danger', async () => {
          if (!confirm('Disconnect your Nigri account? You will need to connect it again before syncing.')) return;
          remove.disabled = true; msg.textContent = 'Disconnecting…';
          const r = await call('DELETE');
          if (r.ok) set({ saved: false, hint: '' }); else { msg.className = 'msg err'; msg.textContent = r.message; remove.disabled = false; }
        });
        row.append(ok, replace, remove); box.append(row, msg);
      } else {
        const row = document.createElement('div'); row.className = 'row';
        const user = document.createElement('input'); user.placeholder = 'Nigri username'; user.autocomplete = 'off'; user.maxLength = 200;
        const pass = document.createElement('input'); pass.type = 'password'; pass.placeholder = 'Nigri password'; pass.autocomplete = 'off'; pass.maxLength = 200;
        const go = button(state.saved ? 'Save new login' : 'Connect', '', async () => {
          const u = user.value.trim(), pw = pass.value;
          if (!u || !pw) { msg.className = 'msg err'; msg.textContent = 'Enter your Nigri username and password.'; return; }
          go.disabled = true; msg.className = 'msg'; msg.textContent = 'Saving…';
          const r = await call('PUT', { username: u, password: pw });
          pass.value = '';                       // never kept on the page
          if (r.ok) { editing = false; set({ saved: r.saved, hint: r.hint }); }
          else { msg.className = 'msg err'; msg.textContent = r.message; go.disabled = false; }
        });
        pass.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
        row.append(user, pass, go);
        if (state.saved) row.append(button('Cancel', 'plain', () => { editing = false; render(); }));
        box.append(row, msg);
        if (state.error) { msg.className = 'msg err'; msg.textContent = state.error; }
      }
      host.replaceChildren(box);
    });
  }
  function button(text, cls, onclick) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; if (cls) b.className = cls; b.onclick = onclick; return b;
  }

  async function start() {
    const gate = window.B3NigriGate ? await window.B3NigriGate.ready : { allowed: false };
    if (!gate || !gate.allowed) { set({ role: 'none', ready: true }); settleReady(state); return; }
    if (gate.reason === 'owner') { set({ role: 'owner', ready: true }); settleReady(state); return; }
    set({ role: 'teacher' });
    const r = await call('GET');
    set(r.ok ? { saved: r.saved, hint: r.hint, ready: true, error: '' } : { saved: false, ready: true, error: r.message });
    settleReady(state);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { render(); start(); }, { once: true });
  else { render(); start(); }

  // ---------- sending School Marks ----------
  // Before sending anything: null = OK to go on; otherwise a plain reason to show (nothing was sent).
  async function cannotSync() {
    await ready;
    if (state.role === 'owner') return null;
    if (state.role !== 'teacher') return 'Nigri sync is not turned on for your school.';
    if (!state.saved) return 'Connect your Nigri account first (the box on this page).';
    return null;
  }
  async function sendMarks(body, ownerSend) {
    await ready;
    if (state.role === 'owner') return { response: await ownerSend(), via: 'owner' };
    const reason = await cannotSync();
    if (reason) throw new Error(reason);
    const token = window.NigriAuth && await window.NigriAuth.getToken();
    if (!token) throw new Error('Please sign in with your teacher Google account first.');
    // Teacher: his sign-in only, never the old shared key. Same server as his login box.
    const response = await fetch(base() + '/sync-marks', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    return { response, via: 'teacher' };
  }

  window.NigriConnect = { ready, state, cannotSync, sendMarks, onChange: fn => { listeners.push(fn); } };
})();
