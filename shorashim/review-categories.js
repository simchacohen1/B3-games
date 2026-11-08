/* Shorashim Learning Lab — category-aware Flashcard Review
   Adds separate Shorashim / Prefixes / Suffixes review pickers while
   preserving the existing card renderer, review timing, selection,
   manual ordering, shuffle, and daily completion system. */
(() => {
  'use strict';

  let reviewTrack = 'shorashim';

  const TRACK_META = {
    shorashim: { label: 'Shorashim', empty: 'shorashim' },
    prefix: { label: 'Prefixes', empty: 'prefixes' },
    suffix: { label: 'Suffixes', empty: 'suffixes' }
  };

  function fixStaticReviewLabelsAndAffixIcons() {
    document.querySelectorAll('[data-review-track]').forEach(btn => {
      const meta = TRACK_META[btn.dataset.reviewTrack];
      const title = btn.querySelector('.track-title');
      if (meta && title) title.textContent = meta.label;
    });

    const prefixIcon = document.querySelector('[data-track="prefix"] .feature-icon');
    if (prefixIcon) {
      prefixIcon.textContent = 'ב־';
      prefixIcon.setAttribute('dir', 'rtl');
    }

    const suffixIcon = document.querySelector('[data-track="suffix"] .feature-icon');
    if (suffixIcon) {
      suffixIcon.textContent = '־ו';
      suffixIcon.setAttribute('dir', 'rtl');
    }
  }

  function cardsForReviewTrack(track = reviewTrack, s = student(), applyPerekFilter = true) {
    let cards = learnedCards(s, track, false).filter(c => !!getItem(c.itemKey));
    if (track === 'shorashim' && applyPerekFilter && typeof reviewPerekFilter !== 'undefined' && reviewPerekFilter !== 'all') {
      cards = cards.filter(c => reviewPerekFilter === 'booklet' ? !!getItem(c.itemKey)?.bookletWeek : !getItem(c.itemKey)?.bookletWeek && unitKeyOf(getItem(c.itemKey)) === reviewPerekFilter);
    }
    return cards;
  }

  function reviewTrackProgress(track, s = student()) {
    const dr = ensureDailyReview(s);
    const keys = cardsForReviewTrack(track, s, false).map(c => c.itemKey);
    const seen = keys.filter(k => dr.seen[k]).length;
    return { seen, total: keys.length, complete: keys.length > 0 && seen === keys.length };
  }

  function updateReviewTrackTabs() {
    document.querySelectorAll('[data-review-track]').forEach(btn => {
      const track = btn.dataset.reviewTrack;
      const p = reviewTrackProgress(track);
      const active = track === reviewTrack;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      const progress = btn.querySelector('.track-progress');
      if (progress) {
        progress.textContent = p.total
          ? `${p.seen} / ${p.total} reviewed today${p.complete ? ' ✓' : ''}`
          : 'No learned cards yet';
      }
    });
  }

  function updatePerekFilterVisibility() {
    const filter = document.querySelector('.review-perek-filter');
    if (!filter) return;
    if (typeof renderReviewUnitFilters === 'function') renderReviewUnitFilters();
    filter.classList.toggle('hidden', reviewTrack !== 'shorashim');
  }

  function selectReviewTrack(track) {
    if (!TRACK_META[track]) return;
    reviewTrack = track;
    reviewDeck = [];
    reviewIndex = 0;
    reviewFlipped = false;
    document.body.classList.remove('shorashim-review-active');
    document.getElementById('reviewArea')?.classList.add('hidden');
    document.getElementById('reviewEmpty')?.classList.add('hidden');
    document.getElementById('reviewSetup')?.classList.remove('hidden');
    updateReviewTrackTabs();
    updatePerekFilterVisibility();
    renderReviewPicker();
    window.scrollTo(0, 0);
  }

  function wireReviewTrackButtons() {
    document.querySelectorAll('[data-review-track]').forEach(btn => {
      btn.onclick = () => selectReviewTrack(btn.dataset.reviewTrack);
    });
    updateReviewTrackTabs();
    updatePerekFilterVisibility();
  }

  const originalBindReview = bindReview;
  bindReview = function categoryAwareBindReview() {
    originalBindReview();
    wireReviewTrackButtons();
  };

  reviewSortedCards = function categoryAwareReviewSortedCards() {
    let arr = cardsForReviewTrack().slice();
    const mode = document.getElementById('reviewSort')?.value || 'newest';
    if (mode === 'alpha') {
      arr.sort((a, b) => (getItem(a.itemKey)?.front || '').localeCompare(getItem(b.itemKey)?.front || '', 'he'));
    } else if (mode === 'manual') {
      arr.sort((a, b) => (a.reviewOrder ?? a.learnedAt) - (b.reviewOrder ?? b.learnedAt));
    } else if (mode === 'newest') {
      arr.sort((a, b) => b.learnedAt - a.learnedAt);
    } else {
      arr.sort((a, b) => a.learnedAt - b.learnedAt);
    }
    return arr;
  };

  renderReviewPicker = function categoryAwareRenderReviewPicker() {
    const box = document.getElementById('reviewPicker');
    if (!box) return;
    const arr = reviewSortedCards();
    const manual = document.getElementById('reviewSort')?.value === 'manual';
    box.innerHTML = '';

    if (!arr.length) {
      const meta = TRACK_META[reviewTrack];
      box.innerHTML = `<div class="review-track-empty">No learned ${escapeHTML(meta.empty)} yet. Learn one, then come back here.</div>`;
      updateReviewSelectionCount();
      updateReviewTrackTabs();
      return;
    }

    arr.forEach(c => {
      const item = getItem(c.itemKey);
      const row = document.createElement('div');
      row.className = 'review-pick-row' + (manual ? ' manual-draggable' : '');
      row.dataset.key = c.itemKey;
      row.draggable = manual;
      row.innerHTML = `<label><input class="review-pick-check" type="checkbox" data-key="${escapeHTML(c.itemKey)}" checked> <b class="hebrew">${escapeHTML(item.front)}</b><span>${escapeHTML(item.english)}${reviewTrack==='shorashim'?` <em class="perek-badge">${reviewFilterLabel(item)}</em>`:''}</span>${manual ? '<span class="review-drag-hint">↕ Drag to reorder</span>' : ''}</label>`;
      box.appendChild(row);
    });

    box.querySelectorAll('.review-pick-check').forEach(x => x.onchange = updateReviewSelectionCount);
    if (manual) bindReviewDragDrop(box);
    updateReviewSelectionCount();
    updateReviewTrackTabs();
  };

  renderReviewAvailability = function categoryAwareRenderReviewAvailability() {
    if (typeof renderReviewUnitFilters === 'function') renderReviewUnitFilters();
    const hasAny = eligibleLearnedCards().length > 0;
    const empty = document.getElementById('reviewEmpty');
    const setup = document.getElementById('reviewSetup');
    const area = document.getElementById('reviewArea');
    empty?.classList.toggle('hidden', hasAny);
    setup?.classList.toggle('hidden', !hasAny);
    if (!hasAny) {
      area?.classList.add('hidden');
    } else {
      updateReviewTrackTabs();
      renderReviewPicker();
    }
  };

  startReview = function categoryAwareStartReview() {
    const keys = [...document.querySelectorAll('.review-pick-check:checked')].map(x => x.dataset.key);
    const map = new Map(cardsForReviewTrack().map(c => [c.itemKey, c]));
    let arr = keys.map(k => map.get(k)).filter(Boolean);

    if (!arr.length) {
      alert(`Select at least one ${TRACK_META[reviewTrack].label.toLowerCase()} card to review.`);
      return;
    }

    if (document.querySelector('input[name="reviewOrderMode"]:checked')?.value === 'shuffle') {
      arr = shuffle(arr.slice());
    }

    reviewDeck = arr;
    reviewIndex = 0;
    reviewFlipped = false;
    document.getElementById('reviewEmpty')?.classList.add('hidden');
    document.getElementById('reviewSetup')?.classList.add('hidden');
    document.body.classList.add('shorashim-review-active');
    document.getElementById('reviewArea')?.classList.remove('hidden');
    renderReviewCard();
  };

  const originalRenderDailyStatus = renderDailyStatus;
  renderDailyStatus = function categoryAwareRenderDailyStatus() {
    originalRenderDailyStatus();
    updateReviewTrackTabs();
  };

  /* Pictures: students see only the pictures the teacher ticked for each word.
     The old meaning-matched fallback emoji and drawings that were shown here to every
     student are now unticked options on the teacher page (see pictures.js). */

  /* ===== Longer Target Shoot =====
     Student request: make the old 10-word target round 20 words.
     The display uses the actual pool length so it stays correct if changed later. */
  const originalRenderShootRound = renderShootRound;
  startShootGame = function longerTargetShoot() {
    cleanupGameRuntime();
    const learned = eligibleLearnedCards();
    if (learned.length < 3) {
      alert('Learn at least three cards before playing Target Shoot.');
      return;
    }
    const pool = [];
    while (pool.length < 20) pool.push(...shuffle([...learned]));
    shootState = {
      pool: pool.slice(0, 20),
      index: 0,
      score: 0,
      shots: 0,
      hits: 0,
      locked: false,
      startedAt: performance.now(),
      targets: []
    };
    renderShootRound();
    focusGameStage();
  };

  renderShootRound = function longerTargetShootRender() {
    originalRenderShootRound();
    const span = document.querySelector('#gameStage .game-scorebox span');
    if (span && shootState?.pool) {
      span.textContent = `Hit ${Math.min(shootState.index + 1, shootState.pool.length)}/${shootState.pool.length}`;
    }
  };

  fixStaticReviewLabelsAndAffixIcons();
  wireReviewTrackButtons();
})();