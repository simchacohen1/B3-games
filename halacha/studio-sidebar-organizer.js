/* A short, accessible tabbed shelf for every Halacha scrapbook.
   Move existing UI nodes only: never touch scrapbook artwork, saves, or account state. */
(function () {
  'use strict';
  const choices = [
    ['pictures', '🖼 Pictures'],
    ['words', '✏️ Words'],
    ['styles', '🎨 Page styles'],
    ['lesson', '📚 Lesson']
  ];
  const lastTab = new Map();
  function organize(id) {
    const section = document.getElementById(id);
    const side = section && section.querySelector('.work > .side');
    if (!side || side.querySelector('.studio-shelf-tabs')) return;
    const intro = side.querySelector(':scope > .studio-intro');
    const actions = side.querySelector(':scope > .studio-actions');
    const header = side.querySelector(':scope > h3');
    if (!actions || !header) return;
    const quickStep = Array.from(side.children).find(el =>
      el.matches('.step') && !!el.querySelector('[onclick^="studioText"],[onclick^="addTextBox"]'));
    const tabs = document.createElement('div');
    tabs.className = 'studio-shelf-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Choose scrapbook supplies');
    const holder = document.createElement('div');
    holder.className = 'studio-shelf-content';
    const panes = {};
    choices.forEach(([key, title]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = id + '-studio-tab-' + key;
      button.className = 'studio-shelf-tab';
      button.textContent = title;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', id + '-studio-panel-' + key);
      button.addEventListener('click', () => activate(key, true));
      tabs.appendChild(button);
      const pane = document.createElement('section');
      pane.id = id + '-studio-panel-' + key;
      pane.className = 'studio-shelf-pane';
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', button.id);
      pane.setAttribute('aria-label', title);
      panes[key] = pane;
      holder.appendChild(pane);
    });
    const anchor = quickStep || actions;
    anchor.after(tabs, holder);
    const fixed = new Set([header, intro, actions, quickStep, tabs, holder]);
    Array.from(side.children).forEach(el => {
      if (fixed.has(el)) return;
      if (el.matches('.studio-stickers, .hal-sticker-shelf')) {
        panes.pictures.appendChild(el);
      } else if (el.matches('.studio-backgrounds, .studio-reset, .studio-custom-bg')) {
        panes.styles.appendChild(el);
      } else if (el.matches('.hal-title-guidance')) {
        panes.words.appendChild(el);
      } else if (el.matches('.lesson-vocab')) {
        panes.lesson.appendChild(el);
      } else if (el.matches('.step')) {
        if (/Pieces to decorate with/i.test(el.textContent)) panes.words.appendChild(el);
        else if (el.querySelector('.actbtn') || /workbook|lesson|practice/i.test(el.className + ' ' + el.textContent)) panes.lesson.appendChild(el);
        else panes.styles.appendChild(el);
      } else if (el.matches('p') && /drag|resize|move/i.test(el.textContent)) {
        panes.styles.appendChild(el);
      } else {
        panes.lesson.appendChild(el);
      }
    });
    // Keep the main lesson-related pictures visible, but fold large
    // shared libraries so the left tray no longer feels like an endless list.
    const universal = panes.pictures.querySelector('.studio-picture-library');
    if (universal && !universal.closest('details')) {
      const details = document.createElement('details');
      details.className = 'studio-shelf-extra-pictures';
      const summary = document.createElement('summary');
      summary.textContent = 'Browse all 12 picture stickers';
      universal.before(details);
      details.append(summary, universal);
    }
    const seifShelf = panes.pictures.querySelector('.hal-sticker-shelf');
    if (seifShelf && !seifShelf.closest('details')) {
      const details = document.createElement('details');
      details.className = 'studio-shelf-extra-pictures';
      const summary = document.createElement('summary');
      summary.textContent = 'More pictures for this סעיף';
      seifShelf.before(details);
      details.append(summary, seifShelf);
    }
    const overview = document.createElement('p');
    overview.className = 'studio-shelf-tip';
    overview.textContent = 'Choose a tab, then tap an item to add it to your page.';
    tabs.before(overview);
    const buttons = Array.from(tabs.querySelectorAll('[role="tab"]'));
    function activate(key, focus) {
      lastTab.set(id, key);
      choices.forEach(([tabKey]) => {
        const selected = key === tabKey;
        panes[tabKey].hidden = !selected;
        const button = buttons.find(b => b.id === id + '-studio-tab-' + tabKey);
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      if (focus) {
        buttons.find(b => b.id === id + '-studio-tab-' + key).focus();
        holder.scrollIntoView && side.scrollTo({top: 0, behavior: 'auto'});
      }
    }
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const index = choices.findIndex(([key]) => key === lastTab.get(id));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + choices.length) % choices.length;
      event.preventDefault();
      activate(choices[next][0], true);
    });
    activate(lastTab.get(id) || 'pictures', false);
  }
  const previousRender = render;
  render = function (lesson) {
    previousRender(lesson);
    if (lesson && lesson.id) organize(lesson.id);
  };
  lessons.forEach(lesson => organize(lesson.id));
})();