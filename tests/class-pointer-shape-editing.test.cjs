'use strict';
// Class Pointer: change a mark after it is drawn. Select on every whiteboard (the teacher's lesson too),
// corner handles to resize, a color click recolors the picked mark; the pen and the eraser work over pasted
// words; shapes are as solid for the teacher as for the class.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const C=require('../class-pointer-prototype/classroom-core.js');
const toolbar=read('class-pointer-prototype/annotation-toolbar.js'),pdf=read('class-pointer-prototype/pdf-mode.js');
const annotate=read('class-pointer-prototype/classroom-annotate.js'),classroom=read('class-pointer-prototype/classroom.js');
const html=read('class-pointer-prototype/classroom.html');

// The pure move / resize helpers, taken out of the toolbar file and run on their own.
const start=toolbar.indexOf('// ---------- Changing a mark after it is drawn (Select) ----------'),end=toolbar.indexOf('// ---------- State ----------');
assert.ok(start>0&&end>start,'the helper block is in the toolbar');
const raw=vm.runInNewContext('const clamp01=v=>Math.max(0,Math.min(1,v));'+toolbar.slice(start,end)+';geometry');
// Values made inside the sandbox are copied out, so they compare as plain arrays and objects.
const plain=v=>v==null?v:JSON.parse(JSON.stringify(v));
const G={handlesOf:s=>plain(raw.handlesOf(s)),resizePoints:(...a)=>plain(raw.resizePoints(...a)),movePoints:(...a)=>plain(raw.movePoints(...a)),handleAt:(...a)=>plain(raw.handleAt(...a))};
const near=(a,b)=>Math.abs(a-b)<1e-9;
const same=(points,expected)=>{assert.equal(points.length,expected.length);points.forEach((p,i)=>assert.ok(near(p.x,expected[i][0])&&near(p.y,expected[i][1]),JSON.stringify(points)+' is not '+JSON.stringify(expected)))};

test('a shape has four corner handles, a line or arrow has its two ends, words have none',()=>{
 const rect={tool:'rectangle',points:[{x:.6,y:.2},{x:.2,y:.5}]};
 assert.deepEqual(G.handlesOf(rect).map(h=>[h.id,h.x,h.y]),[['nw',.2,.2],['ne',.6,.2],['sw',.2,.5],['se',.6,.5]]);
 for(const tool of ['line','arrow','pen-arrow'])assert.deepEqual(G.handlesOf({tool,points:[{x:.1,y:.1},{x:.4,y:.3}]}).map(h=>h.id),['p0','p1']);
 assert.deepEqual(G.handlesOf({tool:'text',points:[{x:.1,y:.1},{x:.3,y:.2}],text:'hi'}),[]);
 assert.equal(G.handlesOf({tool:'pen',points:[{x:.1,y:.1},{x:.2,y:.3},{x:.4,y:.2}]}).length,4);
});

test('dragging a corner resizes from the opposite corner',()=>{
 const rect={tool:'rectangle',points:[{x:.2,y:.2},{x:.6,y:.5}]};
 same(G.resizePoints(rect,'se',.8,.8),[[.2,.2],[.8,.8]]);
 same(G.resizePoints(rect,'nw',.1,.1),[[.1,.1],[.6,.5]]);
 // Drawn "backwards" (bottom right to top left): the same corners still move.
 same(G.resizePoints({tool:'ellipse',points:[{x:.6,y:.5},{x:.2,y:.2}]},'se',.8,.8),[[.8,.8],[.2,.2]]);
 // A freehand line is stretched with its box.
 same(G.resizePoints({tool:'pen',points:[{x:.2,y:.2},{x:.4,y:.4},{x:.6,y:.2}]},'se',1,.6),[[.2,.2],[.6,.6],[1,.2]]);
});

test('a resize can never turn a shape inside out, squeeze it to nothing, or leave the board',()=>{
 const rect={tool:'rectangle',points:[{x:.2,y:.2},{x:.6,y:.5}]};
 const squeezed=G.resizePoints(rect,'se',0,0);
 assert.ok(squeezed[1].x>squeezed[0].x&&squeezed[1].y>squeezed[0].y);
 for(const p of G.resizePoints(rect,'se',5,-3))assert.ok(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);
 // A flat stroke (no height) keeps its height instead of dividing by zero.
 for(const p of G.resizePoints({tool:'pen',points:[{x:.2,y:.3},{x:.5,y:.3},{x:.6,y:.3}]},'se',.9,.9))assert.ok(Number.isFinite(p.x)&&near(p.y,.3));
});

