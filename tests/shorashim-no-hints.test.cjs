const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function review(noHints) {
  const source = fs.readFileSync('shorashim/app.js', 'utf8');
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { style: {}, querySelectorAll: () => [], classList: {
        toggle(name, hidden) { hidden ? classes.add(name) : classes.delete(name); },
        contains: name => classes.has(name)
      } });
    }
    return nodes.get(id);
  } };
  const context = {
    document, reviewNoHints: noHints, reviewFlipped: false, reviewIndex: 0,
    reviewDeck: [{ itemKey: 'one', itemType: 'shorashim', design: {} }],
    getItem: () => ({ front: 'ראה', english: 'see', examples: [] }),
    normalizeDesign: () => ({ hebrewPos: {}, englishPos: {}, arts: ['👁'], drawing: 'drawing.png' }),
    singularTrack: () => '', reviewFilterLabel: () => '', fmtDate: () => '',
    cardDisplayScale: () => 1, hebrewFontVisualStyle: () => ({}),
    renderReadOnlyArts(layer) { layer.innerHTML = '👁'; }, renderDailyStatus() {},
    performance: { now: () => 0 }
  };
  vm.createContext(context);
  for (const name of ['renderReviewCard', 'flipReview']) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n', start);
    vm.runInContext(source.slice(start, end), context);
  }
  return { context, hidden: id => document.getElementById(id).classList.contains('hidden') };
}

test('No Hints keeps pictures and drawings hidden through repeated card flips', () => {
  const r = review(true);
  r.context.renderReviewCard();
  for (let i = 0; i < 5; i++) {
    assert.equal(r.hidden('reviewArtLayer'), true);
    assert.equal(r.hidden('reviewDrawing'), true);
    r.context.flipReview();
  }
});

test('picture modes show artwork on the front and preserve answer flipping', () => {
  const r = review(false);
  r.context.renderReviewCard();
  assert.equal(r.hidden('reviewArtLayer'), false);
  assert.equal(r.hidden('reviewDrawing'), false);
  r.context.flipReview();
  assert.equal(r.hidden('reviewArtLayer'), true);
  assert.equal(r.hidden('reviewDrawing'), true);
  assert.equal(r.hidden('reviewEnglish'), false);
  r.context.flipReview();
  assert.equal(r.hidden('reviewArtLayer'), false);
  assert.equal(r.hidden('reviewDrawing'), false);
});
