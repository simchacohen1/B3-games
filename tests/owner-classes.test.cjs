const test = require('node:test');
const assert = require('node:assert/strict');
const OC = require('../owner-classes.js');

function memoryStorage() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; }

test('idsFromInvites keeps only assigned, safe class ids once', () => {
  const ids = OC.idsFromInvites({
    a: { classIds: { 'TEST-ALEF': true, '*': true, 'bad id': true, off: false } },
    b: { classIds: { 'TEST-ALEF': true, beis: true } },
    c: null, d: {}
  });
  assert.deepEqual(ids.sort(), ['TEST-ALEF', 'beis']);
});

test('remember/remembered round-trips, dedupes and drops unsafe ids', () => {
  const storage = memoryStorage();
  OC.remember('ws1', ['x', 'y', 'x', '../evil'], { storage });
  OC.remember('ws1', 'z', { storage });
  assert.deepEqual(OC.remembered('ws1', { storage }), ['x', 'y', 'z']);
  assert.deepEqual(OC.remembered('other', { storage }), []);
});

test('remembered survives blocked or corrupt storage', () => {
  assert.deepEqual(OC.remembered('ws', { storage: { getItem() { throw new Error('blocked'); } } }), []);
  assert.deepEqual(OC.remembered('ws', { storage: { getItem: () => '{not json' } }), []);
  assert.doesNotThrow(() => OC.remember('ws', 'a', { storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } }));
});

test('readClasses reads each class by its own path and never the whole node', async () => {
  const reads = [];
  const db = { ref(path) { reads.push(path); return { once: async () => {
    if (path.endsWith('/denied')) throw new Error('permission_denied');
    return { val: () => (path.endsWith('/gone') ? null : { name: path.split('/').pop() }) };
  } }; } };
  const { classes, unreadable } = await OC.readClasses(db, 'ws', ['A', 'denied', 'gone', 'A', 'bad id']);
  assert.deepEqual(Object.keys(classes), ['A']);
  assert.deepEqual(unreadable, ['denied']);
  assert.ok(reads.every(p => /^b3Games\/workspaces\/ws\/classes\/[A-Za-z0-9_-]+$/.test(p)), reads.join(','));
  assert.equal(reads.length, 3);
});
