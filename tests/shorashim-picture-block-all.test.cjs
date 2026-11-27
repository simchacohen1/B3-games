const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..','shorashim',f),'utf8');
const js=read('teacher.js'),html=read('teacher.html'),app=read('app.js'),idx=read('index.html');

test('built-in drawings have stable block keys and both pages load them',()=>{
  const w={};vm.runInNewContext(read('builtin-pictures.js'),{window:w,encodeURIComponent});
  const all=w.FTT_BUILTIN_PICTURES.allBuiltIn();
  assert.equal(new Set(all.map(a=>a.key)).size,all.length);
  assert.ok(all.some(a=>a.key==='builtin:svg:eye')&&all.some(a=>a.key.startsWith('builtin:file:')));
  assert.ok(w.FTT_BUILTIN_PICTURES.illustrationsFor({id:'1-raah',english:'see',front:'ראה'}).every(a=>a.key));
  assert.ok(html.indexOf('builtin-pictures.js')<html.indexOf('teacher.js?v='));
  assert.ok(idx.indexOf('builtin-pictures.js')<idx.indexOf('app.js?v='));
});
test('student app hides blocked built-in drawings',()=>{
  assert.match(app,/illustrationsFor\(item\)\.filter\(a=>!blockedArtList\(\)\.includes\(a\.key\)\)/);
});
test('teacher grid lists every kind of picture, grouped with counts',()=>{
  assert.ok(!js.includes("!/^(data:|https?:)/.test(x)"));
  assert.match(js,/add\(i\.artPool\)/);
  for(const g of ['Animals','People','Food','Nature','Objects','Places','Symbols','Uploaded / Drawn / AI pictures'])assert.ok(js.includes(`'${g}'`));
  assert.match(js,/id="pictureCount"/);
  assert.match(js,/allCatalogItems\(\)/);
});
