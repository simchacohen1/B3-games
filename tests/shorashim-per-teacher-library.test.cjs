'use strict';
// Issue #611: per-teacher Shorashim libraries and fully configurable perakim/lists/labels.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const U=require('../shorashim/units.js');

const read=p=>fs.readFileSync(p,'utf8');
const teacher=read('shorashim/teacher.js');
const teacherHtml=read('shorashim/teacher.html');
const app=read('shorashim/app.js');
const owner=read('owner-admin.html');

test('perek labels work for any perek, not only 18 and 19',()=>{
  assert.equal(U.hebrewNumeral(18),'י״ח');
  assert.equal(U.hebrewNumeral(19),'י״ט');
  assert.equal(U.hebrewNumeral(20),'כ׳');
  assert.equal(U.hebrewNumeral(15),'ט״ו');
  assert.equal(U.hebrewNumeral(16),'ט״ז');
  assert.equal(U.hebrewNumeral(1),'א׳');
  assert.equal(U.hebrewNumeral(50),'נ׳');
  assert.equal(U.defaultUnitLabel('perek:20'),'Perek כ׳');
  assert.equal(U.unitLabel('perek:20',{'perek:20':'Vayera part 2'}),'Vayera part 2');
});

test('teacher perek input accepts any whole perek or blank, and rejects junk',()=>{
  assert.deepEqual(U.parsePerekInput(''),{ok:true,value:null});
  assert.deepEqual(U.parsePerekInput(' 20 '),{ok:true,value:20});
  assert.deepEqual(U.parsePerekInput('1'),{ok:true,value:1});
  for(const bad of ['0','-3','2.5','abc','201'])assert.equal(U.parsePerekInput(bad).ok,false,bad);
});

test('units: perakim first in number order, then lists for words with no perek',()=>{
  const items=[{id:'a',perek:19},{id:'b',listName:'Animals'},{id:'c',perek:2},{id:'d'},{id:'e',perek:'19'},{id:'w',bookletWeek:3}];
  const units=U.unitsFor(items,{});
  assert.deepEqual(units.map(u=>u.key),['perek:2','perek:19','list:Animals','list:Main List']);
  assert.equal(units.find(u=>u.key==='perek:19').count,2);
  assert.equal(U.unitKey({bookletWeek:2,perek:18}),'booklet');
});

