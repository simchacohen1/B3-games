/* Share a rendered snapshot; gallery projects keep the existing approval flow. */
(() => {
  const style = document.createElement('style');
  style.textContent = '.teacherMode .halacha-gallery-button{display:none}.halacha-gallery-button{width:100%;padding:10px;border:0;border-radius:10px;background:#173b62;color:white;font-weight:bold}#halachaGalleryDialog{max-width:680px;width:95%;border:0;border-radius:16px;padding:20px}#halachaGalleryDialog::backdrop{background:#0008}#halachaGalleryDialog img{width:100%;max-height:55vh;object-fit:contain}#halachaGalleryDialog button{padding:10px;margin:8px 8px 0 0;border-radius:8px}#halachaGalleryDialog input{width:100%;padding:8px;margin:8px 0}';
  document.head.appendChild(style);
  const dialog = document.createElement('dialog');
  dialog.id = 'halachaGalleryDialog';
  dialog.innerHTML = '<h2>Post to Class Gallery</h2><p>Both scrapbook pages will be sent to your teacher for approval.</p><label>Project title<input id="halachaGalleryTitle" maxlength="60"></label><img alt="Preview of your Halacha scrapbook pages"><p role="status" aria-live="polite"></p><button type="button" data-send disabled>Send for Approval</button><button type="button" data-close>Cancel</button>';
  document.body.appendChild(dialog);
  const status = dialog.querySelector('[role=status]'), send = dialog.querySelector('[data-send]'), cancel = dialog.querySelector('[data-close]');
  let draft = null, busy = false;
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  function installButtons() {
    if (HALACHA_TEACHER_PREVIEW) return;
    document.querySelectorAll('.section .side').forEach(side => {
      if (side.querySelector('.halacha-gallery-button')) return;
      const button = document.createElement('button');
      button.className = 'halacha-gallery-button';
      button.textContent = '🖼️ Post to Class Gallery';
      button.onclick = () => prepare(side.closest('.section').id);
      side.prepend(button);
    });
  }
  new MutationObserver(installButtons).observe(document.getElementById('sections'), { childList: true });
  installButtons();
  async function prepare(id) {
    if (busy) return;
    draft = null; send.disabled = true;
    dialog.querySelector('img').removeAttribute('src');
    const lesson = lessons.find(l => l.id === id);
    dialog.querySelector('input').value = ('Halacha — ' + lesson.title).slice(0, 60);
    dialog.showModal(); status.textContent = 'Preparing your pages…';
    try {
      if (!HALACHA_STUDENT_ID || !halachaDb) throw new Error('Please sign in as a student from the home page first.');
      const info = await FunTorahStudentClass.resolve(halachaDb, HALACHA_STUDENT_ID);
      if (!info.classId) throw new Error('Please choose your class on the home page first.');
      const studentName = String(localStorage.getItem('b3Games_studentName') || '').trim();
      if (!studentName) throw new Error('Please sign in with your name on the home page first.');
      closeCustomizer(); persist(id); saveDrawing(id);
      await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      const spread = document.querySelector('#' + id + ' .spread');
      await document.fonts.ready;
      const canvas = await html2canvas(spread, {
        scale: Math.min(1, 1400 / spread.offsetWidth), useCORS: true, backgroundColor: '#976442', logging: false,
        onclone(doc) { doc.body.classList.add('exporting'); doc.querySelectorAll('.scrap.selected').forEach(el => el.classList.remove('selected')); }
      });
      const image = canvas.toDataURL('image/jpeg', 0.85);
      draft = { studentId: HALACHA_STUDENT_ID, workspaceId: info.workspaceId, classId: info.classId,
        studentName, className: info.classId === 'et' ? 'B3 ET' : info.classId === 'wt' ? 'B3 WT' : info.classId,
        category: 'Halacha', galleryRoom: 'hallway', description: 'My Halacha scrapbook — ' + lesson.title,
        link: '', image, audioUrl: null, videoUrl: null, status: 'pending', source: 'halacha', lessonId: id };
      dialog.querySelector('img').src = image;
      status.textContent = 'Check your pages, then send them to your teacher.'; send.disabled = false;
    } catch (error) { status.textContent = error.message || 'Could not prepare your pages. Please try again.'; }
  }
  send.onclick = async () => {
    if (!draft || busy) return;
    const title = dialog.querySelector('input').value.trim();
    if (!title) { status.textContent = 'Please enter a project title.'; return; }
    busy = true; send.disabled = true; cancel.disabled = true; status.textContent = 'Sending…';
    try {
      const path = ['et', 'wt'].includes(draft.classId) ? 'classGallery/posts' :
        'b3Games/workspaces/' + draft.workspaceId + '/classes/' + draft.classId + '/resources/gallery/posts';
      await halachaDb.ref(path).push().set({ ...draft, title, createdAt: new Date().toISOString() });
      draft = null;
      status.textContent = '✓ Sent to your teacher! Your pages will appear in Class Gallery after approval.';
      cancel.textContent = 'Done';
    } catch (error) { status.textContent = 'Could not send your pages. Please try again. ' + (error.message || ''); send.disabled = false; }
    finally { busy = false; cancel.disabled = false; }
  };
})();
