'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../game-show/team-modes.js'), 'utf8');
function el() {
  return {
    checked: false, value: '', textContent: '', hidden: false, style: {}, handlers: {}, children: [],
    setAttribute() {}, appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    insertBefore(child) { this.children.push(child); },
    insertAdjacentElement() {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}
function host() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, el());
    return elements.get(id);
  };
  get('multipleChoiceToggle').checked = true;
  get('readChoicesToggle').checked = true;
  get('delayToggle').checked = false;
  get('teamModeToggle').checked = false;
  const setup = el(), buzzerCard = el(), stage = el();
  buzzerCard.querySelector = selector => selector === '#delayToggle' ? get('delayToggle') : null;
  setup.querySelectorAll = () => [buzzerCard];
  stage.querySelector = selector => selector === '#answer' ? get('answer') : null;
  const document = {
    querySelector: selector => selector === '#tabSetup .setup-grid' ? setup :
      selector === '#tabPlay .qcard' ? stage : null,
    querySelectorAll: () => [], createElement: () => el(), getElementById: get,
    head: { appendChild() {} }
  };
  const questions = [
    { q: 'How many malochim came?', ans: 'Three', choices: ['Two', 'One', 'Three', 'Four'], correctIndex: 2 },
    { q: 'Who lived in Sedom?', ans: 'Lot', choices: ['Avrohom', 'Lot', 'Yaakov', 'Yitzchok'], correctIndex: 1 }
  ];
  const spoken = [];
  let state = { qIndex: 0, scores: { Ari: 0, Benny: 0 } }, context;
  const notify = () => {
    context.lastGameData = state;
    for (const listener of listeners) listener({ val: () => state });
  };
  const listeners = [];
  const gameRef = {
    on(event, cb) { if(event === 'value') listeners.push(cb); },
    update(values) { state = { ...state, ...values }; notify(); return Promise.resolve(); },
    transaction(change, cb) {
      const next = change({ ...state });
      if (!next) { cb?.(null, false); return; }
      state = next; notify(); cb?.(null, true);
    },
    child() { return { transaction() {} }; }
  };
  const synthesis = {
    speak(u) { spoken.push(u); },
    cancel() {}
  };
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const window = {
    speechSynthesis: synthesis,
    SpeechSynthesisUtterance: Utterance,
    createQuestionRow() {}, saveEditor() {}, adjustSelectedScore() {}
  };
  context = vm.createContext({
    window, document, location: { pathname: '/game-show/teacher.html' },
    gameRef, setRef: { set() { return Promise.resolve(); } }, ACTIVE_SET_TITLE: 'Test',
    questions, lastGameData: state,
    serverNow: () => 10000, ensureAudioAwake() {},
    closeEditor() {}, alert() {}, confirm() { return true; },
    SpeechSynthesisUtterance: Utterance,
    setTimeout() { return 1; }, clearTimeout() {}
  });
  vm.runInContext(script, context, { filename: 'team-modes.js' });
  return { window, document, get, spoken, state: () => state };
}

test('host locks the buzzer during colored narration, then unlocks when reading completes', async () => {
  const h = host();
  h.window.startGameShow();
  await Promise.resolve();
  assert.equal(h.state().roundActive, true);
  assert.equal(h.state().showStarted, true);
  assert.equal(h.state().narrationLocked, true);
  assert.equal(h.state().buzzUnlockAt, 0);
  assert.equal(h.spoken.length, 1);
  assert.match(h.spoken[0].text, /Red: Two.*Blue: One.*Green: Three.*Yellow: Four/);
  assert.doesNotMatch(h.spoken[0].text, /correctIndex|the correct answer|Answer: Three/i);
  h.spoken[0].onend();
  assert.equal(h.state().narrationLocked, false);
  assert.equal(h.state().buzzUnlockAt, 10000);
  assert.equal(h.get('teacherColorChoices').children.length, 0, 'teacher answer panel is not an input');
});

test('moving to the next question relocks the buzzer and stale speech cannot unlock it', async () => {
  const h = host();
  h.window.startGameShow();
  await Promise.resolve();
  const previous = h.spoken[0];
  h.window.goToQuestion(1);
  await Promise.resolve();
  assert.equal(h.state().qIndex, 1);
  assert.equal(h.state().narrationLocked, true);
  assert.equal(h.spoken.length, 2);
  previous.onend();
  assert.equal(h.state().narrationLocked, true);
  h.spoken[1].onend();
  assert.equal(h.state().narrationLocked, false);
});

test('teacher can stop narration manually to unlock the active round', async () => {
  const h = host();
  h.window.startGameShow();
  await Promise.resolve();
  assert.equal(h.state().narrationLocked, true);
  h.get('stopNarrationBtn').handlers.click();
  assert.equal(h.state().narrationLocked, false);
});
