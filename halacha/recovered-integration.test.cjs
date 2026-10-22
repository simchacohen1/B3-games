'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('halacha/index.html','utf8');
const integration=fs.readFileSync('halacha/illustrations-integration.js','utf8');
const source=fs.readFileSync('halacha/siman-c-source.js','utf8');

test('recovered package assets are integrated without replacing existing Siman 2 lessons',()=>{
  assert.match(html,/illustrations-integration\.js\?v=20261022-redesign2/);
  assert.match(html,/siman-c-source\.js\?v=20261022-authentic-text1/);
  const start=html.indexOf('const lessons=['),end=html.indexOf('];',start);
  const lessons=Function('return ('+html.slice(start,end+1).replace('const lessons=','')+')')();
  for(const id of ['s2a','s2b','s2extra','s2c','s2d','f'])assert.ok(lessons.some(l=>l.id===id),id);
  for(const id of ['s3a','s3b','s3c','s3d','s3e','s3f','s3g','s3h'])assert.ok(lessons.some(l=>l.id===id),id);
  assert.ok(integration.includes("s2a:[1,2],s2b:[3,4,5],s2extra:[3,4,5],s2c:[6,7,8],s2d:[9]"));
  assert.match(integration,/s3a:\[1\].*s3h:\[8\]/s);
  assert.match(source,/Transcribed with nekudot from Wikisource/);
  assert.match(integration,/Reveal English/);
  new vm.Script(integration);new vm.Script(source);
});

test('all 18 recovered PNGs exist and source contains eight distinct seifim',()=>{
  for(const [siman,count] of [[2,9],[3,8]])for(let n=1;n<=count;n++){
    const file=`halacha/recovered-art/siman-${siman}-seif-${String(n).padStart(2,'0')}.png`;
    const image=fs.readFileSync(file);assert.ok(image.length>1000,file);assert.deepEqual(image.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  }
  assert.ok(fs.readFileSync('halacha/recovered-art/siman-2-summary.png').length>1000);
  const context={window:{}};vm.runInNewContext(source,context);assert.equal(context.window.HalachaSimanCSource.length,8);
  assert.match(context.window.HalachaSimanCSource[7],/שְׁתֵּי נָשִׁים/);
});

test('coloring is bounded, uses the student scrapbook save path, and teacher preview is read only',()=>{
  assert.match(integration,/threshold=34/);
  assert.match(integration,/window\.add\(lessonId,'photo',html,0\)/);
  assert.match(integration,/window\.persist\(lessonId\)/);
  assert.match(integration,/readonly\(\)/);
  assert.match(integration,/Teacher preview is read only/);
  assert.match(integration,/Read seif/);
  assert.match(integration,/＋ Scrapbook/);
});
