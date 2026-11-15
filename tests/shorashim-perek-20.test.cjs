'use strict';
// Issue #571: Perek 20 support and a Bulk Add that never guesses the perek.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const U=require('../shorashim/units.js');

const read=p=>fs.readFileSync(p,'utf8');
const teacher=read('shorashim/teacher.js');
const teacherHtml=read('shorashim/teacher.html');

test('Bulk Add refuses to save when no perek is chosen',()=>{
  for(const blank of ['','   ',null,undefined]){
    const shared=U.bulkPerekChoice(blank);
    assert.equal(shared.ok,false);
    assert.match(shared.error,/Choose a perek/);
    const own=U.bulkPerekChoice(blank,{noPerekAllowed:true,noPerekChecked:false});
    assert.equal(own.ok,false);
  }
});

test('Bulk Add accepts 18, 19 and 20 and saves that exact number',()=>{
  for(const n of [18,19,20]){
    assert.deepEqual(U.bulkPerekChoice(String(n)),{ok:true,value:n});
    assert.deepEqual(U.bulkPerekChoice(` ${n} `,{noPerekAllowed:true}),{ok:true,value:n});
  }
});

test('Bulk Add rejects junk perek values',()=>{
  for(const bad of ['0','-1','2.5','abc','201'])assert.equal(U.bulkPerekChoice(bad).ok,false,bad);
});

test('"No perek" is only an explicit choice, and never in the shared ET/WT lists',()=>{
  // A teacher's own class: ticking "No perek" groups the words by list name.
  assert.deepEqual(U.bulkPerekChoice('',{noPerekAllowed:true,noPerekChecked:true}),{ok:true,value:null});
  // Shared ET/WT lists: students would see an untagged word as Perek 18, so it is refused.
  assert.equal(U.bulkPerekChoice('',{noPerekAllowed:false,noPerekChecked:true}).ok,false);
});

test('Perek labels: 18, 19, 20 and a fallback for later perakim',()=>{
  assert.equal(U.defaultUnitLabel('perek:18'),'Perek י״ח');
  assert.equal(U.defaultUnitLabel('perek:19'),'Perek י״ט');
  assert.equal(U.defaultUnitLabel('perek:20'),'Perek כ׳');
  assert.equal(U.defaultUnitLabel('perek:21'),'Perek כ״א');
  assert.equal(U.itemUnitLabel({perek:20,front:'x'}),'Perek כ׳');
  assert.equal(U.unitKey({perek:20}),'perek:20');
});

test('teacher page: Bulk Add perek starts empty, is required, and is not taken from the filter',()=>{
  assert.match(teacherHtml,/id="bulkPerek"[^>]*placeholder="Choose a perek/);
  assert.match(teacherHtml,/id="bulkNoPerek" type="checkbox"/);
  assert.match(teacher,/\$\('bulkPerek'\)\.value='';/);
  assert.doesNotMatch(teacher,/\$\('bulkPerek'\)\.value=\/\^\\d\+\$\/\.test\(pf\)/);
  assert.match(teacher,/bulkPerekChoice\(\$\('bulkPerek'\)\.value,\{noPerekAllowed:CLASS_MODE,/);
  // The refusal happens before any word is added or saved.
  const handler=teacher.slice(teacher.indexOf("$('saveBulkItems').onclick"));
  assert.ok(handler.indexOf('if(currentTrack===\'shorashim\'&&!bulkPerek.ok)')<handler.indexOf('l.push(item)'));
});
