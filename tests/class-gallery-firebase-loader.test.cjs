const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('class-gallery/index.html', 'utf8');

test('Class Gallery loads Firebase compat modules and local fallbacks in dependency order', () => {
  let previous = -1;
  for (const module of ['app', 'database', 'storage', 'auth']) {
    const file = `firebase-${module}-compat.js`;
    const cdn = html.indexOf(`https://www.gstatic.com/firebasejs/12.15.0/${file}`);
    const local = html.indexOf(`../vendor/firebase/12.15.0/${file}`);
    assert.ok(cdn > previous, `${file} CDN script is ordered after its dependency`);
    assert.ok(local > cdn, `${file} same-origin fallback follows its CDN script`);
    previous = local;
  }
});

test('Class Gallery validates required Firebase modules before initializing the app', () => {
  const check = html.indexOf('!firebase.database || !firebase.storage || !firebase.auth');
  const initialize = html.indexOf('firebase.initializeApp(window.B3_FIREBASE_CONFIG)');
  assert.ok(check >= 0 && initialize > check);
  assert.match(html, /Firebase could not load on this device or network/);
});
