/* Shorashim review options and points (page side).
   - Two on/off options at the top of Review: "Hide pictures" and "Record myself".
   - Points: 1 point for every 100 words reviewed, counted together across review and all games,
     at most 10 a day. A word counts only when at least the minimum review time was spent on it.
   - The page reports small batches ("12 more words") to Student Rewards; the server holds the
     real total, applies the daily limit and pays each point once (backend/functions/shorashim-words-core.cjs).
   Recordings no longer decide points: they only go to the teacher. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const WORDS_PER_POINT = 100, MAX_POINTS = 10, FLUSH_AT = 5, FLUSH_MS = 10000, MAX_FAILS = 3;
  const sync = { ok: false, words: 0, points: 0, pending: 0, retry: null, timer: null, busy: false, fails: 0, day: '' };
  const seenInDeck = { deck: null, keys: new Set() };

  const signedIn = () => {
    try { return !!(cloudEnabled && cloudStudentId) && !isGuestPreview(); } catch (e) { return false; }
  };
  const minMs = () => { try { return Number(db.settings.minReviewMs) || 500; } catch (e) { return 500; } };

  function endpoint() {
    const app = window.firebase && firebase.apps && firebase.apps[0];
    const id = app && app.options && app.options.projectId;
    return id ? `https://us-central1-${id}.cloudfunctions.net/studentRewardsAutoAward` : '';
  }
  async function call(body, keepalive) {
    const user = window.firebase && firebase.auth && firebase.auth().currentUser, url = endpoint();
    if (!user || !url) throw new Error('not signed in');
    const token = await user.getIdToken();
    const r = await fetch(url, { method: 'POST', keepalive: !!keepalive, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  // ---- progress text ----
  const shownWords = () => Math.min(MAX_POINTS * WORDS_PER_POINT, sync.words + sync.pending + (sync.retry ? sync.retry.n : 0));
  function progressText() {
    if (!sync.ok) return '';
    const w = shownWords(), pts = Math.floor(w / WORDS_PER_POINT);
    if (w >= MAX_POINTS * WORDS_PER_POINT) return `⭐ ${MAX_POINTS}/${MAX_POINTS} points today — amazing!`;
    return `⭐ ${w % WORDS_PER_POINT}/${WORDS_PER_POINT} to next point · ${pts} point${pts === 1 ? '' : 's'} today (max ${MAX_POINTS})`;
  }
  function renderProgress() {
    const txt = progressText();
    ['wordPointsLine', 'gamesPointsLine', 'reviewWordPoints'].forEach(id => { const el = $(id); if (el) { el.textContent = txt; el.classList.toggle('hidden', !txt); } });
  }

  // ---- server sync ----
  function apply(data) {
    sync.ok = true; sync.fails = 0;
    sync.words = Number(data.words) || 0; sync.points = Number(data.points) || 0; sync.day = data.day || '';
    renderProgress();
    if (data.newlyAwarded && data.newlyAwarded.length) toast(`⭐ +${data.newlyAwarded.length} point${data.newlyAwarded.length === 1 ? '' : 's'}!`);
  }
  function toast(msg) {
    let el = $('cycleToast');
    if (!el) { el = document.createElement('div'); el.id = 'cycleToast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3000);
  }
  async function refresh() {
    if (!signedIn()) return;
    try { apply(await call({ action: 'shorashim-words-status' })); } catch (e) { /* no progress line if the server cannot be reached */ }
  }
  async function flush(keepalive) {
    clearTimeout(sync.timer); sync.timer = null;
    if (sync.busy || !signedIn()) return;
    if (!sync.retry && sync.pending < 1) return;
    if (!sync.retry) {
      const n = Math.min(100, sync.pending);
      sync.retry = { n, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };
      sync.pending -= n;
    }
    sync.busy = true;
    try {
      const data = await call({ action: 'shorashim-words-report', words: sync.retry.n, batchId: sync.retry.id }, keepalive);
      sync.retry = null; apply(data);
    } catch (e) {
      if (++sync.fails >= MAX_FAILS) { sync.retry = null; sync.pending = 0; }
    } finally { sync.busy = false; }
    if (sync.pending > 0) schedule();
  }
  function schedule() { if (!sync.timer) sync.timer = setTimeout(() => flush(), FLUSH_MS); }

  // One word counted. spentMs = how long the student was on it; too fast does not count.
  function countWord(spentMs) {
    if (!signedIn() || sync.fails >= MAX_FAILS) return false;
    if (!(spentMs >= minMs())) return false;
    if (!sync.ok) sync.ok = true;
    sync.pending++;
    renderProgress();
    if (sync.pending >= FLUSH_AT) flush(); else schedule();
    return true;
  }

  // ---- review: each word once per batch, only with enough time on the card ----
  const origQualify = qualifyCurrentCard;
  qualifyCurrentCard = function pointsAwareQualify() {
    const c = reviewDeck && reviewDeck[reviewIndex], key = c && c.itemKey;
    const spent = performance.now() - reviewShownAt;
    const ok = origQualify();
    if (ok && key) {
      if (seenInDeck.deck !== reviewDeck) { seenInDeck.deck = reviewDeck; seenInDeck.keys = new Set(); }
      if (!seenInDeck.keys.has(key) && countWord(spent)) seenInDeck.keys.add(key);
    }
    return ok;
  };

  // ---- games: a word counts when answered right, with enough time since the question appeared ----
  let gameClock = performance.now();
  const gameCount = () => { const now = performance.now(), spent = now - gameClock; gameClock = now; return countWord(spent); };
  ['startMatchGame', 'startShootGame', 'startWhackGame', 'startRaceGame'].forEach(name => {
    const orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = function () { gameClock = performance.now(); return orig.apply(this, arguments); };
  });
  const origPick = pickMatch;
  pickMatch = function pointsAwarePick(i) {
    const before = matchState ? matchState.matched.size : 0;
    const r = origPick.apply(this, arguments);
    if (matchState && matchState.matched.size > before) gameCount();
    return r;
  };
  const origFire = fireAtTarget;
  fireAtTarget = function pointsAwareFire(e, card) {
    const before = shootState ? shootState.hits : 0;
    const r = origFire.apply(this, arguments);
    if (shootState && shootState.hits > before) gameCount();
    return r;
  };
  const origWhack = whackMole;
  whackMole = function pointsAwareWhack(b) {
    const wasLocked = !whackState || whackState.locked;
    const r = origWhack.apply(this, arguments);
    if (!wasLocked && whackState && whackState.locked) gameCount();
    return r;
  };
  const origRace = answerRace;
  answerRace = function pointsAwareRace(card, b) {
    const wasLocked = !raceState || raceState.locked, before = raceState ? raceState.studentPos : 0;
    const r = origRace.apply(this, arguments);
    if (!wasLocked && raceState && raceState.studentPos > before) gameCount();
    return r;
  };

  // ---- the two on/off options ----
  function paintToggles() {
    [['hidePicturesToggle'], ['recordMyselfToggle']].forEach(([id]) => {
      const b = $(id); if (!b) return;
      const st = b.querySelector('.toggle-state'); if (st) st.textContent = b.classList.contains('on') ? 'ON' : 'OFF';
    });
  }
  const origGo = goScreen;
  goScreen = function pointsAwareGo(id) {
    const r = origGo.apply(this, arguments);
    if (id === 'reviewScreen' || id === 'gamesScreen') { refresh(); renderProgress(); }
    paintToggles();
    return r;
  };

  function init() {
    const gs = $('gamesScreen');
    if (gs && !$('gamesPointsLine')) { const d = document.createElement('div'); d.id = 'gamesPointsLine'; d.className = 'word-points-line hidden'; d.setAttribute('aria-live', 'polite'); const head = gs.querySelector('.section-head'); head ? head.after(d) : gs.prepend(d); }
    const meta = document.querySelector('#reviewArea .review-meta');
    if (meta && !$('reviewWordPoints')) { const p = document.createElement('span'); p.id = 'reviewWordPoints'; p.className = 'pill cycle-pill hidden'; meta.appendChild(p); }
    ['hidePicturesToggle', 'recordMyselfToggle'].forEach(id => $(id)?.addEventListener('click', () => setTimeout(paintToggles, 0)));
    paintToggles();
    refresh();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
    window.addEventListener('pagehide', () => flush(true));
  }

  const style = document.createElement('style');
  style.textContent = `
    .review-options-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:6px 0 10px}
    .review-toggle{display:flex;align-items:center;gap:10px;min-height:56px;padding:10px 18px;border-radius:16px;border:3px solid #cbd5e1;background:#fff;font-size:1.1rem;cursor:pointer}
    .review-toggle .toggle-icon{font-size:1.6rem}
    .review-toggle .toggle-state{font-weight:900;padding:2px 10px;border-radius:999px;background:#e2e8f0;color:#475569;font-size:.85rem}
    .review-toggle.on{border-color:#16a34a;background:#f0fdf4}
    .review-toggle.on .toggle-state{background:#16a34a;color:#fff}
    .word-points-line{margin:6px auto 10px;text-align:center;font-weight:800;color:#92400e;background:#fffbeb;border:2px solid #fde68a;border-radius:14px;padding:8px 14px;max-width:520px}
    .word-points-line.hidden,#reviewWordPoints.hidden{display:none}
    #reviewWordPoints{background:#fef3c7;color:#92400e}`;
  document.head.appendChild(style);

  window.B3ShorashimWordPoints = { countWord, flush, refresh, progressText };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
