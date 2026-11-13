'use strict';

// Issue #805: a signed-out student who opens the Multiplayer Arcade must be given
// a "Go to sign in" link that remembers to bring them back to the arcade.
// Runs the real multiplayer/center.js against a tiny fake page; no Firebase, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiplayer', 'center.js'), 'utf8');

function fakeElement(tag) {
  const listeners = {};
  const element = {
    tagName: String(tag || 'div').toUpperCase(), children: [], className: '', hidden: false, href: '', type: '',
    style: {}, dataset: {}, attributes: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    get textContent() { return this._text !== undefined ? this._text : this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this._text = String(value); this.children = []; },
    set innerHTML(value) { this._text = ''; this.children = []; },
    get innerHTML() { return ''; },
    appendChild(child) { if (this._text !== undefined && !this.children.length) { this.children.push({ textContent: this._text, children: [] }); } this._text = undefined; this.children.push(child); return child; },
    append(...nodes) { nodes.forEach(node => this.appendChild(typeof node === 'string' ? { textContent: node, children: [] } : node)); },
    replaceChildren(...nodes) { this._text = undefined; this.children = []; nodes.forEach(node => this.children.push(node)); },
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    removeEventListener() {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    querySelector() { return fakeElement('div'); },
    querySelectorAll() { return []; },
    focus() {}, remove() {},
    click() { (listeners.click || []).forEach(handler => handler({ preventDefault() {} })); },
  };
  return element;
}

function loadArcade({ firebase, config }) {
  const byId = {};
  const storage = {};
  const document = {
    getElementById(id) { return byId[id] ||= fakeElement('div'); },
    createElement: fakeElement,
    createTextNode(text) { return { textContent: String(text), children: [] }; },
    querySelector() { return fakeElement('div'); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const window = {
    document, firebase, B3_FIREBASE_CONFIG: config,
    sessionStorage: { getItem: key => (key in storage ? storage[key] : null), setItem(key, value) { storage[key] = String(value); }, removeItem(key) { delete storage[key]; } },
    location: { search: '', href: 'https://example.test/multiplayer/index.html' },
    addEventListener() {}, console, setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {},
    URLSearchParams,
  };
  window.window = window;
  // Card artwork needs a real browser SVG parser and is not what this test is about.
  window.FTT_GAME_ART = { illustration() { return fakeElement('svg'); } };
  vm.runInNewContext(source, window, { filename: 'multiplayer/center.js' });
  return { status: document.getElementById('accountStatus'), storage };
}

function signInLink(status) {
  return status.children.find(child => child.tagName === 'A');
}

function assertSignInLink(status, storage) {
  const link = signInLink(status);
  assert.ok(link, 'the account notice contains a link, not only text: "' + status.textContent + '"');
  assert.equal(link.textContent, 'Go to sign in');
  assert.equal(link.href, '../index.html');
  assert.equal(storage.b3StudentReturnTo, undefined, 'nothing is remembered until the student chooses to sign in');
  link.click();
  assert.equal(storage.b3StudentReturnTo, 'multiplayer/index.html', 'the home page sends the student back to the arcade after sign-in');
}

test('a signed-out student in the arcade gets a sign-in link that returns to the arcade', () => {
  const firebase = {
    apps: [{}],
    initializeApp() {},
    database() { return {}; },
    auth() { return { onAuthStateChanged(callback) { callback(null); } }; },
  };
  const { status, storage } = loadArcade({ firebase, config: { projectId: 'demo-fictional' } });
  assert.equal(status.className, 'notice error');
  assert.match(status.textContent, /not signed in/i);
  assertSignInLink(status, storage);
});

test('the arcade still offers the sign-in link when Firebase did not load', () => {
  const { status, storage } = loadArcade({ firebase: undefined, config: undefined });
  assert.match(status.textContent, /Sign in on Fun Torah Tools first/);
  assertSignInLink(status, storage);
});
