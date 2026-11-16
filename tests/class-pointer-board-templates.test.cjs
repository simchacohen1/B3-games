'use strict';
// Teacher subject folders and templates for saved whiteboards. Both are only names written on the saved file
// (Storage custom metadata), so no rules, data paths or student data change.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../class-pointer-prototype/saved-work-core.js');
const saved=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/saved-work.js'),'utf8');

test('subject and template are written beside the file and read back checked',()=>{
  const meta=Core.fileMetadata({name:'Word boxes',kind:'whiteboard',subject:'  Chumash  ',template:true,savedAt:5});
  assert.equal(meta.subject,'Chumash');assert.equal(meta.template,'1');
  const file=Core.fileFromMetadata({name:'abc.json',size:3,customMetadata:meta});
  assert.equal(file.subject,'Chumash');assert.equal(file.template,true);
  // Plain files (and every student file) carry neither.
  const plain=Core.fileMetadata({name:'x',kind:'whiteboard'});
  assert.equal('subject' in plain,false);assert.equal('template' in plain,false);
  const back=Core.fileFromMetadata({name:'abc.json',customMetadata:plain});
  assert.equal(back.subject,'');assert.equal(back.template,false);
  // Odd values are cleaned: a long subject is cut, anything but "1" is not a template.
  assert.equal(Core.fileFromMetadata({name:'abc.json',customMetadata:{subject:'x'.repeat(200),template:'yes'}}).template,false);
  assert.ok(Core.fileFromMetadata({name:'abc.json',customMetadata:{subject:'x'.repeat(200)}}).subject.length<=Core.LIMITS.folderName);
});

test('whiteboards group by subject A to Z, newest first, files without a subject last',()=>{
  const f=(id,subject,savedAt)=>({id,subject,savedAt});
  const groups=Core.groupBySubject([f('a','Mishnayos',1),f('b','',9),f('c','Chumash',2),f('d','Chumash',7)]);
  assert.deepEqual(groups.map(g=>g.label),['Chumash','Mishnayos','Other']);
  assert.deepEqual(groups[0].files.map(x=>x.id),['d','c']);
  assert.equal(Core.groupBySubject([f('a','',1)])[0].label,'My whiteboards');
  assert.deepEqual(Core.groupBySubject([]),[]);
  assert.deepEqual(Core.subjectsOf([f('a','Navi',1),f('b','Chumash',1),f('c','Navi',1),f('d','',1)]),['Chumash','Navi']);
});

test('a template is never saved over: opening it gives a copy that is not tied to the file',()=>{
  assert.match(saved,/current=file\.template\?null:\{id:file\.id/);
  assert.match(saved,/if\(current&&!current\.template\)actions\.append\(button\('Save over/);
  assert.match(saved,/The template itself never changes/);
  assert.match(saved,/button\(file\.template\?'Use template':'Open',\(\)=>openBoard\(file,ui\),'main'\)/);
});

test('teacher save offers a folder and a template tick; no rules or data paths change',()=>{
  assert.match(saved,/subjectField\(await store\.list\(\)\.then\(Core\.subjectsOf/);
  assert.match(saved,/subject:subject\.value\(\),template:asTemplate\.checked/);
  assert.match(saved,/patch\(file,\{template:file\.template\?'':'1'\}\)/);
  assert.match(saved,/patch\(file,\{subject:/);
  assert.doesNotMatch(saved,/firebase\.database\(\)\.ref\([^)]*subject/);
});
