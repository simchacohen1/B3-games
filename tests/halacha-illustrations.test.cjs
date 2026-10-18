'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.join('halacha');
const script=fs.readFileSync(path.join(root,'illustrated-seif-a.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const file=kind=>path.join(root,'art',kind);

test('Halacha illustration enhancement loads without replacing original lesson/save scripts',()=>{
  assert.match(html,/seif-a-teacher-led\.js/);
  assert.match(html,/scrapbook-editor\.js/);
  assert.match(html,/illustrated-seif-a\.js\?v=20261018-art1/);
  assert.match(html,/illustrated-seif-a\.css\?v=20261018-art1/);
  new vm.Script(script);
});

test('all original production scene and sticker images are valid local JPEG files',()=>{
  const scenes=['learning','walking','helping','speaking','alone','messy'];
  const stickers=['book','house','boy-walking','speech','table-chair','shtender','bed-window','globe','heart','thought','toybox','lamp'];
  for (const [folder,names] of [['scenes',scenes],['stickers',stickers]]) {
    for (const name of names) {
      const img=fs.readFileSync(path.join(file(folder),name+'.jpg'));
      assert.ok(img.length>1000,folder+'/'+name+' not a real image');
      assert.equal(img[0],0xff);
      assert.equal(img[1],0xd8);
      assert.equal(img[img.length-2],0xff);
      assert.equal(img[img.length-1],0xd9);
    }
  }
});

test('daily-life gallery retains five distinct scenes and original quiz feedback',()=>{
  for(const name of ['learning','walking','helping','speaking','alone']) {
    assert.match(script,new RegExp("file: '"+name+"'"));
  }
  assert.match(script,/\.hal-a-choices?/);
  assert.match(script,/messy\.jpg/);
  assert.match(script,/replaceChildren/);
  assert.doesNotMatch(script,/fetch\(|Firebase|cloudfunctions/i);
});

test('new scrapbook stickers reuse existing authorized save and teacher read-only controls',()=>{
  for(const name of ['book','house','boy-walking','speech','table-chair','shtender','bed-window','globe','heart','thought','toybox','lamp']) {
    assert.ok(script.includes("['"+name+"',"),'Missing '+name);
  }
  assert.match(script,/HALACHA_TEACHER_VIEW/);
  assert.match(script,/b\.disabled = isReadonly\(\)/);
  assert.match(script,/window\.add\('a', 'photo', tag, 0\)/);
  assert.match(script,/window\.persist\('a'\)/);
  assert.doesNotMatch(script,/<script|onerror\s*=/i);
});
