const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
function setup() {
  let saved = JSON.stringify({games:{halacha:true,yiddish:false},classGames:{et:{halacha:false},wt:{halacha:false}},classAccess:{et:{mode:'locked'}}}), writes = 0;
  const context = {window:{},console,Intl,Date,localStorage:{getItem:()=>saved,setItem:(key,value)=>{saved=value;writes++;}}};
  vm.runInNewContext(fs.readFileSync('site-settings.js','utf8'),context);
  return {api:context.window.B3SiteSettings,read:()=>JSON.parse(saved),writes:()=>writes};
}
test('reopen and relock both classes with one save per click, preserving other settings',async()=>{
  const s=setup();
  for (const enabled of [true,false,true]) {
    const before=s.writes();
    await s.api.updateClassesGameEnabled(['et','wt'],'halacha',enabled);
    assert.equal(s.writes(),before+1);
    assert.equal(s.read().classGames.et.halacha,enabled);
    assert.equal(s.read().classGames.wt.halacha,enabled);
    assert.equal(s.read().games.yiddish,false);
    assert.equal(s.read().classAccess.et.mode,'locked');
  }
});
test('single-class toggle preserves the other class; invalid classes do not save',async()=>{
  const s=setup();
  await s.api.updateClassesGameEnabled(['et'],'halacha',true);
  assert.equal(s.read().classGames.wt.halacha,false);
  await assert.rejects(s.api.updateClassesGameEnabled(['invalid'],'halacha',true),/Unknown class/);
  assert.equal(s.writes(),1);
});
test('home padlocks use the combined save instead of parallel whole-settings writes',()=>{
  const home=fs.readFileSync('index.html','utf8');
  assert.match(home,/await settingsApi\.updateClassesGameEnabled\(classes,id,nextOpen\)/);
  assert.doesNotMatch(home,/Promise\.all\(classes\.map\(classId=>settingsApi\.updateClassGameEnabled/);
});