test('dragging an end of a line or arrow moves only that end',()=>{
 const arrow={tool:'pen-arrow',points:[{x:.1,y:.1},{x:.4,y:.3}]};
 same(G.resizePoints(arrow,'p1',.9,.2),[[.1,.1],[.9,.2]]);
 same(G.resizePoints(arrow,'p0',.3,.6),[[.3,.6],[.4,.3]]);
});

test('a moved mark keeps its shape and stays whole on the board',()=>{
 const rect={tool:'rectangle',points:[{x:.2,y:.2},{x:.6,y:.5}]};
 same(G.movePoints(rect,.1,.1),[[.3,.3],[.7,.6]]);
 same(G.movePoints(rect,5,5),[[.6,.7],[1,1]]);
 same(G.movePoints(rect,-5,-5),[[0,0],[.4,.3]]);
});

test('a handle is found only close to it',()=>{
 const rect={tool:'rectangle',points:[{x:.2,y:.2},{x:.6,y:.5}]};
 assert.equal(G.handleAt(rect,600+4,250-3,1000,500).id,'se');
 assert.equal(G.handleAt(rect,400,175,1000,500),null);
});

test('the lesson changes one of my own marks in place',()=>{
 const store=new C.HighlightStore();
 assert.ok(store.add('teacher',{tool:'rectangle',color:'#1f2937',size:.016,points:[{x:.2,y:.2},{x:.6,y:.5}]}));
 assert.ok(store.add('student:a',{tool:'pen',color:'#57b8ff',size:.016,points:[{x:.1,y:.1},{x:.2,y:.2}]}));
 assert.ok(store.add('teacher',{tool:'text',color:'#1f2937',size:.016,points:[{x:.3,y:.3},{x:.5,y:.36}],text:'שלום'}));
 const [rect,theirs,words]=store.strokes.map(s=>s.id);
 // Move + resize + recolor: same id, same owner, same place in the pile.
 assert.equal(store.replace('teacher',rect,{tool:'rectangle',color:'#c62828',size:.016,points:[{x:.3,y:.3},{x:.9,y:.9}]}),true);
 assert.deepEqual(store.strokes[0],{tool:'rectangle',color:'#c62828',size:.016,points:[{x:.3,y:.3},{x:.9,y:.9}],owner:'teacher',id:rect});
 assert.deepEqual(store.strokes.map(s=>s.id),[rect,theirs,words]);
 // The kind and the words cannot be changed this way.
 assert.equal(store.replace('teacher',words,{tool:'pen',color:'#1f2937',size:.016,points:[{x:.4,y:.4},{x:.6,y:.46}],text:'other'}),true);
 assert.equal(store.strokes[2].tool,'text');assert.equal(store.strokes[2].text,'שלום');
 // Not someone else's mark, not a mark that is gone, not a broken one, not a different number of points.
 assert.equal(store.replace('teacher',theirs,{tool:'pen',color:'#57b8ff',size:.016,points:[{x:.5,y:.5},{x:.6,y:.6}]}),false);
 assert.equal(store.replace('teacher','h99',{tool:'rectangle',color:'#c62828',size:.016,points:[{x:.3,y:.3},{x:.9,y:.9}]}),false);
 assert.equal(store.replace('teacher',rect,{tool:'rectangle',color:'#c62828',size:.016,points:[{x:.3,y:.3},{x:1.4,y:.9}]}),false);
 assert.equal(store.replace('teacher',rect,{tool:'rectangle',color:'#c62828',size:.016,points:[{x:.3,y:.3},{x:.5,y:.5},{x:.9,y:.9}]}),false);
 assert.deepEqual(store.strokes[0].points,[{x:.3,y:.3},{x:.9,y:.9}]);
});

