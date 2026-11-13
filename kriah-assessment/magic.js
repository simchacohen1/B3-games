/* Alef-Beis adventure presentation helpers. Display only: nothing here reads
   or writes student data, scores or recordings. */
(function (root) {
  'use strict';
  // Reading order. Every container that shows these uses dir="rtl", so Alef is
  // first on the right and each next letter sits to its left.
  const LETTERS = [
    ['א', 'Alef'], ['ב', 'Beis'], ['ג', 'Gimmel'], ['ד', 'Daled'], ['ה', 'Hei'], ['ו', 'Vov'], ['ז', 'Zayin'], ['ח', 'Ches'],
    ['ט', 'Tes'], ['י', 'Yud'], ['כ', 'Kof'], ['ל', 'Lamed'], ['מ', 'Mem'], ['נ', 'Nun'], ['ס', 'Samech'], ['ע', 'Ayin'],
    ['פ', 'Pei'], ['צ', 'Tzadi'], ['ק', 'Kuf'], ['ר', 'Reish'], ['ש', 'Shin'], ['ת', 'Tov']
  ].map(([letter, name], index) => ({ letter, name, index }));
  const FINALS = [['ך', 'Final Chof'], ['ם', 'Final Mem'], ['ן', 'Final Nun'], ['ף', 'Final Fei'], ['ץ', 'Final Tzadi']].map(([letter, name], index) => ({ letter, name, index: 22 + index, final: true }));
  const CHEERS = ['Amazing reading!', 'You did it!', 'What a star reader!', 'Beautiful reading!', 'Every letter is a step forward!'];
  const cheer = (pick = Math.random()) => CHEERS[Math.min(CHEERS.length - 1, Math.floor(pick * CHEERS.length))];

  // Words in reading order, each a list of letter tiles (letter + its nekudos).
  function passageModel(text, Core) {
    const parsed = Core.units(text), words = new Map();
    parsed.clusters.forEach(c => { if (!words.has(c.word)) words.set(c.word, []); words.get(c.word).push({ index: c.index, text: c.text + c.suffix }); });
    return [...words.values()];
  }
  function make(tag, cls, text) { const n = root.document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toggle(tile) { const on = tile.getAttribute('aria-pressed') !== 'true'; tile.setAttribute('aria-pressed', String(on)); tile.classList.toggle('lit', on); return on; }

  // The trail of all 22 letters (plus the five final letters).
  function trail(container, nameNode) {
    container.replaceChildren(); container.dir = 'rtl'; container.lang = 'he';
    [...LETTERS, ...FINALS].forEach(item => {
      const tile = make('button', 'trail-tile tone-' + (item.index % 6) + (item.final ? ' final' : ''), item.letter);
      tile.type = 'button'; tile.dataset.letter = item.letter; tile.setAttribute('aria-pressed', 'false'); tile.setAttribute('aria-label', item.name);
      tile.onclick = () => {
        const on = toggle(tile);
        if (nameNode) nameNode.textContent = on ? item.letter + '  ' + item.name : '';
      };
      container.append(tile);
    });
  }
  // The reading passage as tappable letter tiles, so a child can keep their place.
  function passage(text, Core) {
    const box = make('div', 'hebrew passage reading-tiles'); box.dir = 'rtl'; box.lang = 'he';
    passageModel(text, Core).forEach(word => {
      const group = make('span', 'reading-word');
      word.forEach(c => { const tile = make('button', 'reading-tile tone-' + (c.index % 6), c.text); tile.type = 'button'; tile.dataset.index = c.index; tile.setAttribute('aria-pressed', 'false'); tile.onclick = () => toggle(tile); group.append(tile); });
      box.append(group);
    });
    return box;
  }
  // A short burst of stars. Skipped when the reader prefers reduced motion.
  function burst(node) {
    if (!node || root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const layer = make('div', 'star-burst'); layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 14; i++) { const star = make('span', null, i % 3 ? '★' : '✦'); star.style.setProperty('--x', Math.round(Math.cos(i * 0.45) * (60 + i * 9)) + 'px'); star.style.setProperty('--y', Math.round(-40 - (i * 37) % 120) + 'px'); star.style.setProperty('--d', (i * 40) + 'ms'); layer.append(star); }
    node.append(layer); root.setTimeout(() => layer.remove(), 2200);
  }
  const api = { LETTERS, FINALS, CHEERS, cheer, passageModel, trail, passage, burst };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.KriahMagic = api;
})(typeof window === 'object' ? window : globalThis);
