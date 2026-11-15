'use strict';
// Local-only synthetic service adapter; never imported by deployed functions.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createService, PROJECT, WS } = require('../backend/kriah-staging/service.cjs');
const Core = require('../kriah-assessment/core.js');
const clone = v => v == null ? null : structuredClone(v);
const identities = {
  teacherA: { uid: 'fictional-teacher-a', email: 'teacher-a@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  teacherB: { uid: 'fictional-teacher-b', email: 'teacher-b@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  principal: { uid: 'fictional-principal', email: 'principal@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  owner: { uid: 'fictional-owner', email: 'owner@funtorahtools-staging.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  studentA: { uid: 'fictional-student-a-auth', b3StudentRole: 'student', b3StudentId: 'fictional-alef', b3ClassId: 'kriah-test-et' },
  studentB: { uid: 'fictional-student-b-auth', b3StudentRole: 'student', b3StudentId: 'fictional-beis', b3ClassId: 'kriah-test-wt' }
};
function memoryStore() {
  const data = {}, reads = [], writes = [];
  function get(path) { let value = data; for (const k of path.split('/')) value = value?.[k]; return clone(value); }
  function set(path, value) { const parts = path.split('/'); let row = data; parts.slice(0, -1).forEach(k => row = row[k] || (row[k] = {})); if (value == null) delete row[parts.at(-1)]; else row[parts.at(-1)] = clone(value); }
  return {
    data, reads, writes,
    async get(path) { const value = get(path); reads.push({ path, bytes: Buffer.byteLength(JSON.stringify(value)) }); return value; },
    async set(path, value) { writes.push(path); set(path, value); },
    async update(changes) { Object.entries(changes).forEach(([p, v]) => { writes.push(p); set(p, v); }); },
    async change(path, fn) { const value = fn(get(path)); writes.push(path); set(path, value); return clone(value); },
    async list(path, { limit, before, prefix }) { const entries = Object.entries(get(path) || {}).filter(([k]) => (!before || k < before) && (!prefix || k.startsWith(prefix))).sort(([a], [b]) => a.localeCompare(b)).slice(-limit); const value = Object.fromEntries(entries); reads.push({ path, limit, bytes: Buffer.byteLength(JSON.stringify(value)) }); return value; }
  };
}
function memoryAudio() {
  const objects = new Map(), reads = [];
  return { objects, reads,
    async create(path, bytes, type, hash) { const old = objects.get(path); if (old && old.hash !== hash) throw Object.assign(new Error('Original recording already exists.'), { code: 409 }); if (!old) objects.set(path, { bytes: Buffer.from(bytes), hash, type }); },
    async read(path) { reads.push(path); const value = objects.get(path); if (!value) throw Object.assign(new Error('Audio not found.'), { code: 404 }); return value.bytes.toString('base64'); },
    async remove(path) { objects.delete(path); }
  };
}
const example = { title: 'Fictional mixed review', level: 'Teacher-defined · Stage 1', type: 'Mixed review', unitType: 'letter', text: 'בָּ בַ בֶ בֵ בִ בֹ וּ בֻ בְ בֱ בֲ בֳ שׁ שׂ ך ם ן ף ץ', pronunciation: 'Teacher accepts the chosen Ashkenazic or Sephardic pronunciation. No automatic judgement.', countSelfCorrection: false };
async function fixture() {
  const store = memoryStore(), audio = memoryAudio();
  for (const [classId, sid, name, teacher] of [['kriah-test-et', 'fictional-alef', 'Student Alef (fictional)', 'teacherA'], ['kriah-test-wt', 'fictional-beis', 'Student Beis (fictional)', 'teacherB']]) {
    await store.set(WS + 'classes/' + classId, { name: classId.endsWith('et') ? 'ET · fictional test' : 'WT · fictional test', active: true, kriahSynthetic: true, toolGrants: { 'kriah-assessment': true }, members: { [sid]: { active: true } } });
    await store.set(WS + 'teachers/' + identities[teacher].uid, { active: true, classIds: { [classId]: true } });
    await store.set('b3Games/students/' + sid, { profile: { name, active: true, kriahSynthetic: true }, memberships: { fixture: { active: true, classId, workspaceId: 'b3-2026' } } });
  }
  await store.set(WS + 'teachers/' + identities.principal.uid, { active: true, accountType: 'principal', classIds: { 'kriah-test-et': true } });
  const service = createService({ projectId: PROJECT, store, audio });
  for (const [actor, classId] of [['teacherA', 'kriah-test-et'], ['teacherB', 'kriah-test-wt']]) await service.handle(identities[actor], { action: 'saveExercise', classId, exerciseId: 'fictional-mixed-review', exercise: Core.exercise(example) });
  store.reads.length = 0; store.writes.length = 0;
  return { service, store, audio, identities };
}
async function start(port = 0) {
  const f = await fixture(), root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.url === '/api/kriah' && req.method === 'POST') {
        const identity = identities[req.headers['x-kriah-fixture-actor']];
        let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 3000000) throw Object.assign(new Error('Request too large.'), { code: 400 }); }
        const result = await f.service.handle(identity, JSON.parse(text)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/kriah-assessment/')) { res.writeHead(404); res.end('Local fictional Kriah demo only.'); return; }
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(path.join(root, 'kriah-assessment') + path.sep)) { res.writeHead(403); res.end(); return; }
      const resolved = file.endsWith(path.sep) ? path.join(file, 'index.html') : file;
      res.setHeader('Content-Type', resolved.endsWith('.js') ? 'text/javascript' : resolved.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.promises.readFile(resolved));
    } catch (error) { res.writeHead([400, 401, 403, 404, 409].includes(error.code) ? error.code : 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { ...f, server, url: 'http://127.0.0.1:' + server.address().port + '/kriah-assessment/index.html?fixture=1' };
}
if (require.main === module) start(Number(process.env.KRIAH_FIXTURE_PORT || 8764)).then(f => process.stdout.write(f.url + '\n'));
module.exports = { fixture, start, memoryStore, memoryAudio, identities, example };
