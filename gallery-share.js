/* Site-wide, student-only screenshot pinning. The Firebase HTTPS function
   verifies the student's PIN and class; this client never writes gallery posts. */
(() => {
  'use strict';
  if (window.__fttGalleryShare) return;
  // Gallery submission is not deployed to staging; never probe the production endpoint there.
  if (window.B3_STAGING_FIREBASE_CONFIG?.projectId === 'fun-torah-tools-staging') return;
  window.__fttGalleryShare = true;
  const root = new URL('.', document.currentScript?.src || location.href);
  const endpoint = 'https://us-central1-b3-games.cloudfunctions.net/classGallerySubmit';
  const excluded = /\/(?:class-gallery|admin|owner-admin|teacher-home|student-report|sync-to-nigri)(?:\/|\.html|$)/i;
  if (excluded.test(location.pathname) || /(?:^|[/-])teacher(?:[/.?]|$)/i.test(location.pathname)) return;
  const params = new URLSearchParams(location.search);
  if (['previewStudentId','teacherPreview','teacher_preview'].some(key => params.has(key))) return;

  let ready = false, checking = false, busy = false, image = null, dialog = null, nextReadyCheck = 0;
  const source = (() => {
    const p = location.pathname.toLowerCase();
    if (p.includes('sefer-hamitzvos')) return 'sefer-hamitzvos';
    if (p.includes('shorashim')) return 'shorashim';
    if (p.includes('halacha')) return 'halacha';
    if (p.includes('class-pointer')) return 'class-pointer';
    if (p.includes('record_pesukim')) return 'posuk-practice';
    if (p.includes('chazara')) return 'chazara';
    if (p.includes('yiddish')) return 'yiddish';
    if (p.includes('rashi')) return 'rashi';
    if (p.includes('chumash')) return 'chumash';
    return 'other';
  })();
  // Some older activities store their student identity under the Posuk Practice
  // keys. A student may also sign in after this script first starts.
  const studentContext = () => {
    try {
      if (window.B3Guest?.isGuest?.() || sessionStorage.getItem('b3Games_guest') === '1') return null;
      if (document.body?.classList.contains('teacherMode')) return null;
      const studentId = sessionStorage.getItem('b3Games_studentId') ||
        sessionStorage.getItem('posukPractice_studentId') || '';
      const studentName = sessionStorage.getItem('b3Games_studentName') ||
        sessionStorage.getItem('posukPractice_studentName') || '';
      const classId = sessionStorage.getItem('b3Games_studentClass') ||
        sessionStorage.getItem('weeklyQuiz_classId') || '';
      if (!studentId || !studentName) return null;
      return {studentId, studentName, classId, pin:sessionStorage.getItem('b3Games_classPin') || ''};
    } catch (_) { return null; }
  };
  const credentials = () => {
    const context = studentContext();
    return context?.classId && context.pin ? context : null;
  };

  const css = document.createElement('style');
  css.textContent = `
    #fttGalleryShareButton{position:fixed;right:18px;bottom:18px;z-index:2147479000;
      background:#1d5979;color:#fff;border:2px solid #fff;border-radius:999px;
      padding:12px 17px;box-shadow:0 5px 20px #0004;font:700 14px Arial,sans-serif;
      cursor:pointer}
    /* Keep Audio Mode at bottom-right; show the Gallery pin at bottom-left. */
    body:has(#ftt-audio-mode) #fttGalleryShareButton{bottom:18px;right:auto;left:18px}
    #fttGalleryShareButton:focus-visible{outline:3px solid #facc15}
    #fttGalleryShareDialog{width:min(580px,calc(100vw - 24px));max-height:92vh;
      overflow:auto;box-sizing:border-box;border:0;border-radius:16px;padding:23px;
      background:#fff;color:#1f2937;font:15px/1.45 Arial,sans-serif;
      box-shadow:0 10px 60px #0006;z-index:2147479100}
    #fttGalleryShareDialog::backdrop{background:#0009}
    #fttGalleryShareDialog h2{font-size:22px;margin:0 0 6px}
    #fttGalleryShareDialog img{width:100%;max-height:280px;object-fit:contain;
      background:#f3f4f6;border:1px solid #ddd;border-radius:9px}
    #fttGalleryShareDialog label{display:block;margin:12px 0;font-weight:700}
    #fttGalleryShareDialog input,#fttGalleryShareDialog textarea{display:block;
      width:100%;box-sizing:border-box;padding:10px;margin-top:5px;
      font:15px Arial,sans-serif;border:1px solid #aeb8c5;border-radius:7px}
    #fttGalleryShareDialog textarea{resize:vertical;min-height:55px}
    #fttGalleryShareDialog .ftt-gallery-actions{display:flex;gap:10px;margin-top:15px;flex-wrap:wrap}
    #fttGalleryShareDialog button{border:0;border-radius:9px;padding:11px 16px;
      font-weight:700;cursor:pointer;background:#e5e7eb;color:#17202d}
    #fttGalleryShareDialog button[data-send]{background:#166b50;color:white}
    #fttGalleryShareDialog button:disabled{opacity:.5;cursor:default}
    #fttGalleryShareDialog [role=status]{min-height:20px;font-weight:700}
  `;
  (document.head || document.documentElement).append(css);

  function setStatus(message, error=false) {
    const el = dialog?.querySelector('[role=status]');
    if (el) { el.textContent = message; el.style.color = error ? '#b42318' : '#17694f'; }
  }
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'fttGalleryShareDialog';
    dialog.innerHTML = '<h2>📌 Add to Class Gallery</h2>' +
      '<p>Your current screen will be sent to your Rebbi for approval. ' +
      'Nothing appears in the gallery until your Rebbi approves it.</p>' +
      '<img alt="Preview of the screen you are sending">' +
      '<label>Title<input maxlength="70" required autocomplete="off"></label>' +
      '<label>Tell us about your work (optional)<textarea maxlength="240"></textarea></label>' +
      '<p role="status" aria-live="polite"></p>' +
      '<div class="ftt-gallery-actions"><button type="button" data-send>Send for Approval</button>' +
      '<button type="button" data-close>Cancel</button></div>';
    (document.fullscreenElement || document.body).append(dialog);
    dialog.querySelector('[data-close]').onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.querySelector('[data-send]').onclick = submit;
    return dialog;
  }
  async function loadCanvas() {
    if (typeof window.html2canvas === 'function') return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('halacha/html2canvas.min.js', root).href;
      script.onload = resolve;
      script.onerror = () => reject(Error('The picture tool could not load.'));
      document.head.append(script);
    });
    if (typeof window.html2canvas !== 'function') throw Error('The picture tool could not start.');
  }
  // Large pictures (for example a full-size Sefer HaMitzvos coloring page) used to
  // fail here and never reach the gallery. Shrink the picture until it fits the
  // limit the server accepts instead of giving up.
  const MAX_IMAGE_CHARS = 1150000;
  function encodeUnderLimit(canvas) {
    let current = canvas;
    for (let round = 0; round < 8; round++) {
      for (const quality of [.72, .45]) {
        const data = current.toDataURL('image/jpeg', quality);
        if (data.length <= MAX_IMAGE_CHARS) return data;
      }
      const smaller = document.createElement('canvas');
      smaller.width = Math.max(1, Math.floor(current.width * .75));
      smaller.height = Math.max(1, Math.floor(current.height * .75));
      const ctx = smaller.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, smaller.width, smaller.height);
      ctx.drawImage(current, 0, 0, smaller.width, smaller.height);
      current = smaller;
    }
    throw Error('This picture is too large to send. Please tell your Rebbi.');
  }
  window.__fttGalleryEncode = encodeUnderLimit;
  async function capture() {
    const button = document.getElementById('fttGalleryShareButton');
    if (busy || !button) return;
    if (!credentials()) {
      alert('Please sign in as a student from the Fun Torah Tools home page first.');
      return;
    }
    if (!ready && !(await checkReady(true))) {
      alert('The gallery connection is unavailable right now. Please try again soon.');
      return;
    }
    busy = true;
    button.style.visibility = 'hidden';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      let canvas;
      if (typeof window.FTTGalleryCaptureImage === 'function') {
        // Activities with layered painting surfaces can supply the finished artwork.
        canvas = await window.FTTGalleryCaptureImage();
      } else {
        await loadCanvas();
        const w = Math.min(window.innerWidth, 1400);
        const h = Math.min(window.innerHeight, 900);
        canvas = await window.html2canvas(document.body, {
          backgroundColor:'#ffffff', useCORS:true, logging:false,
          x:window.scrollX, y:window.scrollY, width:w, height:h,
          scale:Math.min(1.3, 1150 / Math.max(1, w)),
          ignoreElements:el => !!el.closest?.('#fttGalleryShareButton,#fttGalleryShareDialog')
        });
      }
      image = encodeUnderLimit(canvas);
      const box = ensureDialog();
      box.querySelector('img').src = image;
      box.querySelector('input').value = (document.title || 'My Learning').slice(0,70);
      box.querySelector('textarea').value = '';
      box.querySelector('[data-send]').disabled = false;
      box.querySelector('[data-close]').textContent = 'Cancel';
      setStatus('Check your picture, then send it to your Rebbi.');
      box.showModal();
    } catch (error) {
      image = null;
      alert(error.message || 'Could not capture this page. Please try again.');
    } finally {
      busy = false;
      button.style.visibility = '';
    }
  }
  async function submit() {
    if (busy || !image || !dialog) return;
    const cred = credentials();
    if (!cred) { setStatus('Please sign in again from the home page.',true); return; }
    const title = dialog.querySelector('input').value.trim();
    if (!title) { setStatus('Please enter a title.',true); return; }
    busy = true;
    const send = dialog.querySelector('[data-send]');
    const close = dialog.querySelector('[data-close]');
    send.disabled = close.disabled = true;
    setStatus('Sending your picture…');
    try {
      const response = await fetch(endpoint, {
        method:'POST', headers:{'Content-Type':'application/json'},
        signal:AbortSignal.timeout(30000),
        body:JSON.stringify({...cred,title,description:dialog.querySelector('textarea').value,source,image})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw Error(result.error || 'Could not send your picture.');
      image = null;
      setStatus('✓ Sent! Your Rebbi will review this picture before it appears in the gallery.');
      close.textContent = 'Done';
    } catch (error) {
      setStatus(error.message || 'Could not send your picture. Please try again.', true);
      send.disabled = false;
    } finally { busy = false; close.disabled = false; }
  }
  // Fullscreen learning activities only display elements inside the active
  // fullscreen container. Move the button (and closed dialog) into it.
  function attachToVisibleSurface() {
    const surface = document.fullscreenElement || document.body;
    const button = document.getElementById('fttGalleryShareButton');
    if (surface && button && button.parentElement !== surface) surface.append(button);
    if (surface && dialog && !dialog.open && dialog.parentElement !== surface) surface.append(dialog);
  }
  function updateButton() {
    attachToVisibleSurface();
    const button = document.getElementById('fttGalleryShareButton');
    // Keep the option visible for signed-in boys, even if the network is
    // briefly offline or the PIN still needs refreshing. Explain on click.
    if (button) button.hidden = !studentContext();
  }
  async function checkReady(force = false) {
    if (ready) return true;
    if (checking) return false;
    if (!force && Date.now() < nextReadyCheck) return false;
    checking = true;
    nextReadyCheck = Date.now() + 20000;
    try {
      const response = await fetch(endpoint, {method:'GET', signal:AbortSignal.timeout(6000)});
      const data = await response.json().catch(() => ({}));
      ready = response.ok && data.ok === true && data.ready === true;
    } catch (_) { ready = false; }
    finally { checking = false; updateButton(); }
    return ready;
  }
  function refresh() {
    updateButton();
    if (credentials() && !ready) checkReady();
  }
  function start() {
    if (!document.body || document.getElementById('fttGalleryShareButton')) return;
    const button = document.createElement('button');
    button.id = 'fttGalleryShareButton';
    button.type = 'button';
    button.textContent = '📌 Add to Gallery';
    button.hidden = true;
    button.addEventListener('click',capture);
    document.body.append(button);
    refresh();
    // A boy can sign in *after* the home page loads. Check promptly rather
    // than leaving the button missing for up to 45 seconds.
    setInterval(refresh, 2000);
    window.addEventListener('focus',refresh);
    window.addEventListener('pageshow',refresh);
    document.addEventListener('visibilitychange',refresh);
    document.addEventListener('fullscreenchange',refresh);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();


// Independent teacher toolbar: share this loader with pages that import
// Firebase configuration, while keeping the student Gallery code unchanged.
(function () {
  if (typeof document === 'undefined' || window.__fttTeacherToolbarLoading) return;
  window.__fttTeacherToolbarLoading = true;
  const current = document.currentScript;
  if (!current || !current.src) return;
  const script = document.createElement('script');
  script.src = new URL('teacher-global-controls.js?v=20261022-pointer2', current.src).href;
  script.async = true;
  (document.head || document.documentElement).appendChild(script);
})();
