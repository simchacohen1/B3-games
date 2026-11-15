'use strict';
// Issue #107: clear-cut Pasuk Practice grading bugs (no paid API calls).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const backend=fs.readFileSync('backend/functions/index.js','utf8');
const page=fs.readFileSync('record_pesukim/student.html','utf8');

// Pull one top-level declaration out of index.js without loading Firebase.
function block(src,start){
  const i=src.indexOf(start);assert.ok(i>=0,'missing '+start);
  let depth=0,seen=false;
  for(let j=src.indexOf('{',i);j<src.length;j++){
    if(src[j]==='{'){depth++;seen=true;}else if(src[j]==='}'){depth--;if(seen&&depth===0)return src.slice(i,j+1);}
  }
  throw new Error('unterminated '+start);
}
function referenceContext(){
  const calls=[];
  const ctx=vm.createContext({
    posukPracticeKehotCache:new Map(),POSUK_PRACTICE_KEHOT_VERSION:'Kehot',cleanSefariaEnglishText:x=>x,
    TORAH_UMESORAH_REFERENCE:{18:{1:'TU Genesis 18:1'}},
    fetch:async url=>{calls.push(decodeURIComponent(url));return {ok:true,json:async()=>({versions:[{text:['Kehot verse 1','Kehot verse 2']}]})};}
  });
  vm.runInContext(block(backend,'const POSUK_PRACTICE_BOOKS = {')+'\n'+block(backend,'function posukPracticeBook(')+'\n'+
    block(backend,'async function fetchPosukPracticeKehotReference(')+'\n'+block(backend,'function fetchPosukPracticeTorahUmesorahReference('),ctx);
  return {ctx,calls};
}

test('reference translations come from the sefer being practiced, not always Genesis',async()=>{
  const {ctx,calls}=referenceContext();
  assert.equal(ctx.posukPracticeBook('Shemos'),'Exodus');
  assert.equal(ctx.posukPracticeBook('Devarim'),'Deuteronomy');
  assert.equal(ctx.posukPracticeBook(''),'Genesis','older pages that send no sefer keep the old default');
  assert.equal(ctx.posukPracticeBook('Nonsense'),'','unknown sefer gets no reference rather than a wrong one');
  await ctx.fetchPosukPracticeKehotReference(3,1,1,'Shemos');
  await ctx.fetchPosukPracticeKehotReference(3,1,1,'Bereishis');
  assert.ok(calls[0].includes('Exodus 3'),calls[0]);
  assert.ok(calls[1].includes('Genesis 3'),calls[1]);
  assert.equal(calls.length,2,'Exodus 3 and Genesis 3 are cached separately');
  assert.equal(await ctx.fetchPosukPracticeKehotReference(3,1,1,'Nonsense'),'');
  assert.equal(ctx.fetchPosukPracticeTorahUmesorahReference(18,1,1,'Bereishis'),'TU Genesis 18:1');
  assert.equal(ctx.fetchPosukPracticeTorahUmesorahReference(18,1,1,'Shemos'),'','Torah Umesorah sheets are Bereishis only');
});

test('every reference lookup passes the sefer through',()=>{
  const kehot=[...backend.matchAll(/fetchPosukPracticeKehotReference\((.*?)\);/g)].map(m=>m[1]);
  const tu=[...backend.matchAll(/fetchPosukPracticeTorahUmesorahReference\((.*?)\);/g)].map(m=>m[1]);
  assert.equal(kehot.length,4);assert.equal(tu.length,5);
  for(const args of [...kehot,...tu])assert.match(args,/\.sefer$/,args);
});

test('grader prompts no longer credit a name just by its position',()=>{
  assert.doesNotMatch(backend,/sits in the same spot as a name/);
  assert.match(backend,/Do NOT pick an alternative merely because it matches the answer key/,'the evidence-based name rule stays');
});

test('every Haiku grader is deterministic (temperature 0)',()=>{
  const models=[...backend.matchAll(/model: "claude-haiku-4-5-20251001",\r?\n\s*\/\/[^\n]*\n\s*temperature: 0,/g)];
  const all=[...backend.matchAll(/model: "claude-haiku-4-5-20251001"/g)];
  assert.equal(all.length,3);
  assert.equal(models.length,all.length);
});

test('prompt and reference text is readable (no double-encoded characters)',()=>{
  assert.doesNotMatch(backend,/â€|Ã[\u0080-¿]|×[\u0080-¿]|Ö[\u0080-¿]/);
  assert.match(backend,/renders עֶדְנָה as "pleasure\/enjoyment,"/);
  assert.match(backend,/Adonoy\/י-ה-ו-ה/);
});

test('reading: Sefaria section markers are not sent as words to read',()=>{
  const m=page.match(/function textForReadingScore\(text\)\{[\s\S]*?\n\}/);assert.ok(m);
  const ctx=vm.createContext({});vm.runInContext(m[0],ctx);
  assert.equal(ctx.textForReadingScore('עַד הַיּֽוֹם׃ {ס}'),'עַד הַיּֽוֹם׃');
  assert.equal(ctx.textForReadingScore('א {פ} ב { ס }'),'א ב');
  assert.equal(ctx.textForReadingScore('בְּרֵאשִׁית בָּרָא'),'בְּרֵאשִׁית בָּרָא');
  assert.match(page,/formData\.append\("posukText", textForReadingScore\(currentPosukText\)\)/);
});

test('page sends the sefer with every graded or generated request',()=>{
  assert.equal((page.match(/formData\.append\('sefer', currentSefer \|\| ''\);/g)||[]).length,3);
  assert.equal((page.match(/sefer: currentSefer,\r?\n\s*perekNum: currentPerekNum,/g)||[]).length,2);
});