test('labels with characters Firebase forbids in keys are stored safely',()=>{
  const key='list:Week 1. A/B [x] #3 $';
  const stored=U.labelStorageKey(key);
  assert.doesNotMatch(stored,/[.#$/\[\]]/);
  assert.equal(U.unitLabel(key,{[stored]:'Custom'}),'Custom');
});

test('copying never overwrites or removes words the teacher already has',()=>{
  const teacherLib={shorashim:[{id:'x',front:'mine',english:'teacher edit'}]};
  const ownerWords={shorashim:[{id:'x',front:'owner',english:'owner version'},{id:'y',perek:20,front:'new'}],prefix:[{id:'p'}]};
  const {catalog,added}=U.mergeCatalogById(teacherLib,ownerWords);
  assert.equal(added,2);
  assert.equal(catalog.shorashim.find(i=>i.id==='x').english,'teacher edit');
  assert.ok(catalog.shorashim.some(i=>i.id==='y'));
  assert.equal(catalog.prefix.length,1);
  // The source is deep-copied, so later edits in the library never change the owner's object.
  catalog.shorashim.find(i=>i.id==='y').front='changed';
  assert.equal(ownerWords.shorashim[1].front,'new');
  // Filtered copy: only the chosen unit.
  const only20=U.mergeCatalogById({},ownerWords,(item,track)=>track==='shorashim'&&U.unitKey(item)==='perek:20');
  assert.deepEqual(only20.catalog.shorashim.map(i=>i.id),['y']);
  assert.equal(only20.catalog.prefix.length,0);
});

test('merging settings keeps the teacher\'s own labels and lists',()=>{
  const out=U.mergeSettings({unitLabels:{'perek:1':'Mine'},namedLists:{shorashim:['A']}},{unitLabels:{'perek:1':'Owner','perek:2':'Two'},namedLists:{shorashim:['B']}});
  assert.equal(out.unitLabels['perek:1'],'Mine');
  assert.equal(out.unitLabels['perek:2'],'Two');
  assert.deepEqual(out.namedLists.shorashim,['A','B']);
});

test('library paths are keyed by a valid teacher uid only',()=>{
  assert.equal(U.libraryPath('abcDEF_123-x'),'shorashimLibraries/abcDEF_123-x');
  for(const bad of ['','a/b','../x','a.b',null])assert.throws(()=>U.libraryPath(bad));
});

test('teacher page: no hardcoded perek choices and Bulk Add never guesses a perek',()=>{
  assert.doesNotMatch(teacherHtml,/<option value="1[89]">/);
  assert.match(teacherHtml,/id="tPerek" type="number"/);
  assert.match(teacherHtml,/id="bulkPerek" type="number"/);
  assert.doesNotMatch(teacher,/pf==='18'\?18:19/);
  assert.doesNotMatch(teacher,/Number\(\$\('tPerek'\)\.value\)\|\|18/);
  assert.doesNotMatch(teacher,/function perekOf\(i\)\{return Number\(i\?\.perek\)\|\|18\}/);
  assert.match(teacher,/parsePerekInput\(\$\('bulkPerek'\)\.value\)/);
  assert.ok(teacherHtml.indexOf('units.js?v=')>0&&teacherHtml.indexOf('units.js?v=')<teacherHtml.indexOf('teacher.js?v='));
});

test('student page: perek choices only accept units that exist in the class',()=>{
  assert.doesNotMatch(app,/choice!==18&&choice!==19/);
  assert.doesNotMatch(app,/Number\(item\?\.perek\)\|\|18/);
  // Only B3's own shared base lists keep the historical 18/19 tagging for untagged words.
  assert.match(app,/if\(!classSpaceId\)catalog\.shorashim\.forEach/);
});

test('teacher library migration copies the class into the library and never writes the class',()=>{
  const fnStart=teacher.indexOf('async function saveClassToLibrary(');
  const fnEnd=teacher.indexOf('\nfunction openLibraryDialog(',fnStart);
  const body=teacher.slice(fnStart,fnEnd);
  assert.ok(fnStart>0&&fnEnd>fnStart);
  assert.match(body,/libraryRef\(\)\.transaction/);
  assert.doesNotMatch(body,/SPACE|ROOT|\.set\(|\.update\(/);
  assert.match(teacher,/function libraryAvailable\(\)\{return CLASS_MODE&&CLASS_ID_VALID/);
});

test('owner grant writes only into the chosen teacher\'s library',()=>{
  const start=owner.indexOf('async function renderLibraryGrant(');
  const end=owner.indexOf('q("libraryTeacherSelect").onchange',start);
  const body=owner.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(body,/db\.ref\(U\.libraryPath\(uid\)\)\.transaction/);
  assert.doesNotMatch(body,/\.set\(|\.update\(|\/classes\//,'the owner grant must not touch any class or the owner\'s own lists');
  assert.match(owner,/<script src="shorashim\/units\.js/);
});

test('rules: each library is private to its teacher, the owner and active admins',()=>{
  for(const file of ['firebase-rules.json','firebase-rules.hardened.json']){
    const rules=JSON.parse(read(file)).rules;
    const node=rules.shorashimLibraries;
    assert.ok(node&&node.$uid,file);
    assert.equal(Object.keys(node).length,1,'no rule at the shorashimLibraries root itself');
    for(const perm of ['.read','.write']){
      const expr=node.$uid[perm];
      assert.equal(typeof expr,'string');
      assert.match(expr,/^auth != null && \(/);
      assert.match(expr,/\$uid == auth\.uid && root\.child\('b3Games\/workspaces\/b3-2026\/teachers\/' \+ auth\.uid \+ '\/active'\)\.val\(\) == true/);
      assert.match(expr,/auth\.token\.email_verified == true/);
      assert.match(expr,/b3Games\/admins\//);
      assert.doesNotMatch(expr,/\|\| true|auth != null\)?$/);
    }
  }
});

test('library panel still loads when stricter rules refuse the class student list',()=>{
  const loadAll=teacher.slice(teacher.indexOf('async function loadAll(){'),teacher.indexOf('function renderAll(){'));
  // The student list read is allowed to fail without stopping the rest of the class load.
  assert.match(loadAll,/\$\{SPACE\}\/students`\)\.once\('value'\)\.catch\(/);
  assert.match(loadAll,/state\.students=\(c&&c\.val\(\)\)\|\|\{\}/);
  // The library is set up after the class load whether it worked or failed, not inside it.
  assert.doesNotMatch(loadAll,/loadTeacherLibrary\(\)/);
  assert.match(teacher,/loadAll\(\)\.catch\([\s\S]{0,200}\)\.finally\(\(\)=>loadTeacherLibrary\(\)\)/);
  // Live student listeners have a cancel callback, so a refusal is a warning, not an uncaught error.
  assert.match(teacher,/studentsRef\.on\('child_added',applyStudent,studentsRefused\)/);
});

test('choosing a learning unit still accepts an older plain perek number',()=>{
  const vm=require('node:vm');
  const fn=app.split(/\r?\n/).find(l=>l.startsWith('function chooseLearningPerek('));
  assert.ok(fn,'chooseLearningPerek exists');
  const ctx=vm.createContext({
    followAllowsScreen:()=>true,bookletAllowed:()=>false,goScreen:()=>{},
    studentUnits:()=>[{key:'perek:18'},{key:'list:Animals'}],
    currentTrack:'',learningPerek:'',selectedItemKey:null
  });
  vm.runInContext(fn+'\nthis.pick=v=>{learningPerek="";chooseLearningPerek(v);return learningPerek;};',ctx);
  assert.equal(ctx.pick(18),'perek:18','a plain number from older callers');
  assert.equal(ctx.pick('perek:18'),'perek:18');
  assert.equal(ctx.pick('list:Animals'),'list:Animals');
  assert.equal(ctx.pick(19),'','a perek the class does not have is ignored');
});
