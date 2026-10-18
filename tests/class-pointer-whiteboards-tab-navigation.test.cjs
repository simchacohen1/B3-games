'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/workspace-layout.js'),'utf8');
test('Student whiteboards tab broadcasts class navigation',()=>{
  assert.match(source,/if\(id==='whiteboards'\)document\.dispatchEvent\(new Event\('classpointer:send-to-whiteboards'\)\)/);
  assert.match(source,/if\(chooser\)chooser\.click\(\);/);
});
test('Student screens tab does not automatically request whiteboards',()=>{
  const trigger=source.match(/if\(id==='whiteboards'\)document\.dispatchEvent\([^\n]+/g)||[];
  assert.equal(trigger.length,1);
});
test('the teacher tab does not bypass share consent or permissions',()=>{
  assert.doesNotMatch(source,/getDisplayMedia|classPointerShareAuth|permissionRevision/);
});
