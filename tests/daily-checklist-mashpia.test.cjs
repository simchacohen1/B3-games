'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../daily-checklist/mashpia-sync.js');

const answers = {
  s1: { name: 'Arik', items: { a: { v: 1, n: 'Shacharis', o: 1 }, b: { v: 0, n: 'Mincha', o: 2 }, c: { v: 1, n: 'Daily Tzedaka', o: 0 } } },
  s2: { name: 'Levi', items: { a: { v: 0, n: 'Shacharis', o: 1 } } },
  s4: { name: 'Ghost', items: {} }
};
const roster = [{ id: 's1', name: 'Arik Fake' }, { id: 's2', name: 'Levi Fake' }, { id: 's3', name: 'Silent Fake' }, { id: 's4', name: 'Ghost Fake' }];

test('sends only Yes answers, in order, for students who answered', () => {
  assert.deepEqual(M.buildStudents(answers, roster), [
    { name: 'Arik Fake', items: ['Daily Tzedaka', 'Shacharis'] },
    { name: 'Levi Fake', items: [] }
  ]);
});

test('one short line', () => {
  assert.equal(M.summary({ synced: 10, not_found: [], greyed: [], missing_items: [] }), 'Synced 10 students');
  assert.equal(M.summary({ synced: 9, not_found: ['Moshe Fake'], greyed: [], missing_items: [] }), "Synced 9, couldn't find: Moshe Fake");
});

function env(responses, login) {
  const calls = [];
  return {
    calls, base: 'http://localhost:1', getToken: async () => 'tok',
    fetch: async (url, opt) => {
      calls.push({ url, method: opt.method, body: opt.body && JSON.parse(opt.body), auth: opt.headers.Authorization });
      const r = responses.shift();
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    },
    askLogin: async why => { calls.push({ asked: true, why }); return login; }
  };
}

test('first time: asks for login once, saves it, then syncs in the same press', async () => {
  const e = env([{ status: 409, body: { error: 'Mashpia login needed', code: 'need_login' } }, { status: 200, body: { saved: true } },
    { status: 200, body: { synced: 2, not_found: [], greyed: [], missing_items: [] } }], { username: 'u', password: 'p' });
  const r = await M.run(e, '2026-11-18', [{ name: 'A', items: [] }]);
  assert.equal(r.message, 'Synced 2 students');
  assert.deepEqual(e.calls.map(c => c.method || 'ask'), ['POST', 'ask', 'PUT', 'POST']);
});

test('later presses never ask again', async () => {
  const e = env([{ status: 200, body: { synced: 1, not_found: [], greyed: [], missing_items: [] } }], null);
  const r = await M.run(e, '2026-11-18', [{ name: 'A', items: [] }]);
  assert.equal(r.message, 'Synced 1 student');
  assert.equal(e.calls.length, 1);
});

test('cancelled login syncs nothing', async () => {
  const e = env([{ status: 409, body: { code: 'need_login', error: 'Mashpia login needed' } }], null);
  const r = await M.run(e, '2026-11-18', [{ name: 'A', items: [] }]);
  assert.equal(r.ok, false);
  assert.equal(e.calls.filter(c => c.method === 'PUT').length, 0);
});

test('nothing answered: nothing sent', async () => {
  const e = env([], null);
  assert.equal((await M.run(e, '2026-11-18', [])).ok, false);
  assert.equal(e.calls.length, 0);
});

test('server address cannot be pointed at an arbitrary http host', () => {
  assert.equal(M.serverBase('http://evil.example.com', 'https://x.example'), 'https://x.example');
  assert.equal(M.serverBase('http://localhost:5000', 'https://x.example'), 'http://localhost:5000');
});

test('teacher page loads the helper and has the one button', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'daily-checklist', 'teacher.html'), 'utf8');
  assert.match(html, /sync-to-nigri\/nigri-auth\.js/);
  assert.match(html, /mashpia-sync\.js/);
  assert.equal((html.match(/id="mashpiaSync"/g) || []).length, 1);
  const inline = html.match(/<script>([\s\S]*?)<\/script>/g).map(s => s.replace(/<\/?script>/g, '')).join('\n');
  assert.doesNotThrow(() => new Function(inline));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'daily-checklist', 'mashpia-sync.js'), 'utf8'), /localStorage|sessionStorage/);
});
