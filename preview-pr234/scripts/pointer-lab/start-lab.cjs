'use strict';
// One command to start the whole Pointer lab on this computer (see README.md):
//   Firebase Auth + Realtime Database emulators  ->  made-up class/students/teacher  ->  the lab website on http://localhost:8787
// Nothing here touches the real Firebase project. Press Ctrl+C (or close the window) to stop everything.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HOME = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'pointer-lab');
const DEPS = path.join(HOME, 'deps');
fs.mkdirSync(HOME, { recursive: true });
const log = m => console.log('[lab] ' + m);

// 1. the three small packages the lab's backend needs (downloaded once into a private folder)
if (!fs.existsSync(path.join(DEPS, 'node_modules', 'firebase-admin'))) {
  log('First run: installing firebase-admin, firebase-functions and express (about 60 MB, needs internet)...');
  fs.mkdirSync(DEPS, { recursive: true });
  fs.writeFileSync(path.join(DEPS, 'package.json'), '{"name":"lab-deps","version":"1.0.0"}');
  const r = spawnSync('npm', ['install', 'firebase-admin@12', 'firebase-functions@5', 'express@4', '--silent'], { cwd: DEPS, shell: true, stdio: 'inherit' });
  if (r.status !== 0) { console.error('npm install failed'); process.exit(1); }
}

// 2. Java 21 (the database emulator needs it)
function findJava21() {
  const local = process.env.LOCALAPPDATA || '';
  const bases = [path.join(local, 'Programs', 'Temurin-21'), path.join(local, 'Programs', 'Eclipse Adoptium', 'jdk-21'), 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java'];
  for (const b of bases) {
    if (!fs.existsSync(b)) continue;
    const stack = [b];
    for (let depth = 0; depth < 3 && stack.length; depth++) {
      for (const dir of stack.splice(0)) {
        if (fs.existsSync(path.join(dir, 'bin', 'java.exe')) && /21/.test(dir)) return dir;
        try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) stack.push(path.join(dir, e.name)); } catch { /* skip */ }
      }
    }
  }
  return null;
}
const java = findJava21();
if (!java) { console.error('Java 21 was not found. Install Temurin 21 (https://adoptium.net) and run this again.'); process.exit(1); }
const env = { ...process.env, JAVA_HOME: java, PATH: path.join(java, 'bin') + path.delimiter + process.env.PATH, LAB_DEPS: DEPS, LAB_REPO: ROOT };
log('Using Java at ' + java);

// 3. emulators, with this checkout's database rules
// use the rules file this checkout's firebase.json would deploy (it can be firebase-rules.hardened.json)
let rulesFile = 'firebase-rules.json';
try { rulesFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8')).database.rules || rulesFile; } catch { /* keep default */ }
if (process.env.LAB_RULES) rulesFile = process.env.LAB_RULES; // compare against another rules file
log('Database rules under test: ' + rulesFile);
fs.writeFileSync(path.join(HOME, 'firebase.json'), JSON.stringify({
  database: { rules: path.join(ROOT, rulesFile).replace(/\\/g, '/') },
  emulators: { auth: { host: '127.0.0.1', port: 9099 }, database: { host: '127.0.0.1', port: 9000 }, ui: { enabled: false }, singleProjectMode: true }
}, null, 1));
const children = [];
const emulatorLog = fs.openSync(path.join(HOME, 'emulators.log'), 'w');
children.push(spawn('firebase', ['emulators:start', '--only', 'auth,database', '--project', 'demo-pointer-lab'], { cwd: HOME, shell: true, env, stdio: ['ignore', emulatorLog, emulatorLog] }));

const up = port => new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
async function waitFor(port, name) {
  for (let i = 0; i < 120; i++) { if (await up(port)) return; await new Promise(r => setTimeout(r, 1000)); }
  throw new Error(name + ' did not start. See ' + path.join(HOME, 'emulators.log'));
}
function stopAll() { for (const c of children) { try { spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } } process.exit(0); }
process.on('SIGINT', stopAll); process.on('SIGTERM', stopAll);

(async () => {
  log('Starting the emulators (about 20 seconds)...');
  await waitFor(9099, 'Auth emulator'); await waitFor(9000, 'Database emulator');
  log('Creating the made-up class, students and teacher...');
  const seed = spawnSync(process.execPath, [path.join(__dirname, 'seed.cjs')], { env, stdio: 'inherit' });
  if (seed.status !== 0) throw new Error('seeding failed');
  children.push(spawn(process.execPath, [path.join(__dirname, 'server.cjs')], { env, stdio: 'inherit' }));
  await waitFor(8787, 'Lab website');
  console.log('\n==============================================================');
  console.log(' POINTER LAB IS RUNNING (isolated, made-up data only)');
  console.log('  Teacher : http://localhost:8787/_lab/login   -> "Sign in as the lab teacher"');
  console.log('  Students: http://localhost:8787/   Pointer Test Student A / 1111   and   Pointer Test Student B / 2222');
  console.log(' Leave this window open while testing. Close it (or Ctrl+C) to stop the lab.');
  console.log('==============================================================\n');
  if (process.argv.includes('--open')) spawn('cmd', ['/c', 'start', '', 'msedge', 'http://localhost:8787/_lab/login'], { stdio: 'ignore', detached: true }).unref();
})().catch(e => { console.error('[lab] ' + e.message); stopAll(); });
