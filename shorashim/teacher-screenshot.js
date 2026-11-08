/* Teacher picture upload for Shorashim words.
 * Replaces the old Regenerate Pictures button.
 * Teachers can upload a picture by:
 *   - Choosing a file from their computer (📁)
 *   - Pasting a screenshot from clipboard (Ctrl+V)
 * Each upload is stored under the teacher's UID in Firebase Storage
 * and appears as a new UNTICKED checkbox option in the picture list.
 * Any verified teacher account (not just the owner account) can upload.
 */
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

  /** Any verified teacher account can upload — not restricted to owner email. */
  function allowedTeacher() {
    const user = firebase.auth().currentUser;
    return !!(activeTeacherAccess?.authorized && user?.emailVerified);
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
      message.textContent = 'Preparing picture…';
      const blob = await prepareScreenshot(file);
      const user = firebase.auth().currentUser;
      if (!user || !allowedTeacher()) throw Error('Sign in as your teacher account again.');
      const filename = Date.now() + '-' + Math.random().toString(36).slice(2) + '.webp';
      const ref = firebase.storage().ref(PREFIX + user.uid + '/' + filename);
      message.textContent = 'Uploading picture…';
      await ref.put(blob, { contentType: 'image/webp' });
      const url = await ref.getDownloadURL();
      if (!screenshotURL(url)) throw Error('Could not verify the picture link.');
      // Add URL to artPool only (unticked by default — teacher must check it to show students)
      const previousArtPool = item.artPool;
      item.artPool = sanitizeSuggestionPool([...(item.artPool || []), url]);
      try {
        await saveCatalog();
      } catch (err) {
        item.artPool = previousArtPool;
        throw err;
      }
      renderCatalog();
      status('☁️ Picture uploaded for ' + item.front + ' — tick it to show students');
    } catch (error) {
      const denied = /unauthorized|permission.denied|storage\/unauthorized|permission denied/i.test(
        String(error?.code || '') + ' ' + String(error?.message || ''));
      const text = denied
        ? 'Picture upload permission is not enabled yet. No card was changed.'
        : (error?.message || 'Could not upload picture.');
      message.textContent = text;
      status(text, 'error');
    } finally { controls.forEach(x => x.disabled = false); }
  }

  /**
   * Inject upload controls into a catalog row's .teacher-upload-controls placeholder.
   * Called by renderCatalog() after each row is built.
   */
  function controlsFor(row) {
    const id = row.dataset.id;
    const placeholder = row.querySelector('.teacher-upload-controls');
    if (!id || !placeholder) return;
    if (!allowedTeacher()) return;

    // Avoid double-injection if renderCatalog fires again quickly
    if (placeholder.dataset.injected) return;
    placeholder.dataset.injected = '1';

    const wrap = document.createElement('div');
    wrap.className = 'teacher-screenshot-tools';

    const paste = document.createElement('div');
    paste.className = 'teacher-screenshot-paste';
    paste.dataset.screenshotPaste = '';
    paste.tabIndex = 0;
    paste.contentEditable = 'true';
    paste.setAttribute('role', 'textbox');
    paste.setAttribute('aria-label', 'Paste a picture here using Control V');
    paste.textContent = '📋 Click here, then Ctrl+V to paste a picture';

    const fileButton = document.createElement('button');
    fileButton.type = 'button';
    fileButton.className = 'ghost';
    fileButton.dataset.screenshotUpload = '';
    fileButton.textContent = '📁 Choose Picture File';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.hidden = true;
    fileInput.accept = INPUT_TYPES.join(',');

    const message = document.createElement('small');
    message.dataset.screenshotStatus = '';
    message.setAttribute('aria-live', 'polite');
    message.className = 'mini-note';
    message.textContent = 'Uploaded pictures are unticked by default — tick them above to show students.';

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
    placeholder.appendChild(wrap);
  }

  // Expose so renderCatalog() can call controlsFor() per row
  window.ShorashimTeacherScreenshot = { controlsFor };

  const style = document.createElement('style');
  style.textContent =
    '.teacher-screenshot-tools{margin:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
    + '.teacher-screenshot-paste{border:2px dashed #818cf8;background:#eef2ff;border-radius:12px;padding:10px;font-size:13px;min-width:240px;cursor:text}'
    + '.teacher-screenshot-paste:focus{outline:3px solid #6366f1}'
    + '.teacher-uploaded-thumb{display:block;width:60px;height:44px;object-fit:contain;border-radius:7px}'
    + '.teacher-upload-controls{margin-top:4px}';
  document.head.appendChild(style);
})();
