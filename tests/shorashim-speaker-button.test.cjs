const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('shorashim/app.js', 'utf8');
const html = fs.readFileSync('shorashim/index.html', 'utf8');
const fn = name => { const i = source.indexOf(`function ${name}(`); return source.slice(i, source.indexOf('\n', i)); };

test('speakEnglish uses browser speech and tolerates missing support', () => {
  const spoken = [];
  class Utt { constructor(t) { this.text = t; } }
  const window = { speechSynthesis: { cancel() {}, speak(u) { spoken.push(u); } } };
  const ctx = vm.createContext({ window, SpeechSynthesisUtterance: Utt });
  vm.runInContext(fn('speakEnglish'), ctx);
  assert.equal(ctx.speakEnglish('saw / appeared'), true);
  assert.equal(spoken[0].text, 'saw, appeared');
  assert.equal(spoken[0].lang, 'en-US');
  assert.equal(ctx.speakEnglish(''), false);
  const none = vm.createContext({ window: {}, SpeechSynthesisUtterance: undefined });
  vm.runInContext(fn('speakEnglish'), none);
  assert.equal(none.speakEnglish('tent'), false);
});

test('Review speaker button is hidden until the card is flipped', () => {
  const calls = [];
  const document = { getElementById: () => ({ style: {}, querySelectorAll: () => [], classList: { toggle() {} } }) };
  const ctx = vm.createContext({
    document, setSpeakButton: (id, t) => calls.push([id, t]), reviewNoHints: false, reviewFlipped: false, reviewIndex: 0,
    reviewDeck: [{ itemKey: 'one', itemType: 'shorashim', design: {} }],
    getItem: () => ({ front: 'ראה', english: 'see', examples: [] }),
    normalizeDesign: () => ({ hebrewPos: {}, englishPos: {}, arts: [] }),
    singularTrack: () => '', reviewFilterLabel: () => '', fmtDate: () => '', cardDisplayScale: () => 1,
    hebrewFontVisualStyle: () => ({}), renderReadOnlyArts() {}, renderDailyStatus() {}, performance: { now: () => 0 }
  });
  vm.runInContext(fn('renderReviewCard'), ctx);
  ctx.renderReviewCard();
  assert.deepEqual(calls.pop(), ['reviewSpeakBtn', '']);
  ctx.reviewFlipped = true;
  ctx.renderReviewCard();
  assert.deepEqual(calls.pop(), ['reviewSpeakBtn', 'see']);
});

test('speaker buttons exist in Learn and Review and do not touch progress', () => {
  assert.match(html, /id="learnSpeakBtn"/);
  assert.match(html, /id="reviewSpeakBtn"[^>]*hidden/);
  assert.match(fn('renderWordList'), /speakButtonHTML\(item\.english\)/);
  for (const name of ['speakEnglish', 'speakButtonHTML', 'setSpeakButton']) {
    assert.doesNotMatch(fn(name), /saveDB|save\(|points|record|cards\[/i);
  }
});
