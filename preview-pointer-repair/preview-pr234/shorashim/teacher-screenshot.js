/* Teacher-only screenshot pictures for Shorashim words.
 * Deliberately separate from student cards and student drawing uploads.
 * Requires the matching restricted Cloud Storage rule before use. */
(() => {
  'use strict';
  const PREFIX = 'shorashim-teacher-pictures/';
  const BUCKET = 'b3-games.firebasestorage.app';
  const MAX_INPUT = 10 * 1024 * 1024;
  const MAX_UPLOAD = 2 * 1024 * 1024;
  const INPUT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  function screenshotURL(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' &&
        url.hostname === 'firebasestorage.googleapis.com' &&
        url.pathname.startsWith('/v0/b/' + BUCKET + '/o/' + encodeURIComponent(PREFIX));
    } catch (_) { return false; }
  }
  function allowedTeacher() {
    const user = firebase.auth().currentUser;
    // Matches the narrowly scoped proposed Storage rule. A student or an
    // ordinary signed-in Google user cannot acquire teacher upload access.
    return !!(activeTeacherAccess?.authorized && user?.emailVerified &&
      user.email === 'simcha5770@gmail.com');
  }
  function picturePreview(button) {
    const src = button.dataset.art;
    if (!screenshotURL(src)) return;
    button.textContent = '';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Teacher screenshot';
    img.className = 'teacher-uploaded-thumb';
    img.loading = 'lazy';
    button.appendChild(img);
  }
  function prepareScreenshot(file) {
    if (!file || !INPUT_TYPES.includes(file.type))
      return Promise.reject(Error('Choose a PNG, JPG, or WebP screenshot.'));
    if (file.size > MAX_INPUT)
      return Promise.reject(Error('Screenshot exceeds 10 MB. Crop it first.'));
    const objectURL = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const factor = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => {
            URL.revokeObjectURL(objectURL);
            if (!blob || blob.size > MAX_UPLOAD) {
              reject(Error('Screenshot is too large after resizing (2 MB limit).'));
              return;
            }
            resolve(blob);
          }, 'image/webp', 0.82);
        } catch (error) { URL.revokeObjectURL(objectURL); reject(error); }
      };
      image.onerror = () => { URL.revokeObjectURL(objectURL); reject(Error('Could not read the screenshot.')); };
      image.src = objectURL;
    });
  }
  async function upload(id, file, row) {
    const item = (state.catalog.shorashim || []).find(x => x.id === id);
    if (!item || !allowedTeacher()) return;
    const message = row.querySelector('[data-screenshot-status]');
    const controls = [...row.querySelectorAll('[data-screenshot-upload], [data-screenshot-paste]')];
    controls.forEach(x => x.disabled = true);
    try {
      const selected = sanitizeClassArt(item.art);
      if (selected.length >= ART_STUDENT_MAX)
        throw Error('First unselect one of the four pictures for this word.');
      message.textContent = 'Preparing screenshot…';
      const blob = await prepareScreenshot(file);
      const user = firebase.auth().currentUser;
      if (!user || !allowedTeacher()) throw Error('Sign in as the approved teacher again.');
      const filename = Date.now() + '-' + Math.random().toString(36).slice(2) + '.webp';
      const ref = firebase.storage().ref(PREFIX + user.uid + '/' + filename);
      message.textContent = 'Uploading screenshot…';
      await ref.put(blob, {contentType: 'image/webp'});
      const url = await ref.getDownloadURL();
      if (!screenshotURL(url)) throw Error('Could not verify the picture link.');
      // Persist only the URL in the class catalog, not image bytes.
      const previousArt = item.art;
      const previousPool = item.artPool;
      item.art = sanitizeClassArt([...selected, url]);
      item.artPool = sanitizeSuggestionPool([...item.art, ...(item.artPool || [])]);
      item.autoArt = false;
      try {
        await saveCatalog();
      } catch (err) {
        item.art = previousArt;
        item.artPool = previousPool;
        throw err;
      }
      renderCatalog();
      status('☁️ Screenshot added to ' + item.front);
    } catch (error) {
      const denied = /unauthorized|permission.denied|storage\/unauthorized|permission denied/i.test(
        String(error?.code || '') + ' ' + String(error?.message || ''));
      const text = denied
        ? 'Teacher screenshot Storage permission is not enabled yet. No card was changed.'
        : (error?.message || 'Could not upload screenshot.');
      message.textContent = text;
      status(text, 'error');
    } finally { controls.forEach(x => x.disabled = false); }
  }
  function controlsFor(row) {
    const id = row.dataset.id;
    const pictureBox = row.querySelector('.teacher-art-preview');
    if (!id || !pictureBox) return;
    row.querySelectorAll('[data-a="art"]').forEach(picturePreview);
    if (!allowedTeacher()) return;
    const wrap = document.createElement('div');
    wrap.className = 'teacher-screenshot-tools';
    const paste = document.createElement('div');
    paste.className = 'teacher-screenshot-paste';
    paste.dataset.screenshotPaste = '';
    paste.tabIndex = 0;
    paste.contentEditable = 'true';
    paste.setAttribute('role', 'textbox');
    paste.setAttribute('aria-label', 'Paste a screenshot here using Control V');
    paste.textContent = '📋 Click here, then Ctrl+V to paste a screenshot';
    const fileButton = document.createElement('button');
    fileButton.type = 'button';
    fileButton.className = 'ghost';
    fileButton.dataset.screenshotUpload = '';
    fileButton.textContent = '📁 Choose Screenshot';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.hidden = true;
    fileInput.accept = INPUT_TYPES.join(',');
    const message = document.createElement('small');
    message.dataset.screenshotStatus = '';
    message.setAttribute('aria-live','polite');
    message.className = 'mini-note';
    paste.addEventListener('paste', event => {
      event.preventDefault();
      const file = [...(event.clipboardData?.items || [])]
        .find(x => x.type.startsWith('image/'))?.getAsFile();
      if (!file) { message.textContent = 'Copy a screenshot first, then paste it here.'; return; }
      upload(id, file, row);
    });
    fileButton.onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) upload(id, file, row);
    };
    wrap.append(paste, fileButton, fileInput, message);
    pictureBox.after(wrap);
  }
  const originalRenderCatalog = renderCatalog;
  renderCatalog = function screenshotReadyCatalog() {
    originalRenderCatalog();
    document.querySelectorAll('#teacherCatalog .catalog-teacher-row').forEach(controlsFor);
  };
  const style = document.createElement('style');
  style.textContent =
    '.teacher-screenshot-tools{margin:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '.teacher-screenshot-paste{border:2px dashed #818cf8;background:#eef2ff;border-radius:12px;padding:10px;font-size:13px;min-width:240px;cursor:text}' +
    '.teacher-screenshot-paste:focus{outline:3px solid #6366f1}' +
    '.teacher-uploaded-thumb{display:block;width:76px;height:55px;object-fit:contain;border-radius:7px}' +
    '.teacher-art-chip:has(.teacher-uploaded-thumb){padding:5px}';
  document.head.appendChild(style);
})();
