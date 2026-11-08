const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// #362: a once() followed by on() on the same path makes the Realtime Database
// SDK download the whole history twice. The student chart must attach its live
// listeners first, so the once() reads are answered from the listeners' copy.
test('Chazara student chart attaches live history listeners before its first reads', () => {
  const html = fs.readFileSync('chazara/index.html', 'utf8');
  const initialRead = html.indexOf("await Promise.all([db.ref(ROOT+sid).once('value'),db.ref('posukPractice/attempts/'+sid).once('value'),db.ref(EVENTS+sid).once('value')])");
  assert.ok(initialRead > 0, 'expected the initial chart read');
  for (const path of ["'posukPractice/attempts/'+sid", 'EVENTS+sid']) {
    const listen = html.indexOf(`db.ref(${path}).on('value'`);
    assert.ok(listen > 0, `expected a live listener on ${path}`);
    assert.ok(listen < initialRead, `${path} listener must be attached before the initial once() read`);
    assert.equal(html.indexOf(`db.ref(${path}).on('value'`, listen + 1), -1, `only one live listener on ${path}`);
  }
});

test('Chazara student chart does not render live updates before its saved chart state loads', () => {
  const html = fs.readFileSync('chazara/index.html', 'utf8');
  assert.match(html, /on\('value',s=>\{attemptsRoot=s\.val\(\)\|\|\{\};attemptsLive=true;if\(liveReady\)rebuildUnlocked\(\)\}\)/);
  assert.match(html, /on\('value',s=>\{chazaraEvents=s\.val\(\)\|\|\{\};eventsLive=true;if\(liveReady\)\{render\(\);renderRecordings\(\)\}\}\)/);
  assert.match(html, /if\(!attemptsLive\)attemptsRoot=attemptSnap\.val\(\)\|\|\{\};if\(!eventsLive\)chazaraEvents=eventSnap\.val\(\)\|\|\{\};liveReady=true;/);
});
