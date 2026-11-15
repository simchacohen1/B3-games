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
 assert.match(annotate,/const out=\[canSelect\(\)\?'select':'hand'\];/,'one arrow button: Select where it works, the plain Mouse elsewhere');
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
 assert.equal((down.match(/editInline\(/g)||[]).length,2,'a click with the Text tool types on the board: in words that are there, or new words on an empty spot');
 assert.ok(!down.includes('openTextEditor'),'no popup');
 assert.match(down,/if\(tool==='text'&&ready\)\{/);
 assert.match(down,/if\(tool==='select'\)\{if\(!usable\|\|!p\)return;if\(startSelect\(event,p\)\)\{event\.preventDefault\(\);event\.stopPropagation\(\)\}return\}/);
 assert.match(down,/if\(tool==='eraser'\)\{if\(!ready\|\|!p\)return;[^}]*eraseUnder\(event\);return\}/);
 assert.match(pdf,/function eraseUnder\(event\)\{const p=normalized\(event\),hit=p&&teacherMarkAt\(event,p,false\);if\(hit\)eraseBlock\(hit\)\}/);
});

test('the changed scripts get new cache versions',()=>{
 for(const file of ['classroom-core','annotation-toolbar','classroom','pdf-mode','classroom-annotate'])
  assert.match(html,new RegExp('"'+file+'\\.js\\?v=20261114-shapes14"'),file);
});

