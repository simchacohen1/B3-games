'use strict';
/* Opening the sharing window must never reload one that is already open: window.open(url, name) navigates an
   existing window to url, and a page reload ends a screen capture. Both places that open it (the activity pages in
   activity-share.js and the Class Pointer classroom page in student-boards.js) share one helper, tested here as it
   really is in each file. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const FILES=['class-pointer-prototype/activity-share.js','class-pointer-prototype/student-boards.js'];
const URL_='https://funtorahtools.com/class-pointer-prototype/student-share-window.html?pointerShare=1';

function helperOf(file){
  const m=/\/\* share-window-open:start \*\/([\s\S]*?)\/\* share-window-open:end \*\//.exec(read(file));
  assert.ok(m,file+' has the shared helper');
  return m[1];
}
const load=file=>vm.runInNewContext('(function(){'+helperOf(file)+'\nreturn openShareWindowOnce})()',{String,RegExp});
function fakeWindow(pathname){
  const w={focused:0,closed:0,navigations:[],focus(){this.focused++},close(){this.closed++},location:{pathname}};
  Object.defineProperty(w.location,'href',{get(){return ''},set(v){w.navigations.push(v)}});
  return w;
}
const opener=target=>({calls:[],open(...args){this.calls.push(args);if(target instanceof Error)throw target;return target}});

for(const file of FILES){
  const name=file.split('/').pop();
  test(name+': a sharing window that is already open is only brought to the front, never navigated',()=>{
    const open=load(file),existing=fakeWindow('/class-pointer-prototype/student-share-window.html'),win=opener(existing);
    const result=open(win,URL_,'classPointerStudentShare');
    assert.deepEqual(win.calls,[['','classPointerStudentShare']],'looked up by name with no address');
    assert.deepEqual(existing.navigations,[],'not reloaded');
    assert.equal(existing.focused,1);
    assert.equal(result.existing,true);assert.equal(result.win,existing);
  });
  test(name+': a new window comes back blank and is sent to the sharing page exactly once',()=>{
    const open=load(file),blank=fakeWindow('blank'),result=open(opener(blank),URL_,'classPointerStudentShare');
    assert.deepEqual(blank.navigations,[URL_]);
    assert.equal(result.existing,false);assert.equal(result.win,blank);
  });
  test(name+': a window with that name that is not the sharing page is sent to it; a blocked pop-up reports no window',()=>{
    const open=load(file),other=fakeWindow('/somewhere-else.html');
    assert.equal(open(opener(other),URL_,'n').existing,false);assert.deepEqual(other.navigations,[URL_]);
    assert.equal(open(opener(null),URL_,'n').win,null,'pop-up blocked');
    assert.equal(open(opener(new Error('blocked')),URL_,'n').win,null,'open() threw');
    const unreadable={location:{get pathname(){throw new Error('cross-origin')},set href(v){this.sent=v}},close(){this.closedIt=true}};
    assert.equal(open(opener(unreadable),URL_,'n').existing,false,'a window that cannot be read is treated as not ours');
    const stuck={location:{pathname:'blank',set href(v){throw new Error('no')}},close(){this.closedIt=true}};
    assert.equal(open(opener(stuck),URL_,'n').win,null);assert.equal(stuck.closedIt,true,'a blank window that cannot be navigated is closed');
  });
}
test('both pages use the very same helper',()=>{
  assert.equal(helperOf(FILES[0]).replace(/\s+/g,''),helperOf(FILES[1]).replace(/\s+/g,''));
});
test('no page ever calls window.open with the sharing address (it would reload an open sharing window)',()=>{
  for(const file of FILES){
    const src=read(file);
    assert.doesNotMatch(src,/window\.open\([^)]*student-share-window/,file);
    assert.doesNotMatch(src,/window\.open\(\s*url\.href/,file);
  }
});
test('the classroom page asks for its sharing window by name after a refresh, and says it is already open',()=>{
  const src=read('class-pointer-prototype/student-boards.js');
  assert.match(src,/openShareWindowOnce\(window,url\.href,'classPointerStudentShare'\)/);
  assert.match(src,/opened\.existing\?'Your sharing window is already open and keeps sharing/);
});
