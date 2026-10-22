/* Halacha -> Class Gallery.
   Students send their finished lesson work through the authenticated
   classGallerySubmit Cloud Function (the same API used by gallery-share.js).
   The server verifies the student's name, individual passcode and class,
   chooses the ET/WT or class gallery, stores the picture and creates a
   *pending* post for teacher approval.
   This file never writes to the database and never changes saved student work:
   it only reads what is on the page to build one picture. */
(() => {
  'use strict';
  const ENDPOINT = 'https://us-central1-b3-games.cloudfunctions.net/classGallerySubmit';
  const MAX_IMAGE_BYTES = 860 * 1024;   // server limit is 900 KiB
  const OUTPUT_WIDTH = 1200;
  const PAD = 24;
  const teacherPreview = typeof HALACHA_TEACHER_PREVIEW !== 'undefined' && !!HALACHA_TEACHER_PREVIEW;

  // ---------- Identity (verified again by the server) ----------
  function readSession(key) { try { return String(sessionStorage.getItem(key) || '').trim(); } catch (_) { return ''; } }
  function isGuest() {
    try { return !!(window.B3Guest && window.B3Guest.isGuest && window.B3Guest.isGuest()) || sessionStorage.getItem('b3Games_guest') === '1'; }
    catch (_) { return false; }
  }
  function credentials() {
    if (teacherPreview || isGuest()) return null;
    const pageStudent = typeof HALACHA_STUDENT_ID !== 'undefined' ? String(HALACHA_STUDENT_ID || '') : '';
    const studentId = readSession('b3Games_studentId');
    // The work on screen must belong to the signed-in student we send as.
    if (!studentId || (pageStudent && pageStudent !== studentId)) return null;
    const studentName = readSession('b3Games_studentName');
    const classId = readSession('b3Games_studentClass');
    const pin = readSession('b3Games_classPin');
    if (!studentName || !classId || !pin) return null;
    return { studentId, studentName, classId, pin };
  }

  // ---------- Capture helpers (read-only) ----------
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('A picture on this page could not be read.'));
      image.src = src;
    });
  }
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function hasInk(canvas) {
    try {
      const probe = canvasOf(Math.min(160, canvas.width), Math.min(160, canvas.height));
      const ctx = probe.getContext('2d');
      ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) return true;
    } catch (_) {}
    return false;
  }
  async function ensureHtml2canvas() {
    if (typeof window.html2canvas === 'function') return;
    if (typeof loadScriptOnce === 'function') {
      await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    } else {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'html2canvas.min.js?v=1.4.1'; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    if (typeof window.html2canvas !== 'function') throw new Error('The picture tool did not load. Please check your internet connection and try again.');
  }

  // The coloring picture the student sees now (Siman Alef classroom or picture study).
  async function coloringPicture(section) {
    if (section.classList.contains('ha-new')) {
      const art = section.querySelector('.ha-classroom canvas');
      if (art && art.dataset.ready === 'true' && art.width > 1) {
        const copy = canvasOf(art.width, art.height);
        const ctx = copy.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, copy.width, copy.height);
        ctx.drawImage(art, 0, 0);
        return copy;
      }
      return null;
    }
    const study = section.querySelector('.hal-sefer-study');
    const svg = study && study.querySelector('.hal-sefer-picture svg');
    if (!svg) return null;
    const ink = study.querySelector('.hal-sefer-ink');
    const copy = svg.cloneNode(true);
    copy.removeAttribute('role');
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', '1240'); copy.setAttribute('height', '760');
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    try {
      const image = await loadImage(url);
      const out = canvasOf(1240, 760);
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(image, 0, 0, out.width, out.height);
      if (ink) ctx.drawImage(ink, 0, 0, out.width, out.height);
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  // Both scrapbook pages: pieces, artwork, photos, text boxes and drawings.
  // The guided lessons hide the legacy scrapbook, so it is shown off-screen
  // only for the moment it takes to photograph it, then hidden again.
  function scrapbookHasWork(section, id) {
    if (section.querySelector('.spread .page .canvas .scrap')) return true;
    const drawings = (typeof S !== 'undefined' && S && Array.isArray(S[id + '_draw'])) ? S[id + '_draw'] : [];
    return drawings.some(src => typeof src === 'string' && src.startsWith('data:image/') && src.length > 200);
  }
  async function scrapbookPages(section, id) {
    const pages = [...section.querySelectorAll('.spread .page')].slice(0, 2);
    if (pages.length < 2 || !scrapbookHasWork(section, id)) return null;
    await ensureHtml2canvas();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    section.classList.add('ftt-gallery-capture');
    try {
      await nextFrame();
      const shots = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const w = page.offsetWidth, h = page.offsetHeight;
        if (!w || !h) throw new Error('Your scrapbook pages could not be prepared. Please try again.');
        const shot = await window.html2canvas(page, {
          scale: 1, useCORS: true, logging: false, backgroundColor: '#ffffff',
          ignoreElements: el => !!(el.classList && (el.classList.contains('draw-layer') || el.classList.contains('page-tools') ||
            el.classList.contains('mini') || el.classList.contains('resize-handle') || el.classList.contains('tb-move') ||
            el.classList.contains('studio-draw-rail') || el.classList.contains('studio-page-label'))),
          onclone(doc) {
            doc.body.classList.add('exporting');
            doc.querySelectorAll('.scrap.selected').forEach(el => el.classList.remove('selected'));
          }
        });
        const saved = (typeof S !== 'undefined' && S && Array.isArray(S[id + '_draw'])) ? S[id + '_draw'][i] : '';
        const live = page.querySelector('.draw-layer');
        let drawing = null;
        if (live && live.width && live._w && hasInk(live)) drawing = live;
        else if (typeof saved === 'string' && saved.startsWith('data:image/')) drawing = await loadImage(saved).catch(() => null);
        if (drawing) {
          const ctx = shot.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0); // html2canvas leaves its own offset on this context
          ctx.drawImage(drawing, 0, 0, shot.width, shot.height);
        }
        shots.push(shot);
      }
      const gap = 16, height = Math.max(...shots.map(s => s.height));
      const spread = canvasOf(shots.reduce((a, s) => a + s.width, 0) + gap, height);
      const ctx = spread.getContext('2d');
      ctx.fillStyle = '#e0e8f3'; ctx.fillRect(0, 0, spread.width, spread.height);
      // Keep the page order the scrapbook itself uses.
      const order = document.documentElement.dir === 'rtl' ? shots.slice().reverse() : shots;
      let x = 0;
      for (const s of order) { ctx.drawImage(s, x, 0); x += s.width + gap; }
      return spread;
    } finally {
      section.classList.remove('ftt-gallery-capture');
    }
  }

  function label(ctx, text, y) {
    ctx.fillStyle = '#173b62';
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(text, PAD, y);
    return y + 38;
  }
  function compose(parts) {
    const inner = OUTPUT_WIDTH - PAD * 2;
    const scaled = parts.map(p => ({ ...p, h: Math.round(p.canvas.height * inner / p.canvas.width) }));
    const height = PAD + scaled.reduce((a, p) => a + 38 + p.h + PAD, 0);
    const out = canvasOf(OUTPUT_WIDTH, height);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, out.width, out.height);
    let y = PAD;
    for (const p of scaled) {
      y = label(ctx, p.label, y);
      ctx.drawImage(p.canvas, PAD, y, inner, p.h);
      y += p.h + PAD;
    }
    return out;
  }

  async function buildLessonPicture(id) {
    const section = document.getElementById(id);
    if (!section) throw new Error('Open a Halacha lesson first.');
    if (typeof closeCustomizer === 'function') { try { closeCustomizer(); } catch (_) {} }
    const parts = [];
    const picture = await coloringPicture(section);
    if (picture) parts.push({ label: 'My colored picture', canvas: picture });
    const pages = await scrapbookPages(section, id);
    if (pages) parts.push({ label: 'My scrapbook — both pages', canvas: pages });
    if (!parts.length) throw new Error('There is no work on this lesson yet. Color the picture first, then send it.');
    return compose(parts);
  }

  function encode(canvas) {
    let source = canvas;
    for (let shrink = 0; shrink < 5; shrink++) {
      for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54, 0.46]) {
        const data = source.toDataURL('image/jpeg', quality);
        const bytes = Math.floor((data.length - data.indexOf(',') - 1) * 3 / 4);
        if (data.startsWith('data:image/jpeg;base64,') && bytes <= MAX_IMAGE_BYTES) return data;
      }
      const smaller = canvasOf(source.width * 0.8, source.height * 0.8);
      smaller.getContext('2d').drawImage(source, 0, 0, smaller.width, smaller.height);
      source = smaller;
    }
    throw new Error('Your pages are too large to send. Please try again.');
  }

  function currentLessonId() {
    const section = document.querySelector('#sections > .section.on');
    return section && typeof lessons !== 'undefined' && lessons.some(l => l.id === section.id) ? section.id : '';
  }

  // The site-wide "Add to Gallery" button uses this hook, so it sends the
  // same complete lesson picture instead of a screenshot of the window.
  window.FTTGalleryCaptureImage = async () => {
    const id = currentLessonId();
    if (!id) throw new Error('Open a Halacha lesson first, then tap Add to Gallery.');
    return buildLessonPicture(id);
  };

  // ---------- Dialog ----------
  const style = document.createElement('style');
  style.textContent = [
    '#sections>.section.ftt-gallery-capture>.work.work{display:block!important;position:fixed!important;left:-20000px!important;top:0!important;width:1400px!important;visibility:visible!important;pointer-events:none!important;z-index:-1!important}',
    '#sections>.section.ftt-gallery-capture>.work>.side{display:none!important}',
    '#sections>.section.ftt-gallery-capture>.work .spread{display:grid!important;grid-template-columns:1fr 1fr!important;gap:16px!important}',
    '.halacha-gallery-button{padding:9px 14px;border:0;border-radius:10px;background:#166b50;color:#fff;font-weight:800;cursor:pointer;font-size:14px}',
    '.halacha-gallery-button:focus-visible{outline:3px solid #facc15;outline-offset:2px}',
    '.side>.halacha-gallery-button{width:100%;margin-bottom:10px}',
    '.teacherMode .halacha-gallery-button,body.exporting .halacha-gallery-button{display:none!important}',
    '#halachaGalleryDialog{max-width:680px;width:calc(100vw - 24px);box-sizing:border-box;border:0;border-radius:16px;padding:20px;font:15px/1.45 Arial,sans-serif;color:#1f2937}',
    '#halachaGalleryDialog::backdrop{background:#0009}',
    '#halachaGalleryDialog h2{margin:0 0 6px;font-size:22px}',
    '#halachaGalleryDialog img{display:block;width:100%;max-height:48vh;object-fit:contain;background:#f3f4f6;border:1px solid #ddd;border-radius:9px}',
    '#halachaGalleryDialog img:not([src]){display:none}',
    '#halachaGalleryDialog label{display:block;margin:10px 0;font-weight:700}',
    '#halachaGalleryDialog input,#halachaGalleryDialog textarea{display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:4px;font:15px Arial,sans-serif;border:1px solid #aeb8c5;border-radius:7px}',
    '#halachaGalleryDialog [role=status]{min-height:22px;font-weight:700;color:#17694f}',
    '#halachaGalleryDialog [role=status].error{color:#b42318}',
    '#halachaGalleryDialog .actions{display:flex;gap:10px;flex-wrap:wrap}',
    '#halachaGalleryDialog .actions button{border:0;border-radius:9px;padding:11px 16px;font-weight:700;cursor:pointer;background:#e5e7eb;color:#17202d}',
    '#halachaGalleryDialog .actions button[data-send]{background:#166b50;color:#fff}',
    '#halachaGalleryDialog .actions button:disabled{opacity:.5;cursor:default}'
  ].join('');
  document.head.appendChild(style);

  const dialog = document.createElement('dialog');
  dialog.id = 'halachaGalleryDialog';
  dialog.setAttribute('aria-labelledby', 'halachaGalleryHeading');
  dialog.innerHTML = '<h2 id="halachaGalleryHeading">🖼️ Send to Class Gallery</h2>' +
    '<p>Your colored picture and both scrapbook pages will be sent to your Rebbi. Nothing appears in the gallery until your Rebbi approves it.</p>' +
    '<img alt="Preview of the Halacha work you are sending">' +
    '<label>Title<input id="halachaGalleryTitle" maxlength="70" autocomplete="off"></label>' +
    '<label>Tell us about your work (optional)<textarea id="halachaGalleryNote" maxlength="240" rows="2"></textarea></label>' +
    '<p role="status" aria-live="polite"></p>' +
    '<div class="actions"><button type="button" data-send disabled>Send for Approval</button><button type="button" data-close>Cancel</button></div>';
  document.body.appendChild(dialog);
  const statusEl = dialog.querySelector('[role=status]');
  const preview = dialog.querySelector('img');
  const titleInput = dialog.querySelector('#halachaGalleryTitle');
  const noteInput = dialog.querySelector('#halachaGalleryNote');
  const send = dialog.querySelector('[data-send]');
  const cancel = dialog.querySelector('[data-close]');
  let draft = null, busy = false;

  function setStatus(message, error = false) { statusEl.textContent = message; statusEl.classList.toggle('error', !!error); }
  cancel.onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { draft = null; preview.removeAttribute('src'); });

  function friendlyError(status, serverMessage) {
    const msg = String(serverMessage || '').trim();
    if (status === 401) return 'Your name and passcode could not be checked. Please sign in again from the Fun Torah Tools home page, then try again. Your work is still saved.';
    if (status === 403) return (msg || 'Your class could not be checked.') + ' Please sign in again from the Fun Torah Tools home page. Your work is still saved.';
    if (status === 429) return 'You just sent something. Please wait a minute, then try again.';
    if (status === 413) return 'Your pages are too large to send. Please try again.';
    if (status === 400 && msg) return msg;
    return 'The Class Gallery could not save your work right now. Please try again in a few minutes. Your work is still saved.';
  }

  async function prepare(id) {
    if (busy) return;
    busy = true; draft = null; send.disabled = true; cancel.disabled = true; cancel.textContent = 'Cancel';
    preview.removeAttribute('src');
    const lesson = typeof lessons !== 'undefined' ? lessons.find(l => l.id === id) : null;
    titleInput.value = ('Halacha — ' + (lesson ? lesson.title : 'My lesson')).slice(0, 70);
    noteInput.value = '';
    if (!dialog.open) dialog.showModal();
    setStatus('Preparing your picture…');
    try {
      if (isGuest()) throw new Error('Guest preview cannot send to the Class Gallery. Sign in as a student first.');
      if (!credentials()) throw new Error('Please sign in as a student from the Fun Torah Tools home page first.');
      const image = encode(await buildLessonPicture(id));
      draft = { image, lessonId: id };
      preview.src = image;
      setStatus('Check your picture, then send it to your Rebbi.');
      send.disabled = false;
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Could not prepare your picture. Please try again.', true);
    } finally { busy = false; cancel.disabled = false; }
  }

  send.onclick = async () => {
    if (!draft || busy) return;
    const title = titleInput.value.trim();
    if (!title) { setStatus('Please enter a title.', true); titleInput.focus(); return; }
    const cred = credentials();
    if (!cred) { setStatus('Please sign in again from the Fun Torah Tools home page. Your work is still saved.', true); return; }
    busy = true; send.disabled = true; cancel.disabled = true;
    setStatus('Sending to your Rebbi…');
    try {
      let response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
          body: JSON.stringify({ ...cred, title, description: noteInput.value.trim(), source: 'halacha', image: draft.image })
        });
      } catch (_) {
        throw new Error('Could not reach the Class Gallery. Check your internet connection and try again. Your work is still saved.');
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(friendlyError(response.status, result.error));
      draft = null;
      setStatus('✓ Sent! Your Rebbi will review your work before it appears in the Class Gallery.');
      cancel.textContent = 'Done';
    } catch (error) {
      setStatus(error.message || friendlyError(0), true);
      send.disabled = false;
    } finally { busy = false; cancel.disabled = false; }
  };

  // ---------- Buttons in each lesson ----------
  function addButton(host, id, asFirst) {
    if (!host || host.querySelector(':scope > .halacha-gallery-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'halacha-gallery-button';
    button.textContent = '🖼️ Send to Class Gallery';
    button.onclick = () => prepare(id);
    if (asFirst) host.prepend(button); else host.appendChild(button);
  }
  function installButtons() {
    if (teacherPreview) return;
    document.querySelectorAll('#sections > .section').forEach(section => {
      const id = section.id;
      if (!id) return;
      // First in the row: the bottom-right corner is covered by the Audio Mode pill.
      addButton(section.querySelector('.ha-classroom .ha-buttons'), id, true);
      addButton(section.querySelector('.hal-sefer-study .hal-sefer-buttons'), id, false);
      addButton(section.querySelector('.work > .side'), id, true);
    });
  }
  const sections = document.getElementById('sections');
  let installQueued = false;
  const queueInstall = () => {
    if (installQueued) return;
    installQueued = true;
    requestAnimationFrame(() => { installQueued = false; installButtons(); });
  };
  if (sections) new MutationObserver(queueInstall).observe(sections, { childList: true, subtree: true });
  installButtons();
})();
