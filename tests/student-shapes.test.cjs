'use strict';
// Students get the same Shapes menu as the teacher: outline and filled rectangle, circle and triangle, then line and arrow,
// and a clear Outline / Filled choice for a picked shape. This is the toolbar's own mark model (a student's whiteboard, a
// worksheet, a teacher's marks on a student's board or screen).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=path.join(__dirname,'../class-pointer-prototype');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const toolbar=read('annotation-toolbar.js');

// cleanItem and drawItem run as written in the file, with the constants they rely on.
function load(){
  const at=toolbar.indexOf('  function cleanItem(raw,opts={}){'),end=toolbar.indexOf('  const measurer=document.createElement');
  const line=re=>toolbar.match(re)[0];
  const code=[line(/  const KINDS=[^\n]*\n/),line(/  const CLOSED=[^\n]*\n/),line(/  const MAX_TEXT=[^\n]*\n/),line(/  const ALIGNS=[^\n]*\n/),line(/  const round=[^\n]*\n/),line(/  const validPoint=[^\n]*\n/),
    toolbar.slice(at,end),'this.api={cleanItem,drawItem};'].join('\n');
  const context={};vm.runInNewContext(code,context);return context.api;
}
const {cleanItem,drawItem}=load();
const P=[{x:.1,y:.2},{x:.5,y:.6}];
const item=(extra={})=>({id:'s1abc',tool:'rect',color:'#1f2937',size:.006,points:P,...extra});
const plain=o=>JSON.parse(JSON.stringify(o));

test('the Shapes menu is the teacher\'s: each closed shape twice, then line and arrow',()=>{
  const list=toolbar.match(/const SHAPES=\[(.*)\];/)[1];
  const kinds=[...list.matchAll(/\['([a-z]+)','([^']+)','([^']+)'\]/g)].map(m=>({id:m[1],icon:m[2],name:m[3]}));
  assert.deepEqual(kinds.map(k=>k.name),['Rectangle','Filled rectangle','Circle','Filled circle','Triangle','Filled triangle','Line','Arrow']);
  assert.deepEqual(kinds.map(k=>k.icon),['▭','▬','◯','⬤','△','▲','━','➜'],'the same icons as the teacher\'s menu');
  // A menu choice is a shape and whether it is filled; the arrow is not a filled "arro".
  const kind=vm.runInNewContext(toolbar.match(/  const CLOSED=[^\n]*\n/)[0]+toolbar.match(/  const KINDS=[^\n]*\n/)[0]+toolbar.match(/  const shapeKind=[^\n]*\n/)[0]+';id=>shapeKind(id)');
  assert.deepEqual(plain(kind('rectf')),{tool:'rect',fill:true});assert.deepEqual(plain(kind('rect')),{tool:'rect',fill:false});
  assert.deepEqual(plain(kind('ellipsef')),{tool:'ellipse',fill:true});assert.deepEqual(plain(kind('trianglef')),{tool:'triangle',fill:true});
  assert.deepEqual(plain(kind('triangle')),{tool:'triangle',fill:false});
  assert.deepEqual(plain(kind('line')),{tool:'line',fill:false});assert.deepEqual(plain(kind('arrow')),{tool:'arrow',fill:false});
});

test('marks: a triangle is a shape; only closed shapes can be filled; old marks are unchanged',()=>{
  assert.deepEqual(plain(cleanItem(item())),{id:'s1abc',tool:'rect',color:'#1f2937',size:.006,points:P},'an outline rectangle is exactly as before');
  assert.equal(cleanItem(item({tool:'triangle'})).tool,'triangle');
  for(const tool of ['rect','ellipse','triangle'])assert.equal(cleanItem(item({tool,fill:true})).fill,true,tool);
  for(const tool of ['line','arrow','pen','highlight'])assert.equal('fill' in cleanItem(item({tool,fill:true,points:tool==='pen'||tool==='highlight'?P:P})),false,tool);
  for(const bad of ['yes',1,{},'#ff0000'])assert.equal('fill' in cleanItem(item({fill:bad})),false,String(bad));
  assert.equal(cleanItem(item({tool:'triangle',points:[P[0]]})),null,'a triangle needs its two corners');
  assert.equal(cleanItem(item({tool:'star'})),null);
});

test('drawing: a triangle has three corners; a filled shape is filled with its color, an outline is not',()=>{
  const draw=extra=>{
    const calls=[];const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:(...a)=>{calls.push(String(k));return undefined},set:(t,k,v)=>{t[k]=v;return true}});
    drawItem(ctx,item(extra),p=>[p.x*100,p.y*100],100);return calls;
  };
  const filled=draw({tool:'triangle',fill:true}),open=draw({tool:'triangle'});
  assert.equal(filled.filter(c=>c==='lineTo').length,2);assert.ok(filled.includes('closePath'),'three corners, closed');
  assert.ok(filled.includes('fill')&&filled.includes('stroke'),'filled, and still outlined');
  assert.ok(!open.includes('fill')&&open.includes('stroke'),'the outline version is not filled');
  assert.ok(draw({tool:'ellipse',fill:true}).includes('fill'));assert.ok(!draw({tool:'ellipse'}).includes('fill'));
  assert.ok(draw({tool:'rect',fill:true}).includes('fill'));assert.ok(!draw({tool:'rect'}).includes('fill'));
  assert.ok(!draw({tool:'line',fill:true}).includes('fill'),'a line is never filled');
});

