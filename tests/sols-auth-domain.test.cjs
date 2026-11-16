'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {applyAuthDomain} = require('../sols-site/auth-domain.cjs');
const config = fs.readFileSync(path.join(__dirname, '../firebase-config.js'), 'utf8');
test('SOLS build enables the owner-provisioned production custom domain', () => {
  assert.deepEqual(require('../sols-site/auth-domain.json'), {enabled:true, domain:'auth.sols.tools'});
});
test('generated production configs and inline fallbacks change together; staging and account resources stay separate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sols-auth-'));
  try {
    fs.writeFileSync(path.join(dir,'firebase-config.js'), config);
    fs.writeFileSync(path.join(dir,'teacher.html'), 'authDomain:"b3-games.firebaseapp.com"');
    fs.mkdirSync(path.join(dir,'staging'));
    const staging = 'authDomain:"fun-torah-tools-staging.firebaseapp.com"';
    fs.writeFileSync(path.join(dir,'staging/config.js'), staging);
    assert.equal(applyAuthDomain(dir,{enabled:false,domain:'auth.sols.tools'}),0);
    assert.equal(fs.readFileSync(path.join(dir,'firebase-config.js'),'utf8'), config);
    assert.equal(applyAuthDomain(dir,{enabled:true,domain:'auth.sols.tools'}),2);
    const generated = fs.readFileSync(path.join(dir,'firebase-config.js'),'utf8');
    for (const hostname of ['sols.tools','www.sols.tools']) {
      const context = {window:{}, location:{hostname}};
      vm.runInNewContext(generated, context);
      const original = {window:{},location:{hostname}};
      vm.runInNewContext(config, original);
      assert.deepEqual(JSON.parse(JSON.stringify(context.window.B3_FIREBASE_CONFIG)),
        {...JSON.parse(JSON.stringify(original.window.B3_FIREBASE_CONFIG)),authDomain:'auth.sols.tools'});
    }
    assert.equal(fs.readFileSync(path.join(dir,'staging/config.js'),'utf8'), staging);
    assert.equal(applyAuthDomain(dir,{enabled:true,domain:'auth.sols.tools'}),0);
    assert.throws(()=>applyAuthDomain(dir,{enabled:true,domain:'sols.tools'}));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('auth-only hosting cannot deploy functions or database rules or redirect the reserved handler', () => {
  const config = require('../firebase.auth-hosting.json');
  assert.deepEqual(Object.keys(config),['hosting']);
  assert.equal(config.hosting.site,'b3-games');
  assert.equal(config.hosting.public,'auth-hosting');
  assert.equal(config.hosting.rewrites,undefined);
  assert.equal(config.hosting.redirects,undefined);
});

test('every published production initializer uses the same domain; disabled builds retain the legacy fallback', () => {
  const root = path.join(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sols-auth-audit-'));
  const production = [];
  // Independently audit every shipped JS/HTML config, including named apps and
  // inline fallbacks, rather than maintaining a short list of known pages.
  const skip = /^(?:\.git|\.github|node_modules|backend|staging|sols-site|tests|e2e.*|docs|security|scripts|vendor|backup.*|preview.*)$/;
  function copy(folder, relative = '') {
    for (const entry of fs.readdirSync(folder, {withFileTypes:true})) {
      const rel = path.join(relative, entry.name), source = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (!skip.test(entry.name)) copy(source, rel); }
      else if (entry.isFile() && /\.(?:js|html?)$/.test(entry.name)) {
        const text = fs.readFileSync(source, 'utf8');
        if (/authDomain\s*:\s*["']b3-games\.firebaseapp\.com["']/.test(text)) production.push(rel);
        fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive:true});
        fs.writeFileSync(path.join(dir, rel), text);
      }
    }
  }
  try {
    copy(root);
    assert.ok(production.includes('firebase-config.js'));
    assert.ok(production.includes(path.join('shorashim', 'teacher.js')));
    assert.ok(production.length > 10, 'audit covers inline production fallbacks');
    const before = new Map(production.map(rel => [rel, fs.readFileSync(path.join(dir,rel),'utf8')]));
    assert.equal(applyAuthDomain(dir,{enabled:false,domain:'auth.sols.tools'}),0);
    for (const [rel, text] of before) assert.equal(fs.readFileSync(path.join(dir,rel),'utf8'),text);
    assert.equal(applyAuthDomain(dir,{enabled:true,domain:'auth.sols.tools'}),production.length);
    for (const [rel, text] of before) {
      assert.equal(fs.readFileSync(path.join(dir,rel),'utf8'),
        text.replace(/(authDomain\s*:\s*["'])b3-games\.firebaseapp\.com/g,'$1auth.sols.tools'), rel);
    }
    for (const rel of ['site-settings.js','admin.html','teacher-home.html','class-pointer-prototype/dashboard.js']) {
      assert.equal(fs.readFileSync(path.join(dir,rel),'utf8'),fs.readFileSync(path.join(root,rel),'utf8'),rel+' session/role code unchanged');
    }
    console.log('Audited production authDomain initializers: '+production.length);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
