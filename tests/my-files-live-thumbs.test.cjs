'use strict';
// My files: new things from the teacher show up without a refresh (with a short notice), and PDFs and worksheets show a
// small picture of page 1, loaded lazily.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../class-pointer-prototype/my-files-core.js');
const dir=path.join(__dirname,'../class-pointer-prototype');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const item=(key,extra={})=>({key,name:key,fromTeacher:true,...extra});

test('arrivals: only new things from the teacher count, never the first load', () => {
  assert.deepEqual(M.arrivals(null,[item('a')]),[], 'first load: nothing is new');
  assert.deepEqual(M.arrivals([{key:'a'}],[item('a'),item('b')]).map(x=>x.key),['b']);
  assert.deepEqual(M.arrivals([{key:'a'}],[item('a'),item('mine',{fromTeacher:false})]),[], 'the student\'s own new file is not a notice');
  assert.deepEqual(M.arrivals([{key:'a'},{key:'b'}],[item('a')]),[], 'a removed file is not a notice');
  assert.equal(M.arrivalText([]),'');
  assert.equal(M.arrivalText([item('x',{name:'Parsha sheet'})]),'New from your teacher: Parsha sheet');
  assert.match(M.arrivalText([item('1',{name:'One'}),item('2',{name:'Two'}),item('3',{name:'Three'})]),/^New from your teacher: 3 new files \(One, Two, …\)$/);
});

test('the page looks for new things every 30 seconds while it is showing, and only reloads when the list changed', () => {
  const saved=read('saved-work.js'),mine=read('my-files.js');
  assert.match(saved,/function watch\(onTick,every=30000\)/);
  assert.match(saved,/if\(busy\|\|document\.hidden\)return/, 'nothing runs while the page is hidden');
  assert.match(saved,/document\.addEventListener\('visibilitychange',back\)/, 'a look at once when the student comes back');
  assert.match(saved,/teacherPage\|\|typeof setInterval/, 'never on a teacher page');
  // the cheap look: names of the files (one list) and the worksheet ids; no file is downloaded
  const snap=saved.slice(saved.indexOf('async function snapshot'),saved.indexOf('function watch'));
  assert.match(snap,/listAll\(\)/);assert.doesNotMatch(snap,/getMetadata|download|getDownloadURL/);
  assert.match(mine,/Saved\.watch\(snap=>/);
  assert.match(mine,/if\(snap\.sig!==knownSig\)\{knownSig=snap\.sig;return refresh\(true\)\}/);
  assert.match(mine,/announce\(M\.arrivals\(lastKeys,items\)\)/);
  assert.match(read('my-files.html'),/id="mfNotice"[^>]*role="status"/);
});

test('the small pop-up follows the teacher too: it refreshes by itself and lists new worksheets', () => {
  const saved=read('saved-work.js');
  assert.match(saved,/dispatchEvent\(new CustomEvent\('ftt-myfiles-changed'/, 'a kept copy tells the open pop-up');
  assert.match(saved,/const stop=watch\(snap=>/);
  assert.match(saved,/ui\.dialog\.addEventListener\('close',\(\)=>\{stop\(\)/, 'the look stops when the pop-up closes');
  assert.match(saved,/Worksheet from your teacher · New/);
  assert.match(saved,/New from your teacher: /);
});

test('a PDF or worksheet shows page 1 as a small picture, made only when its tile is on screen, one at a time', () => {
  const mine=read('my-files.js');
  assert.match(mine,/else lazyPdfThumb\(item,thumb\)/, 'the icon is replaced only when there is no saved picture');
  assert.match(mine,/new IntersectionObserver\(/);assert.match(mine,/rootMargin:'200px'/);
  assert.match(mine,/pdfChain=pdfChain\.then\(/, 'one at a time');
  assert.match(mine,/getPage\(1\)/);assert.match(mine,/doc\.destroy\(\)/);
  assert.match(mine,/item\.kind==='pdf'\?\(\)=>store\.readPdf\(item\.files\[0\]\):item\.copy\?\(\)=>store\.readPdf\(item\.copy\):item\.sheet\?\(\)=>Saved\.worksheets\.read\(item\.sheet\.id\)/, 'the student\'s own copy first, then the teacher\'s PDF');
  assert.match(mine,/pdfThumbs\.set\(key,blob\|\|null\)/, 'a picture is made once per visit; a failed one leaves the icon');
});

test('new versions so students load it', () => {
  const html=read('my-files.html');
  for(const [f,v] of [['saved-work','20261117-send1'],['my-files-core','20261116-live2'],['my-files','20261116-live2']])assert.match(html,new RegExp(f+'\\.js\\?v='+v));
  assert.match(read('activity-share.js'),/saved-work\.js\?v=20261117-send1/);
  assert.match(read('classroom.html'),/saved-work\.js\?v=20261117-send1/);
});
