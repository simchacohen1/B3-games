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
 assert.match(classroom,/replaceMark\(id,stroke\)\{if\(!isTeacher\|\|!highlightStore\.replace\(markOwner\(id\),id,stroke\)\)return false;publishHighlights\(\);return true\}/);
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
 const click=toolbar.slice(toolbar.indexOf('// Choosing a color (a swatch or the custom picker).'),toolbar.indexOf('function applyDelegate(){'));
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
 assert.match(down,/if\(startSelect\(event,p\)\)\{event\.preventDefault\(\);event\.stopPropagation\(\);return\}/);
 assert.match(down,/if\(tool==='eraser'\)\{if\(!ready\|\|!p\)return;[^}]*eraseUnder\(event\);return\}/);
 assert.match(pdf,/function eraseUnder\(event\)\{const p=normalized\(event\),hit=p&&teacherMarkAt\(event,p,false\);if\(hit\)eraseBlock\(hit\)\}/);
});

test('the changed scripts get new cache versions',()=>{
 assert.match(html,new RegExp('"classroom-core\\.js\\?v=20261116-wbplus1"'),'classroom-core');
 assert.match(html,/"classroom\.js\?v=20261117-send2"/,'classroom');
 assert.match(html,/"pdf-mode\.js\?v=20261116-wbplus3"/,'pdf-mode');
});

