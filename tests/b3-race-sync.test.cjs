'use strict';

// Fictional two-student race run against an in-memory Firebase and a tiny fake DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'b3-race.js'), 'utf8');
const RASHI = fs.readFileSync(path.join(__dirname, '..', 'rashi-letters', 'student.html'), 'utf8');

function fakeElement(tag) {
  const node = {
    tagName: tag, children: [], attrs: {}, className: '', textContent: '', style: {}, disabled: false,
    classList: { add() {}, remove() {} },
    append(...items) { items.forEach(item => node.children.push(item)); },
    appendChild(item) { node.children.push(item); return item; },
    replaceChildren(...items) { node.children = items; },
    replaceWith() {},
    setAttribute(key, value) { node.attrs[key] = value; },
    hasAttribute(key) { return key in node.attrs; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return node;
}

function memoryFirebase() {
  const root = {};
  const listeners = [];
  const disconnect = new Map();
  const keys = p => String(p).split('/').filter(Boolean);
  const read = p => keys(p).reduce((v, k) => (v == null ? undefined : v[k]), root) ?? null;
  const write = (p, value) => {
    const parts = keys(p); let parent = root;
    for (const k of parts.slice(0, -1)) parent = parent[k] ||= {};
    if (value == null) delete parent[parts.at(-1)]; else parent[parts.at(-1)] = JSON.parse(JSON.stringify(value));
  };
  const resolve = value => (value && typeof value === 'object' && value['.sv'] ? Date.now() : value);
  const notify = () => listeners.forEach(l => { if (!l.path.startsWith('.info')) l.cb({ val: () => structuredClone(read(l.path)) }); });
  let connected = true;
  const ref = p => ({
    child: c => ref(`${p}/${c}`),
    once: async () => ({ val: () => structuredClone(read(p)) }),
    set: async value => { const v = JSON.parse(JSON.stringify(value, (k, x) => resolve(x))); write(p, v); notify(); },
    update: async value => { for (const [k, v] of Object.entries(value)) write(`${p}/${k}`, resolve(v)); notify(); },
    remove: async () => { write(p, null); notify(); },
    on(_event, cb) { listeners.push({ path: p, cb }); cb({ val: () => (p === '.info/connected' ? connected : structuredClone(read(p))) }); return cb; },
    off(_event, cb) { const i = listeners.findIndex(l => l.path === p && l.cb === cb); if (i >= 0) listeners.splice(i, 1); },
    onDisconnect: () => ({
      remove() { disconnect.set(p, { op: 'remove' }); },
      update(value) { disconnect.set(p, { op: 'update', value }); },
      // Like Firebase, cancel() clears queued writes for this location and everything under it.
      cancel() { for (const k of [...disconnect.keys()]) if (k === p || k.startsWith(p + '/')) disconnect.delete(k); },
    }),
  });
  return {
    db: { ref }, read, write, disconnect, notify,
    reconnect() { connected = true; listeners.filter(l => l.path === '.info/connected').forEach(l => l.cb({ val: () => true })); },
    dropConnection() {
      for (const [p, entry] of disconnect) {
        if (entry.op === 'remove') write(p, null);
        else for (const [k, v] of Object.entries(entry.value)) write(`${p}/${k}`, v);
      }
      disconnect.clear(); notify();
    },
  };
}

function loadRace(fb) {
  const head = fakeElement('head');
  const window = {
    firebase: { database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } } },
    location: { href: 'https://example.test/gematria/index.html', search: '' },
    history: { replaceState() {} },
  };
  const context = vm.createContext({
    window, document: { getElementById: () => null, createElement: fakeElement, head }, URL, URLSearchParams, setTimeout: () => 0, clearTimeout() {}, console,
  });
  vm.runInContext(SOURCE, context);
  return (studentId, name) => window.B3Race.create({
    container: fakeElement('div'), db: fb.db, roomsPath: 'rooms', studentId, studentName: name,
    makeQuestions: () => [{ prompt: 'q', big: '1', choices: ['1', '2'], answer: '1' }],
  });
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('a short drop on the host device no longer deletes a race in progress', async () => {
  const fb = memoryFirebase();
  const create = loadRace(fb);
  const host = create('avi', 'Avi'), guest = create('benny', 'Benny');
  await host.start({ forceCreate: true }); await flush();
  const code = Object.keys(fb.read('rooms'))[0];
  assert.equal(fb.disconnect.get(`rooms/${code}`)?.op, 'remove', 'an empty lobby is still removed if the host disconnects');
  await guest.start({ roomCode: code }); await flush();
  await fb.db.ref(`rooms/${code}`).update({ state: 'playing' }); await flush();
  assert.equal(fb.disconnect.has(`rooms/${code}`), false, 'the room-delete marker is cancelled once the race starts');
  assert.equal(fb.disconnect.get(`rooms/${code}/players/avi`)?.op, 'update', 'the host is still marked away if he disconnects');
  fb.dropConnection();
  assert.ok(fb.read(`rooms/${code}`), 'the room survives');
  assert.equal(fb.read(`rooms/${code}/players/avi/left`), true);
  assert.equal(fb.read(`rooms/${code}/players/benny/left`), true);
  fb.reconnect(); await flush();
  assert.equal(fb.read(`rooms/${code}/players/avi/left`), false, 'reconnecting puts the host back in the race');
  assert.equal(fb.read(`rooms/${code}/players/benny/left`), false, 'and the guest too');
  assert.equal(fb.disconnect.get(`rooms/${code}/players/benny`)?.op, 'update', 'the disconnect marker is set up again');
});

test('a host who leaves mid-race steps out instead of deleting the room', async () => {
  const fb = memoryFirebase();
  const create = loadRace(fb);
  const host = create('avi', 'Avi'), guest = create('benny', 'Benny');
  await host.start({ forceCreate: true }); await flush();
  const code = Object.keys(fb.read('rooms'))[0];
  await guest.start({ roomCode: code }); await flush();
  await fb.db.ref(`rooms/${code}`).update({ state: 'playing' }); await flush();
  host.leave(); await flush();
  assert.ok(fb.read(`rooms/${code}`), 'Benny keeps his race');
  assert.equal(fb.read(`rooms/${code}/players/avi/left`), true);
});

test('Rashi Letters race has the same reconnect and host-drop protections', () => {
  assert.match(RASHI, /if\(r\.isHost\) r\.ref\.onDisconnect\(\)\.cancel\(\);/);
  assert.match(RASHI, /db\.ref\('\.info\/connected'\)/);
  assert.match(RASHI, /if\(r\.data\.players\[mpPlayerId\]\.left\) mine\.update\(\{left:false\}\)/);
  assert.match(RASHI, /r\.isHost && state==='playing' && !r\.finished && othersRacing/);
});

test('a host waiting alone keeps watching for friends who are also waiting', () => {
  assert.match(SOURCE, /if \(isHost\) startWatch\(\); else stopWatch\(\);/);
  assert.doesNotMatch(SOURCE, /startWatch\(\);\s*stopWatch\(\);/, 'the watch is no longer stopped right after starting');
});
