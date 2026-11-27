'use strict';
// Whiteboard rich text: inside one text box, some words can have their own color, size, font and bold.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../class-pointer-prototype/classroom-core.js');
const K=require('../class-pointer-prototype/board-clipboard.js');
const dir=path.join(__dirname,'../class-pointer-prototype');
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const pdf=read('pdf-mode.js'),share=read('activity-share.js'),highlighting=read('highlighting.js');

const base={tool:'text',color:'#112233',size:.016,points:[{x:.1,y:.1},{x:.3,y:.12}],text:'hello world'};
const widthFor=()=>line=>line.length*50;
const flowOpts={size:.02,aspect:16/9,scale:1,block:'b1',color:'#112233',center:{x:.5,y:.5},runWidth:widthFor};

test('a text mark without runs is plain',()=>{
  assert.equal(C.richLine(base),false);
  assert.equal(C.cleanStroke(base).runs,undefined);
});

test('runs are kept only when valid and adding up to the line',()=>{
  const kept=C.cleanStroke({...base,runs:[{t:'hello ',c:'#FF0000',s:1.5},{t:'world',b:true,f:'serif',x:1}]});
  assert.equal(C.richLine(kept),true);
  assert.equal(kept.runs[0].c,'#ff0000');
  assert.equal(kept.runs[1].x,undefined);
  assert.equal(C.cleanStroke({...base,runs:[{t:'something else'}]}).runs,undefined);
  assert.equal(C.cleanStroke({...base,runs:'hello world'}).runs,undefined);
});

test('the share, highlight, board and picture paths all draw styled lines',()=>{
  assert.match(pdf,/C\.richLine\(stroke\)/);
  assert.match(pdf,/C\.drawRichText\(/);
  assert.match(pdf,/C\.richSvgText\(/);
  assert.match(share,/richSvgText/);
  assert.match(highlighting,/richSvgText/);
});

test('flowText with no spans is unchanged and styled spans produce runs',()=>{
  const text='hello big world of words that wrap around nicely';
  const plain=K.flowText(text,widthFor(),flowOpts);
  assert.equal(plain.strokes.every(s=>s.runs===undefined),true);
  const made=K.flowText(text,widthFor(),{...flowOpts,boxW:.3,spans:[{start:6,end:9,s:2,c:'#ff0000'},{start:10,end:15,b:true}]});
  assert.ok(made.strokes.length>=2);
  assert.ok(made.strokes[0].runs.some(r=>r.c==='#ff0000'&&r.s===2));
  assert.equal(made.strokes.every(s=>C.cleanStroke(s)!==null),true);
});

test('blockSpans recovers text and spans, and relaying out gives the same block',()=>{
  const text='hello big world of words that wrap around nicely';
  const opts={...flowOpts,boxW:.3,spans:[{start:6,end:9,s:2,c:'#ff0000'},{start:10,end:15,b:true}]};
  const made=K.flowText(text,widthFor(),opts);
  const back=K.blockSpans(made.strokes);
  assert.equal(back.text,text);
  assert.deepEqual(back.spans,opts.spans);
  assert.equal(JSON.stringify(K.flowText(back.text,widthFor(),{...opts,spans:back.spans}).strokes),JSON.stringify(made.strokes));
});

test('Hebrew keeps styled pieces',()=>{
  const made=K.flowText('שלום עולם יפה',widthFor(),{...flowOpts,spans:[{start:5,end:9,c:'#c62828',b:true}]});
  const line=made.strokes[0];
  assert.ok(line.points[0].x>line.points[1].x);
  assert.equal(line.runs.map(r=>r.t).join(''),'שלום עולם יפה');
  assert.ok(line.runs.some(r=>r.t==='עולם'&&r.b===true));
});
