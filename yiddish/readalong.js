/* Read-along add-on for the Yiddish story reader.
   - Lights up each word as it is spoken (and the phrase around it).
   - "One phrase at a time": the audio pauses at the end of each phrase; Play continues.
   - Tap a word: hear just that word, see its meaning, or read on from there.
   Needs word-times.js (window.YIDDISH_WORD_TIMES). Load after reader.js. Changes nothing in the page's text. */
(() => {
  const W = window.YIDDISH_WORD_TIMES;
  const player = document.getElementById('audio');
  const box = document.getElementById('text');
  if (!W || !player || !box) return;
  const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  const SETTINGS_KEY = 'yiddish-readalong-v1';
  let settings = { step: true };
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) {}
  const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} };

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
  ::highlight(ra-phrase){background-color:#ffffff}
  ::highlight(ra-word){background-color:#ffb020;color:#1d1300}
  .para.ra-on.active{background:#fff4c2}
  .ra-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .ra-tools label{display:flex;gap:6px;align-items:center;font:600 16px Arial;background:#fff;color:#143e69;border:1px solid #bcc8d3;border-radius:8px;padding:8px 12px;cursor:pointer}
  .ra-tools input{width:18px;height:18px;margin:0}
  .ra-card{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:200;width:min(560px,calc(100vw - 32px));background:#fffdf6;border:3px solid #ddb649;border-radius:14px;box-shadow:0 8px 30px #0004;padding:12px 14px;display:grid;grid-template-columns:1fr auto;gap:8px 12px;align-items:center}
  .ra-card .yi{font:bold 34px 'Times New Roman',serif;direction:rtl;text-align:right}
  .ra-card .en{font:20px Arial;color:#3d372d;grid-column:1/-1}
  .ra-card .btns{display:flex;gap:8px;flex-wrap:wrap;grid-column:1/-1}
  .ra-card .x{grid-row:1;grid-column:2;align-self:start;padding:4px 10px}
  .ra-tap .para{cursor:pointer}`;
  document.head.append(css);

  /* ---------- toolbar (next to Speed / Back 10 sec) ---------- */
  const bar = document.querySelector('header .bar') || document.querySelector('.bar');
  const tools = document.createElement('div'); tools.className = 'ra-tools';
  tools.innerHTML = '<button type="button" id="raBack">\u25C0 Back</button><button type="button" id="raAgain">Again</button><button type="button" id="raNext">Next \u25B6</button><label><input type="checkbox" id="raStep"> Stop after each sentence</label>';
  bar.append(tools);
  const stepBox = document.getElementById('raStep');
  stepBox.checked = !!settings.step;
  stepBox.onchange = () => { settings.step = stepBox.checked; save(); stopAt = null; };
  document.body.classList.add('ra-tap');

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

  /* ---------- text ranges ---------- */
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
    const el = document.getElementById('p' + w.p); if (!el) return null;
    const sp = tokenSpans(el)[w.k]; return sp ? rangeFor(el, sp[0], sp[1]) : null;
  }
  function phraseRange(i) {
    const ph = phrases[i]; if (!ph) return null;
    const a = words.find(w => w.ph === i), z = [...words].reverse().find(w => w.ph === i);
    if (!a || !z || a.p !== z.p) return null;
    const el = document.getElementById('p' + a.p), sp = tokenSpans(el);
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
    hp.priority = 0; hw.priority = 1;
    CSS.highlights.set('ra-phrase', hp);
    CSS.highlights.set('ra-word', hw);
  }
  function tick() {
    const t = player.currentTime;
    if (stopAt !== null && t >= stopAt) { stopAt = null; player.pause(); }
    else if (settings.step && !player.paused && stopAt === null) {
      const i = phraseAt(t);
      if (i >= 0 && t < phrases[i].e) stopAt = phrases[i].e + 0.15;
    }
    const w = wordAt(t), ph = phraseAt(t);
    if (w !== curWord || ph !== curPh) { curWord = w; curPh = ph; paint(); }
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
  document.getElementById('raAgain').onclick = () => playPhrase(here());
  document.getElementById('raNext').onclick = () => {
    const t = player.currentTime, i = phraseAt(t);
    playPhrase(i < 0 ? 0 : (t < phrases[i].s + 0.2 && player.paused ? i : i + 1));
  };
  document.getElementById('raBack').onclick = () => playPhrase(here() - 1);

  /* ---------- tap a word ---------- */
  let card = null;
  const bareYi = s => s.normalize('NFD').replace(/\u05F2/g, '\u05D9\u05D9').replace(/\u05F0/g, '\u05D5\u05D5').replace(/[^\u05D0-\u05EA]/g, '');
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
      const r = rangeFor(el, sp[k][0], sp[k][1]);
      if (r && [...r.getClientRects()].some(b => x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2)) return k;
      return -1;
    }
    return -1;
  }
  function playWord(w) { player.currentTime = Math.max(0, w.s - 0.04); stopAt = w.e + 0.08; player.play(); }
  function showCard(w, token, el) {
    if (card) card.remove();
    const vocab = [...el.querySelectorAll('.vw')].find(v => token.includes(v.textContent));
    const AUD = '\u05E2\u05D5\u05DC\u05DD';
    const en = (vocab && vocab.title) || W.gloss[bareYi(token.replace(AUD, ''))] || 'Listen again and guess from the story!';
    card = document.createElement('div'); card.className = 'ra-card'; card.setAttribute('role', 'dialog');
    const yi = document.createElement('div'); yi.className = 'yi'; yi.textContent = token.replace(new RegExp('^\\(' + AUD + ':?'), '').replace(/[\\.,?!:;()"]+/g, '');
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '\u00D7'; x.setAttribute('aria-label', 'Close'); x.onclick = () => { card.remove(); card = null; };
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
    ev.stopPropagation(); ev.preventDefault();
    showCard(w, el.textContent.slice(...tokenSpans(el)[k]), el);
    playWord(w);
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && card) { card.remove(); card = null; } });

  /* ---------- layout: fit the picture and text cards into the window ---------- */
  const main = document.querySelector('main');
  const BOTTOM_GAP = 64;
  function fit() {
    const notice = document.querySelector('header + p');
    if (notice) { notice.style.padding = '8px 18px'; notice.style.fontSize = '16px'; notice.style.margin = '0'; }
    if (!main || main.hidden) return;
    if (innerWidth <= 850) { main.style.height = ''; return; }
    const top = main.getBoundingClientRect().top + scrollY;
    main.style.height = Math.max(420, innerHeight - top - BOTTOM_GAP) + 'px';
    main.style.minHeight = '0';
  }
  addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.querySelector('header'));

  /* ---------- start once the reader has opened the section ---------- */
  function ready() {
    fit(); collect(); curWord = null; curPh = -1; tick();
    document.querySelectorAll('.hint').forEach(h => {
      for (const n of h.childNodes) if (n.nodeType === 3 && /Click a paragraph/.test(n.data)) n.data = 'Original wording preserved. Tap any word to hear it and see what it means. ';
    });
  }
  if (main && main.hidden) {
    const mo = new MutationObserver(() => { if (!main.hidden) { mo.disconnect(); setTimeout(ready, 300); } });
    mo.observe(main, { attributes: true, attributeFilter: ['hidden'] });
  } else setTimeout(ready, 300);
})();