test('pasted words can be recolored and resized: a size click in Select goes to the picked mark',()=>{
 // Toolbar: the size buttons show in Select and reach the picked mark before the old behavior.
 assert.match(toolbar,/sizeBox\.hidden=!drawing&&st\.tool!=='select';/);
 assert.match(toolbar,/if\(st\.tool==='select'&&\(isDelegate\(now\)\?now\.delegate\.resize\?\.\(v\):resizeSelected\(now,v\)\)\)\{st\.sizeIndex=i;sync\(\);return\}/);
 assert.match(annotate,/resize:size=>!!window\.ClassPointerPdf\?\.resizeSelected\?\.\(size\)/);
 assert.match(pdf,/function resizeSelected\(size\)\{/);
 assert.match(pdf,/activityMarks,recolorSelected,resizeSelected,/);
 // The lesson accepts only its three sizes, so a text mark changed this way stays valid for every student page.
 const store=new C.HighlightStore();
 store.add('teacher',{tool:'text',color:'#1f2937',size:.016,points:[{x:.3,y:.3},{x:.5,y:.34}],text:'שלום'});
 const id=store.strokes[0].id;
 assert.equal(store.replace('teacher',id,{...store.strokes[0],size:.028,color:'#c62828'}),true);
 assert.equal(store.strokes[0].size,.028);assert.equal(store.strokes[0].color,'#c62828');assert.equal(store.strokes[0].text,'שלום');
 // Words may be any size between the limits; anything else falls back to medium, as for a new mark.
 assert.equal(store.replace('teacher',id,{...store.strokes[0],size:.05}),true);
 assert.equal(store.strokes[0].size,.05);
 assert.equal(store.replace('teacher',id,{...store.strokes[0],size:.5}),true);
 assert.equal(store.strokes[0].size,.016);
 // A line or a shape still has only the three sizes.
 assert.equal(C.cleanStroke({tool:'rectangle',color:'#1f2937',size:.05,points:[{x:.1,y:.1},{x:.2,y:.2}]}).size,.016);
});

test('the lines of one pasted text are picked, moved, recolored and resized together, and sent once',()=>{
 assert.match(pdf,/function textBlock\(stroke,list=strokes\)\{/);
 assert.match(pdf,/upper\.color===lower\.color&&upper\.size===lower\.size&&Math\.abs\(lower\.points\[0\]\.y-upper\.points\[0\]\.y-lineStep\(upper\.size\)\)<\.004/);
 assert.match(pdf,/group:textBlock\(hit\)/);
 assert.match(pdf,/changeMarks\(textBlock\(stroke\)\.map\(item=>\[item\.id,\{\.\.\.item,color:color\.toLowerCase\(\)\}\]\)\)/);
 assert.match(classroom,/replaceMarks\(list\)\{if\(!isTeacher\|\|!Array\.isArray\(list\)\)return false;let changed=false;for\(const \[id,stroke\] of list\)changed=highlightStore\.replace\('teacher',id,stroke\)\|\|changed;if\(changed\)publishHighlights\(\);return changed\}/);
});

test('after a paste the teacher is pointed at Select, which is always on screen',()=>{
 assert.ok(!pdf.includes('Use “Edit latest text” to change it.'));
 assert.match(pdf,/Words pasted\. To change them, choose ⬚ Select on the toolbar and click the words/);
});

test('lines of words on the teacher whiteboard are spaced for the real size of the letters',()=>{
 const Clip=require('../class-pointer-prototype/board-clipboard.js');
 const width100=line=>line.length*50*2.4,opts={aspect:16/9,sizes:[.016],color:'#1f2937',center:{x:.5,y:.5}};
 const tight=Clip.textStrokes('one\ntwo',width100,opts).strokes,roomy=Clip.textStrokes('one\ntwo',width100,{...opts,scale:2.4}).strokes;
 assert.equal(tight.length,2);assert.equal(roomy.length,2);
 const step=list=>list[1].points[0].y-list[0].points[0].y;
 // Letters are drawn 2.4 x size tall (as a share of the width), so a line needs at least that much room.
 assert.ok(step(tight)<.016*2.4*16/9,'the old spacing was less than one letter height');
 assert.ok(Math.abs(step(roomy)-.016*1.25*2.4*16/9)<1e-6);
 // Student boards (no scale) are laid out exactly as before.
 assert.deepEqual(Clip.textStrokes('one\ntwo',width100,{...opts,scale:1}).strokes,tight);
 assert.match(pdf,/clip\.flowText\(text,width100,\{aspect:W\/Math\.max\(1,H\),scale:TEXT_SCALE,block:newBlockId\(\),\.\.\.opts\}\)/);
 assert.match(pdf,/const lineStep=size=>size\*1\.25\*TEXT_SCALE\*W\/Math\.max\(1,H\);/);
});

test('a block of words is edited and removed as one piece',()=>{
 // The edit box opens with every line of the block, and saving replaces the whole block.
 assert.match(pdf,/block=textBlock\(target,B\.highlights\?\.\(\)\|\|strokes\);const f=blockFrame\(block\);/);
 assert.match(pdf,/size=f\.size;color=block\[0\]\.color;value=f\.text;rtl=f\.rtl;top=f\.top;/);
 assert.match(pdf,/const block=stroke\.block\?\.length\?stroke\.block:\[stroke\],made=reflow\(block,\{text\}\);/);
 // Delete and the Eraser take every line.
 assert.match(pdf,/function eraseBlock\(stroke\)\{const ids=textBlock\(stroke\)\.map\(item=>item\.id\);return ids\.length>1\?B\.eraseMarks\?\.\(ids\):B\.eraseMark\?\.\(ids\[0\]\)\}/);
 assert.match(classroom,/eraseMarks\(ids\)\{if\(!isTeacher\|\|!Array\.isArray\(ids\)\)return false;/);
});

test('the bar under the lesson is as wide as its buttons, so Edit latest text is not pushed off the screen',()=>{
 const css=read('class-pointer-prototype/classroom.css');
 assert.match(css,/#pdfNav\{position:absolute;z-index:6;left:50%;bottom:12px;transform:translateX\(-50%\);width:max-content;display:flex;flex-wrap:wrap;[^}]*max-width:calc\(100% - 24px\)/);
 assert.match(html,/classroom\.css\?v=20261114-shapes14/);
});

test('words are drawn in the font they are measured in, so a wrapped line stays on the board',()=>{
 // Wrapping measures with "100px sans-serif" and the class picture paints with "px sans-serif".
 assert.match(pdf,/ctx\.font='100px sans-serif'/);
 assert.match(pdf,/svg\('text',\{x:first\.x\*W,y:first\.y\*H,'font-family':'sans-serif','font-size':/);
});


// ---------- Words as one block that is laid out again (one line when it fits; corner and side handles) ----------
const Clip=require('../class-pointer-prototype/board-clipboard.js');
// Every letter is half the size wide, so the arithmetic below is easy to follow.
const letters=line=>line.length*50,LONG='aaaa bbbb cccc dddd eeee'; // 24 letters

test('words stay on one line when they fit the board, and wrap only when they do not',()=>{
 // 24 letters at .05 are .6 wide: one line. At .08 they are .96 wide, more than the board less its margins: two lines.
 const one=Clip.flowText(LONG,letters,{size:.05,center:{x:.5,y:.5},block:'b1'});
 assert.deepEqual(one.strokes.map(s=>s.text),[LONG]);assert.equal(one.strokes[0].soft,undefined);
 const two=Clip.flowText(LONG,letters,{size:.08,center:{x:.5,y:.5},block:'b1'});
 assert.equal(two.strokes.length,2);
 assert.deepEqual(two.strokes.map(s=>!!s.soft),[false,true],'the second line only wrapped');
 for(const s of two.strokes){assert.equal(s.block,'b1');assert.ok(Math.abs(s.points[1].x-s.points[0].x)<=.92+1e-9)}
});

test('a wrapped block joins back into one line when the letters get smaller',()=>{
 const two=Clip.flowText(LONG,letters,{size:.08,center:{x:.5,y:.5}});
 assert.equal(Clip.blockText(two.strokes),LONG,'wrapped lines join with a space');
 const again=Clip.flowText(Clip.blockText(two.strokes),letters,{size:.03,left:two.frame.left,top:two.frame.top});
 assert.deepEqual(again.strokes.map(s=>s.text),[LONG]);
 assert.ok(Math.abs(again.strokes[0].points[0].y-two.strokes[0].points[0].y)<1e-3,'the top stays where it was');
});

test('a line break the writer chose is kept, a wrap is not',()=>{
 const made=Clip.flowText('aaaa bbbb cccc dddd eeee\nffff',letters,{size:.08,center:{x:.5,y:.5}});
 assert.deepEqual(made.strokes.map(s=>!!s.soft),[false,true,false]);
 assert.equal(Clip.blockText(made.strokes),'aaaa bbbb cccc dddd eeee\nffff');
 const small=Clip.flowText(Clip.blockText(made.strokes),letters,{size:.02,center:{x:.5,y:.5}});
 assert.deepEqual(small.strokes.map(s=>s.text),['aaaa bbbb cccc dddd eeee','ffff']);
});

test('the teacher can choose the width of the box, and the lines wrap to it',()=>{
 // .02 letters: 24 letters are .24 wide. A box .13 wide holds 13 letters a line.
 const narrow=Clip.flowText(LONG,letters,{size:.02,boxW:.13,left:.3,top:.2,block:'b2'});
 assert.deepEqual(narrow.strokes.map(s=>s.text),['aaaa bbbb','cccc dddd','eeee']);
 for(const s of narrow.strokes){assert.equal(s.boxW,.13);assert.equal(s.points[0].x,.3)}
 assert.ok(Math.abs(narrow.frame.width-.13)<1e-9);
 // Wider again: back to one line, and the box keeps the chosen width.
 const wide=Clip.flowText(Clip.blockText(narrow.strokes),letters,{size:.02,boxW:.5,left:.3,top:.2});
 assert.deepEqual(wide.strokes.map(s=>s.text),[LONG]);assert.equal(wide.strokes[0].boxW,.5);
});

test('Hebrew lines start at the right edge of the block, and the block never leaves the board',()=>{
 const made=Clip.flowText('אבגד הוזח טיכל מנסע פצקר',letters,{size:.08,right:.99,top:.9});
 assert.equal(made.frame.rtl,true);assert.equal(made.strokes.length,2);
 for(const s of made.strokes){assert.ok(s.points[0].x>s.points[1].x,'first point is the right end');for(const p of s.points)assert.ok(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)}
 assert.ok(made.frame.top+made.frame.height<=1+1e-9,'pushed up so both lines are on the board');
});

test('a block laid out again takes the place of the old lines in the pile, all or nothing',()=>{
 const store=new C.HighlightStore();
 store.add('teacher',{tool:'pen',color:'#1f2937',size:.016,points:[{x:.1,y:.1},{x:.2,y:.2}]});
 for(const s of Clip.flowText(LONG,letters,{size:.08,center:{x:.5,y:.5},block:'b1'}).strokes)assert.ok(store.add('teacher',s));
 store.add('student:a',{tool:'pen',color:'#57b8ff',size:.016,points:[{x:.3,y:.3},{x:.4,y:.4}]});
 const [pen,l1,l2,theirs]=store.strokes.map(s=>s.id);
 assert.deepEqual(store.strokes.slice(1,3).map(s=>[s.block,!!s.soft]),[['b1',false],['b1',true]],'the block id and the wrap mark are kept');
 const one=Clip.flowText(LONG,letters,{size:.03,center:{x:.5,y:.5},block:'b9'}).strokes;
 const made=store.swap('teacher',[l1,l2],one);
 assert.equal(made.length,1);
 assert.deepEqual(store.strokes.map(s=>s.id),[pen,made[0],theirs],'same place in the pile');
 assert.equal(store.strokes[1].size,.03);assert.equal(store.strokes[1].owner,'teacher');
 // Not someone else's marks, not marks that are gone, and nothing changes if one new mark is bad.
 assert.equal(store.swap('teacher',[theirs],one),null);
 assert.equal(store.swap('teacher',[l1],one),null);
 assert.equal(store.swap('teacher',made,[one[0],{tool:'text',color:'#1f2937',size:.03,points:[{x:.1,y:.1},{x:2,y:.2}],text:'bad'}]),null);
 assert.deepEqual(store.strokes.map(s=>s.id),[pen,made[0],theirs]);
});

test('on the teacher board words have corner handles for size and side handles for width',()=>{
 assert.match(pdf,/function textHandles\(f\)\{/);
 assert.match(pdf,/\{id:'nw',x:f\.left,y:f\.top\},\{id:'ne',x:f\.right,y:f\.top\},\{id:'sw',x:f\.left,y:f\.bottom\},\{id:'se',x:f\.right,y:f\.bottom\},\{id:'w',x:f\.left,y:mid\},\{id:'e',x:f\.right,y:mid\}/);
 // A side sets a chosen width; a corner sets the size and keeps the opposite corner where it is.
 assert.match(pdf,/made=reflow\(edit\.group,\{boxW:Math\.max\(\.08,h==='e'\?at\.x-f\.left:f\.right-at\.x\),fixX:h==='e'\?'left':'right'\}\);/);
 assert.match(pdf,/made=reflow\(edit\.group,\{size,boxW:f\.boxW\?Math\.min\(1,f\.boxW\*size\/f\.size\):0,fixX:h\[1\]==='w'\?'right':'left',fixY:h\[0\]==='n'\?'bottom':'top'\}\);/);
 assert.match(pdf,/const ids=B\.swapMarks\?\.\(done\.swap\.ids,done\.swap\.strokes\);if\(ids\)selectedId=ids\[0\];/);
 assert.match(classroom,/swapMarks\(ids,strokes\)\{if\(!isTeacher\)return null;const made=highlightStore\.swap\('teacher',ids,strokes\);if\(made\)publishHighlights\(\);return made\}/);
});

test('a paste picks the biggest size at which the words fit on one line',()=>{
 assert.match(pdf,/for\(const size of \[0\.028,0\.016,0\.008\]\)\{const tried=flow\(payload\.text,\{size,color:B\.ownColor\(\),center:\{x:\.5,y:\.5\}\}\);if\(tried\.strokes\.length&&!tried\.cut&&!tried\.strokes\.some\(line=>line\.soft\)\)\{made=tried;break\}\}/);
 assert.match(pdf,/if\(!made\)made=flow\(payload\.text,\{size:0\.016,color:B\.ownColor\(\),center:\{x:\.5,y:\.5\}\}\);/);
 // The lines of a block are found by its id first.
 assert.match(pdf,/if\(stroke\.block\)\{const same=list\.filter\(item=>item\.tool==='text'&&item\.owner===stroke\.owner&&item\.block===stroke\.block\);if\(same\.length\)return same\}/);
});

// ---------- Mouse mode on the lesson; nothing of the toolbar hidden behind the tabs ----------
test('one arrow button is both Select and the mouse on the teacher whiteboard, PDF and webpage',()=>{
 // The toolbar shows Select (as an arrow) instead of the Mouse there; a shared screen and students keep the Mouse.
 assert.match(annotate,/const out=\[canSelect\(\)\?'select':'hand'\];/);
 assert.match(annotate,/select:\['↖','Select',/);
 // With the arrow chosen the lesson is in mouse mode: no pointing, no drawing, the page scrolls and drags.
 assert.match(annotate,/const arrow=tool=>tool==='hand'\|\|tool==='select';/);
 assert.match(annotate,/B\.setNavigation\?\.\(arrow\(tool\)&&open\);/);
 assert.equal((annotate.match(/arrow\(s\.tool\)&&!B\.navigating\?\.\(\)\)B\.setNavigation\?\.\(true\);/g)||[]).length,2,'kept on for the teacher and the student');
 assert.match(annotate,/else if\(kind==='webpage'\)FA\.select\('select'\);/,'a webpage opens on the arrow');
 assert.ok(!annotate.includes('cpMouseBtn'),'no second button for the mouse');
 // The toolbar shows a surface's own name for a tool.
 assert.match(toolbar,/const own=s\.toolLabels\?\.\[tool\],usual=TOOLS\.find\(t=>t\[0\]===tool\),name=own\?own\[1\]:usual\[2\];/);
});

test('the arrow picks a drawing that is clicked; a click on nothing is a plain mouse click',()=>{
 // What the arrow can grab: a handle of the picked mark, or one of the teacher's own marks.
 assert.match(pdf,/function grabAt\(event\)\{\s*if\(!selecting\(\)\|\|notReady\(\)\)return false;/);
 assert.match(pdf,/return !!teacherMarkAt\(event,normalized\(event\),true\);/);
 // Dragging the page never starts on a mark; a click on nothing lets go of the pick and is the mouse's.
 const pan=pdf.slice(pdf.indexOf('let snapshotPan=null;'),pdf.indexOf("stage.addEventListener('pointermove'",pdf.indexOf('let snapshotPan=null;')));
 assert.match(pan,/if\(grabAt\(event\)\)return;\s*if\(inlineEdit\)finishInline\(true\);\s*if\(selectedId\)\{selectedId=null;drawInk\(\)\}/);
 assert.ok(pan.indexOf('if(grabAt(event))return;')<pan.indexOf('snapshotPan={id:event.pointerId'),'checked before the drag starts');
 // The lesson's own click handler does not swallow a click that picked nothing, so a PDF can still be dragged.
 assert.match(pdf,/drawInk\(\);return !!hit;/);
 // Picking works while the lesson is in mouse mode (the eraser and the text tool still need it off).
 assert.match(pdf,/usable=!notReady\(\)&&B\.live\(\)&&B\.writingAllowed\(\),ready=usable&&!B\.navigating\(\);/);
 // A normal arrow cursor, not a grabbing hand.
 assert.match(read('class-pointer-prototype/classroom.css'),/#stage\.mouse-navigation #pdfView,#stage\.mouse-navigation #pdfContent\{cursor:default\}/);
});

test('in Mouse mode a click on a link in the webpage opens that page for the class',()=>{
 assert.match(pdf,/function linkAt\(event\)\{/);
 assert.match(pdf,/const url=link&&Web\?\.cleanUrl\?\.\(link\.getAttribute\('data-lesson-link'\)\);/);
 // The copy keeps where a link led as plain text only; the link itself stays dead.
 const core=read('class-pointer-prototype/webpage-core.js');
 assert.match(core,/node\.removeAttribute\('href'\);node\.removeAttribute\('target'\);/);
 assert.match(core,/if\(dest\)node\.setAttribute\('data-lesson-link',dest\);else node\.removeAttribute\('data-lesson-link'\);/);
 assert.match(core,/if\(dest&&new URL\(dest\)\.hostname==='invalid\.invalid'\)dest=null;/);
 // Only a click that did not drag, only on a webpage, only while the Mouse is on (the pan was started in it).
 assert.match(pdf,/if\(!p\|\|event\.pointerId!==p\.id\|\|docLabel!=='webpage'\|\|Math\.hypot\(event\.clientX-p\.x,event\.clientY-p\.y\)>=5\)return;/);
 assert.ok(pdf.indexOf('const url=linkAt(event);if(!url)return;')<pdf.indexOf("forEach(type=>stage.addEventListener(type,stopSnapshotPan,true))"),'looked up before the drag is forgotten');
 // The copy still cannot run anything.
 assert.match(pdf,/iframe\.setAttribute\('sandbox','allow-same-origin'\)/);
 const Web=require('../class-pointer-prototype/webpage-core.js');
 assert.equal(Web.cleanUrl('javascript:alert(1)'),null);assert.equal(Web.cleanUrl('https://example.com/a'),'https://example.com/a');
});

test('the toolbar menus and the Students tip are not hidden behind the tabs row',()=>{
 const css=read('class-pointer-prototype/teacher-dashboard.css');
 assert.match(css,/\.cp-tabs-row\{position:relative;z-index:2147483646;/,'the tabs row is one layer above the toolbar');
 assert.match(toolbar,/#fttAnnotate\.fa-fly-open\{z-index:2147483647\}/);
 assert.match(toolbar,/fly\.hidden=false;root\.classList\.add\('fa-fly-open'\);placeFly\(\);/);
 assert.match(toolbar,/function closeFly\(\)\{flyOpen=null;flySig='';fly\.hidden=true;root\.classList\.remove\('fa-fly-open'\)\}/);
 assert.match(css,/\.app-header\.cp-header:has\(\.cp-students-hint:not\(\[hidden\]\)\)\{position:relative;z-index:2147483647\}/);
 assert.match(html,/teacher-dashboard\.css\?v=20261114-shapes14/);
});

// ---------- Typing right in the words on the board (no popup) ----------
test('a second click on picked words opens a text box in place, not a popup',()=>{
 // Select: the click must be on words that were already picked and must not drag.
 assert.match(pdf,/const again=!!hit&&hit\.tool==='text'&&!!picked&&textBlock\(picked\)\.some\(item=>item\.id===hit\.id\);/);
 assert.match(pdf,/if\(commit&&!done\.moved&&done\.again\)\{editInline\(done\.stroke\);return\}/);
 // Text tool: a click on words opens them in place; only an empty spot asks for new words in the dialog.
 assert.match(pdf,/if\(words\?\.tool==='text'\)\{editInline\(words\);return\}/);
 const down=pdf.slice(pdf.indexOf("content.addEventListener('pointerdown'"),pdf.indexOf('function extend(event)'));
 assert.ok(!/openTextEditor\((words|hit|stroke)\b/.test(down),'no popup for words that are already on the board');
});

test('the text box sits on the block: same place, color, size and width, and the block is not drawn under it',()=>{
 const body=pdf.slice(pdf.indexOf('function editInline(target){'),pdf.indexOf('function addTextStroke('));
 assert.match(body,/block=textBlock\(target,B\.highlights\?\.\(\)\|\|strokes\);const f=blockFrame\(block\);/);
 assert.match(body,/size=f\.size;color=block\[0\]\.color;value=f\.text;rtl=f\.rtl;top=f\.top;/);
 assert.match(body,/Object\.assign\(box\.style,\{left:left\*100\+'%',top:top\*100\+'%',width:\(right-left\)\*100\+'%',color\}\);/);
 assert.match(body,/left=f\.boxW\?f\.left:/,'a chosen width is kept');
 assert.match(body,/box\.value=value;/);assert.match(body,/box\.dir=fresh\?'auto':rtl\?'rtl':'ltr';/);
 assert.match(body,/open\.box\.style\.fontSize=Math\.max\(16\*width\/Math\.max\(1,W\),open\.size\*TEXT_SCALE\*width\)\+'px';/);
 assert.match(pdf,/let shown=inlineEdit\?strokes\.filter\(stroke=>!inlineEdit\.ids\.has\(stroke\.id\)\):strokes;/);
 const css=read('class-pointer-prototype/classroom.css');
 assert.match(css,/\.board-text-inline\{position:absolute;[^}]*font-family:sans-serif;[^}]*line-height:1\.25;/);
});

test('closing the text box keeps the change in place; Escape drops it; empty words are not saved',()=>{
 const body=pdf.slice(pdf.indexOf('function editInline(target){'),pdf.indexOf('function addTextStroke('));
 assert.match(body,/box\.addEventListener\('blur',\(\)=>finishInline\(true\)\);/);
 assert.match(body,/if\(event\.key==='Escape'\)\{event\.preventDefault\(\);finishInline\(false\)\}/);
 assert.match(body,/else if\(save&&text!==open\.before\)replaceTextStroke\(open\.stroke,text\);/);
 assert.match(body,/if\(save&&!text\.trim\(\)\)B\.status\(/);
 // Typing never reaches the lesson's shortcuts, the Delete key or the drawing tools.
 assert.match(body,/for\(const type of \['pointerdown','pointermove','pointerup','click','dblclick','keyup','paste'\]\)box\.addEventListener\(type,event=>event\.stopPropagation\(\)\);/);
 assert.match(body,/box\.addEventListener\('keydown',event=>\{\s*event\.stopPropagation\(\);/);
 // A click elsewhere on the board, another tool, or the lesson closing all close the box.
 assert.match(pdf,/if\(inlineEdit\)\{finishInline\(true\);event\.preventDefault\(\);event\.stopPropagation\(\);return\}\s*if\(isTeacher&&event\.button===0\)\{/,'that click only closes the box');
 assert.match(pdf,/addEventListener\('change',\(\)=>\{erasePid=null;finishInline\(true\);/);
 assert.match(pdf,/function unload\(hide\)\{\s*finishInline\(false\);/);
 // The changed words go back as the same block: same color, size and chosen width, and they stay picked.
 assert.match(pdf,/const block=stroke\.block\?\.length\?stroke\.block:\[stroke\],made=reflow\(block,\{text\}\);/);
 assert.match(pdf,/selectedId=selecting\(\)\?ids\[0\]:null;/);
});

// ---------- The whole whiteboard at a glance ----------
test('at 100% a whiteboard is shown whole; a PDF or webpage still fits the width',()=>{
 assert.match(pdf,/const base=fitWhole&&lay\.total>0\?Math\.min\(cw,Math\.floor\(ch\/lay\.total\)\):cw;\s*W=base\*zoom;H=W\*lay\.total;/);
 assert.match(pdf,/fitWhole=!!board;relayout\(\);scroller\.scrollTop=0;scroller\.scrollLeft=0;/);
 assert.match(pdf,/docLabel='webpage';fitWhole=false;await loadWebDoc\(data\)/);
 assert.match(pdf,/if\(isTeacher\)fitWhole=false; \/\/ a PDF fits the width/);
 // The arithmetic: a 16:9 board in a lesson area 1237 wide and 500 high is 888 wide, so all 500 of height show.
 const total=9/16,cw=1237,ch=500,base=Math.min(cw,Math.floor(ch/total));
 assert.equal(base,888);assert.ok(base*total<=ch);
 // A tall, narrow area is limited by its width instead.
 assert.equal(Math.min(600,Math.floor(900/total)),600);
});

test('students are told to show the whiteboard whole too',()=>{
 const Core=require('../class-pointer-prototype/pdf-core.js');
 assert.equal(Core.cleanView({zoom:1,top:0,left:0,whole:true}).whole,true);
 assert.equal(Core.cleanView({zoom:1,top:0,left:0}).whole,false);
 assert.equal(Core.cleanView({zoom:1,top:0,left:0,whole:'yes'}).whole,false);
 assert.match(pdf,/return\{zoom,top:P\.clamp\(scroller\.scrollTop\/H,0,1\),left:[^}]*\.\.\.layoutOpts,whole:fitWhole\};/);
 assert.match(pdf,/if\(!isTeacher&&'whole' in view\)fitWhole=view\.whole===true;/);
 assert.match(pdf,/function studentReset\(\)\{fitWhole=false;/);
});

test('the teacher workspace fills the window below whatever is above it, so the window does not scroll',()=>{
 const css=read('class-pointer-prototype/teacher-dashboard.css');
 assert.match(css,/body\.teacher-view\.cp-compact-workspace\{display:flex;flex-direction:column;height:100dvh;min-height:0\}/);
 assert.match(css,/body\.teacher-view\.cp-compact-workspace main\{flex:1 1 0;[^}]*height:auto;min-height:550px;/);
});


test('there is no popup at all: new words and Edit latest text use the text box on the board',()=>{
 assert.ok(!/pdfTextEditDialog|openTextEditor|showModal\(\);textEditInput|Save text/.test(pdf));
 // New words: the box is centered on the clicked spot, and the words land where the box was.
 assert.match(pdf,/editInline\(\{point:p,color:\$\(colorId\)\.value\|\|B\.ownColor\(\),size:Number\(\$\(sizeId\)\.value\)\}\);return;/);
 assert.match(pdf,/const half=Math\.max\(\.1,Math\.min\(target\.point\.x-margin,1-margin-target\.point\.x\)\);/);
 assert.match(pdf,/if\(open\.create\)\{if\(save&&text\.trim\(\)\)addTextStroke\(open\.create,text\)\}/);
 assert.match(pdf,/const made=flow\(text,\{size:spot\.size,color:spot\.color,center:spot\.point,top:spot\.top\}\);/);
 const made=Clip.flowText('one\ntwo',letters,{size:.02,center:{x:.3,y:.5},top:.4});
 assert.ok(Math.abs(made.strokes[0].points[0].y-.4)<1e-3,'the first line is where the typing box was');
 assert.ok(Math.abs((made.frame.left+made.frame.width/2)-.3)<1e-9,'centered on the clicked spot');
 // Edit latest text: the same box, on the words that were added last.
 const latest=pdf.slice(pdf.indexOf('function editLatestText(){'),pdf.indexOf("content.addEventListener('pointerdown'"));
 assert.match(latest,/editInline\(stroke\);/);
});