test('only the teacher page can change or erase lesson marks, and the whole list is sent again',()=>{
 assert.match(classroom,/eraseMark\(id\)\{if\(!isTeacher\)return false;/);
 assert.match(classroom,/replaceMark\(id,stroke\)\{if\(!isTeacher\|\|!highlightStore\.replace\('teacher',id,stroke\)\)return false;publishHighlights\(\);return true\}/);
 // Students still may only add, undo and clear: no new message type reaches the teacher.
 assert.match(classroom,/\['point','pointer-hide','highlight','edit-highlights'\]\.includes\(message\.type\)/);
 assert.match(classroom,/\['undo','clear'\]\.includes\(message\.action\)/);
});

test('Select is offered on the teacher whiteboard, PDF and webpage, not on a shared screen or to students',()=>{
 assert.match(html,/<option value="eraser">Eraser<\/option><option value="select">Select<\/option>/);
 assert.equal((html.match(/value="select"/g)||[]).length,1,'only in the teacher tool menu');
 assert.match(annotate,/const canSelect=\(\)=>teacher&&allowed\('select'\)&&\['whiteboard','pdf','webpage'\]\.includes\(B\.lessonKind\?\.\(\)\);/);
 assert.match(annotate,/if\(canSelect\(\)\)out\.push\('select'\);/);
 assert.match(annotate,/recolor:color=>!!window\.ClassPointerPdf\?\.recolorSelected\?\.\(color\)/);
 // Select never moves the teacher's pointer for the class.
 assert.match(classroom,/\['eraser','select'\]\.includes\(\$\('teacherTool'\)\.value\)\)\{hideOwnPointer\(\);return\}/);
});

test('a color click recolors the picked mark and keeps the Select tool',()=>{
 const click=toolbar.slice(toolbar.indexOf('// Select: the color goes to the picked mark'),toolbar.indexOf("b.dataset.color=c;"));
 assert.match(click,/if\(st\.tool==='select'&&\(isDelegate\(now\)\?now\.delegate\.recolor\?\.\(c\):recolorSelected\(now,c\)\)\)\{st\.color=c;sync\(\);return\}/);
 assert.ok(click.indexOf("st.tool==='select'&&")<click.indexOf("st.tool='pen'"),'checked before the old switch to the pen');
 assert.match(pdf,/function recolorSelected\(color\)\{\s*if\(!selecting\(\)\|\|typeof color!=='string'\)return false;const stroke=selectedStroke\(\);if\(!stroke\)return false;/);
});

test('shapes are solid for the teacher too, not see-through like a highlighter',()=>{
 assert.match(pdf,/const PEN_TOOLS=\['pen','line','pen-arrow','rectangle','ellipse','triangle','text'\];/);
 assert.match(pdf,/const kind=PEN_TOOLS\.includes\(stroke\.tool\)\?'pen':/);
 assert.ok(!pdf.includes("const kind=['pen','text'].includes(stroke.tool)?'pen':"));
});

test('words are opened for editing only with Text or a second click in Select; other tools draw over them',()=>{
 const down=pdf.slice(pdf.indexOf("content.addEventListener('pointerdown'"),pdf.indexOf('function extend(event)'));
 assert.equal((down.match(/openTextEditor\(/g)||[]).length,1,'one way into the edit box from a click');
 assert.match(down,/if\(tool==='text'&&ready\)\{/);
 assert.match(down,/if\(tool==='select'\)\{if\(!ready\|\|!p\)return;event\.preventDefault\(\);event\.stopPropagation\(\);startSelect\(event,p\);return\}/);
 assert.match(down,/if\(tool==='eraser'\)\{if\(!ready\|\|!p\)return;[^}]*eraseUnder\(event\);return\}/);
 assert.match(pdf,/function eraseUnder\(event\)\{const p=normalized\(event\),hit=p&&teacherMarkAt\(event,p,false\);if\(hit\)B\.eraseMark\?\.\(hit\.id\)\}/);
});

test('the changed scripts get new cache versions',()=>{
 for(const file of ['classroom-core','annotation-toolbar','classroom','pdf-mode','classroom-annotate'])
  assert.match(html,new RegExp('"'+file+'\\.js\\?v=20261114-shapes1"'),file);
});
