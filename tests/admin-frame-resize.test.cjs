const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const html = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
  const source = html.match(/  const resize=\(\)=>\{[\s\S]*?\n  resize\(\);/)[0];
  const callbacks = [], writes = [];
  const d = { body: { offsetHeight: 100 } };
  const style = {};
  Object.defineProperty(style, 'height', {
    get: () => writes.at(-1),
    set: height => writes.push(height)
  });
  const frame = { contentDocument: d, style };
  let deliver;
  vm.runInNewContext(source, {
    d, frame,
    requestAnimationFrame: callback => callbacks.push(callback),
    ResizeObserver: class {
      constructor(callback) { deliver = callback; }
      observe(body) { assert.equal(body, d.body); }
    }
  });
  return { d, frame, callbacks, writes, deliver: () => deliver() };
}

test('iframe resize defers observer writes and coalesces notifications using the latest height', () => {
  const f = fixture();
  assert.deepEqual(f.writes, ['100px']);
  f.d.body.offsetHeight = 200;
  f.deliver();
  f.d.body.offsetHeight = 300;
  f.deliver();
  assert.deepEqual(f.writes, ['100px'], 'no layout writes during observer delivery');
  assert.equal(f.callbacks.length, 1);
  f.callbacks.shift()();
  assert.deepEqual(f.writes, ['100px', '300px']);
  f.deliver();
  f.callbacks.shift()();
  assert.equal(f.writes.length, 2, 'unchanged height must not trigger another write');
  f.d.body.offsetHeight = 400;
  f.deliver();
  f.callbacks.shift()();
  assert.equal(f.writes.at(-1), '400px', 'later resize notifications still work');
});

test('a queued iframe resize cannot change a frame after navigation', () => {
  const f = fixture();
  f.d.body.offsetHeight = 200;
  f.deliver();
  f.frame.contentDocument = { body: { offsetHeight: 500 } };
  assert.equal(f.callbacks.length, 1);
  f.callbacks.shift()();
  assert.deepEqual(f.writes, ['100px']);
});
