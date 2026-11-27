/* Shorashim review cycles (page side).
   The student picks how many words to review now; the words come from the current cycle
   (every learned word once), the place is saved in his record, and each word keeps a count of
   how many times it was reviewed. Points and recordings are not touched. */
(() => {
  'use strict';
  const C = window.B3ReviewCycles;
  if (!C) return;

  const COUNT_CHOICES = ['10', '20', '50', '100', 'all'];
  const COUNT_KEY = 'shorashimReviewCount';
  const TRACK_LABEL = { shorashim: 'Shorashim', prefix: 'Prefixes', suffix: 'Suffixes' };
  let chosenCount = '20';
  try { const v = localStorage.getItem(COUNT_KEY); if (COUNT_CHOICES.includes(v)) chosenCount = v; } catch (e) {}

  let cycleDeck = false, cycleTrack = 'shorashim', cycleJustCompleted = false;
  let countedDeck = null, counted = new Set();

  const $ = id => document.getElementById(id);
  const track = () => (typeof window.B3ReviewTrack === 'function' ? window.B3ReviewTrack() : 'shorashim');
  const cardsOf = (t, s = student()) => learnedCards(s, t, false).filter(c => !!getItem(c.itemKey));
  const keysOf = (t, s = student()) => cardsOf(t, s).map(c => c.itemKey);

  function orderedCards(t) {
    const arr = cardsOf(t).slice(), mode = $('reviewSort')?.value || 'newest';
    if (mode === 'alpha') arr.sort((a, b) => (getItem(a.itemKey)?.front || '').localeCompare(getItem(b.itemKey)?.front || '', 'he'));
    else if (mode === 'manual') arr.sort((a, b) => (a.reviewOrder ?? a.learnedAt) - (b.reviewOrder ?? b.learnedAt));
    else if (mode === 'learned') arr.sort((a, b) => a.learnedAt - b.learnedAt);
    else arr.sort((a, b) => b.learnedAt - a.learnedAt);
    return arr;
  }

  function leftLine(t) {
    const s = C.summary(student(), t, keysOf(t));
    return s.total ? C.leftText(s.left) : '';
  }

  // One short line for the home page / hub: each track that has learned words.
  function homeText() {
    const parts = [];
    C.TRACKS.forEach(t => {
      const s = C.summary(student(), t, keysOf(t));
      if (s.total) parts.push({ t, left: s.left });
    });
    if (!parts.length) return '';
    if (parts.length === 1 && parts[0].t === 'shorashim') return C.leftText(parts[0].left);
    return parts.map(p => `${TRACK_LABEL[p.t]}: ${C.leftText(p.left)}`).join(' · ');
  }

  function renderCycleStatus() {
    let s; try { s = student(); } catch (e) { return; }
    if (!s) return;
    const t = track(), line = leftLine(t);
    const box = $('cycleBox');
    if (box) {
      box.classList.toggle('hidden', !line);
      const sum = C.summary(s, t, keysOf(t));
      const lt = $('cycleLeftLine');
      if (lt) lt.textContent = line ? `${line} (cycle ${sum.cycle}${t === 'shorashim' ? '' : ' · ' + TRACK_LABEL[t]})` : '';
      document.querySelectorAll('#cycleCountBtns [data-count]').forEach(b => {
        const on = b.dataset.count === chosenCount;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    const pill = $('reviewCycleLeft');
    if (pill) { const lt = leftLine(cycleDeck ? cycleTrack : t); pill.textContent = lt; pill.classList.toggle('hidden', !lt); }
    const txt = homeText();
    ['homeCycleLeft', 'hubCycleLeft'].forEach(id => { const el = $(id); if (el) { el.textContent = txt; el.classList.toggle('hidden', !txt); } });
  }

  function toast(msg) {
    let el = $('cycleToast');
    if (!el) { el = document.createElement('div'); el.id = 'cycleToast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // Called once per word per review session, when the word is really reviewed.
  function recordReviewed(key) {
    const [t] = splitKey(key);
    if (!C.TRACKS.includes(t)) return;
    const r = C.markReviewed(student(), t, key, keysOf(t), Date.now());
    if (r.completed) { cycleJustCompleted = true; toast('🎉 Cycle complete!'); }
    saveDB();
    renderCycleStatus();
  }

  const origQualify = qualifyCurrentCard;
  qualifyCurrentCard = function cycleAwareQualify() {
    const c = reviewDeck && reviewDeck[reviewIndex], key = c && c.itemKey;
    const ok = origQualify();
    if (ok && key) {
      if (countedDeck !== reviewDeck) { countedDeck = reviewDeck; counted = new Set(); }
      if (!counted.has(key)) { counted.add(key); recordReviewed(key); }
    }
    return ok;
  };

  // ---- starting a cycle batch ----
  function startCycleReview() {
    const t = track(), cards = orderedCards(t);
    if (!cards.length) { alert('Learn a card first, then come back to review.'); return; }
    const map = new Map(cards.map(c => [c.itemKey, c]));
    const keys = C.pickBatch(student(), t, cards.map(c => c.itemKey), chosenCount);
    let arr = keys.map(k => map.get(k)).filter(Boolean);
    if (!arr.length) { renderCycleStatus(); return; }
    if (document.querySelector('input[name="reviewOrderMode"]:checked')?.value === 'shuffle') arr = shuffle(arr.slice());
    reviewDeck = arr; reviewIndex = 0; reviewFlipped = false;
    cycleDeck = true; cycleTrack = t; cycleJustCompleted = false;
    hideBatchDone();
    $('reviewEmpty')?.classList.add('hidden');
    $('reviewSetup')?.classList.add('hidden');
    document.body.classList.add('shorashim-review-active');
    $('reviewArea')?.classList.remove('hidden');
    renderReviewCard();
  }
  window.startCycleReview = startCycleReview;

  // A hand-picked review ("Pick different cards") is not a cycle batch.
  const origStart = startReview;
  startReview = function cycleAwareStart() {
    if (!(typeof origStart === 'function')) return;
    cycleDeck = false; hideBatchDone();
    return origStart.apply(this, arguments);
  };
  const origChoose = chooseDifferentReviewCards;
  chooseDifferentReviewCards = function cycleAwareChoose() {
    cycleDeck = false; hideBatchDone();
    const r = origChoose.apply(this, arguments);
    renderCycleStatus();
    return r;
  };

  // ---- end of a batch ----
  function hideBatchDone() { $('reviewBatchDone')?.classList.add('hidden'); }
  function recordingBusy() { return typeof shorashimRecorder !== 'undefined' && shorashimRecorder && ['recording', 'paused'].includes(shorashimRecorder.state); }

  function showBatchDone() {
    const box = $('reviewBatchDone'); if (!box) return;
    const t = cycleTrack, s = C.summary(student(), t, keysOf(t));
    const reviewed = reviewDeck.length;
    const head = cycleJustCompleted ? '🎉 Cycle complete!' : 'Great job!';
    const sub = cycleJustCompleted
      ? `You reviewed all your words. A new cycle started: ${C.leftText(s.left)}.`
      : `You reviewed ${reviewed} word${reviewed === 1 ? '' : 's'}. ${C.leftText(s.left)}.`;
    $('reviewBatchHead').textContent = head;
    $('reviewBatchSub').textContent = sub;
    const more = $('reviewBatchMoreBtn');
    if (more) more.textContent = chosenCount === 'all' ? 'Keep going' : `Keep going (${chosenCount} more)`;
    $('reviewBatchNote').textContent = recordingBusy() ? 'Press “Finish & Submit” to send your recording first.' : '';
    box.classList.remove('hidden');
    cycleJustCompleted = false;
    renderCycleStatus();
    box.scrollIntoView?.({ block: 'nearest' });
  }

  const origMove = moveReview;
  moveReview = function cycleAwareMove(dir) {
    if (cycleDeck && dir > 0 && reviewDeck.length && reviewIndex === reviewDeck.length - 1) {
      if (!qualifyCurrentCard()) return;
      showBatchDone();
      return;
    }
    hideBatchDone();
    return origMove.apply(this, arguments);
  };

  function bindBatchButtons() {
    $('reviewBatchMoreBtn')?.addEventListener('click', () => {
      if (recordingBusy()) { const n = $('reviewBatchNote'); if (n) n.textContent = 'Press “Finish & Submit” to send your recording first.'; return; }
      hideBatchDone(); startCycleReview();
    });
    $('reviewBatchStopBtn')?.addEventListener('click', () => {
      if (recordingBusy()) { const n = $('reviewBatchNote'); if (n) n.textContent = 'Press “Finish & Submit” to send your recording first.'; return; }
      hideBatchDone();
      chooseDifferentReviewCards();
      goScreen('reviewHubScreen');
    });
    document.querySelectorAll('#cycleCountBtns [data-count]').forEach(b => b.addEventListener('click', () => {
      chosenCount = b.dataset.count;
      try { localStorage.setItem(COUNT_KEY, chosenCount); } catch (e) {}
      renderCycleStatus();
    }));
  }

  // ---- show review counts ----
  const origRenderCard = renderReviewCard;
  renderReviewCard = function cycleAwareRenderCard() {
    const r = origRenderCard.apply(this, arguments);
    const c = reviewDeck[reviewIndex], el = $('reviewPasuk');
    if (c && el) el.textContent += ` • reviewed ${C.countLabel(C.reviewCountOf(c))}`;
    renderCycleStatus();
    return r;
  };
  const origPicker = renderReviewPicker;
  renderReviewPicker = function cycleAwarePicker() {
    const r = origPicker.apply(this, arguments);
    const cards = student().cards || {};
    document.querySelectorAll('#reviewPicker .review-pick-row').forEach(row => {
      const n = C.reviewCountOf(cards[row.dataset.key]), span = row.querySelector('label > span');
      if (span && !span.querySelector('.review-count-badge')) {
        const b = document.createElement('em'); b.className = 'review-count-badge'; b.textContent = `reviewed ${C.countLabel(n)}`; span.appendChild(b);
      }
    });
    return r;
  };
  const origDaily = renderDailyStatus;
  renderDailyStatus = function cycleAwareDaily() { const r = origDaily.apply(this, arguments); renderCycleStatus(); return r; };

  const style = document.createElement('style');
  style.textContent = `
    .cycle-box{margin:12px 0;padding:12px 14px;border:2px solid #bbf7d0;background:#f0fdf4;border-radius:14px;text-align:center}
    .cycle-box.hidden,.cycle-pill.hidden,.hub-cycle.hidden{display:none}
    .cycle-left{font-size:1.15rem;font-weight:800;color:#166534}
    .cycle-count-title{margin:8px 0 6px;font-weight:700}
    #cycleCountBtns{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
    #cycleCountBtns button{min-width:56px;padding:10px 14px;border-radius:999px;border:2px solid #86efac;background:#fff;font-weight:800;font-size:1.05rem;cursor:pointer}
    #cycleCountBtns button.active{background:#16a34a;border-color:#16a34a;color:#fff}
    .cycle-pill{background:#dcfce7;color:#166534;font-weight:700}
    .hub-cycle{display:block;margin-top:6px;font-weight:800;color:#166534}
    .review-count-badge{margin-left:6px;font-style:normal;font-size:.8em;color:#6b7280}
    #reviewBatchDone{margin:12px 0;padding:16px;border:3px solid #16a34a;background:#f0fdf4;border-radius:16px;text-align:center}
    #reviewBatchDone.hidden{display:none}
    #reviewBatchHead{font-size:1.6rem;font-weight:900;color:#166534}
    #reviewBatchSub{margin:6px 0 10px;font-size:1.05rem}
    #reviewBatchNote{min-height:1.2em;color:#b45309;font-weight:700;margin-bottom:8px}
    #reviewBatchDone .batch-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
    #cycleToast{position:fixed;left:50%;top:18px;transform:translate(-50%,-140%);background:#16a34a;color:#fff;font-weight:900;font-size:1.3rem;padding:12px 22px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:99999;transition:transform .25s}
    #cycleToast.show{transform:translate(-50%,0)}`;
  document.head.appendChild(style);

  const init = () => { bindBatchButtons(); renderCycleStatus(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
