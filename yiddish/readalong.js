/* Read-along add-on for the Yiddish story reader.
   - Book view: picture + short English description on the left page, that scene's Yiddish on the right page.
     Pages turn by themselves as the story is read. One slim control bar replaces the big header.
   - Lights up each word as it is spoken (and the phrase around it).
   - "Stop after each sentence": the audio pauses at the end of each phrase; Play continues.
   - Tap a word: hear just that word, see its meaning, or read on from there.
   Needs word-times.js (window.YIDDISH_WORD_TIMES). Load after reader.js. Never changes the story text. */
(() => {
  const W = window.YIDDISH_WORD_TIMES;
  const player = document.getElementById('audio');
  const box = document.getElementById('text');
  if (!W || !player || !box) return;
  const $ = id => document.getElementById(id);
  const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  const SETTINGS_KEY = 'yiddish-readalong-v1';
  let settings = { step: true, book: true };
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) {}
  const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} };
 
  /* A few plain English words for each picture, keyed by the picture's title in story.html. */
  const SCENE_TEXT = {
    'Prague and its rav': 'Long ago, in the city of Prague, lived a great rav: Rabbi Yechezkel Landau.',
    'Reb Pesach teaches': 'Reb Pesach was a good teacher, but his school paid him very little.',
    'A wedding to prepare for': 'His daughter Gitl will soon get married, but there is no money for the wedding.',
    'Working and saving in Hungary': 'Reb Pesach goes to Hungary. He teaches for two years and saves his money in a little bag.',
    'A deal with the wine merchant': 'Mr. Weinman drives a big wagon of wine home. Reb Pesach rides along and guards the wine.',
    'The journey home': 'A bumpy ride home. They stop at a hotel for Shabbos.',
    'Hiding the money': 'Reb Pesach hides his money bag between the wine barrels. But someone is watching!',
    'The money is missing': 'After Shabbos the money is gone!',
    'Asking the merchant': 'Reb Pesach asks Mr. Weinman, very politely, to give the money back. He says he did not take it.',
    'Coming home empty-handed': 'Reb Pesach comes home with no money at all.',
    'Telling the rav': 'He tells the rav the whole story.',
    'The rav reassures him': 'The rav says: go home, everything will be good.',
    'The merchant requests a hechsher': 'The next day Mr. Weinman comes to the rav. He wants a hechsher for his wine.',
    'Describing the supervision': 'He says his wine had a good mashgiach the whole time: Reb Pesach!',
    'The rav raises a question': 'The rav says: your mashgiach told me his money was taken.',
    'The merchant denies taking it': 'Mr. Weinman says: I did not take it!',
    'The merchant understands': 'If a stranger touched the wine, the wine is not kosher. Mr. Weinman could lose everything.',
    'Returning the money': 'Mr. Weinman admits he took the money and gives it back.',
    'Regret and teshuvah': 'Mr. Weinman cries and is truly sorry. The rav has a clever plan.',
    'Paying for the wedding': 'Mr. Weinman writes a check to pay for the whole wedding.',
    'Good news for Reb Pesach': 'The rav calls Reb Pesach with very good news!',
    'A joyful wedding': 'Gitl gets married, and the whole town comes to dance. Mazel tov!'
  };
 
  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
  ::highlight(ra-phrase){background-color:#ffffff}
  ::highlight(ra-word){background-color:#ffb020;color:#1d1300}
  .para.ra-on.active{background:#fff4c2}
  .ra-tap .para{cursor:pointer}
 
  /* control bar */
  .ra-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%}
  .ra-bar button,.ra-bar select{font:600 15px Arial;padding:7px 11px}
  .ra-bar .ra-play{background:#ddb649;border-color:#ddb649;color:#143e69;min-width:96px;font-size:17px}
  .ra-bar .ra-play:hover{background:#ecc85e}
  .ra-bar .ra-sep{flex:1}
  .ra-bar label{display:flex;gap:6px;align-items:center;font:600 15px Arial;background:#fff;color:#143e69;border:1px solid #bcc8d3;border-radius:8px;padding:6px 10px;cursor:pointer}
  .ra-bar label input{width:17px;height:17px;margin:0}
  .ra-bar label select{padding:3px 6px;border:0}
  .ra-bar .ra-view{background:transparent;color:#fff;border-color:#ffffff66;font-weight:500}
  .ra-bar .ra-step{color:#ffe7a3;font:14px Arial}
  .ra-prog{position:absolute;left:0;right:0;bottom:-4px;height:4px;background:#ddb649}
  .ra-prog i{display:block;height:100%;width:0;background:#7ec8ff}
 
  /* word card */
  .ra-card{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:200;width:min(560px,calc(100vw - 32px));background:#fffdf6;border:3px solid #ddb649;border-radius:14px;box-shadow:0 8px 30px #0004;padding:12px 14px;display:grid;grid-template-columns:1fr auto;gap:8px 12px;align-items:center}
  .ra-card .yi{font:bold 34px 'Times New Roman',serif;direction:rtl;text-align:right}
  .ra-card .en{font:20px Arial;color:#3d372d;grid-column:1/-1}
  .ra-card .btns{display:flex;gap:8px;flex-wrap:wrap;grid-column:1/-1}
  .ra-card .x{grid-row:1;grid-column:2;align-self:start;padding:4px 10px}
 
  /* ---------- book view ---------- */
  body.ra-book{background:#d9cdb4}
  body.ra-book header{position:sticky;padding:8px 16px;gap:16px;align-items:center;border-bottom-width:0}
  body.ra-book header h1{font-size:20px;margin:0;white-space:nowrap}
  body.ra-book header small,body.ra-book header .player{display:none}
  body.ra-book .ra-bar{width:auto;flex:1}
  body.ra-book.ra-open header + p{display:none}
  body.ra-book main{gap:0;padding:14px 22px;max-width:1500px;margin:0 auto;grid-template-columns:1fr 1fr}
  body.ra-book main .card{background:#fffaf0;box-shadow:0 6px 18px #0003;border-radius:0}
  body.ra-book main .card:first-child{border-radius:14px 3px 3px 14px;box-shadow:inset -22px 0 26px -22px #0005,0 6px 18px #0003}
  body.ra-book main .card:last-child{border-radius:3px 14px 14px 3px;box-shadow:inset 22px 0 26px -22px #0005,0 6px 18px #0003}
  body.ra-book main .card:first-child > .bar:first-child,body.ra-book #thumbs,body.ra-book main .hint{display:none}
  body.ra-book .stage{background:transparent;padding:22px 26px 8px}
  body.ra-book .stage svg{border-radius:8px;box-shadow:0 2px 10px #0003}
  body.ra-book .caption{background:transparent;font:bold 24px Georgia,'Times New Roman',serif;color:#3b2a14;padding:6px 26px 0}
  body.ra-book .ra-desc{font:19px/1.45 Arial,sans-serif;color:#4a3d2b;text-align:center;padding:4px 34px 6px;margin:0;text-wrap:balance}
  body.ra-book main .card:first-child .nav{padding:6px 18px 12px}
  body.ra-book main .card:first-child .nav button{background:transparent;border-color:#d8c9a8;color:#6b5126}
  body.ra-book #count{font:14px Georgia,serif;color:#8a7350}
  body.ra-book .textbar{background:transparent;padding:10px 14px 0;justify-content:flex-start}
  body.ra-book .textbar #top,body.ra-book .textbar label{display:none}
  body.ra-book .textbar button{padding:4px 10px;font-size:14px;background:transparent;border-color:#d8c9a8;color:#6b5126}
  body.ra-book .textbar #fontLabel{font:13px Arial;color:#8a7350}
  body.ra-book .vw-legend{padding:6px 16px 0;font-size:12px}
  body.ra-book .transcript{padding:10px 34px 24px}
  body.ra-book .para{border:0;padding:4px 0;margin:0 0 14px;line-height:1.75}
  body.ra-book .para.active,body.ra-book .para.ra-on.active{background:transparent}
  body.ra-book .para.ra-off{display:none}
  @media(max-width:850px){
    body.ra-book main{padding:10px}
    body.ra-book main .card,body.ra-book main .card:first-child,body.ra-book main .card:last-child{border-radius:12px;height:auto;margin-bottom:10px}
    body.ra-book .stage{height:46vh}
    body.ra-book .ra-bar .ra-sep{display:none}
    body.ra-book header{position:static;padding:8px 10px}
    body.ra-book header h1{font-size:18px}
    body.ra-book .ra-bar #full,body.ra-book .ra-bar .ra-step{display:none}
    body.ra-book .ra-bar button,body.ra-book .ra-bar select{padding:6px 9px;font-size:14px}
  }`;
  document.head.append(css);
 
  /* ---------- control bar ---------- */
  const header = document.querySelector('header');
  header.style.position = header.style.position || 'sticky';
  const barEl = document.createElement('div'); barEl.className = 'ra-bar';
  barEl.innerHTML =
    '<button type="button" class="ra-play" id="raPlay">▶ Play</button>' +
    '<button type="button" id="raBack" title="Previous sentence">◀ Back</button>' +
    '<button type="button" id="raAgain" title="Hear this sentence again">Again</button>' +
    '<button type="button" id="raNext" title="Next sentence">Next ▶</button>' +
    '<label><input type="checkbox" id="raStep"> Stop after each sentence</label>' +
    '<span class="ra-sep"></span><span class="ra-step" id="raStepName"></span>' +
    '<button type="button" class="ra-view" id="raView"></button>';
  const prog = document.createElement('div'); prog.className = 'ra-prog'; prog.innerHTML = '<i></i>'; header.append(prog);
  header.insertBefore(barEl, prog);
  const speed = $('speed'); if (speed) { const l = speed.closest('label') || speed; barEl.insertBefore(l, $('raView')); }
  const full = $('full'); if (full) barEl.insertBefore(full, $('raView'));
  const stepBox = $('raStep');
  stepBox.checked = !!settings.step;
  stepBox.onchange = () => { settings.step = stepBox.checked; save(); stopAt = null; };
  document.body.classList.add('ra-tap');
  const playBtn = $('raPlay');
  playBtn.onclick = () => { if (player.paused) { stopAt = null; player.play(); } else player.pause(); };
  const syncPlayBtn = () => { playBtn.textContent = player.paused ? '▶ Play' : '❚❚ Pause'; };
  player.addEventListener('play', syncPlayBtn); player.addEventListener('pause', syncPlayBtn);
  function setView(book) {
    settings.book = book; save();
    document.body.classList.toggle('ra-book', book);
    const playerBox = header.querySelector('.player');
    if (book || !playerBox) header.insertBefore(barEl, prog); else playerBox.append(barEl);
    $('raView').textContent = book ? 'Classic view' : 'Book view';
    updateScene(); setTimeout(fit, 0);
  }
  $('raView').onclick = () => setView(!settings.book);
 
  /* ---------- words of the visible paragraphs ---------- */
  let words = [], phrases = [];
  function collect() {
    words = []; phrases = [];
    document.querySelectorAll('#text .para').forEach(el => {
      if (el.hidden) return;
      const p = +el.id.slice(1), d = W.paras[p];
      if (!d) return;
      el.classList.add('ra-on');
      const starts = d.ph.concat([d.t.length]);
      for (let j = 0; j < starts.length - 1; j++) {
        const first = words.length;
        for (let k = starts[j]; k < starts[j + 1]; k++) {
          const t = d.t[k];
          if (t) words.push({ p, k, s: t[0], e: t[1], ph: phrases.length });
        }
        if (words.length > first) phrases.push({ s: words[first].s, e: words[words.length - 1].e, first, last: words.length - 1 });
      }
    });
    words.sort((a, b) => a.s - b.s);
  }
 
  /* ---------- text ranges (computed fresh, so other scripts may re-wrap the text) ---------- */
  function tokenSpans(el) {
    const txt = el.textContent, out = [], re = /\S+/g; let m;
    while ((m = re.exec(txt))) out.push([m.index, m.index + m[0].length]);
    return out;
  }
  function rangeFor(el, a, b) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, pos = 0, r = document.createRange(), started = false;
    while ((n = walker.nextNode())) {
      const len = n.data.length;
      if (!started && a <= pos + len) { r.setStart(n, a - pos); started = true; }
      if (started && b <= pos + len) { r.setEnd(n, b - pos); return r; }
      pos += len;
    }
    return null;
  }
  function wordRange(w) {
    const el = $('p' + w.p); if (!el) return null;
    const sp = tokenSpans(el)[w.k]; return sp ? rangeFor(el, sp[0], sp[1]) : null;
  }
  function phraseRange(i) {
    const ph = phrases[i]; if (!ph) return null;
    const a = words.find(w => w.ph === i), z = [...words].reverse().find(w => w.ph === i);
    if (!a || !z || a.p !== z.p) return null;
    const el = $('p' + a.p), sp = tokenSpans(el);
    return rangeFor(el, sp[a.k][0], sp[z.k][1]);
  }
 
  /* ---------- sync ---------- */
  let curWord = null, curPh = -1, stopAt = null, raf = 0;
  function wordAt(t) {
    let now = null;
    for (const w of words) { if (w.s <= t + 0.03) now = w; else break; }
    if (now && t > now.e + 0.5) now = null;
    return now;
  }
  function phraseAt(t) {
    let idx = -1;
    for (let i = 0; i < phrases.length; i++) { if (phrases[i].s - 0.12 <= t) idx = i; else break; }
    return idx;
  }
  function paint() {
    if (!HL) return;
    const wr = curWord && wordRange(curWord), pr = curPh >= 0 && phraseRange(curPh);
    const hp = pr ? new Highlight(pr) : new Highlight();
    const hw = wr ? new Highlight(wr) : new Highlight();
    hp.priority = 0; hw.priority = 1;   // the word paints on top of its phrase
    CSS.highlights.set('ra-phrase', hp);
    CSS.highlights.set('ra-word', hw);
    // keep the word being read in view when the page's text is longer than the page
    if (wr && !player.paused) {
      const r = wr.getBoundingClientRect(), b = box.getBoundingClientRect();
      if (r.height && (r.bottom > b.bottom - 30 || r.top < b.top + 10)) box.scrollTop += r.top - b.top - b.height * 0.3;
    }
  }
  function tick() {
    const t = player.currentTime;
    if (stopAt !== null && t >= stopAt) { stopAt = null; player.pause(); }
    else if (settings.step && !player.paused && stopAt === null) {
      const i = phraseAt(t);
      if (i >= 0 && t < phrases[i].e) stopAt = phrases[i].e + 0.15;
    }
    const w = wordAt(t), ph = phraseAt(t);
    if (w !== curWord || ph !== curPh) {
      curWord = w; curPh = ph; paint();
      if (w && settings.book) showParaPage(w.p);
    }
    if (words.length) {
      const a = words[0].s, z = words[words.length - 1].e;
      prog.firstChild.style.width = Math.max(0, Math.min(100, 100 * (t - a) / (z - a))) + '%';
    }
    raf = player.paused ? 0 : requestAnimationFrame(tick);
  }
  player.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); });
  player.addEventListener('pause', tick);
  player.addEventListener('seeked', () => { stopAt = null; tick(); });
 
  function playPhrase(i) {
    if (!phrases.length) return;
    i = Math.max(0, Math.min(phrases.length - 1, i));
    curPh = i;
    player.currentTime = Math.max(0, phrases[i].s - 0.1);
    stopAt = settings.step ? phrases[i].e + 0.15 : null;
    player.play();
  }
  const here = () => { const i = phraseAt(player.currentTime); return i < 0 ? 0 : i; };
  $('raAgain').onclick = () => playPhrase(here());
  $('raNext').onclick = () => {
    const t = player.currentTime, i = phraseAt(t);
    playPhrase(i < 0 ? 0 : (t < phrases[i].s + 0.2 && player.paused ? i : i + 1));
  };
  $('raBack').onclick = () => playPhrase(here() - 1);
 
  /* ---------- tap a word ---------- */
  let card = null;
  const AUD = 'עולם';   // "audience:" stage direction
  const bareYi = s => s.normalize('NFD').replace(/ײ/g, 'יי').replace(/װ/g, 'וו').replace(/[^א-ת]/g, '');
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); return c && { node: c.offsetNode, off: c.offset }; }
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r && { node: r.startContainer, off: r.startOffset }; }
    return null;
  }
  function tokenAtPoint(el, x, y) {
    const c = caretAt(x, y); if (!c || !el.contains(c.node) || c.node.nodeType !== 3) return -1;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, pos = 0;
    while ((n = walker.nextNode())) { if (n === c.node) break; pos += n.data.length; }
    const at = pos + c.off, sp = tokenSpans(el);
    for (let k = 0; k < sp.length; k++) if (at >= sp[k][0] && at <= sp[k][1]) {
      const r = rangeFor(el, sp[k][0], sp[k][1]);   // make sure the click landed on the word, not the gap after it
      if (r && [...r.getClientRects()].some(b => x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2)) return k;
      return -1;
    }
    return -1;
  }
  function playWord(w) { player.currentTime = Math.max(0, w.s - 0.04); stopAt = w.e + 0.08; player.play(); }
  function showCard(w, token, el) {
    if (card) card.remove();
    const vocab = [...el.querySelectorAll('.vw')].find(v => token.includes(v.textContent));
    const en = (vocab && vocab.title) || W.gloss[bareYi(token.replace(AUD, ''))] || 'Listen again and guess from the story!';
    card = document.createElement('div'); card.className = 'ra-card'; card.setAttribute('role', 'dialog');
    const yi = document.createElement('div'); yi.className = 'yi'; yi.textContent = token.replace(new RegExp('^\\(' + AUD + ':?'), '').replace(/[\\.,?!:;()"]+/g, '');
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Close'); x.onclick = () => { card.remove(); card = null; };
    const e = document.createElement('div'); e.className = 'en'; e.textContent = en;
    const b = document.createElement('div'); b.className = 'btns';
    const hear = document.createElement('button'); hear.textContent = 'Hear it again'; hear.onclick = () => playWord(w);
    const from = document.createElement('button'); from.textContent = 'Read from here';
    from.onclick = () => { card.remove(); card = null; player.currentTime = Math.max(0, w.s - 0.05); stopAt = settings.step ? phrases[w.ph].e + 0.15 : null; player.play(); };
    b.append(hear, from); card.append(yi, x, e, b); document.body.append(card);
  }
  box.addEventListener('click', ev => {
    const el = ev.target.closest('.para'); if (!el || !el.classList.contains('ra-on')) return;
    const k = tokenAtPoint(el, ev.clientX, ev.clientY); if (k < 0) return;
    const p = +el.id.slice(1), w = words.find(x => x.p === p && x.k === k); if (!w) return;
    ev.stopPropagation(); ev.preventDefault();   // keep the paragraph's own click (jump to its start) from firing
    showCard(w, el.textContent.slice(...tokenSpans(el)[k]), el);
    playWord(w);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && card) { card.remove(); card = null; }
    if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON|AUDIO/.test(e.target.tagName)) { e.preventDefault(); playBtn.click(); }
  });
 
  /* ---------- book pages: one picture + its paragraphs ---------- */
  // reader.js keeps `defs` (pictures), `state.order` and `pos` (current picture) as page globals.
  const G = name => { try { return Function('return typeof ' + name + ' === "undefined" ? undefined : ' + name)(); } catch (e) { return undefined; } };
  function pageStarts() {
    const defs = G('defs'), state = G('state');
    if (!defs || !state) return [];
    return state.order.map(id => defs[id][2]);
  }
  const visibleParas = () => [...document.querySelectorAll('#text .para')].filter(el => !el.hidden && el.textContent.trim());
  function pageRange() {
    const starts = pageStarts(), pos = G('pos') || 0, vis = visibleParas();
    if (!vis.length) return null;
    const firstP = +vis[0].id.slice(1), lastP = +vis[vis.length - 1].id.slice(1);
    const from = pos === 0 ? firstP : Math.max(firstP, starts[pos]);
    const next = starts.slice(pos + 1).filter(s => s > from).sort((a, b) => a - b)[0];
    return { from, to: next === undefined ? lastP : Math.min(lastP, next - 1) };
  }
  let descEl = null;
  function updateScene() {
    const vis = visibleParas(), r = settings.book && pageRange();
    vis.forEach(el => { const p = +el.id.slice(1); el.classList.toggle('ra-off', !!r && (p < r.from || p > r.to)); });
    if (!descEl) { descEl = document.createElement('p'); descEl.className = 'ra-desc'; const cap = $('caption'); if (cap) cap.after(descEl); }
    const title = ($('caption') || {}).textContent || '';
    descEl.textContent = SCENE_TEXT[title] || '';
    descEl.hidden = !settings.book || !descEl.textContent;
    box.scrollTop = 0;
    if (curWord || curPh >= 0) paint();
  }
  // turn to the page that holds paragraph p (when the reading moves there)
  function showParaPage(p) {
    const r = pageRange(); if (!r || (p >= r.from && p <= r.to)) return;
    const starts = pageStarts(); let j = 0;
    starts.forEach((s, i) => { if (s <= p) j = i; });
    const nextBtn = $('next'), prevBtn = $('prev'), pos = G('pos') || 0;
    if (j > pos && nextBtn) for (let n = pos; n < j; n++) nextBtn.click();
    else if (j < pos && prevBtn) for (let n = pos; n > j; n--) prevBtn.click();
  }
  // a page turned by the reader (audio sync, Previous/Next, arrow keys): show that page's text;
  // if it was turned by hand while paused, start the audio there next time Play is pressed.
  const cap = $('caption');
  if (cap) new MutationObserver(() => {
    updateScene();
    if (player.paused && words.length) {
      const r = pageRange(); if (!r) return;
      const nowW = wordAt(player.currentTime), inPage = nowW && nowW.p >= r.from && nowW.p <= r.to;
      const first = words.find(w => w.p >= r.from && w.p <= r.to);
      if (!inPage && first) player.currentTime = Math.max(0, first.s - 0.1);
    }
  }).observe(cap, { childList: true, characterData: true, subtree: true });
 
  /* ---------- layout: fit the book into the window ---------- */
  const main = document.querySelector('main');
  const BOTTOM_GAP = 60;   // room for the floating "Fun Torah Tools" / "Add to Gallery" buttons
  function fit() {
    const notice = document.querySelector('header + p');
    if (notice) {
      notice.style.padding = '8px 18px'; notice.style.fontSize = '16px'; notice.style.margin = '0';
      const m = notice.textContent.match(/^Steps? [\d–\-]+/); $('raStepName').textContent = m ? m[0] : '';
    }
    if (!main || main.hidden) return;
    if (innerWidth <= 850) { main.style.height = ''; return; }   // phones and tablets stack and scroll
    const top = main.getBoundingClientRect().top + scrollY;
    main.style.height = Math.max(420, innerHeight - top - BOTTOM_GAP) + 'px';
    main.style.minHeight = '0';
  }
  addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(header);
 
  /* ---------- start once the reader has opened the section ---------- */
  function ready() {
    document.body.classList.add('ra-open');
    const follow = $('follow'); if (follow) follow.checked = true;
    setView(!!settings.book);
    collect(); curWord = null; curPh = -1; tick(); fit();
    document.querySelectorAll('.hint').forEach(h => {
      for (const n of h.childNodes) if (n.nodeType === 3 && /Click a paragraph/.test(n.data)) n.data = 'Original wording preserved. Tap any word to hear it and see what it means. ';
    });
  }
  // the reader hides the story again if the teacher closes access
  if (main) new MutationObserver(() => document.body.classList.toggle('ra-open', !main.hidden)).observe(main, { attributes: true, attributeFilter: ['hidden'] });
  if (main && main.hidden) {
    const mo = new MutationObserver(() => { if (!main.hidden) { mo.disconnect(); setTimeout(ready, 300); } });
    mo.observe(main, { attributes: true, attributeFilter: ['hidden'] });
  } else setTimeout(ready, 300);
})();
 