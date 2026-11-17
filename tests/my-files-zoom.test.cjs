'use strict';
// My files: − and ＋ buttons make the tiles smaller or bigger (five sizes), so a student can see more files at once.
// The size is remembered, and it works in the grid and in the list.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../class-pointer-prototype/my-files-core.js');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('five sizes, one step at a time, never past the ends; bad saved values go back to the middle',()=>{
  assert.equal(M.ZOOM_MAX,4);assert.equal(M.ZOOM_DEFAULT,2);
  assert.equal(M.stepZoom(2,1),3);assert.equal(M.stepZoom(2,-1),1);
  assert.equal(M.stepZoom(4,1),4,'already biggest');assert.equal(M.stepZoom(0,-1),0,'already smallest');
  assert.equal(M.stepZoom(2,0),2);
  for(const bad of [undefined,null,'x',-1,5,1.5,NaN,'9'])assert.equal(M.cleanZoom(bad),2,String(bad));
  assert.equal(M.cleanZoom('3'),3);assert.equal(M.cleanZoom(0),0);
  assert.equal(M.stepZoom('nope',1),3,'a bad value starts from the middle');
});

test('the page has the − and ＋ buttons, remembers the size, and applies it to the grid and the list',()=>{
  const html=read('class-pointer-prototype/my-files.html'),js=read('class-pointer-prototype/my-files.js');
  assert.match(html,/id="zoomOut"[^>]*>−<\/button><button id="zoomIn"[^>]*>＋<\/button>/);
  assert.match(html,/aria-label="Smaller files: see more at once"/);assert.match(html,/aria-label="Bigger files"/);
  // remembered per student, like the view and the sort
  assert.match(js,/let tileZoom=M\.cleanZoom\(remembered\('zoom',String\(M\.ZOOM_DEFAULT\),\['0','1','2','3','4'\]\)\)/);
  assert.match(js,/remember\('zoom',String\(tileZoom\)\)/);
  assert.match(js,/\$\('zoomOut'\)\.disabled=tileZoom<=0;\$\('zoomIn'\)\.disabled=tileZoom>=M\.ZOOM_MAX/);
  assert.match(js,/\$\('filesList'\)\.className='mf-z'\+tileZoom/);
  // the PDF reader's own zoom is a different variable and is not touched
  assert.match(js,/let pdf=null,current=null,pageNumber=1,zoom=1,/);
  // sizes for both views, from the smallest to the biggest
  for(const level of [0,1,3,4])assert.match(html,new RegExp('#filesList\\.mf-z'+level+'\\{--mf-tile:\\d+px;--mf-thumb-h:\\d+px;--mf-row-w:\\d+px;--mf-row-h:\\d+px;--mf-font:\\d+px\\}'));
  assert.match(html,/minmax\(var\(--mf-tile,190px\),1fr\)/,'the grid columns follow the size');
  assert.match(html,/\.mf-list \.mf-thumb\{width:var\(--mf-row-w,72px\);height:var\(--mf-row-h,48px\)/,'the list rows follow the size');
  // the middle size is what the page looked like before
  assert.match(html,/#filesList\{--mf-tile:190px;--mf-thumb-h:120px;--mf-row-w:72px;--mf-row-h:48px;--mf-font:16px\}/);
  const px=level=>Number(html.match(new RegExp('#filesList\\.mf-z'+level+'\\{--mf-tile:(\\d+)px'))[1]);
  assert.ok(px(0)<px(1)&&px(1)<190&&190<px(3)&&px(3)<px(4),'five sizes, smallest to biggest');
  assert.match(html,/my-files-core\.js\?v=20261116-live2/);assert.match(html,/my-files\.js\?v=20261116-live2/);
});