test('pasted words can be recolored and resized: a size click in Select goes to the picked mark',()=>{
 // Toolbar: the size buttons show in Select and reach the picked mark before the old behavior.
 assert.match(toolbar,/sizeBox\.hidden=\(!drawing&&st\.tool!=='select'\)\|\|\(st\.tool==='text'&&!!s\.ownTextSize\);/);
 assert.match(toolbar,/if\(st\.tool==='select'&&\(isDelegate\(now\)\?now\.delegate\.resize\?\.\(v\):resizeSelected\(now,v\)\)\)\{st\.sizeIndex=i;sync\(\);return\}/);
 assert.match(annotate,/resize:size=>!!window\.ClassPointerPdf\?\.resizeSelected\?\.\(size\)/);
 assert.match(pdf,/function resizeSelected\(size\)\{/);
 assert.match(pdf,/activityMarks,recolorSelected,resizeSelected,setFill,fillSelected,pickedShape,/);
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
 assert.match(classroom,/replaceMarks\(list\)\{if\(!isTeacher\|\|!Array\.isArray\(list\)\)return false;let changed=false;for\(const \[id,stroke\] of list\)changed=highlightStore\.replace\(markOwner\(id\),id,stroke\)\|\|changed;if\(changed\)publishHighlights\(\);return changed\}/);
});

test('after a paste the teacher is pointed at Select, which is always on screen',()=>{
 assert.ok(!pdf.includes('Use “Edit latest text” to change it.'));
 assert.match(pdf,/Words pasted\. To change them, choose 🖱️ Select on the toolbar and click the words/);
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
 assert.match(pdf,/clip\.flowText\(text,widthFor\(opts&&opts\.font,opts&&opts\.bold\),\{aspect:W\/Math\.max\(1,H\),scale:TEXT_SCALE,block:newBlockId\(\),\.\.\.opts\}\)/);
 assert.match(pdf,/const lineStep=size=>size\*1\.25\*TEXT_SCALE\*W\/Math\.max\(1,H\);/);
});

test('a block of words is edited and removed as one piece',()=>{
 // The edit box opens with every line of the block, and saving replaces the whole block.
 assert.match(pdf,/block=textBlock\(target,B\.highlights\?\.\(\)\|\|strokes\);const f=blockFrame\(block\);/);
 assert.match(pdf,/size=f\.size;bold=f\.bold;font=f\.font;color=block\[0\]\.color;value=f\.text;rtl=f\.rtl;top=f\.top;/);
 assert.match(pdf,/const block=stroke\.block\?\.length\?stroke\.block:\[stroke\],made=reflow\(block,\{text,size,bold,font\}\);/);
 // Delete and the Eraser take every line.
 assert.match(pdf,/function eraseBlock\(stroke\)\{const ids=textBlock\(stroke\)\.map\(item=>item\.id\);return ids\.length>1\?B\.eraseMarks\?\.\(ids\):B\.eraseMark\?\.\(ids\[0\]\)\}/);
 assert.match(classroom,/eraseMarks\(ids\)\{if\(!isTeacher\|\|!Array\.isArray\(ids\)\)return false;/);
});

test('the bar under the lesson is as wide as its buttons, so Edit latest text is not pushed off the screen',()=>{
 const css=read('class-pointer-prototype/classroom.css');
 assert.match(css,/#pdfNav\{position:absolute;z-index:6;left:50%;bottom:12px;transform:translateX\(-50%\);width:max-content;display:flex;flex-wrap:wrap;[^}]*max-width:calc\(100% - 24px\)/);
 assert.match(html,/classroom\.css\?v=20261116-wbplus1/);
});

test('words are drawn in the font they are measured in, so a wrapped line stays on the board',()=>{
 // Wrapping measures with "100px sans-serif" and the class picture paints with "px sans-serif".
 assert.match(pdf,/ctx\.font='100px sans-serif'/);
 assert.match(pdf,/svg\('text',\{x:first\.x\*W,y:first\.y\*H,'font-family':C\.fontStack\(stroke\.font\),'font-size':/);
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
 assert.match(classroom,/swapMarks\(ids,strokes\)\{if\(!isTeacher\|\|!Array\.isArray\(ids\)\|\|!ids\.length\)return null;const owner=markOwner\(ids\[0\]\);if\(!owner\|\|ids\.some\(id=>markOwner\(id\)!==owner\)\)return null;const made=highlightStore\.swap\(owner,ids,strokes\);if\(made\)publishHighlights\(\);return made\}/);
});

test('a paste picks the biggest size at which the words fit on one line',()=>{
 // The chosen text size first, then the smaller sizes down to 16; the first at which no line wraps wins.
 assert.match(pdf,/const chosen=labelOfSize\(textSize\),steps=\[chosen,\.\.\.\[\.\.\.TEXT_LABELS\]\.reverse\(\)\.filter\(label=>label<chosen&&label>=TEXT_FLOOR\)\];/);
 assert.match(pdf,/if\(tried\.strokes\.length&&!tried\.cut&&!tried\.strokes\.some\(line=>line\.soft\)\)\{made=tried;break\}/);
 assert.match(pdf,/if\(!made\)made=flow\(payload\.text,\{size:sizeOfLabel\(Math\.min\(chosen,Math\.max\(TEXT_FLOOR,steps\[steps\.length-1\]\)\)\),/);
 // The lines of a block are found by its id first.
 assert.match(pdf,/if\(stroke\.block\)\{const same=list\.filter\(item=>item\.tool==='text'&&item\.owner===stroke\.owner&&item\.block===stroke\.block\);if\(same\.length\)return same\}/);
});

// ---------- Mouse mode on the lesson; nothing of the toolbar hidden behind the tabs ----------
test('one arrow button is both Select and the mouse on the teacher whiteboard, PDF and webpage',()=>{
 // The toolbar shows Select (a computer mouse) instead of the Mouse there; a shared screen and students keep the Mouse.
 assert.match(annotate,/const out=\[canSelect\(\)\?'select':'hand'\];/);
 assert.match(annotate,/select:\['🖱️','Select',/,'drawn as a computer mouse');
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
 assert.match(pdf,/return !!teacherMarkAt\(event,point,true,true\)\|\|!!pictureAt\(point\);/);
 // Dragging the page never starts on a mark; a click on nothing lets go of the pick and is the mouse's.
 const pan=pdf.slice(pdf.indexOf('let snapshotPan=null;'),pdf.indexOf("stage.addEventListener('pointermove'",pdf.indexOf('let snapshotPan=null;')));
 assert.match(pan,/if\(grabAt\(event\)\)return;\s*if\(inlineEdit\)finishInline\(true\);\s*if\(selectedId\)\{selectedId=null;drawInk\(\)\}/);
 assert.match(pan,/if\(pictureEdits\.length&&selecting\(\)\)finishPictureEdit\(\);/);
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
 assert.match(html,/teacher-dashboard\.css\?v=20261117-send2/);
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
 assert.match(body,/size=f\.size;bold=f\.bold;font=f\.font;color=block\[0\]\.color;value=f\.text;rtl=f\.rtl;top=f\.top;/);
 assert.match(body,/Object\.assign\(box\.style,\{left:left\*100\+'%',top:top\*100\+'%',width:\(right-left\)\*100\+'%',color\}\);/);
 assert.match(body,/left=f\.boxW\?f\.left:/,'a chosen width is kept');
 assert.match(body,/box\.value=value;/);assert.match(body,/box\.dir=fresh\?'auto':rtl\?'rtl':'ltr';/);
 assert.match(body,/open\.box\.style\.fontSize=Math\.max\(4\*width\/Math\.max\(1,W\),open\.size\*TEXT_SCALE\*width\)\+'px';/);
 assert.match(pdf,/let shown=inlineEdit\?strokes\.filter\(stroke=>!inlineEdit\.ids\.has\(stroke\.id\)\):strokes;/);
 const css=read('class-pointer-prototype/classroom.css');
 assert.match(css,/\.board-text-inline\{position:absolute;[^}]*font-family:sans-serif;[^}]*line-height:1\.25;/);
});

test('closing the text box keeps the change in place; Escape drops it; empty words are not saved',()=>{
 const body=pdf.slice(pdf.indexOf('function editInline(target){'),pdf.indexOf('function addTextStroke('));
 assert.match(body,/box\.addEventListener\('blur',event=>\{if\(event\.relatedTarget&&textSizeBox\?\.contains\(event\.relatedTarget\)\)return;finishInline\(true\)\}\);/);
 assert.match(body,/if\(event\.key==='Escape'\)\{event\.preventDefault\(\);finishInline\(false\)\}/);
 assert.match(body,/else if\(save&&\(text!==open\.before\|\|open\.size!==open\.sizeBefore\|\|open\.bold!==open\.boldBefore\|\|open\.font!==open\.fontBefore\)\)replaceTextStroke\(open\.stroke,text,open\.size,open\.bold,open\.font\);/);
 assert.match(body,/if\(save&&!text\.trim\(\)\)B\.status\(/);
 // Typing never reaches the lesson's shortcuts, the Delete key or the drawing tools.
 assert.match(body,/for\(const type of \['pointerdown','pointermove','pointerup','click','dblclick','keyup','paste'\]\)box\.addEventListener\(type,event=>event\.stopPropagation\(\)\);/);
 assert.match(body,/box\.addEventListener\('keydown',event=>\{\s*event\.stopPropagation\(\);/);
 // A click elsewhere on the board, another tool, or the lesson closing all close the box.
 assert.match(pdf,/if\(inlineEdit\)\{finishInline\(true\);event\.preventDefault\(\);event\.stopPropagation\(\);return\}\s*if\(isTeacher&&event\.button===0\)\{/,'that click only closes the box');
 assert.match(pdf,/addEventListener\('change',\(\)=>\{erasePid=null;finishInline\(true\);/);
 assert.match(pdf,/function unload\(hide\)\{\s*finishInline\(false\);/);
 // The changed words go back as the same block: same color, size and chosen width, and they stay picked.
 assert.match(pdf,/const block=stroke\.block\?\.length\?stroke\.block:\[stroke\],made=reflow\(block,\{text,size,bold,font\}\);/);
 assert.match(pdf,/selectedId=selecting\(\)\?ids\[0\]:null;/);
});

// ---------- The whole whiteboard at a glance ----------
test('at 100% a whiteboard is shown whole; a PDF or webpage still fits the width',()=>{
 assert.match(pdf,/const base=fitWhole&&lay\.total>0\?Math\.min\(cw,Math\.floor\(ch\/lay\.total\)\):cw;\s*W=base\*zoom;H=W\*lay\.total;/);
 assert.match(pdf,/fitWhole=!!board;updateControls\(\);syncFit\(\);relayout\(\);scroller\.scrollTop=0;scroller\.scrollLeft=0;/);
 assert.match(pdf,/docLabel='webpage';fitWhole=false;syncFit\(\);await loadWebDoc\(data\)/);
 assert.match(pdf,/if\(isTeacher\)\{fitWhole=false;syncFit\(\)\} \/\/ a PDF fits the width/);
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
 assert.match(pdf,/if\(!isTeacher&&'whole' in view\)\{fitWhole=view\.whole===true;syncFit\(\)\}/);
 assert.match(pdf,/function studentReset\(\)\{fitWhole=false;syncFit\(\);/);
});

test('the teacher workspace fills the window below whatever is above it, so the window does not scroll',()=>{
 const css=read('class-pointer-prototype/teacher-dashboard.css');
 assert.match(css,/body\.teacher-view\.cp-compact-workspace\{display:flex;flex-direction:column;height:100dvh;min-height:0\}/);
 assert.match(css,/body\.teacher-view\.cp-compact-workspace main\{flex:1 1 0;[^}]*height:auto;min-height:550px;/);
});


test('there is no popup at all: new words and Edit latest text use the text box on the board',()=>{
 assert.ok(!/pdfTextEditDialog|openTextEditor|showModal\(\);textEditInput|Save text/.test(pdf));
 // New words: the box is centered on the clicked spot, and the words land where the box was.
 assert.match(pdf,/editInline\(\{point:p,color:\$\(colorId\)\.value\|\|B\.ownColor\(\),size:textSize\}\);return;/);
 assert.match(pdf,/const half=Math\.max\(\.1,Math\.min\(target\.point\.x-margin,1-margin-target\.point\.x\)\);/);
 assert.match(pdf,/if\(open\.create\)\{if\(save&&text\.trim\(\)\)addTextStroke\(\{\.\.\.open\.create,bold:open\.bold,font:open\.font\},text\)\}/);
 assert.match(pdf,/const made=flow\(text,\{size:spot\.size,color:spot\.color,bold:spot\.bold===true,font:spot\.font,center:spot\.point,top:spot\.top\}\);/);
 const made=Clip.flowText('one\ntwo',letters,{size:.02,center:{x:.3,y:.5},top:.4});
 assert.ok(Math.abs(made.strokes[0].points[0].y-.4)<1e-3,'the first line is where the typing box was');
 assert.ok(Math.abs((made.frame.left+made.frame.width/2)-.3)<1e-9,'centered on the clicked spot');
 // Edit latest text: the same box, on the words that were added last.
 const latest=pdf.slice(pdf.indexOf('function editLatestText(){'),pdf.indexOf("content.addEventListener('pointerdown'"));
 assert.match(latest,/editInline\(stroke\);/);
});


// ---------- A big board: full width, the bar below it, a slim top ----------
test('a new whiteboard is made in the shape of the lesson area, so it fills the width',()=>{
 const boards=read('class-pointer-prototype/student-boards.js');
 assert.match(boards,/const ratio=window\.ClassPointerPdf\.boardRatio\?\.\(\)\|\|9\/16;\s*const c=document\.createElement\('canvas'\);c\.width=1600;c\.height=Math\.round\(1600\*ratio\);/);
 assert.match(pdf,/exportPng,boardRatio,/);
 // The room under the tabs, less the bar; never an extreme shape.
 assert.match(pdf,/return width>200&&height>120\?Math\.max\(\.36,Math\.min\(\.75,height\/width\)\):9\/16;/);
 // With the board in the area's own shape, "whole" and "full width" are the same size.
 const cw=1252,ch=560,total=ch/cw;assert.equal(Math.min(cw,Math.floor(ch/total)),cw);
});

test('the bar of buttons sits below a whiteboard that is shown whole, and is slim',()=>{
 const css=read('class-pointer-prototype/classroom.css');
 assert.match(css,/#stage\.board-whole #pdfView\{bottom:var\(--pdf-nav-h,0px\)\}/);
 assert.match(css,/#stage\.board-whole #pdfNav \.pdf-btn\{min-height:30px;/);
 assert.match(pdf,/stage\.classList\.toggle\('board-whole',fitWhole\);/);
 assert.match(pdf,/stage\.style\.setProperty\('--pdf-nav-h',\(fitWhole&&nav&&!nav\.hidden\?nav\.offsetHeight\+8:0\)\+'px'\);/);
 assert.match(pdf,/new ResizeObserver\(syncFit\)\.observe\(nav\)/,'the room follows the bar when it is hidden or wraps');
 // Closing the lesson gives the room back.
 assert.match(pdf,/function closePdf\(quiet\)\{\s*fitWhole=false;syncFit\(\);/);
});

test('the top of the teacher workspace is slim and the message line shares the tabs row while a lesson is open',()=>{
 const css=read('class-pointer-prototype/teacher-dashboard.css');
 assert.match(css,/body\.teacher-view\.cp-compact-workspace \.cp-topbar\{padding:4px 12px;gap:8px;border-radius:10px\}/);
 assert.match(css,/body\.teacher-view\.cp-is-live \.cp-topbar-back\{display:none\}/);
 assert.match(css,/\.cp-tabs-spacer #connectionStatus\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
 assert.match(annotate,/if\(open&&spacer\)\{if\(statusLine\.parentNode!==spacer\)spacer\.appendChild\(statusLine\);/);
 assert.match(annotate,/placeStatus\(!!kind\);/);
 // Without a lesson the line goes back to its own place.
 assert.match(annotate,/statusHome\.parent\.insertBefore\(statusLine,/);
});


test('an empty new board takes the exact shape of the lesson area once the page has settled',()=>{
 assert.match(pdf,/const opened=docId;setTimeout\(\(\)=>settleBoardShape\(opened\),900\)/);
 // Only an untouched board is made again: nothing drawn, pasted or being typed.
 assert.match(pdf,/if\(!isBoardOpen\(\)\|\|docId!==opened\|\|boardPictures\.length\|\|pictureEdits\.length\|\|\(B\.highlights\?\.\(\)\|\|\[\]\)\.length\|\|inlineEdit\)return;/);
 assert.match(pdf,/const want=Math\.max\(\.36,Math\.min\(\.75,h\/w\)\),have=boardSize\.h\/boardSize\.w;\s*if\(Math\.abs\(want-have\)\/have<\.012\)return;/);
 assert.match(pdf,/boardSize=\{w:boardSize\.w,h:Math\.round\(boardSize\.w\*want\)\};publishBoard\(\);/);
});


// ---------- One mouse-arrow button; a real text size control ----------
test('the lesson toolbar shows only the tools it has: no greyed-out hand next to the arrow',()=>{
 assert.match(annotate,/hideUnused:true,ownTextSize:true,/);
 assert.match(toolbar,/b\.hidden=!!s\.hideUnused&&b\.disabled;/);
 assert.match(toolbar,/#fttAnnotate \.fa-tool\[hidden\]\{display:none\}/);
 // The arrow comes first, and its icon is our own fixed drawing.
 assert.match(annotate,/click a link to open it for the class\.',-1\]\},/);
 assert.match(toolbar,/b\.style\.order=own&&own\[3\]!=null\?String\(own\[3\]\):'';/);
 assert.match(toolbar,/if\(String\(mark\)\.startsWith\('<svg'\)\)\{if\(ico\.dataset\.mark!==mark\)\{ico\.dataset\.mark=mark;ico\.innerHTML=mark\}\}/);
});

test('words have a size control (A- number A+) and new words start smaller',()=>{
 assert.match(pdf,/const TEXT_LABELS=\[12,14,16,18,20,24,28,32,40,48,64,80,96,120,144,200\],TEXT_REF=1280,TEXT_FLOOR=16,MIN_LABEL=10,MAX_LABEL=200;/);
 assert.match(pdf,/let textSize=sizeOfLabel\(24\),/);
 // 24 on a board 1280 wide is letters 24 pixels high: a mark size of 24 / (2.4 * 1280).
 const size=Math.round(24/(2.4*1280)*1e4)/1e4;
 assert.equal(size,.0078);assert.equal(Math.round(size*2.4*1280),24);
 assert.ok(size<.016,'smaller than the old default');
 // The smallest size on the list is allowed by the lesson.
 assert.ok(Math.round(12/(2.4*1280)*1e4)/1e4>=C.TEXT_MIN);
 assert.equal(C.cleanStroke({tool:'text',color:'#1f2937',size:.0039,points:[{x:.1,y:.1},{x:.2,y:.2}],text:'a'}).size,.0039);
 // The control is in the bar under the lesson and shows only while there are words to size.
 assert.match(pdf,/const smaller=button\('A−','Smaller letters',\(\)=>stepTextSize\(-1\),'pdf-btn pdf-textsize-btn'\),bigger=button\('A\+','Bigger letters',\(\)=>stepTextSize\(1\),'pdf-btn pdf-textsize-btn'\);/);
 assert.match(pdf,/textSizeBox\.hidden=!target;if\(target\)\{if\(document\.activeElement!==textSizeValue\)textSizeValue\.value=String\(labelOfSize\(target\.size\)\);boldBtn\?\.setAttribute\('aria-pressed',String\(target\.bold===true\)\);if\(fontSelect\)fontSelect\.value=target\.font\|\|'sans'\}/);
 assert.match(pdf,/if\(inlineEdit\)return\{kind:'typing',size:inlineEdit\.size,bold:inlineEdit\.bold===true,font:inlineEdit\.font\|\|'sans'\};/);
 assert.match(pdf,/if\(picked\?\.tool==='text'\)return\{kind:'picked',size:picked\.size,bold:picked\.bold===true,font:picked\.font\|\|'sans'\};/);
 assert.match(pdf,/return \$\('teacherTool'\)\?\.value==='text'\?\{kind:'new',size:textSize,bold:textBold,font:textFont\}:null;/);
 // Pressing A- or A+ does not take the typing cursor out of the words.
 assert.match(pdf,/for\(const b of \[smaller,bigger,boldBtn\]\)for\(const type of \['pointerdown','mousedown'\]\)b\.addEventListener\(type,event=>event\.preventDefault\(\)\);/);
 // One step from an in-between size (after a corner drag) goes to the next size on the list.
 const labels=[12,14,16,18,20,24,28,32,40,48,64,80,96];
 assert.equal(labels.find(label=>label>30),32);assert.equal([...labels].reverse().find(label=>label<30),28);
});


test('words stay picked, with their handles, after their size is changed',()=>{
 assert.match(pdf,/if\(ids\)\{selectedId=ids\[0\];drawInk\(\)\}else B\.status\('That size cannot be used for these words\.'\);/);
});


// ---------- The arrow moves, resizes and deletes pasted pictures ----------
test('the arrow picks a pasted picture on the whiteboard and the same press moves it',()=>{
 assert.match(pdf,/function pictureAt\(point\)\{\s*if\(!point\|\|!isBoardOpen\(\)\)return null;/);
 // The picture on top wins; a point outside every picture gives nothing.
 const pics=[{x:.1,y:.1,w:.3,h:.3,n:1},{x:.2,y:.2,w:.3,h:.3,n:2}];
 const at=point=>[...pics].reverse().find(q=>point.x>=q.x&&point.x<=q.x+q.w&&point.y>=q.y&&point.y<=q.y+q.h)||null;
 assert.equal(at({x:.25,y:.25}).n,2);assert.equal(at({x:.12,y:.12}).n,1);assert.equal(at({x:.8,y:.8}),null);
 // A mark at the same spot is picked first; only then a picture.
 const down=pdf.slice(pdf.indexOf("content.addEventListener('pointerdown'"),pdf.indexOf('function extend(event)'));
 assert.ok(down.indexOf('if(startSelect(event,p))')<down.indexOf('const picture=pictureAt(p);'));
 assert.match(down,/if\(picture\)\{event\.preventDefault\(\);event\.stopPropagation\(\);pickPicture\(picture,event\)\}/);
 // The picture is lifted into its frame and the drag carries on.
 assert.match(pdf,/const item=startPictureEdit\(picture\.image,\{x:picture\.x,y:picture\.y,w:picture\.w,h:picture\.h,after:picture\.after\}\);\s*publishBoard\(\);item\.grab\(event\);/);
 assert.match(pdf,/item\.grab=event=>begin\(event,null\);/);
});

test('with the arrow a moved or resized picture goes straight back on the board; Move pictures still works',()=>{
 assert.match(pdf,/if\(moved&&selecting\(\)&&pictureEdits\.includes\(item\)\)\{moved=false;finishPictureEdit\(\)\}/);
 assert.match(pdf,/if\(Math\.hypot\(event\.clientX-drag\.x,event\.clientY-drag\.y\)>=3\)moved=true;/,'a plain click only picks it');
 // Delete removes the picked picture (the existing key handler), and the button and its bar are untouched.
 assert.match(pdf,/const item=pictureEdits\.find\(other=>other\.el\.classList\.contains\('selected'\)\);/);
 assert.match(pdf,/movePicturesBtn=button\('🖼 Move pictures',/);
 assert.match(pdf,/done\.addEventListener\('click',\(\)=>finishPictureEdit\(\)\);/);
});

// Words are drawn at one size everywhere: 2.4 times the mark size, as a fraction of the board width.
test('every renderer draws words at the same size, with no fixed minimum that makes small text bigger than laid out',()=>{
 const share=read('class-pointer-prototype/activity-share.js'),highlighting=read('class-pointer-prototype/highlighting.js');
 for(const [name,source] of [['pdf-mode',pdf],['highlighting',highlighting]])assert.doesNotMatch(source,/Math\.max\(16,stroke\.size/,name+' has no 16px floor on words');
 assert.match(pdf,/'font-size':Math\.max\(4,stroke\.size\*W\*2\.4\)/);
 assert.match(highlighting,/'font-size':Math\.max\(4,stroke\.size\*w\*2\.4\)/);
 // The class's copy of the words (a 1000 x 1000 layer stretched over the picture) is the teacher's size, undistorted.
 assert.doesNotMatch(share,/Math\.max\(16,width\*2\.2\)/,'the old, smaller size is gone');
 assert.match(share,/\(Number\(stroke\.size\)\|\|\.016\)\*1000\*2\.4/);
 assert.match(share,/scale\(1 \$\{textRatio\}\)/);
 assert.match(share,/textRatio=b\.width\/Math\.max\(1,b\.height\)/);
});

test('a pasted paragraph has room between its lines at the size the board draws it',()=>{
 const Clip=require('../class-pointer-prototype/board-clipboard.js');
 const width100=line=>line.length*50*2.4,aspect=16/9;
 const made=Clip.flowText('One two three four five six seven\neight nine ten eleven twelve thirteen fourteen fifteen sixteen',width100,{aspect,scale:2.4,size:.0078});
 assert.ok(made.strokes.length>=2);
 for(let i=1;i<made.strokes.length;i++){
  const step=made.strokes[i].points[0].y-made.strokes[i-1].points[0].y,letters=.0078*2.4*aspect;
  assert.ok(step>=letters*1.2,'lines are at least a letter height and a bit apart');
 }
 for(const stroke of made.strokes)assert.ok(Math.max(...stroke.points.map(p=>p.x))<=1,'no line runs off the right edge');
});

// A whiteboard lesson reaches an activity page as a picture with every mark (words too) already painted into it.
// The page's own overlay must not draw the words a second time; PDF and screen lessons have no marks in the picture.
test('students are told when the whiteboard picture already has the marks, and the overlay then skips words only',()=>{
 const sender=read('class-pointer-prototype/classroom.js'),share=read('class-pointer-prototype/activity-share.js');
 assert.match(sender,/function marksInVideo\(\)\{return state\.pdf===true&&state\.documentKind==='whiteboard'\}/);
 assert.match(sender,/if\(message\.type==='lesson-marks'\)message=\{\.\.\.message,marksInVideo:marksInVideo\(\),boardBox:window\.ClassPointerPdf\?\.active\(\)\?window\.ClassPointerPdf\.activityBoardBox\?\.\(\)\|\|null:null\};connection\.send\(message\)/);
 assert.match(share,/marksInVideo:message\.marksInVideo===true,boardBox:Number\.isFinite\(message\.boardBox\?\.w\)&&Number\.isFinite\(message\.boardBox\?\.h\)\?\{w:message\.boardBox\.w,h:message\.boardBox\.h\}:null\};renderLessonMarks\(\)/);
 assert.match(share,/if\(stroke\.tool==='text'&&lessonMarks\.marksInVideo===true\)continue;/);
 // The whiteboard picture really does carry the words: paintInk draws text marks into it.
 assert.match(pdf,/function paintBoardPresentation\(canvas\)/);
 assert.match(pdf,/paintInk\(ctx,canvas,draft\?\[\.\.\.strokes,\{\.\.\.draft,owner:B\.owner\(\)\}\]:strokes,W,H\);/);
 assert.match(pdf,/if\(stroke\.tool==='text'\)\{\s*lc\.font=/);
 // PDF lessons paint no marks into their picture, so their overlay keeps drawing words.
 const pdfPaint=pdf.slice(pdf.indexOf('function paintPdfPresentation(canvas)'),pdf.indexOf('function startPdfPresentation()'));
 assert.doesNotMatch(pdfPaint,/paintInk\(/);
});

// ---------- Arrow keys on a picked mark or picture ----------
// pdf-mode.js: the nudge helpers are taken out of the file and run on their own with a fake board 1000 x 500 pixels.
function nudgeHarness(picked,{width=1000,height=500}={}){
 const from=pdf.indexOf('const NUDGE={'),to=pdf.indexOf("if(isTeacher){",from);
 assert.ok(from>0&&to>from,'the nudge helpers are in pdf-mode.js');
 const changes=[];
 const sandbox={content:{getBoundingClientRect:()=>({width,height})},selectedStroke:()=>picked,geometry:()=>G,textBlock:s=>s.block?picked.group:[s],
  changeMarks:list=>{changes.push(list);return true}};
 // G (the pure geometry helpers above) runs in its own sandbox, so its answers are plain copies.
 sandbox.G={movePoints:(...a)=>raw.movePoints(...a)};
 const api=vm.runInNewContext(pdf.slice(from,to)+';({NUDGE,nudgeSelected,nudgeFractions})',sandbox);
 return{api,changes};
}
const shifted=(changes,i=0)=>plain(changes[0].map(([id,stroke])=>[id,stroke.points.map(p=>[Math.round(p.x*1e6)/1e6,Math.round(p.y*1e6)/1e6])])).map(([id,pts])=>({id,pts}))[i];

test('an arrow key moves a picked shape 1 pixel; Shift moves it 10; the class gets the change at once',()=>{
 const rect={id:'r1',tool:'rectangle',color:'#ff0000',size:.016,points:[{x:.2,y:.2},{x:.6,y:.5}]};
 const h=nudgeHarness(rect);
 assert.deepEqual(plain(Object.keys(h.api.NUDGE)),['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
 assert.equal(h.api.nudgeSelected(h.api.NUDGE.ArrowRight,1),true);
 assert.deepEqual(shifted(h.changes).pts,[[.201,.2],[.601,.5]],'1 px of a 1000 px wide board is .001');
 h.api.nudgeSelected(h.api.NUDGE.ArrowDown,10);
 assert.deepEqual(shifted([h.changes[1]]).pts,[[.2,.22],[.6,.52]],'10 px of a 500 px tall board is .02');
 h.api.nudgeSelected(h.api.NUDGE.ArrowLeft,10);h.api.nudgeSelected(h.api.NUDGE.ArrowUp,1);
 assert.deepEqual(shifted([h.changes[2]]).pts,[[.19,.2],[.59,.5]]);
 assert.deepEqual(shifted([h.changes[3]]).pts,[[.2,.198],[.6,.498]]);
});

test('a nudge is held back at the board edge, and every line of picked words moves together',()=>{
 const edge={id:'e1',tool:'rectangle',color:'#ff0000',size:.016,points:[{x:.5,y:.5},{x:1,y:.9}]};
 const h=nudgeHarness(edge);
 h.api.nudgeSelected(h.api.NUDGE.ArrowRight,10);
 assert.equal(h.changes.length,0,'already at the right edge: nothing to change');
 const lines=[{id:'t1',tool:'text',text:'one',points:[{x:.1,y:.1},{x:.3,y:.15}]},{id:'t2',tool:'text',text:'two',points:[{x:.1,y:.2},{x:.3,y:.25}]}];
 const words=nudgeHarness({...lines[0],block:'b1',group:lines});
 words.api.nudgeSelected(words.api.NUDGE.ArrowDown,10);
 assert.deepEqual(plain(words.changes[0].map(([id])=>id)),['t1','t2']);
 assert.deepEqual(shifted(words.changes,0).pts,[[.1,.12],[.3,.17]]);
 assert.deepEqual(shifted(words.changes,1).pts,[[.1,.22],[.3,.27]]);
});

test('nothing is nudged without a picked mark or a board to measure',()=>{
 assert.equal(nudgeHarness(null).api.nudgeSelected([1,0],1),false);
 assert.equal(nudgeHarness({id:'x',tool:'rectangle',points:[{x:.1,y:.1},{x:.2,y:.2}]},{width:0,height:0}).api.nudgeSelected([1,0],1),false);
});

test('the teacher whiteboard keys: arrows nudge, Shift is 10, no scrolling, nothing while typing, Delete still removes',()=>{
 const from=pdf.indexOf('// Delete removes the picked mark; Escape lets go of it.'),block=pdf.slice(from,pdf.indexOf('// Hover or tap a mark on a whiteboard',from));
 assert.match(block,/if\(!selecting\(\)\|\|!selectedId\|\|event\.target\?\.closest\?\.\('input,textarea,select,dialog,\[contenteditable="true"\]'\)\)return;/,'typing in a box is left alone');
 assert.match(block,/else if\(NUDGE\[event\.key\]&&!event\.ctrlKey&&!event\.metaKey&&!event\.altKey&&selectedStroke\(\)\)\{event\.preventDefault\(\);event\.stopPropagation\(\);if\(!edit&&!inlineEdit\)nudgeSelected\(NUDGE\[event\.key\],event\.shiftKey\?10:1\)\}/);
 assert.match(block,/if\(event\.key==='Delete'\|\|event\.key==='Backspace'\)\{event\.preventDefault\(\);event\.stopPropagation\(\);const picked=selectedStroke\(\);selectedId=null;endSelect\(false\);if\(picked\)eraseBlock\(picked\)\}/);
 assert.match(pdf,/return changeMarks\(group\.map\(item=>\[item\.id,\{\.\.\.item,points:item\.points\.map\(q=>\(\{x:q\.x\+dx,y:q\.y\+dy\}\)\)\}\]\)\);/,'moves go through the same path as a drag');
});

test('a picked picture: arrows move it, it goes back on the board for the class after a short pause (arrow tool only)',()=>{
 const from=pdf.indexOf('// Arrow keys move the picked picture 1 pixel'),block=pdf.slice(from,from+1100);
 assert.ok(from>0);
 assert.match(block,/else if\(NUDGE\[event\.key\]&&!event\.ctrlKey&&!event\.metaKey&&!event\.altKey\)\{/);
 assert.match(block,/const item=pictureEdits\.find\(other=>other\.el\.classList\.contains\('selected'\)\),step=item&&nudgeFractions\(NUDGE\[event\.key\],event\.shiftKey\?10:1\);/);
 assert.match(block,/event\.preventDefault\(\);event\.stopPropagation\(\);/);
 assert.match(block,/item\.x=P\.clamp\(item\.x\+step\.x,-item\.w\*0\.8,1-item\.w\*0\.2\);item\.y=P\.clamp\(item\.y\+step\.y,-item\.h\*0\.8,1-item\.h\*0\.2\);placeEditElement\(item\);/);
 assert.match(block,/if\(selecting\(\)\)pictureNudgeTimer=setTimeout\(\(\)=>\{if\(selecting\(\)&&pictureEdits\.includes\(item\)\)finishPictureEdit\(\)\},400\);/);
 // The same handler ignores keys typed in a box.
 assert.match(pdf,/if\(!pictureEdits\.length\|\|event\.target\?\.closest\?\.\('input,textarea,select,\[contenteditable\]'\)\)return;/);
});

test('the shared drawing toolbar (student boards, screen marks) nudges the picked mark the same way',()=>{
 assert.match(toolbar,/if\(\(e\.key==='Delete'\|\|e\.key==='Backspace'\)&&selected\)\{if\(deleteSelected\(\)\)\{e\.preventDefault\(\);e\.stopPropagation\(\)\}\}\s*\/\/ Arrow keys move the picked mark 1 pixel \(Shift: 10\); the page does not scroll while a mark is picked\.\s*else if\(selected&&ARROW_STEP\[e\.key\]&&!e\.ctrlKey&&!e\.metaKey&&!e\.altKey\)\{if\(nudgeSelected\(ARROW_STEP\[e\.key\],e\.shiftKey\?10:1\)\)\{e\.preventDefault\(\);e\.stopPropagation\(\)\}\}/);
 assert.match(toolbar,/if\(e\.target\?\.closest\?\.\('input,textarea,select,\[contenteditable="true"\]'\)\)return;/,'typing in a box is left alone');
 assert.match(toolbar,/moveItem\(s,item,direction\[0\]\*px\/r\.width,direction\[1\]\*px\/r\.height\);\s*return true;/);
 assert.match(toolbar,/Arrow keys move it 1 pixel \(Shift: 10\)\. Delete removes it\./);
});

// ---------- Student marks on a whiteboard: none may be refused for reaching the margin ----------
// A student on an activity page draws on a picture of the teacher's view. A whiteboard can be smaller than that view
// (empty strip at the bottom or right), so a mark that reaches the strip used to land outside the board and the teacher
// refused the whole mark. The real conversion (classroom.js) and the real store (classroom-core.js) are run here.
function grabFunction(source,start){
 const i=source.indexOf(start);assert.ok(i>=0,start+' is in the source');
 let depth=0;for(let k=source.indexOf('{',i);k<source.length;k++){const c=source[k];if(c==='{')depth++;else if(c==='}'&&!--depth)return source.slice(i,k+1)}
 assert.fail('unbalanced '+start);
}
function whiteboardRoom({viewW=1200,viewH=800,boardRatio=9/16,scrollLeft=0,scrollTop=0}={}){
 // The whiteboard fits whole inside the view: pdf-mode.js relayout(), base=min(width,floor(height/ratio)).
 const W=Math.min(viewW,Math.floor(viewH/boardRatio)),H=W*boardRatio;
 const sandbox={scroller:{clientWidth:viewW,clientHeight:viewH,scrollLeft,scrollTop},W,H};
 const activityPoint=vm.runInNewContext(grabFunction(pdf,'function activityPoint(point,toDocument=true)')+';activityPoint',sandbox);
 const convert=grabFunction(read('class-pointer-prototype/classroom.js'),'function studentMessageToDocument(message)');
 const win={ClassPointerPdf:{active:()=>true,activityPoint}};
 const toDocument=vm.runInNewContext(convert+';studentMessageToDocument',{window:win,C,Number,Math});
 return{W,H,toDocument,activityPoint};
}
const marksOfDifferentSizes=()=>{
 const pen=(n,x0,y0,dx,dy)=>({tool:'pen',color:'#c62828',size:.016,points:Array.from({length:n},(_,i)=>({x:Math.min(1,x0+i*dx),y:Math.min(1,y0+i*dy)}))});
 const rect=(x1,y1,x2,y2)=>({tool:'rectangle',color:'#1d4ed8',size:.016,points:[{x:x1,y:y1},{x:x2,y:y2}]});
 return [
  pen(8,.1,.1,.02,.01),rect(.1,.2,.2,.3),pen(40,.2,.4,.012,.004),rect(.3,.3,.6,.6),pen(120,.05,.5,.007,.003),
  rect(.1,.1,.9,.9),pen(255,.02,.02,.0035,.0035),rect(.5,.6,.95,.97),pen(30,.4,.9,.01,.002),
  {tool:'ellipse',color:'#2e7d32',size:.028,points:[{x:.2,y:.7},{x:.8,y:.99}]},{tool:'line',color:'#ef6c00',size:.008,points:[{x:.05,y:.95},{x:.99,y:.99}]},
  {tool:'triangle',color:'#7b1fa2',size:.016,points:[{x:.6,y:.5},{x:.99,y:.98}]}
 ];
};

test('twelve student marks of different sizes all stay, even ones that reach the empty strip around the board',()=>{
 const room=whiteboardRoom(),marks=marksOfDifferentSizes();
 assert.equal(marks.length,12);
 const store=new C.HighlightStore();
 let before=0;
 for(const stroke of marks){
  const sent=room.toDocument({type:'highlight',stroke});
  assert.ok(sent.stroke.points.every(C.validPoint),'every point is on the board');
  assert.ok(store.add('student:a',sent.stroke),'the teacher keeps the mark');
  // What the old code did: convert and hand the points over unchecked. Count the marks it would have refused.
  const old={...stroke,points:stroke.points.map(point=>room.activityPoint(point))};
  if(!C.cleanStroke(old))before++;
 }
 assert.equal(store.strokes.length,12);
 assert.ok(before>=4,'before the fix several of these marks were refused (here '+before+')');
});

test('a mark drawn fully inside the board is not moved by the fix',()=>{
 const room=whiteboardRoom(),stroke={tool:'rectangle',color:'#1d4ed8',size:.016,points:[{x:.2,y:.2},{x:.4,y:.4}]};
 const sent=room.toDocument({type:'highlight',stroke}),expected=stroke.points.map(point=>room.activityPoint(point));
 assert.deepEqual(plain(sent.stroke.points.map(p=>({x:p.x,y:p.y}))),plain(expected.map(p=>({x:p.x,y:p.y}))));
});

test('a mark in the empty strip is held at the board edge, in every direction',()=>{
 const wide=whiteboardRoom({viewW:1600,viewH:700}),tall=whiteboardRoom({viewW:900,viewH:1000});
 for(const room of [wide,tall]){
  const sent=room.toDocument({type:'highlight',stroke:{tool:'pen',color:'#c62828',size:.016,points:[{x:.99,y:.99},{x:1,y:1},{x:.95,y:.97}]}});
  assert.ok(sent.stroke.points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));
 }
 // A pointer in the strip is pinned too.
 const pointer=tall.toDocument({type:'point',point:{x:.99,y:.99,tool:'target'}});
 assert.ok(pointer.point.x<=1&&pointer.point.y<=1&&pointer.point.tool==='target');
});

test('no whiteboard or document open: the message passes through untouched',()=>{
 const convert=grabFunction(read('class-pointer-prototype/classroom.js'),'function studentMessageToDocument(message)');
 const pass=vm.runInNewContext(convert+';studentMessageToDocument',{window:{ClassPointerPdf:{active:()=>false}},C,Number,Math});
 const message={type:'highlight',stroke:{tool:'pen',color:'#c62828',size:.016,points:[{x:.1,y:.1},{x:.2,y:.2}]}};
 assert.equal(pass(message),message);
});

test('the teacher page uses the helper, the student page says when a mark is refused and keeps off-view points',()=>{
 const teacherPage=read('class-pointer-prototype/classroom.js'),share=read('class-pointer-prototype/activity-share.js');
 assert.match(teacherPage,/message=studentMessageToDocument\(message\);/);
 assert.doesNotMatch(teacherPage,/const toDocument=p=>window\.ClassPointerPdf\.activityPoint\(p\);/,'the unchecked conversion is gone');
 assert.match(share,/if\(message\.type==='highlight-error'\)\{\s*if\(admitted\)\{const before=lessonStatus\.textContent;lessonStatus\.textContent='That mark could not be added\./);
 assert.match(share,/Math\.abs\(p\.x\)<=8&&Math\.abs\(p\.y\)<=8\);/);
 assert.doesNotMatch(share,/p\.x>=0&&p\.x<=1&&p\.y>=0&&p\.y<=1\);\s*if\(!points\.length\)continue;/);
 assert.match(share,/markLayer\.style\.cssText='position:absolute;pointer-events:none;overflow:hidden';/);
});

// ---------- Bold text on the whiteboard ----------
test('a text mark can be bold; the class receives and keeps the flag through every change',()=>{
 const base={tool:'text',color:'#1f2937',size:.0078,points:[{x:.1,y:.1},{x:.4,y:.15}],text:'hello'};
 assert.equal(C.cleanStroke({...base,bold:true}).bold,true);
 for(const odd of [false,'true',1,null,undefined])assert.equal('bold' in C.cleanStroke({...base,bold:odd}),false,'only true counts');
 assert.equal('bold' in C.cleanStroke({tool:'pen',color:'#1f2937',size:.016,points:[{x:.1,y:.1},{x:.2,y:.2}],bold:true}),false,'lines are never bold');
 const store=new C.HighlightStore();
 assert.ok(store.add('teacher',{...base,bold:true}));
 const mark=store.strokes[0];
 // Moving, recoloring and resizing hand the whole mark back; bold stays.
 assert.ok(store.replace('teacher',mark.id,{...mark,color:'#c62828'}));
 assert.ok(store.replace('teacher',mark.id,{...store.strokes[0],points:[{x:.2,y:.2},{x:.5,y:.25}]}));
 assert.equal(store.strokes[0].bold,true);
 assert.equal(store.strokes[0].color,'#c62828');
});

test('words laid out bold: every line carries the flag; plain words do not',()=>{
 const Clip=require('../class-pointer-prototype/board-clipboard.js'),width100=line=>line.length*50*2.4;
 const text='One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen';
 const bold=Clip.flowText(text,width100,{aspect:16/9,scale:2.4,size:.0078,bold:true,block:'b1'});
 assert.ok(bold.strokes.length>=2);
 assert.ok(bold.strokes.every(stroke=>stroke.bold===true&&stroke.block==='b1'));
 const plain=Clip.flowText(text,width100,{aspect:16/9,scale:2.4,size:.0078,block:'b2'});
 assert.ok(plain.strokes.every(stroke=>!('bold' in stroke)));
});

test('bold on picked words relays the whole block bold at once; typing and the next new words follow the button',()=>{
 const from=pdf.indexOf('function setTextBold(next){'),to=pdf.indexOf('// One step up or down the list of sizes');
 assert.ok(from>0&&to>from);
 const calls=[];
 const picked={id:'a',tool:'text',block:'b1',bold:false};
 const sandbox={calls,inlineEdit:null,textBold:false,
  textTarget:()=>sandbox.target,sizeInline:()=>calls.push('sizeInline'),syncTextSize:()=>calls.push('sync'),drawInk:()=>calls.push('draw'),
  selectedStroke:()=>picked,selectedId:'a',textBlock:()=>[picked,{id:'b',tool:'text',block:'b1',bold:false}],
  reflow:(block,patch)=>{calls.push(['reflow',block.length,patch]);return{strokes:[{id:'n1'},{id:'n2'}]}},
  B:{swapMarks:(ids,strokes)=>{calls.push(['swap',ids,strokes.length]);return['n1','n2']},status:()=>{}}};
 const api=vm.runInNewContext(pdf.slice(from,to)+';({setTextBold,toggleTextBold})',sandbox);
 // Picked words: the whole block is laid out again bold and swapped in one go.
 sandbox.target={kind:'picked',bold:false};
 api.toggleTextBold();
 assert.deepEqual(plain(calls.filter(c=>Array.isArray(c))),[['reflow',2,{bold:true}],['swap',['a','b'],2]]);
 // Already bold: nothing to do for the class.
 calls.length=0;picked.bold=true;sandbox.target={kind:'picked',bold:true};
 api.setTextBold(true);
 assert.deepEqual(plain(calls.filter(c=>Array.isArray(c))),[]);
 // Typing: the open box turns bold and is resized.
 calls.length=0;sandbox.inlineEdit={bold:false};sandbox.target={kind:'typing',bold:false};
 api.toggleTextBold();
 assert.equal(sandbox.inlineEdit.bold,true);assert.ok(calls.includes('sizeInline'));
 // New words (Text tool chosen): the choice is remembered for the next words.
 calls.length=0;sandbox.target={kind:'new',bold:false};
 api.toggleTextBold();
 assert.equal(sandbox.textBold,true);
 // Nothing to bold: nothing happens.
 calls.length=0;sandbox.target=null;api.toggleTextBold();assert.deepEqual(plain(calls),[]);
});

test('the B button, Ctrl+B and the drawing of bold words are wired everywhere words are drawn',()=>{
 const highlighting=read('class-pointer-prototype/highlighting.js'),share=read('class-pointer-prototype/activity-share.js');
 // The button sits in the text size group, so it shows with the Text tool, picked words or typing, and shows its state.
 assert.match(pdf,/boldBtn=button\('B','Bold \(Ctrl\+B\)',\(\)=>toggleTextBold\(\),'pdf-btn pdf-textsize-btn pdf-bold-btn'\);/);
 assert.match(pdf,/textSizeBox\.append\(el\('span',null,'pdf-label','Text size'\),smaller,textSizeValue,bigger,boldBtn,fontSelect\);/);
 assert.match(pdf,/boldBtn\?\.setAttribute\('aria-pressed',String\(target\.bold===true\)\)/);
 assert.match(pdf,/for\(const b of \[smaller,bigger,boldBtn\]\)for\(const type of \['pointerdown','mousedown'\]\)b\.addEventListener\(type,event=>event\.preventDefault\(\)\);/,'pressing B keeps the typing cursor');
 // Ctrl+B: while typing, with picked words, and with the Text tool chosen. Never inside another input.
 assert.match(pdf,/else if\(\(event\.ctrlKey\|\|event\.metaKey\)&&!event\.altKey&&!event\.shiftKey&&String\(event\.key\)\.toLowerCase\(\)==='b'\)\{event\.preventDefault\(\);toggleTextBold\(\)\}/);
 assert.match(pdf,/String\(event\.key\)\.toLowerCase\(\)==='b'&&selectedStroke\(\)\?\.tool==='text'\)\{event\.preventDefault\(\);event\.stopPropagation\(\);toggleTextBold\(\)\}/);
 assert.match(pdf,/textTarget\(\)\?\.kind!=='new'\)return;\s*event\.preventDefault\(\);toggleTextBold\(\);/);
 // Typing shows bold, and the result keeps it.
 assert.match(pdf,/open\.box\.style\.fontWeight=open\.bold\?'700':'400';/);
 assert.match(pdf,/addTextStroke\(\{\.\.\.open\.create,bold:open\.bold,font:open\.font\},text\)/);
 assert.match(pdf,/open\.font!==open\.fontBefore\)\)replaceTextStroke\(open\.stroke,text,open\.size,open\.bold,open\.font\)/);
 // Bold words are measured bold, so they wrap and get a box that fits.
 assert.match(pdf,/measurerBold\.font='bold 100px sans-serif'/);
 assert.match(pdf,/widthFor\(opts&&opts\.font,opts&&opts\.bold\)/);
 // Drawn bold on the teacher's whiteboard (screen and the picture of it), in the class's copy, and on class pages.
 assert.match(pdf,/'font-size':Math\.max\(4,stroke\.size\*W\*2\.4\),\.\.\.\(stroke\.bold\?\{'font-weight':'700'\}:\{\}\),fill:color,/);
 assert.match(pdf,/lc\.font=`\$\{stroke\.bold\?'bold ':''\}\$\{Math\.max\(4,stroke\.size\*W\*2\.4\)\}px \$\{C\.fontStack\(stroke\.font\)\}`;/);
 assert.match(highlighting,/\.\.\.\(stroke\.bold\?\{'font-weight':'700'\}:\{\}\),fill:color,/);
 assert.match(share,/'font-family':window\.ClassPointerCore\?\.fontStack\?\.\(stroke\.font\)\|\|'sans-serif',\.\.\.\(stroke\.bold\?\{'font-weight':'700'\}:\{\}\),transform:/);
 // The mark itself keeps the flag in the class's store.
 assert.match(read('class-pointer-prototype/classroom-core.js'),/\.\.\.\(value\.bold===true\?\{bold:true\}:\{\}\),/);
});

test('Select shows a computer mouse; its name and tooltip text still start with Select',()=>{
 const line=toolbar.split('\n').find(text=>text.includes("['select',"));
 assert.ok(line);
 assert.match(line,/^\s*\['select','🖱️','Select','Click a mark to pick it\./);
 assert.doesNotMatch(toolbar,/\['select','⬚'/);
 assert.match(toolbar,/btn\('fa-tool','<span class="fa-ico"><\/span><span class="fa-name"><\/span>',name\+': '\+help,/,'the tooltip is still built from the name');
});

// ---------- Student words typed on the board; sizes up to 200; black paste; floating bar; mouse icon ----------
const shareSource=read('class-pointer-prototype/activity-share.js');
function studentTextApi(){
 const code=grabFunction(shareSource,'function wrapStudentText(paragraph,widthOf,fit)')+';'+grabFunction(shareSource,'function studentTextStrokes(o)')+';({studentTextStrokes})';
 return vm.runInNewContext(code,{Array,Math,String,Number});
}
// A line is as wide as 50 pixels per letter at a 100px font (a measure the test controls).
const measure50=(line,bold)=>line.length*(bold?55:50);

test('a student\'s words become one text mark per line, laid out like the teacher\'s: same size rule, same line spacing, in the box',()=>{
 const {studentTextStrokes}=studentTextApi();
 const o={text:'one two three four five six seven eight nine ten eleven twelve thirteen\nsecond paragraph',label:24,bold:false,color:'#c62828',block:'bk1',top:.1,left:.1,maxW:.5,aspect:16/9,measure:measure50};
 const made=studentTextStrokes(o);
 assert.ok(made.strokes.length>=3,'long text wraps inside the box');
 const size=Math.round(24/(2.4*1280)*1e4)/1e4;
 assert.equal(made.size,size);
 assert.equal(size,.0078);
 for(const stroke of made.strokes){
  assert.equal(stroke.tool,'text');assert.equal(stroke.size,size);assert.equal(stroke.block,'bk1');assert.equal(stroke.color,'#c62828');
  assert.ok(stroke.points.length===2&&stroke.points.every(C.validPoint),'every point is on the board');
  assert.ok(C.cleanStroke(stroke),'the teacher\'s page accepts the mark');
  assert.ok(stroke.text.length<=240);
 }
 // The teacher spaces lines size x 1.25 x 2.4 x (width / height); the student's lines use the same step.
 const step=size*1.25*2.4*(16/9);
 for(let i=1;i<made.strokes.length;i++)assert.ok(Math.abs(made.strokes[i].points[0].y-made.strokes[i-1].points[0].y-step)<2e-4,'line spacing is the teacher\'s');
 // A wrapped line is soft; the first line of each paragraph is not.
 assert.equal(made.strokes[0].soft,undefined);
 assert.equal(made.strokes.filter(stroke=>stroke.soft===true).length>=1,true);
 assert.equal(made.strokes.find(stroke=>stroke.text==='second paragraph').soft,undefined);
 // No line is wider than the box.
 for(const stroke of made.strokes)assert.ok(Math.abs(stroke.points[1].x-stroke.points[0].x)<=.5+1e-9);
});

test('student words: bold is measured and sent bold; Hebrew lines start at the right edge of the box; the last lines are cut at the bottom',()=>{
 const {studentTextStrokes}=studentTextApi();
 const plainBox={text:'aaa bbb ccc ddd eee fff ggg hhh',label:24,color:'#1f2937',block:'bk2',top:.1,left:.1,maxW:.3,aspect:16/9,measure:measure50};
 const regular=studentTextStrokes({...plainBox,bold:false}),bold=studentTextStrokes({...plainBox,bold:true});
 assert.ok(bold.strokes.length>=regular.strokes.length,'bold words are wider, so they wrap at least as often');
 assert.ok(bold.strokes.every(stroke=>stroke.bold===true));
 assert.ok(regular.strokes.every(stroke=>!('bold' in stroke)));
 const hebrew=studentTextStrokes({...plainBox,text:'שלום עולם זה טקסט',bold:false});
 for(const stroke of hebrew.strokes)assert.ok(stroke.points[0].x>stroke.points[1].x,'a Hebrew line runs right to left, starting at the right edge');
 assert.ok(hebrew.strokes.every(stroke=>Math.abs(stroke.points[0].x-.4)<1e-9),'every line starts at the box\'s right edge');
 const tall=studentTextStrokes({...plainBox,text:Array.from({length:60},(_,i)=>'line '+i).join('\n'),top:.8});
 assert.equal(tall.cut,true);
 assert.ok(tall.strokes.every(stroke=>stroke.points.every(C.validPoint)));
 assert.ok(tall.strokes.length<20);
});

test('the teacher keeps a student\'s words at the size the student chose, even when the student\'s view is wider than the board',()=>{
 const convert=grabFunction(read('class-pointer-prototype/classroom.js'),'function studentMessageToDocument(message)');
 // A view 1200 wide, a board 900 wide (so words are 4/3 of a board-width fraction to look the same).
 const pdfApi={active:()=>true,activityPoint:point=>({...point,x:point.x*1200/900,y:point.y*800/506}),activityTextScale:()=>1200/900};
 const toDocument=vm.runInNewContext(convert+';studentMessageToDocument',{window:{ClassPointerPdf:pdfApi},C,Number,Math});
 const stroke={tool:'text',color:'#1f2937',size:.0078,text:'hello',block:'bk3',bold:true,points:[{x:.1,y:.1},{x:.3,y:.14}]};
 const sent=toDocument({type:'highlight',stroke});
 assert.equal(sent.stroke.size,Math.round(.0078*1200/900*1e4)/1e4);
 assert.equal(sent.stroke.bold,true);assert.equal(sent.stroke.block,'bk3');
 // The size is held inside what words may be.
 assert.equal(toDocument({type:'highlight',stroke:{...stroke,size:.07}}).stroke.size,C.TEXT_MAX);
 // Lines (not words) keep their thickness.
 const pen={tool:'pen',color:'#c62828',size:.016,points:[{x:.1,y:.1},{x:.2,y:.2}]};
 assert.equal(toDocument({type:'highlight',stroke:pen}).stroke.size,.016);
 assert.match(read('class-pointer-prototype/pdf-mode.js'),/function activityTextScale\(\)\{const vw=scroller\.clientWidth;return vw&&W\?vw\/W:1\}/);
});

test('a student types where they click: no pop-up box, with size, bold and Ctrl+B like the teacher',()=>{
 assert.doesNotMatch(shareSource,/window\.prompt\('Text for the lesson/);
 assert.match(shareSource,/if\(lessonTool==='text'\)\{startTextEditor\(p\);return\}/);
 assert.match(shareSource,/const boldButton=textButton\('B','Bold \(Ctrl\+B\)',\(\)=>setTextBold\(!textBold\)\);/);
 assert.match(shareSource,/textSizeBox\.min='10';textSizeBox\.max='200';/);
 assert.match(shareSource,/String\(event\.key\)\.toLowerCase\(\)==='b'\)\{event\.preventDefault\(\);setTextBold\(!textBold\)\}/);
 assert.match(shareSource,/if\(event\.key==='Escape'\)\{event\.preventDefault\(\);finishTextEditor\(false\)\}/);
 assert.match(shareSource,/if\(event\.relatedTarget&&textOptions\.contains\(event\.relatedTarget\)\)return;finishTextEditor\(true\)/,'the size and bold buttons do not close the words');
 assert.match(shareSource,/textOptions\.style\.display=lessonLevel!=='none'&&lessonTool==='text'&&allowedMode\('text'\)\?'flex':'none';/);
 assert.match(shareSource,/for\(const stroke of made\.strokes\)presenceConn\.send\(\{type:'highlight',stroke\}\);/,'each line goes to the teacher as it is made');
 assert.match(shareSource,/drawTools\.append\(colorSelect,textOptions,bottomRow,viewOnly\);/);
});

test('undo takes back all the lines of the last block of words at once',()=>{
 const store=new C.HighlightStore();
 const line=(text,y,block)=>({tool:'text',color:'#1f2937',size:.0078,text,block,points:[{x:.1,y},{x:.4,y:y+.05}]});
 store.add('student:a',{tool:'pen',color:'#c62828',size:.016,points:[{x:.1,y:.1},{x:.2,y:.2}]});
 for(const [i,text] of ['one','two','three'].entries())store.add('student:a',line(text,.3+i*.06,'bk9'));
 store.add('student:b',line('other student',.8,'bk9'));
 store.edit('student:a','undo','');
 assert.deepEqual(plain(store.strokes.map(s=>s.owner+':'+(s.text||s.tool))),['student:a:pen','student:b:other student'],'only this student\'s block went');
 store.edit('student:a','undo','');
 assert.deepEqual(plain(store.strokes.map(s=>s.owner)),['student:b']);
});

test('text size goes up to 200 and any size can be typed in the number box',()=>{
 for(const label of [10,96,144,200]){
  const size=Math.round(label/(2.4*1280)*1e4)/1e4;
  assert.ok(size>=C.TEXT_MIN&&size<=C.TEXT_MAX,label+' is inside what words may be');
  assert.equal(C.cleanStroke({tool:'text',color:'#1f2937',size,points:[{x:.1,y:.1},{x:.4,y:.2}],text:'x'}).size,size);
  assert.ok(Math.abs(Math.round(size*2.4*1280)-label)<=1,'the label comes back');
 }
 assert.match(pdf,/TEXT_LABELS=\[12,14,16,18,20,24,28,32,40,48,64,80,96,120,144,200\],TEXT_REF=1280,TEXT_FLOOR=16,MIN_LABEL=10,MAX_LABEL=200;/);
 assert.match(pdf,/textSizeValue=el\('input',null,'pdf-textsize-value'\);textSizeValue\.type='number';textSizeValue\.min=String\(MIN_LABEL\);textSizeValue\.max=String\(MAX_LABEL\);/);
 assert.match(pdf,/setTextSize\(sizeOfLabel\(Math\.max\(MIN_LABEL,Math\.min\(MAX_LABEL,Math\.round\(typed\)\)\)\)\);/);
 assert.match(pdf,/textSizeValue\.addEventListener\('change',applyTypedSize\);/);
 assert.match(pdf,/if\(event\.key==='Enter'\)\{event\.preventDefault\(\);applyTypedSize\(\);inlineEdit\?\.box\.focus\(\)\}/,'Enter applies the size and returns to the words');
 assert.match(pdf,/box\.addEventListener\('blur',event=>\{if\(event\.relatedTarget&&textSizeBox\?\.contains\(event\.relatedTarget\)\)return;finishInline\(true\)\}\);/);
});

test('pasted words are always black, whatever color is chosen',()=>{
 assert.match(pdf,/const PASTE_INK='#1f2937';/);
 assert.equal(C.cleanStroke({tool:'text',color:'#1f2937',size:.0078,points:[{x:.1,y:.1},{x:.4,y:.2}],text:'x'}).color,'#1f2937','the board\'s black is kept as it is');
 const paste=pdf.slice(pdf.indexOf('async paste(payload){'),pdf.indexOf('async copy(){'));
 assert.equal((paste.match(/color:PASTE_INK/g)||[]).length,2,'both paste layouts');
 assert.doesNotMatch(paste,/ownColor/);
});

test('the bottom bar floats on the screen in a narrow or short window; Select is a computer mouse on the teacher toolbar',()=>{
 const css=read('class-pointer-prototype/classroom.css');
 assert.match(css,/@media \(max-width:1100px\),\(max-height:700px\)\{#pdfNav,#stage\.board-whole #pdfNav\{position:fixed;bottom:10px;z-index:2147483000;max-width:calc\(100vw - 20px\);max-height:45vh;overflow:auto\}\}/);
 assert.match(css,/#pdfNav\{position:absolute;z-index:6;left:50%;bottom:12px;/,'wide windows keep the bar where it was');
 assert.match(annotate,/select:\['🖱️','Select','Click one of your marks to pick it/);
 assert.doesNotMatch(annotate,/select:\['<svg/);
});

test('a student\'s typing box stays on the board, and the teacher tells the student page where the board is',()=>{
 const {studentTextStrokes}=studentTextApi();
 // A board that covers 89% of the width of the picture: lines never go past it, and the last lines are cut at its bottom.
 const made=studentTextStrokes({text:'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen',label:24,bold:false,color:'#1f2937',block:'bk5',top:.1,bottom:.4,left:.3,maxW:.59,aspect:16/9,measure:measure50});
 for(const stroke of made.strokes)assert.ok(Math.max(stroke.points[0].x,stroke.points[1].x)<=.89+1e-9,'inside the board');
 const tall=studentTextStrokes({text:Array.from({length:40},(_,i)=>'line '+i).join('\n'),label:24,bold:false,color:'#1f2937',block:'bk6',top:.1,bottom:.4,left:.1,maxW:.5,aspect:16/9,measure:measure50});
 assert.equal(tall.cut,true);
 for(const stroke of tall.strokes)assert.ok(stroke.points[0].y+.0078*1.25*2.4*16/9<=.4+1e-6,'above the bottom of the board');
 assert.match(shareSource,/const fit=lessonMarks\.boardBox,right=fit&&fit\.w>\.2\?Math\.min\(\.96,fit\.w-\.02\):\.96,bottom=fit&&fit\.h>\.2\?Math\.min\(1,fit\.h\):1;/);
 assert.match(read('class-pointer-prototype/pdf-mode.js'),/function activityBoardBox\(\)\{\s*const vw=scroller\.clientWidth,vh=scroller\.clientHeight;/);
 // The sizes the teacher sends back are the sizes the student chose.
 assert.match(read('class-pointer-prototype/pdf-mode.js'),/\.\.\.\(stroke\.tool==='text'\?\{size:stroke\.size\/activityTextScale\(\)\}:\{\}\),points:stroke\.points\.map\(p=>activityPoint\(p,false\)\)/);
});

// ---------- A student's Select: their own marks only ----------
function studentSelectApi(){
 const names=['function selectionBox(list)','function segmentDistance(px,py,ax,ay,bx,by)','function markHit(list,px,py,w,h)','function movedMarks(orig,box,dx,dy)','function resizedMarks(orig,box,handle,p,words)'];
 const code=names.map(name=>grabFunction(shareSource,name)).join(';')+';({selectionBox,markHit,movedMarks,resizedMarks})';
 return vm.runInNewContext(code,{Math,Map,Number});
}
const ink=(id,tool,points,extra={})=>({id,tool,color:'#c62828',size:.016,points,...extra});
const mapOf=list=>new Map(list.map(mark=>[mark.id,{points:mark.points,size:mark.size}]));
const flat=map=>plain([...map].map(([id,v])=>[id,v.size,v.points.map(p=>[Math.round(p.x*1e4)/1e4,Math.round(p.y*1e4)/1e4])]));

test('student Select finds the top mark under the pointer: lines by distance, shapes and words by their box',()=>{
 const {markHit}=studentSelectApi();
 const pen=ink('p1','pen',[{x:.1,y:.1},{x:.5,y:.1}]),box=ink('r1','rectangle',[{x:.2,y:.3},{x:.6,y:.6}]),words=ink('t1','text',[{x:.1,y:.8},{x:.4,y:.85}],{text:'hi'});
 const list=[pen,box,words],w=1000,h=500;
 assert.equal(markHit(list,300,50,w,h).id,'p1','on the line');
 assert.equal(markHit(list,300,58,w,h).id,'p1','within a few pixels of the line');
 assert.equal(markHit(list,300,100,w,h),null,'too far from the line');
 assert.equal(markHit(list,400,225,w,h).id,'r1','inside the shape');
 assert.equal(markHit(list,200,410,w,h).id,'t1','on the words');
 assert.equal(markHit(list,900,450,w,h),null,'nothing there');
 // The top one wins where marks overlap.
 const over=ink('r2','rectangle',[{x:.3,y:.4},{x:.7,y:.7}]);
 assert.equal(markHit([box,over],450,250,w,h).id,'r2');
});

test('student Select moves a pick as one piece and never off the picture; resizing scales about the opposite corner',()=>{
 const {movedMarks,resizedMarks,selectionBox}=studentSelectApi();
 const rect=ink('r1','rectangle',[{x:.2,y:.2},{x:.6,y:.5}]),orig=mapOf([rect]),box=selectionBox([rect]);
 assert.deepEqual(flat(movedMarks(orig,box,.1,.05)),[['r1',.016,[[.3,.25],[.7,.55]]]]);
 assert.deepEqual(flat(movedMarks(orig,box,5,5)),[['r1',.016,[[.6,.7],[1,1]]]],'held at the edge');
 assert.deepEqual(flat(movedMarks(orig,box,-5,-5)),[['r1',.016,[[0,0],[.4,.3]]]]);
 // Dragging the bottom right corner to (.8,.8): the top left corner stays put.
 assert.deepEqual(flat(resizedMarks(orig,box,'se',{x:.8,y:.8},false)),[['r1',.016,[[.2,.2],[.8,.8]]]]);
 // Dragging the top left corner to (.1,.1): the bottom right corner stays put.
 assert.deepEqual(flat(resizedMarks(orig,box,'nw',{x:.1,y:.1},false)),[['r1',.016,[[.1,.1],[.6,.5]]]]);
 // Never smaller than a twentieth, never off the picture.
 const tiny=resizedMarks(orig,box,'se',{x:.2,y:.2},false).get('r1').points;
 assert.ok(tiny[1].x>tiny[0].x&&tiny[1].y>tiny[0].y);
 assert.ok(resizedMarks(orig,box,'se',{x:1,y:1},false).get('r1').points.every(p=>p.x<=1&&p.y<=1));
 // Words: the whole block scales evenly and the size changes with it; lines keep their thickness.
 const lines=[ink('a','text',[{x:.1,y:.1},{x:.3,y:.14}],{size:.0078,text:'one',block:'b1'}),ink('b','text',[{x:.1,y:.15},{x:.35,y:.19}],{size:.0078,text:'two',block:'b1'})];
 const wordBox=selectionBox(lines),grown=resizedMarks(mapOf(lines),wordBox,'se',{x:.35,y:.19+.09},true);
 const k=grown.get('a').size/.0078;
 assert.ok(k>1.2&&k<=9.9,'bigger');
 assert.ok(Math.abs(grown.get('b').size-grown.get('a').size)<1e-12,'every line the same size');
 assert.ok(Math.abs((grown.get('b').points[0].y-grown.get('a').points[0].y)-.05*k)<1e-3,'line spacing grows with the letters');
 assert.equal(resizedMarks(orig,box,'se',{x:.9,y:.9},false).get('r1').size,.016);
});

test('the teacher keeps a student\'s changes to that student\'s marks only',()=>{
 const code=grabFunction(read('class-pointer-prototype/classroom.js'),'function studentMessageToDocument(message)')+';'+grabFunction(read('class-pointer-prototype/classroom.js'),'function replaceStudentMarks(member,changes)')+';'+grabFunction(read('class-pointer-prototype/classroom.js'),'function eraseStudentMarks(member,ids)')+';({replaceStudentMarks,eraseStudentMarks})';
 const store=new C.HighlightStore();
 const api=vm.runInNewContext(code,{window:{ClassPointerPdf:{active:()=>false}},C,highlightStore:store,Number,Math,Array});
 const A={id:'presence:a'},B={id:'presence:b'};
 const rect=(x1,y1,x2,y2)=>({tool:'rectangle',color:'#1d4ed8',size:.016,points:[{x:x1,y:y1},{x:x2,y:y2}]});
 store.add('teacher',rect(.1,.1,.2,.2));store.add(A.id,rect(.3,.3,.5,.5));store.add(B.id,rect(.6,.6,.8,.8));store.add(A.id,{tool:'text',color:'#1f2937',size:.0078,text:'mine',block:'bk1',points:[{x:.1,y:.7},{x:.3,y:.75}]});
 const [teacherMark,aMark,bMark,aText]=store.strokes.map(s=>({...s}));
 const moved=rect(.35,.35,.55,.55);
 // A moves A's own mark.
 assert.equal(api.replaceStudentMarks(A,[{id:aMark.id,stroke:moved}]),true);
 assert.deepEqual(plain(store.strokes[1].points),plain(moved.points));assert.equal(store.strokes[1].owner,A.id);
 // A cannot touch the teacher's mark or B's: nothing changes.
 for(const target of [teacherMark,bMark]){
  assert.equal(api.replaceStudentMarks(A,[{id:target.id,stroke:moved}]),false);
 }
 assert.deepEqual(plain(store.strokes[0].points),plain(teacherMark.points));assert.deepEqual(plain(store.strokes[2].points),plain(bMark.points));
 // A cannot turn a rectangle into something else, or change its owner.
 api.replaceStudentMarks(A,[{id:aMark.id,stroke:{...moved,tool:'pen',owner:'teacher'}}]);
 assert.equal(store.strokes[1].tool,'rectangle');assert.equal(store.strokes[1].owner,A.id);
 // Recolor and resize words keep the words, the block and bold.
 assert.equal(api.replaceStudentMarks(A,[{id:aText.id,stroke:{tool:'text',color:'#c62828',size:.012,text:'hacked',block:'bk1',points:[{x:.1,y:.7},{x:.4,y:.78}]}}]),true);
 const words=store.strokes.find(s=>s.id===aText.id);
 assert.equal(words.text,'mine');assert.equal(words.color,'#c62828');assert.equal(words.size,.012);
 // Garbage and too many changes are ignored; a hundred changes never go through.
 assert.equal(api.replaceStudentMarks(A,'x'),false);
 assert.equal(api.replaceStudentMarks(A,[null,{id:5,stroke:moved},{id:aMark.id,stroke:{tool:'nope',points:[]}}]),false);
 // Erase: only the sender's own marks.
 assert.equal(api.eraseStudentMarks(A,[teacherMark.id,bMark.id]),false);
 assert.equal(store.strokes.length,4);
 assert.equal(api.eraseStudentMarks(A,[aMark.id,bMark.id,aText.id]),true);
 assert.deepEqual(plain(store.strokes.map(s=>s.owner)),['teacher',B.id],'only A\'s own marks went');
 assert.equal(api.eraseStudentMarks(A,'x'),false);
});

test('the teacher page accepts student Select messages only from a student with pen permission',()=>{
 const room=read('class-pointer-prototype/classroom.js');
 assert.match(room,/else if\(member\.presence&&selected\(member\)&&memberTools\(member\)\?\.pen===true\)\{\s*if\(message\.action==='replace'&&replaceStudentMarks\(member,message\.changes\)\)publishHighlights\(\);\s*else if\(message\.action==='erase'&&eraseStudentMarks\(member,message\.ids\)\)publishHighlights\(\);/);
 assert.match(room,/const converted=studentMessageToDocument\(\{type:'highlight',stroke:change\.stroke\}\)\.stroke;\s*if\(highlightStore\.replace\(member\.id,change\.id,converted\)\)changed=true;/,'the owner is the sender\'s, never named by the message');
 assert.doesNotMatch(room,/replace\(change\.owner|replace\(message\.owner/);
});

test('the student toolbar offers Select (mouse icon) only with pen permission, and wires drag, handles, recolor, delete and arrow keys',()=>{
 assert.match(shareSource,/const lessonModes=\[\['select','🖱️','Select'\],\['point','☝','Pointer'\]/);
 assert.match(shareSource,/const allowedMode=mode=>mode==='point'\?lessonLevel!=='none':lessonLevel==='pen'\|\|lessonLevel==='highlight'&&\['highlight','box'\]\.includes\(mode\);/,'the pen level, and only that, has Select');
 // Only marks filed under this page's own connection can be picked.
 assert.match(shareSource,/const myOwner=\(\)=>presencePeer\?\.id\?'presence:'\+presencePeer\.id:null;/);
 assert.match(shareSource,/\.filter\(m=>m&&m\.owner===me&&typeof m\.id==='string'/);
 assert.match(shareSource,/if\(lessonTool==='select'\)\{startSelect\(e,p\);return\}/);
 assert.match(shareSource,/if\(lessonTool==='select'\)\{moveSelect\(e\);return\}/);
 assert.match(shareSource,/if\(lessonTool==='select'\)\{endSelect\(true\);return\}/);
 assert.match(shareSource,/const selectColor=color=>\{lessonColor=color;if\(lessonTool==='select'\)recolorSelection\(color\);/);
 // Live to the teacher while dragging, and once more on release.
 assert.match(shareSource,/const now=Date\.now\(\);if\(now-selSendAt>=90\)\{selSendAt=now;sendChanges\(selPreview\)\}/);
 assert.match(shareSource,/if\(drag&&commit&&drag\.moved\)sendChanges\(selPreview\)/);
 // Keys: Delete, Escape and the arrows (1 px, Shift 10), never while typing in a box, no scrolling.
 assert.match(shareSource,/if\(event\.target\?\.closest\?\.\('input,textarea,select,\[contenteditable="true"\]'\)\)return;\s*if\(event\.key==='Delete'\|\|event\.key==='Backspace'\)\{event\.preventDefault\(\);event\.stopPropagation\(\);eraseSelection\(\);return\}/);
 assert.match(shareSource,/event\.preventDefault\(\);event\.stopPropagation\(\);nudgeSelection\(direction,event\.shiftKey\?10:1\);/);
 assert.match(shareSource,/presenceConn\.send\(\{type:'edit-highlights',action:'replace',changes\}\)/);
 assert.match(shareSource,/presenceConn\.send\(\{type:'edit-highlights',action:'erase',ids:ids\.slice\(0,60\)\}\)/);
 // Leaving the tool lets go of the pick, and the frame is drawn above everything else.
 assert.match(shareSource,/if\(lessonTool!=='select'\)\{selIds=\[\];selDrag=null;selPreview=new Map\(\)\}/);
 assert.match(shareSource,/pointerLayer\.appendChild\(tag\);\s*\}\s*drawSelection\(\);\s*\}/);
});

// The real Select code of a student page, driven with fake pointer and key events, talking to the teacher's real handlers.
function selectRoom(marks,{level='pen',claims}={}){
 const from=shareSource.indexOf('    // ---------- Select (a student\'s own marks only) ----------'),to=shareSource.indexOf('    function renderLessonMarks(){');
 assert.ok(from>0&&to>from,'the select code is in activity-share.js');
 const sent=[],kids=[];let keyHandler=null,renders=0;
 const fakeEl=()=>({style:{},children:[],appendChild(node){kids.push(node)}});
 const sandbox={Math,Map,Number,Array,Date,
  presencePeer:{id:'peerA'},admitted:true,lessonActive:true,lessonTool:'select',lessonMarks:{strokes:marks},
  allowedMode:mode=>mode==='select'&&level==='pen',
  presenceConn:{open:true,send:message=>sent.push(JSON.parse(JSON.stringify(message)))},
  picture:()=>({left:0,top:0,width:1000,height:500}),
  hitLayer:{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:500}),setPointerCapture(){}},
  pointerLayer:fakeEl(),document:{createElement:fakeEl,addEventListener:(type,fn)=>{if(type==='keydown')keyHandler=fn}},
  renderLessonMarks:()=>{renders++}};
 const code='let selIds=[],selDrag=null,selPreview=new Map(),selSendAt=0;'+shareSource.slice(from,to)+';({startSelect,moveSelect,endSelect,eraseSelection,nudgeSelection,recolorSelection,state:()=>({selIds,selDrag,selPreview})})';
 const api=vm.runInNewContext(code,sandbox);
 return{api,sent,kids,sandbox,key:event=>keyHandler&&keyHandler(event),renders:()=>renders};
}
const pointer=(x,y,id=1)=>({pointerId:id,clientX:x*1000,clientY:y*500});

test('a student picks and drags their own mark; the teacher\'s page applies it to that mark only',()=>{
 const rect=(owner,id,x1,y1,x2,y2)=>({id,owner,tool:'rectangle',color:'#1d4ed8',size:.016,points:[{x:x1,y:y1},{x:x2,y:y2}]});
 const marks=[rect('teacher','h1',.05,.05,.15,.15),rect('presence:peerB','h2',.6,.6,.8,.8),rect('presence:peerA','h3',.3,.3,.5,.5)];
 const room=selectRoom(marks);
 // Other people's marks cannot be picked: a click on them (or on nothing) picks nothing.
 room.api.startSelect(pointer(.1,.1),{x:.1,y:.1});assert.deepEqual(plain(room.api.state().selIds),[]);
 room.api.startSelect(pointer(.7,.7),{x:.7,y:.7});assert.deepEqual(plain(room.api.state().selIds),[]);
 assert.equal(room.sent.length,0);
 // Their own mark can be picked and dragged: it is shown moved at once and the teacher is told while it moves and when it stops.
 room.api.startSelect(pointer(.4,.4),{x:.4,y:.4});assert.deepEqual(plain(room.api.state().selIds),['h3']);
 room.api.moveSelect(pointer(.5,.45));
 assert.equal(room.sent.length,1,'told while moving');
 room.api.endSelect(true);
 assert.equal(room.sent.length,2,'told again when let go');
 const last=room.sent[1];
 assert.equal(last.type,'edit-highlights');assert.equal(last.action,'replace');
 assert.deepEqual(last.changes.map(change=>change.id),['h3']);
 const moved=last.changes[0].stroke.points.map(p=>[Math.round(p.x*1e4)/1e4,Math.round(p.y*1e4)/1e4]);
 assert.deepEqual(moved,[[.4,.35],[.6,.55]]);
 // The teacher's real handlers, with the real store, apply it.
 const store=new C.HighlightStore();
 for(const mark of marks)store.add(mark.owner==='teacher'?'teacher':mark.owner,{tool:mark.tool,color:mark.color,size:mark.size,points:mark.points});
 const code=grabFunction(read('class-pointer-prototype/classroom.js'),'function studentMessageToDocument(message)')+';'+grabFunction(read('class-pointer-prototype/classroom.js'),'function replaceStudentMarks(member,changes)')+';replaceStudentMarks';
 const apply=vm.runInNewContext(code,{window:{ClassPointerPdf:{active:()=>false}},C,highlightStore:store,Number,Math,Array});
 const ids=new Map(store.strokes.map((s,i)=>[marks[i].id,s.id]));
 const wire=room.sent[1].changes.map(change=>({id:ids.get(change.id),stroke:change.stroke}));
 assert.equal(apply({id:'presence:peerA'},wire),true);
 assert.deepEqual(plain(store.strokes[2].points.map(p=>[Math.round(p.x*1e4)/1e4,Math.round(p.y*1e4)/1e4])),[[.4,.35],[.6,.55]]);
 assert.deepEqual(plain(store.strokes[0].points),plain(marks[0].points),'the teacher\'s mark is untouched');
 assert.deepEqual(plain(store.strokes[1].points),plain(marks[1].points),'the other student\'s mark is untouched');
 // The same message from another student changes nothing.
 assert.equal(apply({id:'presence:peerB'},wire),false);
});

test('student Select: corner resize, recolor, arrow keys, Delete, and no keys while typing in a box',()=>{
 const own=(id,tool,points,extra={})=>({id,owner:'presence:peerA',tool,color:'#1d4ed8',size:.016,points,...extra});
 const other={id:'h9',owner:'presence:peerB',tool:'rectangle',color:'#1d4ed8',size:.016,points:[{x:.7,y:.1},{x:.9,y:.3}]};
 const marks=[own('h1','rectangle',[{x:.2,y:.2},{x:.4,y:.4}]),other];
 const room=selectRoom(marks);
 room.api.startSelect(pointer(.3,.3),{x:.3,y:.3});
 room.api.endSelect(true);
 assert.equal(room.sent.length,0,'a click without a drag sends nothing');
 // Corner handle: drag the bottom right corner out.
 room.api.startSelect(pointer(.4,.4),{x:.4,y:.4});
 room.api.moveSelect(pointer(.6,.6));room.api.endSelect(true);
 const resized=room.sent.at(-1).changes[0].stroke.points;
 assert.deepEqual(plain(resized.map(p=>[Math.round(p.x*1e4)/1e4,Math.round(p.y*1e4)/1e4])),[[.2,.2],[.6,.6]]);
 // Recolor.
 room.sent.length=0;
 room.api.recolorSelection('#2e7d32');
 assert.equal(room.sent[0].changes[0].stroke.color,'#2e7d32');
 assert.equal(room.sent[0].changes[0].id,'h1');
 // Arrow keys: 1 pixel, Shift 10 pixels (a 1000 x 500 picture).
 room.sent.length=0;
 const prevented=[];
 const key=(k,extra={})=>room.key({key:k,target:{closest:()=>null},preventDefault:()=>prevented.push(k),stopPropagation(){},shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,...extra});
 key('ArrowRight');key('ArrowDown',{shiftKey:true});
 const step=index=>room.sent[index].changes[0].stroke.points[0];
 assert.ok(Math.abs(step(0).x-(.2+.001))<1e-9);
 assert.ok(Math.abs(step(1).y-(.2+.02))<1e-9,'10 px of a 500 px tall picture is .02');
 assert.deepEqual(prevented,['ArrowRight','ArrowDown'],'no scrolling');
 // Typing in a box: the keys belong to the box.
 room.sent.length=0;prevented.length=0;
 key('ArrowLeft',{target:{closest:()=>({})}});key('Delete',{target:{closest:()=>({})}});
 assert.equal(room.sent.length,0);assert.equal(prevented.length,0);
 // Delete removes only the pick.
 key('Delete');
 assert.deepEqual(room.sent.at(-1),{type:'edit-highlights',action:'erase',ids:['h1']});
 assert.deepEqual(plain(room.api.state().selIds),[]);
});

test('student Select does nothing without pen permission, and words move and resize with every line',()=>{
 const own=(id,points,extra={})=>({id,owner:'presence:peerA',tool:'text',color:'#1f2937',size:.0078,text:id,block:'bk1',points,...extra});
 const marks=[own('l1',[{x:.1,y:.1},{x:.3,y:.14}]),own('l2',[{x:.1,y:.15},{x:.35,y:.19}])];
 const off=selectRoom(marks,{level:'highlight'});
 off.api.startSelect(pointer(.2,.12),{x:.2,y:.12});off.api.moveSelect(pointer(.3,.2));off.api.endSelect(true);
 assert.equal(off.sent.length,0,'no pen permission: nothing is sent');
 const room=selectRoom(marks);
 room.api.startSelect(pointer(.2,.12),{x:.2,y:.12});
 assert.deepEqual(plain(room.api.state().selIds),['l1','l2'],'picking one line picks the whole block');
 room.api.moveSelect(pointer(.3,.22));room.api.endSelect(true);
 const change=room.sent.at(-1).changes;
 assert.deepEqual(change.map(c=>c.id),['l1','l2']);
 assert.ok(change.every(c=>c.stroke.tool==='text'&&c.stroke.block==='bk1'&&typeof c.stroke.text==='string'),'the words travel with the block');
});

// ---------- The teacher's Select works on anyone's mark ----------
function teacherMarkApi({isTeacher=true}={}){
 const room=read('class-pointer-prototype/classroom.js'),lines=room.split('\n');
 const method=name=>{const line=lines.find(text=>text.startsWith('  '+name+'('));assert.ok(line,name+' is in classroom.js');return line.replace(/,\s*$/,'')};
 const store=new C.HighlightStore(),published=[];
 const code=grabFunction(room,'function markOwner(id)')+';({'+['eraseMark','eraseMarks','swapMarks','replaceMark','replaceMarks'].map(method).join(',')+'})';
 const api=vm.runInNewContext(code,{isTeacher,highlightStore:store,publishHighlights:()=>published.push(1),Array,Number});
 return{api,store,published};
}

test('the teacher can move, resize, recolor and delete a student\'s mark, and it stays that student\'s',()=>{
 const {api,store,published}=teacherMarkApi();
 const rect=(x1,y1,x2,y2)=>({tool:'rectangle',color:'#1d4ed8',size:.016,points:[{x:x1,y:y1},{x:x2,y:y2}]});
 store.add('teacher',rect(.1,.1,.2,.2));store.add('presence:a',rect(.3,.3,.5,.5));store.add('presence:b',rect(.6,.6,.8,.8));
 const ids=store.strokes.map(s=>s.id);
 // Move (and resize) a student's mark.
 assert.equal(api.replaceMark(ids[1],{...store.strokes[1],points:[{x:.35,y:.35},{x:.6,y:.6}]}),true);
 assert.deepEqual(plain(store.strokes[1].points),[{x:.35,y:.35},{x:.6,y:.6}]);
 assert.equal(store.strokes[1].owner,'presence:a','still the student\'s mark');assert.equal(store.strokes[1].id,ids[1]);
 // Recolor two marks of two owners in one go.
 assert.equal(api.replaceMarks([[ids[1],{...store.strokes[1],color:'#c62828'}],[ids[2],{...store.strokes[2],color:'#c62828'}]]),true);
 assert.deepEqual(plain(store.strokes.map(s=>s.color)),['#1d4ed8','#c62828','#c62828']);
 assert.deepEqual(plain(store.strokes.map(s=>s.owner)),['teacher','presence:a','presence:b']);
 assert.ok(published.length>=2,'the class and the students are sent the change');
 // Delete one student's mark and then the other's.
 assert.equal(api.eraseMark(ids[1]),true);
 assert.equal(api.eraseMarks([ids[2]]),true);
 assert.deepEqual(plain(store.strokes.map(s=>s.owner)),['teacher']);
 // Unknown marks change nothing.
 assert.equal(api.eraseMark('nope'),false);assert.equal(api.replaceMark('nope',rect(.1,.1,.2,.2)),false);assert.equal(api.eraseMarks('x'),false);
});

test('a student\'s block of words is swapped for new lines of the same student; a swap across owners is refused',()=>{
 const {api,store}=teacherMarkApi();
 const line=(text,y,block)=>({tool:'text',color:'#1f2937',size:.0078,text,block,points:[{x:.1,y},{x:.4,y:y+.05}]});
 store.add('presence:a',line('one',.1,'bk1'));store.add('presence:a',line('two',.16,'bk1'));store.add('teacher',line('mine',.5,'bk2'));
 const [a1,a2,t1]=store.strokes.map(s=>s.id);
 const made=api.swapMarks([a1,a2],[line('one two three',.1,'bk1')]);
 assert.equal(made.length,1);
 assert.equal(store.strokes.find(s=>s.id===made[0]).owner,'presence:a','the new lines are the student\'s');
 assert.equal(store.strokes.length,2);
 assert.equal(api.swapMarks([made[0],t1],[line('x',.2,'bk3')]),null,'not across two owners');
 assert.equal(store.strokes.length,2);
 assert.equal(api.swapMarks([],[line('x',.2,'bk3')]),null);
});

test('only the teacher\'s page can use these; a student page cannot',()=>{
 const {api,store}=teacherMarkApi({isTeacher:false});
 store.add('presence:a',{tool:'rectangle',color:'#1d4ed8',size:.016,points:[{x:.3,y:.3},{x:.5,y:.5}]});
 const id=store.strokes[0].id;
 assert.equal(api.eraseMark(id),false);assert.equal(api.eraseMarks([id]),false);
 assert.equal(api.replaceMark(id,{...store.strokes[0],color:'#c62828'}),false);
 assert.equal(api.replaceMarks([[id,{...store.strokes[0],color:'#c62828'}]]),false);
 assert.equal(api.swapMarks([id],[{...store.strokes[0]}]),null);
 assert.equal(store.strokes.length,1);assert.equal(store.strokes[0].color,'#1d4ed8');
});

test('Select picks anyone\'s mark; the eraser and the Text tool still reach only the teacher\'s own',()=>{
 // The picked mark can belong to anyone; words that follow each other are one block only when they have the same owner.
 assert.match(pdf,/const stroke=selectedId\?strokes\.find\(item=>item\.id===selectedId\):null;/);
 assert.match(pdf,/upper\.tool==='text'&&lower\.tool==='text'&&upper\.owner===lower\.owner&&upper\.color===lower\.color/);
 assert.match(pdf,/function teacherMarkAt\(event,p,inside,anyOwner\)\{/);
 assert.match(pdf,/\(anyOwner\|\|item\.owner==='teacher'\)&&markHits\(item,p,inside\)/);
 assert.match(pdf,/return !!teacherMarkAt\(event,point,true,true\)\|\|!!pictureAt\(point\);/,'the arrow cursor and a pick use any owner');
 assert.match(pdf,/const hit=teacherMarkAt\(event,p,true,true\);\s*\/\/ Words that were already picked/);
 assert.match(pdf,/function eraseUnder\(event\)\{const p=normalized\(event\),hit=p&&teacherMarkAt\(event,p,false\);/,'the eraser stays on the teacher\'s own marks');
 assert.match(pdf,/const words=teacherMarkAt\(event,p,true\);\s*if\(words\?\.tool==='text'\)\{editInline\(words\);return\}/,'the Text tool stays on the teacher\'s own words');
 // Students are untouched: a student's message still reaches only that student's marks.
 const room=read('class-pointer-prototype/classroom.js');
 assert.match(room,/if\(highlightStore\.replace\(member\.id,change\.id,converted\)\)changed=true;/);
 assert.match(room,/mark\.owner===member\.id&&mark\.id===id/);
});
