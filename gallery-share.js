/* Site-wide, student-only screenshot pinning. The Firebase HTTPS function
   verifies the student's PIN and class; this client never writes gallery posts. */
(() => {
  'use strict';
  if (window.__fttGalleryShare) return;
  window.__fttGalleryShare = true;
  const root = new URL('.', document.currentScript?.src || location.href);
  const endpoint = 'https://us-central1-b3-games.cloudfunctions.net/classGallerySubmit';
  const excluded = /\/(?:class-gallery|admin|owner-admin|teacher-home|student-report|sync-to-nigri)(?:\/|\.html|$)/i;
  if (excluded.test(location.pathname) || /(?:^|[/-])teacher(?:[/.?]|$)/i.test(location.pathname)) return;
  if (new URLSearchParams(location.search).has('previewStudentId')) return;

  let ready = false, checking = false, busy = false, image = null, dialog = null;
  const source = (() => {
    const p = location.pathname.toLowerCase();
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
  const credentials = () => {
    try {
      if (window.B3Guest?.isGuest?.()) return null;
      if (document.body?.classList.contains('teacherMode')) return null;
      const studentId = sessionStorage.getItem('b3Games_studentId') || '';
      const studentName = sessionStorage.getItem('b3Games_studentName') || '';
      const classId = sessionStorage.getItem('b3Games_studentClass') || '';
      const pin = sessionStorage.getItem('b3Games_classPin') || '';
      return studentId && studentName && classId && pin ?
        {studentId, studentName, classId, pin} : null;
    } catch (_) { return null; }
  };

  const css = document.createElement('style');
  css.textContent = `
    #fttGalleryShareButton{position:fixed;right:18px;bottom:18px;z-index:2147479000;
      background:#1d5979;color:#fff;border:2px solid #fff;border-radius:999px;
      padding:12px 17px;box-shadow:0 5px 20px #0004;font:700 14px Arial,sans-serif;
      cursor:pointer}#fttGalleryShareButton:focus-visible{outline:3px solid #facc15}
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
    document.body.append(dialog);
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
  async function capture() {
    const button = document.getElementById('fttGalleryShareButton');
    if (busy || !credentials() || !button) return;
    busy = true;
    button.style.visibility = 'hidden';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      await loadCanvas();
      const w = Math.min(window.innerWidth, 1400);
      const h = Math.min(window.innerHeight, 900);
      const canvas = await window.html2canvas(document.body, {
        backgroundColor:'#ffffff', useCORS:true, logging:false,
        x:window.scrollX, y:window.scrollY, width:w, height:h,
        scale:Math.min(1.3, 1150 / Math.max(1, w)),
        ignoreElements:el => !!el.closest?.('#fttGalleryShareButton,#fttGalleryShareDialog')
      });
      image = canvas.toDataURL('image/jpeg', .72);
      if (image.length > 1150000) image = canvas.toDataURL('image/jpeg', .45);
      if (image.length > 1150000) throw Error('This picture is too large. Try making your browser window smaller.');
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
  function updateButton() {
    const button = document.getElementById('fttGalleryShareButton');
    if (button) button.hidden = !ready || !credentials();
  }
  async function checkReady() {
    if (ready || checking) return;
    checking = true;
    try {
      const response = await fetch(endpoint, {method:'GET', signal:AbortSignal.timeout(6000)});
      const data = await response.json().catch(() => ({}));
      ready = response.ok && data.ok === true && data.ready === true;
    } catch (_) { ready = false; }
    finally { checking = false; updateButton(); }
  }
  function start() {
    if (!document.body) return;
    const button = document.createElement('button');
    button.id = 'fttGalleryShareButton';
    button.type = 'button';
    button.textContent = '📌 Add to Gallery';
    button.hidden = true;
    button.addEventListener('click',capture);
    document.body.append(button);
    updateButton();
    if (credentials()) checkReady();
    setInterval(() => {
      updateButton();
      if (!ready && credentials()) checkReady();
    }, 45000);
    window.addEventListener('focus', () => { updateButton(); if (!ready && credentials()) checkReady(); });
    // Student login on the main home page does not navigate or reload.
    if (location.pathname.endsWith('/index.html') || location.pathname === '/') {
      setTimeout(() => {updateButton(); if (!ready && credentials()) checkReady();},2500);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