test('the toolbar makes filled shapes, and a picked shape gets an Outline / Filled choice for its own marks too',()=>{
  assert.match(toolbar,/const kind=st\.tool==='shape'\?shapeKind\(st\.shape\):\{tool:st\.tool,fill:false\},tool=kind\.tool;/);
  assert.match(toolbar,/\.\.\.\(kind\.fill\?\{fill:true\}:\{\}\)\};/);
  assert.match(toolbar,/function pickedItemShape\(s\)\{/);
  assert.match(toolbar,/if\(!item\|\|!CLOSED\.includes\(item\.tool\)\|\|item\.image\)return null;/,'a picture is not a shape');
  assert.match(toolbar,/changeItem\(now,item,\{fill:filled\?true:undefined\}\)/);
  // Clicking a filled shape anywhere inside picks it.
  assert.match(toolbar,/if\(inside\|\|s\.fill===true\)return true;/);
  // The Outline / Filled choice follows what is picked: the bar is redrawn when a mark is picked, put down or deleted.
  assert.match(toolbar,/const hit=topHit\(s,p,true\);selected=hit\?hit\.id:null;sync\(\);/);
  assert.match(toolbar,/commit\(s,next\);sync\(\);return true/);
  assert.match(toolbar,/e\.key==='Escape'&&selected\)\{selected=null;scheduleRender\(\);sync\(\)\}/);
  assert.match(toolbar,/\['rect','ellipse','triangle','line','arrow'\]\.includes\(d\.tool\)/,'a tiny triangle is dropped like any tiny shape');
});

test('a student\'s whiteboard keeps the fill and the triangle; the worksheet and the teacher\'s marks use the same checking',()=>{
  const boards=read('student-boards.js');
  assert.match(boards,/const ITEM_TOOLS=\['highlight','rect','ellipse','triangle','line','arrow','text'\]/);
  assert.match(boards,/if\(s\.fill===true&&\['rect','ellipse','triangle'\]\.includes\(tool\)&&s\.image==null\)out\.fill=true;/);
  assert.match(boards,/FTTAnnotate\.drawItem\(ctx,s,p=>\[p\.x\*w,p\.y\*h\],w\)/,'the board and the grid tiles are drawn by the toolbar\'s drawItem');
  // exported (saved) boards keep every field of a mark, so the fill is saved
  assert.match(boards,/strokes:(board|page)\.strokes\.map\(s=>\(\{\.\.\.s,points:/);
  // the worksheet page checks its saved marks with the toolbar's cleanItem and draws the page pictures with drawItem
  const mine=read('my-files.js');
  assert.match(mine,/FA\?\.cleanItem\(raw,\{idPrefix:'s',maxPoints:400\}\)/);assert.match(mine,/FA\.drawItem\(ctx,item,/);
  // the teacher's lesson keeps its own menu (it supplies its own list of shapes)
  assert.match(read('classroom-annotate.js'),/\['rectf','▬','Filled rectangle','rectangle',true\]/);
});

test('student pages load the new toolbar and board scripts (new versions)',()=>{
  const share=read('activity-share.js');
  const toolbarToken=share.match(/annotation-toolbar\.js\?v=([^'"]+)/)[1],boardsToken=share.match(/student-boards\.js\?v=([^'"]+)/)[1];
  assert.match(toolbarToken,/wb3$/);assert.match(boardsToken,/wb3$/);
  for(const page of ['chazara/index.html','chavrusa/index.html','gematria/index.html','halacha/index.html','shorashim/index.html','index.html'])
    assert.match(fs.readFileSync(path.join(__dirname,'..',page),'utf8'),/activity-share\.js\?v=20261126-lead1/,page);
  assert.match(read('my-files.html'),/annotation-toolbar\.js\?v=20261125-wb3/);
  assert.match(read('classroom.html'),/annotation-toolbar\.js\?v=20261125-wb3/);assert.match(read('classroom.html'),/student-boards\.js\?v=20261126-zn1/);
});

test('the teacher pencil on regular activity pages loads the current toolbar (new shapes)', () => {
  const g = fs.readFileSync(path.join(__dirname,'../teacher-global-controls.js'),'utf8');
  assert.match(g, /annotation-toolbar\.js\?v=20261125-wb3/);
  assert.doesNotMatch(g, /annotate1/);
});
