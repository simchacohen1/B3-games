'use strict';
// "Switch student" stopped working when the PIN setup step was removed
// (c9063c6a): switchStudent still called the deleted resetPinForm(), threw
// before clearing anything, and left the student signed in.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('every plain function switchStudent calls is defined in index.html',()=>{
  const start=html.indexOf('  async function switchStudent(){');
  assert.ok(start>0,'switchStudent not found');
  const body=html.slice(start,html.indexOf('\n  }\n',start));
  const calls=[...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\(/g)].map(m=>m[1]);
  // Keywords, browser/JS globals and constructors are not page functions.
  const skip=new Set(['async','function','if','for','while','switch','catch','return','el','alert','confirm','fetch']);
  for(const name of new Set(calls)){
    if(skip.has(name)||name in globalThis||/^[A-Z]/.test(name))continue;
    assert.match(html,new RegExp('function '+name+'\\(|(const|let|var) '+name+'\\s*='),'switchStudent calls undefined '+name+'()');
  }
});
