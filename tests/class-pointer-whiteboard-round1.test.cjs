'use strict';
// Whiteboard round 1 (principal's feedback): default tool, right-click menu, copy/cut/paste of the picked item, layers,
// Upload (pictures and PDFs), and text alignment. Logic is tested for real; the page wiring is checked in the source.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../class-pointer-prototype/classroom-core.js');
const Clip=require('../class-pointer-prototype/board-clipboard.js');
const read=name=>fs.readFileSync(path.join(__dirname,'../class-pointer-prototype',name),'utf8');
const pdf=read('pdf-mode.js'),room=read('classroom.js'),annotate=read('classroom-annotate.js'),clipSource=read('board-clipboard.js'),boards=read('student-boards.js');

const IMG='data:image/jpeg;base64,'+Buffer.from('a small picture').toString('base64');
const BOX=[{x:.1,y:.1},{x:.5,y:.4}];
const pen=()=>({tool:'pen',color:'#1f2937',size:.016,points:BOX});
const words=text=>({tool:'text',color:'#1f2937',size:.02,points:BOX,text});
const picture=()=>({tool:'picture',points:BOX,image:IMG});
const order=store=>store.strokes.map(s=>s.tool+(s.text?':'+s.text:'')).join(',');

test('1. a whiteboard opens on the pointer / Select arrow, not the pen (teacher board and student boards)',()=>{
  assert.match(annotate,/get defaultTool\(\)\{return teacher&&B\.lessonKind\?\.\(\)==='whiteboard'\?\(canSelect\(\)\?'select':'pen'\):'pointer'\}/);
  assert.match(annotate,/if\(kind==='whiteboard'\)FA\.select\(canSelect\(\)\?'select':'pen',\{color:black\}\)/);
  assert.match(boards,/const boardSurface=\{id:'board',idPrefix:'s',defaultTool:'select'/);
  assert.match(boards,/const boardInk=FA&&\{id:'student-board',idPrefix:'t',autoOpen:true,defaultTool:'select'/);
});

test('pictures are marks: two corners and a real small picture; bad ones are refused',()=>{
  const ok=C.cleanStroke(picture());
  assert.equal(ok.tool,'picture');assert.equal(ok.image,IMG);assert.match(ok.ref,/^p[a-z0-9]+$/);
  assert.equal(C.cleanStroke({...picture(),image:'javascript:alert(1)'}),null);
  assert.equal(C.cleanStroke({...picture(),image:'data:text/html;base64,AAAA'}),null);
  assert.equal(C.cleanStroke({...picture(),image:'data:image/jpeg;base64,'+'A'.repeat(C.PICTURE_MAX_CHARS)}),null,'too big');
  assert.equal(C.cleanStroke({...picture(),points:[BOX[0]]}),null);
  assert.equal(C.cleanStroke({...picture(),points:[{x:.5,y:.5},{x:.5,y:.5}]}),null,'no size');
  // on the wire a picture is only a short reference (the teacher sends the picture itself once)
  const ref=C.cleanStroke({tool:'picture',points:BOX,ref:ok.ref});
  assert.equal(ref.ref,ok.ref);assert.equal('image' in ref,false);
  assert.equal(C.cleanStroke({tool:'picture',points:BOX,ref:'<script>'}),null);
});

test('a board holds at most 12 pictures; they do not use up the highlight limits',()=>{
  const store=new C.HighlightStore();
  for(let i=0;i<C.PICTURES_MAX;i++)assert.equal(store.add('teacher',{...picture(),image:IMG.replace('AAAA','')+'A'.repeat(i+1)}),true);
  assert.equal(store.add('teacher',picture()),false,'the 13th picture');
  assert.equal(store.add('teacher',words('still room for words')),true);
});

test('moving or resizing a picture keeps the picture; recolor does not break it',()=>{
  const store=new C.HighlightStore();store.add('teacher',picture());
  assert.equal(store.replace('teacher','h1',{points:[{x:.2,y:.2},{x:.6,y:.5}]}),true);
  assert.equal(store.strokes[0].image,IMG);assert.deepEqual(store.strokes[0].points,[{x:.2,y:.2},{x:.6,y:.5}]);
});

test('4. layers: front, back, forward and backward; blocks of words move together; Undo puts the order back',()=>{
  const store=new C.HighlightStore();
  store.add('teacher',words('under'));store.add('teacher',picture());store.add('teacher',words('over'));store.add('teacher',pen());
  assert.equal(order(store),'text:under,picture,text:over,pen');
  assert.equal(store.reorder('teacher',['h2'],'front'),true);assert.equal(order(store),'text:under,text:over,pen,picture');
  assert.equal(store.reorder('teacher',['h2'],'front'),false,'already on top');
  store.undo('teacher');assert.equal(order(store),'text:under,picture,text:over,pen');
  assert.equal(store.reorder('teacher',['h2'],'back'),true);assert.equal(order(store),'picture,text:under,text:over,pen');
  assert.equal(store.reorder('teacher',['h2'],'back'),false,'already at the bottom');
  assert.equal(store.reorder('teacher',['h2'],'forward'),true);assert.equal(order(store),'text:under,picture,text:over,pen');
  assert.equal(store.reorder('teacher',['h2'],'backward'),true);assert.equal(order(store),'picture,text:under,text:over,pen');
  // two lines of one block move as one
  assert.equal(store.reorder('teacher',['h1','h3'],'front'),true);assert.equal(order(store),'picture,pen,text:under,text:over');
  assert.equal(store.reorder('teacher',['h1','h3'],'nonsense'),false);
  assert.equal(store.reorder('teacher',['missing'],'front'),false);
});

test('layer order survives a saved whiteboard: saved in order, opened in order, with the pictures',()=>{
  const store=new C.HighlightStore();
  store.add('teacher',words('behind'));store.add('teacher',picture());store.add('teacher',words('on top'));
  store.reorder('teacher',['h3'],'back');
  const saved=store.strokes.map(s=>({owner:'teacher',tool:s.tool,color:s.color,size:s.size,points:s.points,...(s.text?{text:s.text}:{}),...(s.image?{image:s.image}:{})}));
  const opened=Clip.cleanLessonBoard({version:1,kind:'lesson-whiteboard',pictures:[],strokes:saved},C.cleanStroke);
  assert.deepEqual(opened.strokes.map(s=>s.tool+(s.text?':'+s.text:'')),['text:on top','text:behind','picture']);
  assert.equal(opened.strokes[2].image,IMG);
  const again=new C.HighlightStore();again.restore(opened.strokes);
  assert.equal(order(again),'text:on top,text:behind,picture');
});

test('Clear takes away drawings and words but never the picture they are on',()=>{
  const store=new C.HighlightStore();
  store.add('teacher',picture());store.add('teacher',pen());store.add('teacher',words('x'));
  store.edit('teacher','clear');assert.equal(order(store),'picture');
  store.add('teacher',pen());store.clearAll('teacher');assert.equal(order(store),'picture');
  store.undo('teacher');assert.equal(order(store),'picture,pen','Undo brings the drawing back, in place');
  store.reset();assert.equal(order(store),'','a new whiteboard starts empty');
});

test('6. alignment: left, center and right place the lines inside the box; saved; Hebrew lines start at their right end',()=>{
  const width100=line=>line.length*50;
  const flow=(align,text='ab\nabcdefgh')=>Clip.flowText(text,width100,{size:.02,left:.2,top:.2,align,boxW:.5}).strokes;
  const edge=(stroke,rtl)=>rtl?[Math.min(...stroke.points.map(p=>p.x)),Math.max(...stroke.points.map(p=>p.x))]:[stroke.points[0].x,stroke.points[1].x];
  const [shortLeft,longLeft]=flow('left'),[shortCenter,longCenter]=flow('center'),[shortRight,longRight]=flow('right');
  assert.equal(shortLeft.points[0].x,longLeft.points[0].x,'left: both lines start at the same edge');
  const mid=s=>(s.points[0].x+s.points[1].x)/2;
  assert.ok(Math.abs(mid(shortCenter)-mid(longCenter))<.002,'center: both lines have the same middle');
  const end=s=>Math.max(s.points[0].x,s.points[1].x);
  assert.ok(Math.abs(end(shortRight)-end(longRight))<.002,'right: both lines end at the same edge');
  assert.ok(shortRight.points[0].x>shortLeft.points[0].x);
  assert.equal(shortCenter.align,'center');
  // no choice: as before, and no align field
  const plain=Clip.flowText('ab\nabcdefgh',width100,{size:.02,left:.2,top:.2,boxW:.5}).strokes;
  assert.equal('align' in plain[0],false);assert.equal(plain[0].points[0].x,plain[1].points[0].x);
  // Hebrew: the first point is the right end of the line
  const [heShort,heLong]=Clip.flowText('אב\nאבגדהוזח',width100,{size:.02,left:.2,top:.2,boxW:.5,align:'right'}).strokes;
  assert.ok(Math.abs(heShort.points[0].x-heLong.points[0].x)<.002,'Hebrew, right: both lines start at the right edge');
  const [leShort,leLong]=Clip.flowText('אב\nאבגדהוזח',width100,{size:.02,left:.2,top:.2,boxW:.5,align:'left'}).strokes;
  assert.ok(Math.abs(Math.min(...leShort.points.map(p=>p.x))-Math.min(...leLong.points.map(p=>p.x)))<.002,'Hebrew, left: both lines end at the left edge');
  // the board only accepts the three names, and keeps them
  assert.equal(C.cleanStroke({tool:'text',color:'#1f2937',size:.02,points:BOX,text:'a',align:'center'}).align,'center');
  assert.equal('align' in C.cleanStroke({tool:'text',color:'#1f2937',size:.02,points:BOX,text:'a',align:'justify'}),false);
  assert.equal('align' in C.cleanStroke({tool:'pen',color:'#1f2937',size:.016,points:BOX,align:'center'}),false);
});

test('students get each picture once, then only its short reference; students can never add pictures; the page watching the video gets none',()=>{
  assert.match(room,/function wireStrokes\(connection,strokes\)/);
  assert.match(room,/if\(stroke\.image&&!sent\.has\(stroke\.ref\)\)\{sent\.add\(stroke\.ref\);/);
  assert.match(room,/message\.type==='highlights'&&Array\.isArray\(message\.strokes\)\)message=\{\.\.\.message,strokes:wireStrokes\(connection,message\.strokes\)\}/);
  assert.match(room,/message\.type==='lesson-marks'&&Array\.isArray\(message\.strokes\)\)message=\{\.\.\.message,strokes:message\.strokes\.filter\(stroke=>stroke\.tool!=='picture'\)\}/);
  assert.match(room,/message\.stroke\?\.tool!=='picture'&&writingAllowed/);
  assert.match(room,/if\(clean&&clean\.ref===item\.ref\)\{pictureCache\.set/,'a received picture must match its reference');
  assert.match(room,/reorderMarks\(ids,how\)\{if\(!isTeacher/);
});

test('2. right-click: our own menu on the whiteboard only (Cut, Copy, Paste, and the four layer choices when something is picked)',()=>{
  assert.match(pdf,/scroller\.addEventListener\('contextmenu',event=>\{\s*if\(!isBoardOpen\(\)\)return;/,'other documents keep the browser menu');
  assert.match(pdf,/textarea,input'\)\)return;/,'typing boxes keep the browser menu');
  assert.match(pdf,/add\('Cut',/);assert.match(pdf,/add\('Copy',/);assert.match(pdf,/add\('Paste',/);
  for(const word of ['Bring to Front','Bring Forward','Send Backward','Send to Back'])assert.ok(pdf.includes("'"+word+"'"),word);
  assert.match(pdf,/if\(has\)\{sep\(\)/,'layer choices only with something picked');
  assert.match(pdf,/closeBoardMenu/);
});

test('3. copy and cut act on the picked item only; paste puts it at the cursor; Ctrl+C / X / V use the same code',()=>{
  assert.match(pdf,/async copy\(\)\{await copyItems\(false\)\}/);
  assert.match(pdf,/async cut\(\)\{await copyItems\(true\)\}/);
  assert.doesNotMatch(pdf,/async copy\(\)\{[^}]*exportPng/,'Copy no longer copies the whole board');
  assert.match(pdf,/async copyWhole\(\)\{/,'the Copy board button still copies a picture of the whole board');
  assert.match(pdf,/clip\.copyFrom\(\{\.\.\.clipTarget,copy:\(\)=>clipTarget\.copyWhole\(\)\}\)/);
  assert.match(pdf,/const group=selectedGroup\(\)[\s\S]{0,200}Click an item first/,'nothing picked: it says so and copies nothing');
  assert.match(clipSource,/document\.addEventListener\('cut'/);
  assert.match(clipSource,/data-ftt-board-clip/);
  assert.match(pdf,/if\(payload\.kind==='item'\)\{\s*if\(itemClip&&itemClip\.id===payload\.id\)\{pasteItems\(\)/);
  assert.match(pdf,/if\(payload\.kind==='image'\)\{await pastePicture\(payload\.blob\);return\}/,'a picture from the clipboard still pastes as before');
  assert.match(pdf,/if\(spot\)\{dx=spot\.x-\(x1\+x2\)\/2;dy=spot\.y-\(y1\+y2\)\/2\}else\{dx=\.03\*pastedCount/,'at the cursor, or slightly offset');
  assert.match(pdf,/\{\.\.\.rest,points:/,'a pasted item gets a new id and owner');
});

test('5. Upload: jpg, png, gif, webp and PDF; a PDF is one page per slide; pictures are shrunk to fit a board mark',()=>{
  assert.match(pdf,/uploadInput\.accept='image\/jpeg,image\/png,image\/gif,image\/webp,application\/pdf,\.jpg,\.jpeg,\.png,\.gif,\.webp,\.pdf'/);
  assert.match(pdf,/if\(!\(i===1&&empty\)\)\{\s*if\(!canSlides\)/,'the first page goes on an empty open page, the others on new pages');
  assert.match(pdf,/if\(!await addPage\(false\)\)break/);
  assert.match(pdf,/Pages\.MAX_PAGES-wbPages\.length/,'never more slides than a whiteboard may have');
  assert.match(pdf,/UPLOAD_PDF_BYTES=25\*1024\*1024/);
  assert.match(annotate,/id:'quick-upload',icon:'⬆️',label:'Upload'/,'a button on the whiteboard toolbar');
  assert.match(pdf,/button\('⬆ Upload'/);
  assert.match(pdf,/B\.fail\('This page already has '\+C\.PICTURES_MAX\+' pictures/);
});

test('old saved whiteboards (pictures kept apart from the marks) still open: their pictures come back as marks at the very back',()=>{
  assert.match(pdf,/legacy\.push\(\{owner:'teacher',tool:'picture'/);
  assert.match(pdf,/strokes:\[\.\.\.legacy,\.\.\.saved\.strokes\]/);
  const old=Clip.cleanLessonBoard({version:1,kind:'lesson-whiteboard',pictures:[{data:IMG,x:.1,y:.1,w:.3,h:.3}],strokes:[]},C.cleanStroke);
  assert.equal(old.pictures.length,1,'the old file is still accepted as before');
});

test('sending a whiteboard to the class: the preview is the one yes, so no second popup silently stops the send',()=>{
  // Before: if any student had a mark (even a stray tap), a second native popup asked again. A popup that was closed or blocked
  // left every student on the OLD board, with the new picture and words never arriving.
  assert.match(boards,/if\(item\.kind==='image'\)await sendImageFile\(item\.file,\{subject:item\.subject,important,confirmed:true\}\)/);
  assert.match(boards,/else if\(item\.kind==='pages'\)await sendPagesFiles\(item\.files,\{subject:item\.subject,important,confirmed:true\}\)/);
  assert.match(boards,/hasWork&&opts\.confirmed!==true&&!confirm\(/);
  assert.match(boards,/hasStudentWork\(\)&&info\.confirmed!==true&&!confirm\(/);
  // The warning is shown in the preview, before the green button.
  assert.match(boards,/if\(hasStudentWork\(\)\)\{const warn=el\('p',null,'.{1,3} Some students have marks on their boards\. Sending replaces their boards with this one\.'\)/);
  // A declined question is never silent.
  assert.equal((boards.match(/Nothing was sent\. Students still have their marks\./g)||[]).length,3);
});
