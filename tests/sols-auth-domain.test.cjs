'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {applyAuthDomain} = require('../sols-site/auth-domain.cjs');
const config = fs.readFileSync(path.join(__dirname, '../firebase-config.js'), 'utf8');
test('cutover remains off until owner completes external provisioning', () => {
  assert.deepEqual(require('../sols-site/auth-domain.json'), {enabled:false, domain:'auth.sols.tools'});
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
