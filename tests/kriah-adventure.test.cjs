'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'kriah-assessment/adventure.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'kriah-assessment/adventure.html'), 'utf8');

function fixture() {
  class Element {
    constructor() {
      this.children = [];
      this.handlers = {};
      this.hidden = false;
      this.disabled = false;
      this.textContent = '';
      this.attrs = {};
      const values = new Set();
      this.classList = { add: value => values.add(value), toggle: (value, enabled) => enabled ? values.add(value) : values.delete(value), contains: value => values.has(value) };
    }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(type, callback) { this.handlers[type] = callback; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll(selector) { return selector === 'button' ? this.children : []; }
    click() { if (!this.disabled) this.handlers.click?.(); }
    scrollIntoView() {}
  }
  const ids = ['letterMap','mapView','lessonView','resume','missionGo','showMap','back','toFind','tryNext','repeat','lessonTitle','lessonDescription','featuredLetter','bigDiscover','nameDiscover','findName','readingToken','stageDiscover','stageFind','stagePractice','answers','feedback'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const stages = [new Element(), new Element(), new Element()];
  const document = { getElementById: id => elements[id], createElement: () => new Element(), querySelectorAll: selector => selector === '[data-stage]' ? stages : [] };
  vm.runInNewContext(js, { document }, { filename: 'adventure.js', timeout: 2000 });
  return elements;
}

test('page includes no Firebase writes or fake persisted mastery', () => {
  assert.match(html, /FICTIONAL UI PREVIEW/);
  assert.match(html, /href="index.html"/);
  assert.doesNotMatch(js, /firebase|localStorage|fetch\s*\(|XMLHttpRequest/);
});
test('map presents 22 canonical Hebrew consonants in RTL order', () => {
  const e = fixture();
  assert.equal(e.letterMap.children.length, 22);
  assert.equal(e.letterMap.children.map(child => child.children[0].textContent).join(''), 'אבגדהוזחטיכלמנסעפצקרשת');
});
test('clicking any letter opens its own practice screen', () => {
  const e = fixture();
  e.letterMap.children[1].click();
  assert.equal(e.lessonTitle.textContent, 'Meet Beis');
  assert.equal(e.featuredLetter.textContent, 'ב');
  assert.equal(e.lessonView.hidden, false);
  assert.equal(e.mapView.hidden, true);
});
test('wrong answers can be retried; a correct choice unlocks practice', () => {
  const e = fixture();
  e.letterMap.children[1].click();
  e.toFind.click();
  assert.equal(e.answers.children.length, 4);
  const wrong = e.answers.children.find(element => element.textContent !== 'ב');
  wrong.click();
  assert.equal(e.tryNext.disabled, true);
  const correct = e.answers.children.find(element => element.textContent === 'ב');
  correct.click();
  assert.equal(e.tryNext.disabled, false);
  e.tryNext.click();
  assert.equal(e.stagePractice.hidden, false);
  e.back.click();
  assert.equal(e.mapView.hidden, false);
});
test('all lessons can enter the challenge and choose their target letter', () => {
  const e = fixture();
  e.letterMap.children.forEach((tile, i) => {
    tile.click();
    e.toFind.click();
    const target = e.featuredLetter.textContent;
    assert.ok(e.answers.children.some(child => child.textContent === target), 'missing target at ' + i);
  });
});