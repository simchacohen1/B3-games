'use strict';
// The Class Access panel is rebuilt on every class/settings change and every 30 s. A rebuild moves the "Open for sending"
// box and closes any dropdown open in it (on a busy site the Rashi list could not be used at all). While the teacher is
// working inside that box, the rebuild must wait, then run once they leave it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(`${__dirname}/../admin.html`, 'utf8').split('\r\n').join('\n');
const start = html.indexOf('let cpRenderPending=false;');
const end = html.indexOf('function renderOwnerControl(){');
assert.ok(start > 0 && end > start, 'guard code not found in admin.html');
const guardCode = html.slice(start, end);

function world() {
  const listeners = {};
  let renders = 0;
  const card = { contains: node => node === inside };
  const inside = {}, outside = {};
  const document = {
    activeElement: outside,
    getElementById: id => (id === 'submissionOpenCard' ? card : null),
    addEventListener: (type, fn) => { listeners[type] = fn; }
  };
  const context = { document, currentTab: 'access', setTimeout: fn => fn(), renderOwnerControl: () => { renders++; } };
  vm.runInNewContext(guardCode + '\nthis.cpUserIsEditingOpenForSending = cpUserIsEditingOpenForSending; this.state = () => cpRenderPending; this.setPending = v => { cpRenderPending = v; };', context);
  return { document, inside, outside, listeners, context, renders: () => renders };
}

test('the guard is true only while focus is inside the Open for sending box', () => {
  const w = world();
  assert.equal(w.context.cpUserIsEditingOpenForSending(), false);
  w.document.activeElement = w.inside;
  assert.equal(w.context.cpUserIsEditingOpenForSending(), true);
});

test('a rebuild waits while the teacher is inside the box, and runs once after they leave', () => {
  const w = world();
  w.document.activeElement = w.inside;
  w.context.setPending(true);          // a rebuild was held back
  w.listeners.focusout();              // focus moves within the box: nothing happens
  assert.equal(w.renders(), 0);
  w.document.activeElement = w.outside;
  w.listeners.focusout();              // focus left the box: the held rebuild runs once
  assert.equal(w.renders(), 1);
  assert.equal(w.context.state(), false);
  w.listeners.focusout();              // nothing pending any more
  assert.equal(w.renders(), 1);
});

test('renderOwnerControl starts with the guard', () => {
  const body = html.slice(html.indexOf('function renderOwnerControl(){'));
  assert.match(body.slice(0, 200), /if\(cpUserIsEditingOpenForSending\(\)\)\{cpRenderPending=true;return\}/);
});
