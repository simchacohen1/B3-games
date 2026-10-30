'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function fakeCanvas(w, h) {
  return {
    width: w, height: h,
    getContext: () => ({fillRect() {}, drawImage() {}, set fillStyle(_) {}}),
    // Pretend the encoded size grows with the pixel count and the quality.
    toDataURL: (_type, q) => 'x'.repeat(Math.floor(w * h * q * 0.5))
  };
}
function loadHelper() {
  const document = {
    readyState: 'complete', body: null, currentScript: null,
    head: {append() {}}, documentElement: {append() {}},
    createElement: tag => tag === 'canvas' ? fakeCanvas(0, 0) : {},
    // createElement('canvas') result gets its size set by the helper
    addEventListener() {}
  };
  document.createElement = tag => tag === 'canvas' ? fakeCanvas(1, 1) : {textContent: ''};
  const window = {};
  const ctx = {window, document, location: {href: 'https://x.test/sefer-hamitzvos/', pathname: '/sefer-hamitzvos/', search: ''},
    URL, URLSearchParams, sessionStorage: {getItem: () => null}, setInterval() {}, console};
  ctx.window = Object.assign(window, ctx);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'gallery-share.js'), 'utf8'), ctx);
  return window.__fttGalleryEncode;
}

test('large pictures are shrunk until they fit instead of failing', () => {
  const encode = loadHelper();
  assert.equal(typeof encode, 'function');
  const out = encode(fakeCanvas(3000, 4000));
  assert.ok(out.length <= 1150000, 'encoded picture fits the server limit');
});

test('small pictures are sent unchanged at normal quality', () => {
  const encode = loadHelper();
  assert.equal(encode(fakeCanvas(800, 600)).length, Math.floor(800 * 600 * .72 * .5));
});

test('server labels Sefer HaMitzvos posts', () => {
  const src = fs.readFileSync(path.join(root, 'backend/functions/class-gallery-submit.js'), 'utf8');
  assert.match(src, /'sefer-hamitzvos':'Sefer HaMitzvos'/);
});
