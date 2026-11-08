/* Shorashim teacher page: add your own picture to a word.
 * The teacher chooses a file or pastes a screenshot. The picture is shrunk to a
 * small image and saved under that teacher's own account at
 * shorashimTeacherPictures/<teacherUid>/<pictureId>. The word gets it as a new,
 * UNTICKED option (item.customArt); students see it only after the teacher ticks it.
 * Replaces the older owner-only Firebase Storage screenshot uploader. Screenshots
 * already saved that way keep working. */
(() => {
  'use strict';
  const P = window.B3ShorashimPictures;
  const MAX_ADDED_PER_WORD = 12;

  function allowedTeacher() {
    const user = firebase.auth().currentUser;
    return !!(activeTeacherAccess?.authorized && user && P.makeRef && /^[A-Za-z0-9_-]{1,128}$/.test(user.uid));
  }
  async function addPicture(id, file, row) {
    const item = (state.catalog.shorashim || []).find(x => x.id === id);
    if (!item || !allowedTeacher()) return;
    const message = row.querySelector('[data-picture-status]');
    const controls = [...row.querySelectorAll('[data-picture-upload], [data-picture-paste]')];
    controls.forEach(x => { x.disabled = true; });
    let path = '';
    try {
      const added = customArtOf(item);
      if (added.length >= MAX_ADDED_PER_WORD)
        throw new Error(`This word already has ${MAX_ADDED_PER_WORD} added pictures.`);
      message.textContent = 'Preparing picture…';
      const data = await P.compressImage(file);
      const user = firebase.auth().currentUser;
      if (!user || !allowedTeacher()) throw new Error('Please sign in again as a teacher.');
      const ref = P.makeRef(user.uid, P.newPictureId());
      path = P.picturePath(ref);
      message.textContent = 'Saving picture…';
      await firebase.database().ref(path).set({ data, createdAt: Date.now() });
      P.remember(ref, data);
      const previous = item.customArt;
      item.customArt = [...added, ref]; // a new option, not ticked
      try {
        await saveCatalog();
      } catch (err) {
        item.customArt = previous;
        firebase.database().ref(path).remove().catch(() => {});
        throw err;
      }
      renderCatalog();
      status('☁️ Picture added to ' + item.front + '. Tick it to show it to students.');
    } catch (error) {
      const denied = /permission.denied|permission denied|PERMISSION_DENIED/i.test(
        String(error?.code || '') + ' ' + String(error?.message || ''));
      const text = denied
        ? 'Could not save the picture: permission denied. Nothing was changed.'
        : (error?.message || 'Could not add the picture.');
      if (message) message.textContent = text;
      status(text, 'error');
    } finally { controls.forEach(x => { x.disabled = false; }); }
  }
  function controlsFor(row) {
    const id = row.dataset.id;
    const pictureBox = row.querySelector('.teacher-art-preview');
    if (!id || !pictureBox || !allowedTeacher()) return;
    const wrap = document.createElement('div');
    wrap.className = 'teacher-add-picture';
    const paste = document.createElement('div');
    paste.className = 'teacher-add-picture-paste';
    paste.dataset.picturePaste = '';
    paste.tabIndex = 0;
    paste.contentEditable = 'true';
    paste.setAttribute('role', 'textbox');
    paste.setAttribute('aria-label', 'Paste a picture here with Control V');
    paste.textContent = '📋 Click here, then Ctrl+V to paste a picture';
    const fileButton = document.createElement('button');
    fileButton.type = 'button';
    fileButton.className = 'ghost';
    fileButton.dataset.pictureUpload = '';
    fileButton.textContent = '📁 Add picture from computer';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.hidden = true;
    fileInput.accept = P.INPUT_TYPES.join(',');
    const message = document.createElement('small');
    message.dataset.pictureStatus = '';
    message.setAttribute('aria-live', 'polite');
    message.className = 'mini-note';
    paste.addEventListener('paste', event => {
      event.preventDefault();
      const file = [...(event.clipboardData?.items || [])]
        .find(x => x.type.startsWith('image/'))?.getAsFile();
      if (!file) { message.textContent = 'Copy a picture or screenshot first, then paste it here.'; return; }
      addPicture(id, file, row);
    });
    // Typing is not allowed in the paste box; it only accepts a pasted picture.
    paste.addEventListener('beforeinput', event => { if (event.inputType !== 'insertFromPaste') event.preventDefault(); });
    fileButton.onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) addPicture(id, file, row);
    };
    wrap.append(paste, fileButton, fileInput, message);
    pictureBox.after(wrap);
  }
  const originalRenderCatalog = renderCatalog;
  renderCatalog = function catalogWithAddPicture() {
    originalRenderCatalog();
    if (currentTrack !== 'shorashim') return;
    document.querySelectorAll('#teacherCatalog .catalog-teacher-row').forEach(controlsFor);
  };
  const style = document.createElement('style');
  style.textContent =
    '.teacher-add-picture{margin:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '.teacher-add-picture-paste{border:2px dashed #818cf8;background:#eef2ff;border-radius:12px;padding:10px;font-size:13px;min-width:240px;cursor:text}' +
    '.teacher-add-picture-paste:focus{outline:3px solid #6366f1}';
  document.head.appendChild(style);
})();
