/* Siman Aleph professional Halacha art. Additive: never overwrites student work. */
(function () {
  'use strict';
  var SCENE_BASE = 'art/scenes/';
  var STICKER_BASE = 'art/stickers/';
  var examples = [
    { file: 'learning', title: 'Learning Torah', caption: 'I learn carefully and respectfully.' },
    { file: 'walking', title: 'Walking Outside', caption: 'I behave respectfully wherever I go.' },
    { file: 'helping', title: 'Helping at Home', caption: 'I help even when nobody asks me.' },
    { file: 'speaking', title: 'Speaking Kindly', caption: 'I choose gentle, thoughtful words.' },
    { file: 'alone', title: 'When I Am Alone', caption: 'I remember to do what is right.' }
  ];
  var stickers = [
    ['book', 'Sefer'], ['house', 'Home'], ['boy-walking', 'Walking'],
    ['speech', 'Kind words'], ['table-chair', 'Table and chair'],
    ['shtender', 'Shtender'], ['bed-window', 'Bedroom'], ['globe', 'World'],
    ['heart', 'Kindness'], ['thought', 'Thought'], ['toybox', 'Toybox'],
    ['lamp', 'Lamp']
  ];
  var htmlEscape = function (s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
    });
  };
  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (typeof text === 'string') el.textContent = text;
    return el;
  }
  function image(file, alt, cls) {
    var im = node('img', cls || '');
    im.src = file + '?v=20261019-chabad1';
    im.alt = alt;
    im.loading = 'lazy';
    im.decoding = 'async';
    return im;
  }
  function isReadonly() {
    return typeof HALACHA_TEACHER_VIEW !== 'undefined' && !!HALACHA_TEACHER_VIEW;
  }
  function sayAdded(label) {
    var status = document.querySelector('.hal-art-status');
    if (status) status.textContent = 'Added ' + label + ' to your scrapbook ✓';
  }
  function addPicture(file, label) {
    if (isReadonly() || typeof window.add !== 'function') return;
    var markup = '<img src="' + file + '?v=20261019-chabad1" alt="' + htmlEscape(label) + '">';
    var piece = window.add('a', 'photo', markup, 0);
    if (piece) {
      piece.classList.add('hal-illustrated-piece', 'studio-sticker');
      piece.style.width = '175px';
      if (typeof window.persist === 'function') window.persist('a');
      sayAdded(label + ' picture');
    }
  }
  function addWords(words) {
    if (isReadonly() || typeof window.add !== 'function') return;
    var piece = window.add('a', 'textbox', '<div class="tb-text" contenteditable="true">' + htmlEscape(words) + '</div>', 0);
    if (piece) {
      piece.classList.add('hal-lesson-text-piece');
      piece.style.width = '260px';
      if (typeof window.persist === 'function') window.persist('a');
      sayAdded('words');
    }
  }
  function installArt() {
    var section = document.getElementById('a');
    if (!section || section.querySelector('[data-halacha-professional-art]')) return;
    var lesson = section.querySelector('.hal-a-panel');
    var galleryHost = lesson && lesson.querySelector('.hal-a-scenarios');
    var aside = section.querySelector('.side');
    if (!galleryHost || !aside) return;
    var gallery = node('section', 'hal-story-gallery');
    gallery.setAttribute('data-halacha-professional-art', '');
    gallery.setAttribute('aria-label', 'Examples from daily life');
    gallery.appendChild(node('h3', '', 'Examples from Daily Life'));
    var grid = node('div', 'hal-story-grid');
    examples.forEach(function (item) {
      var card = node('figure', 'hal-story-card');
      card.appendChild(image(SCENE_BASE + item.file + '.jpg', item.title + ': ' + item.caption));
      var info = node('figcaption', '');
      info.appendChild(node('strong', '', item.title));
      info.appendChild(node('span', '', item.caption));
      card.appendChild(info);
      var actions = node('div', 'hal-story-actions');
      var useImage = node('button', 'hal-story-use', '＋ Picture');
      useImage.type = 'button';
      useImage.disabled = isReadonly();
      useImage.setAttribute('aria-label', 'Add ' + item.title + ' picture to scrapbook');
      useImage.addEventListener('click', function () { addPicture(SCENE_BASE + item.file + '.jpg', item.title); });
      var useWords = node('button', 'hal-story-use', '＋ Words');
      useWords.type = 'button';
      useWords.disabled = isReadonly();
      useWords.setAttribute('aria-label', 'Add ' + item.caption + ' to scrapbook');
      useWords.addEventListener('click', function () { addWords(item.caption); });
      actions.append(useImage, useWords);
      card.appendChild(actions);
      grid.appendChild(card);
    });
    gallery.appendChild(grid);
    // Present the artwork at the TOP of the learning panel, not buried
    // beneath the Hebrew source and phrase cards. Preserve the quiz below.
    var lessonBody = lesson.querySelector('.hal-a-body');
    if (lessonBody) lessonBody.insertBefore(gallery, lessonBody.firstChild);
    else galleryHost.insertBefore(gallery, galleryHost.firstChild);
    var status = node('p', 'hal-art-status');
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    gallery.appendChild(status);
    // Maintain the existing correct/incorrect choice controls and their feedback.
    var choices = galleryHost.querySelectorAll('.hal-a-choice .hal-a-scene-art');
    if (choices.length >= 2) {
      choices[0].replaceChildren(image(SCENE_BASE + 'helping.jpg', 'A boy helping carefully at home'));
      choices[1].replaceChildren(image(SCENE_BASE + 'messy.jpg', 'A boy leaving toys scattered'));
      var qHolder = galleryHost.querySelector('.hal-a-quiz-details');
      if (qHolder) {
        var pictureRow = node('div', 'hal-story-actions');
        [['helping','Picture 1'], ['messy','Picture 2']].forEach(function (pair) {
          var button = node('button', 'hal-story-use', '＋ Use ' + pair[1] + ' in scrapbook');
          button.type = 'button';
          button.disabled = isReadonly();
          button.addEventListener('click', function () { addPicture(SCENE_BASE + pair[0] + '.jpg', pair[1]); });
          pictureRow.appendChild(button);
        });
        qHolder.appendChild(pictureRow);
      }
    }
    var shelf = node('section', 'hal-sticker-shelf');
    shelf.setAttribute('aria-label', 'Illustrated scrapbook stickers');
    shelf.appendChild(node('h3', '', 'Illustrated Stickers for This Seif'));
    shelf.appendChild(node('p', 'hal-sticker-hint', 'Tap a picture to add it to your scrapbook. Move and resize it on the page.'));
    var all = node('div', 'hal-sticker-grid');
    stickers.forEach(function (pair) {
      var key = pair[0], label = pair[1], file = STICKER_BASE + key + '.jpg';
      var b = node('button', 'hal-sticker-button');
      b.type = 'button';
      b.disabled = isReadonly();
      b.appendChild(image(file, ''));
      b.appendChild(node('span', '', label));
      b.setAttribute('aria-label', 'Add ' + label + ' sticker to scrapbook');
      b.addEventListener('click', function () {
        if (isReadonly() || typeof window.add !== 'function') return;
        var tag = '<img alt="' + htmlEscape(label) + '" src="' + file + '?v=20261019-chabad1">';
        var piece = window.add('a', 'photo', tag, 0);
        if (piece) {
          piece.classList.add('studio-sticker', 'clear', 'hal-illustrated-piece');
          piece.style.width = '150px';
          // The base add() saves immediately; also save the final size and style.
          if (typeof window.persist === 'function') window.persist('a');
        }
      });
      all.appendChild(b);
    });
    shelf.appendChild(all);
    // Keep the new illustrated choices visible before the long style/options list.
    // Do not replace the older sticker tray or alter its saved piece keys.
    var pageStyles = aside.querySelector('.studio-backgrounds');
    var old = aside.querySelector('.studio-stickers');
    if (pageStyles) aside.insertBefore(shelf, pageStyles);
    else if (old) aside.insertBefore(shelf, old);
    else aside.appendChild(shelf);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installArt, {once: true});
  } else {
    installArt();
  }
})();
