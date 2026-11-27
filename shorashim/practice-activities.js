/* Shorashim practice activities: Tracing, Multiple Choice and Matching.
   Loaded after app.js (uses its student(), eligibleLearnedCards(), getItem(), speakEnglish(),
   recordPractice(), escapeHTML()).  Each correct answer / finished trace is recorded per word
   in student.practice so the teacher's Mastery tab can show it.

   Pictures later: every choice is { key, text, picture }.  Set
   window.SHORASHIM_CHOICE_PICTURE = (word) => 'https://…' and the choices show it. */
(function () {
  'use strict';
  const M = window.ShorashimMastery;
  const $ = id => document.getElementById(id);
  const TRACE_FONT = '"Gveret Levin","Playpen Sans Hebrew","Ktav Yad CLM","Segoe Script","Comic Sans MS",cursive';
  const NIKUD = /[֑-ׇ]/g;
  let run = null; // the running activity, so a new one cleanly replaces it

  function words() {
    return eligibleLearnedCards().map(c => { const it = getItem(c.itemKey); return it ? { key: c.itemKey, front: it.front, english: it.english } : null; }).filter(Boolean);
  }
  function catalogWords() {
    const out = [];
    ['shorashim', 'prefix', 'suffix'].forEach(t => visibleCatalog(t).forEach(it => out.push({ key: keyFor(t, it.id), front: it.front, english: it.english })));
    return out;
  }
  function picture(word) {
    const f = window.SHORASHIM_CHOICE_PICTURE;
    try { return typeof f === 'function' ? (f(word) || null) : null; } catch (e) { return null; }
  }
  const stage = () => $('practiceStage');
  function open(html) { const st = stage(); st.classList.remove('hidden'); st.innerHTML = html; requestAnimationFrame(() => st.scrollIntoView({ block: 'start' })); return st; }
  function stop() { if (run && run.cleanup) run.cleanup(); run = null; }
  const speakBtn = text => `<button type="button" class="pa-speak" data-speak="${escapeHTML(text)}" aria-label="Hear ${escapeHTML(text)}" title="Hear it">🔊</button>`;
  const picHTML = c => c.picture ? `<img class="pa-pic" src="${escapeHTML(c.picture)}" alt="">` : '';
  function needWords(n, name) {
    const w = words();
    if (w.length < n) { alert(`Learn at least ${n} card${n === 1 ? '' : 's'} before ${name}.`); return null; }
    return w;
  }

  /* ================= Multiple choice ================= */
  function startMultipleChoice() {
    stop();
    const learned = needWords(1, 'Multiple Choice'); if (!learned) return;
    const pool = learned.concat(catalogWords());
    const rounds = M.shuffleIn(learned, Math.random).slice(0, 10);
    if (M.buildChoices(rounds[0], pool, 4, Math.random).length < 2) { alert('This class needs more words in its list before Multiple Choice can start.'); return; }
    const st = { i: 0, right: 0, firstTry: true, locked: false };
    run = { cleanup() {} };
    const renderQ = () => {
      if (st.i >= rounds.length) {
        open(`<div class="game-finish"><div class="finish-icon">🅰️</div><h3>Round complete!</h3><p><b>${st.right} of ${rounds.length}</b> right on the first try.</p><button id="paAgain" class="primary">Play again</button></div>`);
        $('paAgain').onclick = startMultipleChoice; return;
      }
      const w = rounds[st.i], choices = M.buildChoices(w, pool, 4, Math.random, picture);
      st.firstTry = true; st.locked = false;
      open(`<div class="game-head"><div><h3>🅰️ Multiple Choice</h3><span class="muted">Which English meaning goes with this word?</span></div><div class="game-scorebox"><span>${st.i + 1} / ${rounds.length}</span></div></div>
        <div class="pa-prompt" dir="rtl" lang="he">${escapeHTML(w.front)}</div>
        <div class="pa-choices" id="paChoices">${choices.map((c, n) => `<div class="pa-choice" data-n="${n}"><button type="button" class="pa-choice-btn">${picHTML(c)}<span>${escapeHTML(c.text)}</span></button>${speakBtn(c.text)}</div>`).join('')}</div>
        <div id="paMsg" class="game-message">Tap an answer. Tap 🔊 to hear it.</div>`);
      document.querySelectorAll('#paChoices .pa-choice').forEach(box => {
        const c = choices[+box.dataset.n], btn = box.querySelector('.pa-choice-btn');
        btn.onclick = () => {
          if (st.locked) return;
          if (c.correct) {
            st.locked = true; box.classList.add('correct');
            recordPractice(w.key, 'mc');
            if (st.firstTry) st.right++;
            $('paMsg').textContent = 'Correct!'; $('paMsg').className = 'game-message correct';
            setTimeout(() => { st.i++; renderQ(); }, 900);
          } else {
            st.firstTry = false; box.classList.add('wrong'); btn.disabled = true;
            $('paMsg').textContent = 'Not that one — try again.'; $('paMsg').className = 'game-message wrong';
          }
        };
      });
    };
    renderQ();
  }

  /* ================= Matching ================= */
  const MATCH_PAIRS = 5;
  function startMatching() {
    stop();
    const learned = needWords(3, 'Matching'); if (!learned) return;
    const seen = new Set(), picks = [];
    M.shuffleIn(learned, Math.random).forEach(w => { const n = String(w.english).toLowerCase(); if (picks.length < MATCH_PAIRS && !seen.has(n)) { seen.add(n); picks.push(w); } });
    if (picks.length < 3) { alert('Learn a few more different words before Matching.'); return; }
    const st = { sel: null, done: new Set(), mistakes: 0, left: M.shuffleIn(picks, Math.random), right: M.shuffleIn(picks, Math.random) };
    run = { cleanup() {} };
    const draw = () => {
      const finished = st.done.size === picks.length;
      open(`<div class="game-head"><div><h3>🔗 Matching</h3><span class="muted">Tap a Hebrew word, then its English meaning. Tap 🔊 to hear the English.</span></div><div class="game-scorebox"><span>${st.done.size} / ${picks.length}</span></div></div>
        <div class="pa-match">
          <div class="pa-col" id="paLeft">${st.left.map(w => `<button type="button" class="pa-tile he${st.done.has(w.key) ? ' matched' : ''}${st.sel && st.sel.side === 'L' && st.sel.key === w.key ? ' selected' : ''}" data-key="${escapeHTML(w.key)}" dir="rtl" lang="he" ${st.done.has(w.key) ? 'disabled' : ''}>${escapeHTML(w.front)}</button>`).join('')}</div>
          <div class="pa-col" id="paRight">${st.right.map(w => { const c = { picture: picture(w) }; return `<div class="pa-tile-row"><button type="button" class="pa-tile en${st.done.has(w.key) ? ' matched' : ''}${st.sel && st.sel.side === 'R' && st.sel.key === w.key ? ' selected' : ''}" data-key="${escapeHTML(w.key)}" ${st.done.has(w.key) ? 'disabled' : ''}>${picHTML(c)}<span>${escapeHTML(w.english)}</span></button>${speakBtn(w.english)}</div>`; }).join('')}</div>
        </div>
        ${finished ? `<div class="game-result-banner"><h3>🎉 All matched!</h3><p>${st.mistakes} mistake${st.mistakes === 1 ? '' : 's'}.</p><button id="paAgain" class="primary">Another round</button></div>` : '<div id="paMsg" class="game-message">Pick a word on the left.</div>'}`);
      if (finished) { $('paAgain').onclick = startMatching; return; }
      document.querySelectorAll('#paLeft .pa-tile').forEach(b => b.onclick = () => pick('L', b.dataset.key));
      document.querySelectorAll('#paRight .pa-tile').forEach(b => b.onclick = () => pick('R', b.dataset.key));
    };
    const pick = (side, key) => {
      if (!st.sel || st.sel.side === side) { st.sel = { side, key }; draw(); return; }
      if (st.sel.key === key) {
        st.done.add(key); st.sel = null; recordPractice(key, 'match'); draw();
        const m = $('paMsg'); if (m) { m.textContent = 'Match!'; m.className = 'game-message correct'; }
      } else {
        st.mistakes++;
        const wrong = [...document.querySelectorAll('.pa-tile')].filter(b => b.dataset.key === key || b.dataset.key === st.sel.key);
        wrong.forEach(b => b.classList.add('wrong'));
        st.sel = null;
        setTimeout(() => draw(), 450);
      }
    };
    draw();
  }

  /* ================= Tracing ================= */
  const W = 900, H = 360, SCALE = 0.5, BRUSH = 30;
  function traceLetters(front) {
    const first = String(front || '').split('/')[0];
    return Array.from(first.normalize('NFC').replace(NIKUD, '')).filter(ch => /[א-ת]/.test(ch));
  }
  function startTracing() {
    stop();
    const learned = needWords(1, 'Tracing'); if (!learned) return;
    const deck = M.shuffleIn(learned.filter(w => traceLetters(w.front).length), Math.random);
    if (!deck.length) { alert('No words can be traced yet.'); return; }
    let idx = 0;
    run = { cleanup() { window.__shorashimTrace = null; } };
    const showWord = async () => {
      const w = deck[idx % deck.length], letters = traceLetters(w.front);
      open(`<div class="game-head"><div><h3>✍️ Tracing</h3><span class="muted">Trace every letter with your finger or the mouse.</span></div><div class="game-scorebox"><span>Word ${idx + 1}</span><button id="trClear" class="ghost" type="button">Clear</button><button id="trSkip" class="ghost" type="button">Skip →</button></div></div>
        <div class="pa-trace-label" dir="rtl" lang="he">${escapeHTML(w.front)}</div>
        <div class="pa-trace-wrap" id="trWrap"><canvas id="trBase" width="${W}" height="${H}"></canvas><canvas id="trInk" width="${W}" height="${H}"></canvas></div>
        <div id="trMsg" class="game-message">Start on the first letter (right side) and trace over the outline.</div>
        <div class="pa-trace-foot"><span class="muted">${escapeHTML(w.english)}</span> ${speakBtn(w.english)}<button id="trNext" class="primary hidden" type="button">Next word →</button></div>`);
      $('trSkip').onclick = () => { idx++; showWord(); };
      try { await Promise.race([document.fonts.load(`200px ${TRACE_FONT}`, letters.join('')), new Promise(r => setTimeout(r, 1800))]); } catch (e) { /* fall back to whatever font is available */ }
      if (!$('trBase')) return; // the student left meanwhile
      setupTrace(w, letters, () => { idx++; showWord(); });
    };
    showWord();
  }

  function setupTrace(w, letters, onNext) {
    const base = $('trBase'), ink = $('trInk'), bctx = base.getContext('2d'), ictx = ink.getContext('2d');
    // Fit the word to the canvas.
    let size = 300; bctx.font = `${size}px ${TRACE_FONT}`;
    const measure = () => letters.map(l => bctx.measureText(l).width);
    let widths = measure(), total = widths.reduce((a, b) => a + b, 0) + (letters.length - 1) * size * 0.04;
    if (total > W - 60) { size = Math.floor(size * (W - 60) / total); bctx.font = `${size}px ${TRACE_FONT}`; widths = measure(); total = widths.reduce((a, b) => a + b, 0) + (letters.length - 1) * size * 0.04; }
    const gap = size * 0.04, baseline = Math.round(H * 0.74);
    // Hebrew reads right to left: the first letter sits at the right.
    let x = (W + total) / 2;
    const pos = letters.map((l, i) => { x -= widths[i]; const p = { l, x, w: widths[i] }; x -= gap; return p; });

    const smallW = Math.round(W * SCALE), smallH = Math.round(H * SCALE);
    const sm = document.createElement('canvas'); sm.width = smallW; sm.height = smallH;
    const sctx = sm.getContext('2d', { willReadFrequently: true });
    const alphaMask = (draw) => {
      sctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); sctx.clearRect(0, 0, W, H); draw(sctx);
      const d = sctx.getImageData(0, 0, smallW, smallH).data, out = new Uint8Array(smallW * smallH);
      for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 40 ? 1 : 0;
      return out;
    };
    const setFont = c => { c.font = `${size}px ${TRACE_FONT}`; c.textBaseline = 'alphabetic'; c.direction = 'ltr'; };
    const letterMasks = pos.map(p => alphaMask(c => { setFont(c); c.fillStyle = '#000'; c.fillText(p.l, p.x, baseline); }));
    const tolerance = alphaMask(c => { setFont(c); c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineJoin = 'round'; c.lineWidth = BRUSH * 0.9; pos.forEach(p => { c.fillText(p.l, p.x, baseline); c.strokeText(p.l, p.x, baseline); }); });

    let done = pos.map(() => false), finished = false;
    const paintBase = () => {
      bctx.clearRect(0, 0, W, H); setFont(bctx); bctx.lineJoin = 'round';
      pos.forEach((p, i) => {
        bctx.fillStyle = done[i] ? '#bbf7d0' : '#f8fafc'; bctx.fillText(p.l, p.x, baseline);
        bctx.lineWidth = 3; bctx.strokeStyle = done[i] ? '#16a34a' : '#64748b'; bctx.setLineDash(done[i] ? [] : [9, 7]); bctx.strokeText(p.l, p.x, baseline);
      });
      bctx.setLineDash([]);
    };
    paintBase();

    const userMask = () => { sctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); sctx.clearRect(0, 0, W, H); sctx.drawImage(ink, 0, 0); const d = sctx.getImageData(0, 0, smallW, smallH).data, out = new Uint8Array(smallW * smallH); for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 40 ? 1 : 0; return out; };
    const msg = (t, k) => { const m = $('trMsg'); if (m) { m.textContent = t; m.className = 'game-message ' + (k || ''); } };
    const evaluate = () => {
      const tp = M.traceProgress(letterMasks, userMask(), tolerance);
      // A letter that was completed stays completed even if the child keeps scribbling.
      tp.done.forEach((d, i) => { if (d && !tp.scribbled) done[i] = true; });
      paintBase();
      const n = done.filter(Boolean).length;
      if (tp.scribbled && n < done.length) { msg('Stay on the letters — tap Clear and trace slowly.', 'wrong'); return; }
      if (done.every(Boolean) && !finished) {
        finished = true; recordPractice(w.key, 'trace');
        msg('✓ Traced every letter!', 'correct');
        const nb = $('trNext'); nb.classList.remove('hidden'); nb.onclick = onNext;
      } else if (!finished) msg(`${n} of ${done.length} letters traced.`, '');
    };

    let drawing = false, last = null;
    const pt = e => { const r = ink.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
    ictx.lineCap = 'round'; ictx.lineJoin = 'round'; ictx.lineWidth = BRUSH; ictx.strokeStyle = 'rgba(37,99,235,.55)';
    ink.addEventListener('pointerdown', e => { if (finished) return; e.preventDefault(); drawing = true; last = pt(e); try { ink.setPointerCapture(e.pointerId); } catch (x) { /* synthetic events */ } ictx.beginPath(); ictx.moveTo(last.x, last.y); ictx.lineTo(last.x + 0.01, last.y); ictx.stroke(); });
    ink.addEventListener('pointermove', e => { if (!drawing) return; e.preventDefault(); const p = pt(e); ictx.beginPath(); ictx.moveTo(last.x, last.y); ictx.lineTo(p.x, p.y); ictx.stroke(); last = p; });
    const end = e => { if (!drawing) return; drawing = false; evaluate(); };
    ink.addEventListener('pointerup', end); ink.addEventListener('pointercancel', end);
    $('trClear').onclick = () => { ictx.clearRect(0, 0, W, H); if (!finished) { done = pos.map(() => false); paintBase(); msg('Start on the first letter (right side) and trace over the outline.'); } };
    // Test hook: where the letters are, in canvas pixels.
    window.__shorashimTrace = { width: W, height: H, scale: SCALE, smallW, letterMasks, letters: pos.map(p => p.l), isDone: () => done.slice(), finished: () => finished };
  }

  /* ================= menu ================= */
  function bind() {
    const tiles = { mc: startMultipleChoice, match: startMatching, trace: startTracing };
    document.querySelectorAll('[data-practice]').forEach(b => b.addEventListener('click', () => { const f = tiles[b.dataset.practice]; if (f) f(); }));
  }
  window.ShorashimPractice = { startMultipleChoice, startMatching, startTracing, traceLetters };
  bind();
})();
