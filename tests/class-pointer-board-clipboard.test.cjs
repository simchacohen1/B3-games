'use strict';
// Whiteboard paste / copy / save (issue #770): the plain logic in board-clipboard.js, the paste dispatcher,
// the student board's picture marks and its export / import, and restoring a saved teacher whiteboard.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../class-pointer-prototype');
const Clip=require(path.join(dir,'board-clipboard.js'));
const Core=require(path.join(dir,'classroom-core.js'));
const clipSource=fs.readFileSync(path.join(dir,'board-clipboard.js'),'utf8');
const boardsSource=fs.readFileSync(path.join(dir,'student-boards.js'),'utf8');
const pdfSource=fs.readFileSync(path.join(dir,'pdf-mode.js'),'utf8');
const PNG='data:image/png;base64,'+'iVBORw0KGgo'.repeat(8)+'==';
const width100=line=>line.length*50; // every letter is half as wide as the font is tall

test('pasted words are tidied, never silently cut, and capped with a flag',()=>{
  assert.deepEqual(Clip.cleanText(' one\r\ntwo\u0000\t!\r\n\r\n\r\n\r\nthree \n'),{text:' one\ntwo  !\n\nthree',cut:false});
  const long=Clip.cleanText('a'.repeat(Clip.LIMITS.textChars+50));
  assert.equal(long.text.length,Clip.LIMITS.textChars);assert.equal(long.cut,true);
  assert.deepEqual(Clip.cleanText(null),{text:'',cut:false});
});
test('what the clipboard holds: picture, words, or the words of copied web content',()=>{
  const blob={type:'image/png'};
  assert.deepEqual(Clip.pick({image:blob,text:'',html:''}),{kind:'image',blob});
  // A picture copied from a web page comes with web content that points at it: still a picture.
  assert.equal(Clip.pick({image:blob,text:'https://example.com/a.png',html:'<img src="https://example.com/a.png">'}).kind,'image');
  // Word and Excel add a picture of the copied words: the words win.
  assert.deepEqual(Clip.pick({image:blob,text:'שלום עולם',html:'<p>שלום עולם</p>'}),{kind:'text',text:'שלום עולם',cut:false});
  // Web content with a picture link but no picture file falls back to its text.
  assert.deepEqual(Clip.pick({image:null,text:'',html:'<div><img src="x.png">Hello<br>there</div><script>alert(1)</script>'}),{kind:'text',text:'Hello\nthere',cut:false});
  assert.equal(Clip.pick({image:null,text:'  \n ',html:'<img src="x.png">'}),null);
  assert.equal(Clip.pick({}),null);
});
test('long text is wrapped and split into board text boxes instead of being cut at 80 letters',()=>{
  const text=Array.from({length:60},(_,i)=>'word'+i).join(' ');
  const laid=Clip.layoutText(text,width100);
  assert.equal(laid.cut,false);
  assert.ok(laid.items.length>1);
  assert.equal(laid.items.map(item=>item.text.replace(/\n/g,' ')).join(' '),text);
  for(const item of laid.items){
    assert.ok(item.text.length<=Clip.LIMITS.itemChars&&item.text.split('\n').length<=Clip.LIMITS.itemLines&&item.text.trim());
    assert.ok([.045,.03,.02].includes(item.size));
    assert.ok(item.x>=0&&item.x<=1&&item.y>=0&&item.y<=1);
    for(const line of item.text.split('\n'))assert.ok(item.x+width100(line)/100*item.size<=1);
  }
  assert.equal(Clip.layoutText('Hi',width100).items[0].size,.045); // short words stay big
});
test('pasted teacher text becomes bounded, validated text strokes with visible hit boxes',()=>{
  const made=Clip.textStrokes('Read\nthis lesson',width100,{aspect:16/9,sizes:[.028,.016,.008],color:'#1d4ed8'});
  assert.equal(made.cut,false);assert.equal(made.strokes.length,1);
  const stroke=made.strokes[0],clean=Core.cleanStroke(stroke);
  assert.equal(stroke.tool,'text');assert.equal(stroke.color,'#1d4ed8');assert.equal(stroke.text,'Read\nthis lesson');
  assert.ok(clean);assert.equal(clean.size,.028);assert.ok(stroke.points[1].x>stroke.points[0].x);assert.ok(stroke.points[1].y>stroke.points[0].y);
  assert.ok(stroke.points.every(point=>point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1));
  const hebrew=Clip.textStrokes('שלום עולם',width100,{aspect:16/9,sizes:[.028,.016,.008]}).strokes[0];
  assert.ok(Core.cleanStroke(hebrew));assert.ok(hebrew.points[1].x<hebrew.points[0].x,'RTL hit box extends left from the right-edge text anchor');
  const tooTall=Clip.textStrokes(Array.from({length:250},()=> 'x').join('\n'),width100,{aspect:16/9,sizes:[.008]});
  assert.equal(tooTall.cut,true);assert.ok(tooTall.strokes.length>0);assert.ok(tooTall.strokes.every(item=>Core.cleanStroke(item)));
});
test('text that cannot fit on one board is cut with a flag, and one very long word is broken',()=>{
  const laid=Clip.layoutText(Array.from({length:900},()=>'word').join(' '),width100);
  assert.equal(laid.cut,true);assert.equal(laid.size,.02);
  const last=laid.items[laid.items.length-1];
  assert.ok(last.y+last.text.split('\n').length*.02*1.25*16/9<=1);
  const lines=Clip.wrapLines('x'.repeat(500),line=>line.length,100);
  assert.ok(lines.length>=5&&lines.every(line=>line.length<=100));assert.equal(lines.join(''),'x'.repeat(500));
});
test('Hebrew text boxes line up on the right edge; a paste lands at the pointer but stays on the board',()=>{
  const laid=Clip.layoutText('שלום\n'+'מילה '.repeat(70).trim(),width100,{center:{x:.99,y:.99}});
  assert.equal(Clip.isRtl('abc שלום'),true);assert.equal(Clip.isRtl('abc'),false);
  const edges=laid.items.map(item=>item.x+Math.max(...item.text.split('\n').map(width100))/100*item.size);
  for(const edge of edges)assert.ok(Math.abs(edge-edges[0])<1e-3&&edge<=.9601);
});
test('a pasted picture keeps its shape, covers at most 60% of the board and stays on it',()=>{
  const [a,b]=Clip.placeImage(4000,1000,{center:{x:0,y:1}});
  assert.ok(Math.abs((b.x-a.x)-.6)<1e-3);
  assert.ok(Math.abs((b.y-a.y)-.6*(1000/4000)*16/9)<1e-3);
  assert.equal(a.x,0);assert.equal(b.y,1);
  const [c,d]=Clip.placeImage(200,2000);
  assert.ok(Math.abs((d.y-c.y)-.6)<1e-3&&d.x-c.x>=.03&&c.x>0&&d.x<1);
  assert.deepEqual(Clip.fitSize(4000,1000,900),{w:900,h:225});assert.deepEqual(Clip.fitSize(100,50,900),{w:100,h:50});
});
test('picture data must be a small base64 image data: URL',()=>{
  assert.equal(Clip.cleanImageData(PNG),PNG);
  for(const bad of [null,5,'','javascript:alert(1)','data:text/html;base64,AAAA','data:image/svg+xml;base64,AAAA','data:image/png;base64,AA"><script>','data:image/png;base64,'+'A'.repeat(Clip.LIMITS.imageChars)])
    assert.equal(Clip.cleanImageData(bad),null);
  assert.equal(Clip.LIMITS.imagesPerBoard,6);assert.ok(Clip.LIMITS.imageChars<=420000);
});

// ---------- The paste dispatcher (browser part, run with a tiny fake page) ----------
function clipboardPage(clipboard){
  const listeners={};
  const context={navigator:{platform:'Win32',clipboard},document:{addEventListener:(type,fn)=>{listeners[type]=fn},dispatchEvent(){}},Event:class{constructor(type){this.type=type}},getSelection:()=>''};
  context.window=context;vm.createContext(context);vm.runInContext(clipSource,context);
  const event=(data,inside)=>{const e={prevented:0,target:{closest:()=>inside?{}:null},clipboardData:{items:[],files:[],getData:type=>data[type]||''},preventDefault(){e.prevented++},stopImmediatePropagation(){}};return e};
  return{api:context.ClassPointerClipboard,listeners,event};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('Ctrl+V goes to the open whiteboard, never into a text field, and never twice at once',async()=>{
  const page=clipboardPage({}),got=[],said=[];let open=true,release;
  const target=page.api.register({priority:1,active:()=>open,say:text=>said.push(text),paste:payload=>{got.push(payload);return new Promise(resolve=>{release=resolve})}});
  const typed=page.event({'text/plain':'in a field'},true);page.listeners.paste(typed);
  assert.equal(typed.prevented,0);assert.equal(got.length,0);
  const first=page.event({'text/plain':'hello'});page.listeners.paste(first);
  assert.equal(first.prevented,1);assert.equal(got.length,1);assert.equal(got[0].kind,'text');assert.equal(got[0].text,'hello');
  // A second paste (or the Paste button) while the first is still being added does nothing.
  page.listeners.paste(page.event({'text/plain':'again'}));
  assert.equal(await page.api.pasteInto(target),false);
  assert.equal(got.length,1);
  release();await tick();
  page.listeners.paste(page.event({}));await tick();
  assert.equal(said.at(-1),page.api.MSG.empty);
  open=false;const closed=page.event({'text/plain':'x'});page.listeners.paste(closed);
  assert.equal(closed.prevented,0);assert.equal(got.length,1);
});
test('the board with the highest priority that is open gets the paste',async()=>{
  const page=clipboardPage({}),got=[];
  page.api.register({priority:0,active:()=>true,paste:()=>{got.push('lesson')}});
  page.api.register({priority:3,active:()=>false,paste:()=>{got.push('closed')}});
  page.api.register({priority:2,active:()=>true,paste:()=>{got.push('student board')}});
  page.listeners.paste(page.event({'text/plain':'x'}));await tick();
  assert.deepEqual(got,['student board']);
});
test('the Paste button reads the clipboard and explains clearly when the browser blocks it',async()=>{
  const blocked=clipboardPage({read:async()=>{throw Object.assign(new Error('no'),{name:'NotAllowedError'})}}),said=[];
  const target={active:()=>true,say:text=>said.push(text),paste(){throw new Error('must not run')}};
  assert.equal(await blocked.api.pasteInto(target),false);
  assert.match(said[0],/Click on the whiteboard, then press Ctrl\+V/);
  const textBlob=text=>({text:async()=>text}),got=[];
  const working=clipboardPage({read:async()=>[{types:['text/html','text/plain'],getType:async type=>textBlob(type==='text/plain'?'copied words':'<b>copied words</b>')}]});
  assert.equal(await working.api.pasteInto({active:()=>true,say(){},paste:payload=>{got.push(payload)}}),true);
  assert.equal(got[0].text,'copied words');
  const empty=clipboardPage({read:async()=>[]}),notes=[];
  await empty.api.pasteInto({active:()=>true,say:text=>notes.push(text),paste(){}});
  assert.equal(notes[0],empty.api.MSG.empty);
  const none=clipboardPage(undefined),sorry=[];
  await none.api.pasteInto({active:()=>true,say:text=>sorry.push(text),paste(){}});
  assert.match(sorry[0],/press Ctrl\+V/);
});

// ---------- Student board: picture marks, limits, move, export / import ----------
function studentBoard(){
  const noop=()=>{},plain=new Set(['hidden','disabled','value','textContent','className','id','title','type','files','then','maxLength','placeholder','dir','accept','tabIndex','srcObject','muted','autoplay','playsInline']);
  const fake=()=>new Proxy({style:{setProperty:noop},dataset:{},classList:{toggle:noop,add:noop,remove:noop,contains:()=>false},getClientRects:()=>[{}],
    getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:450,width:800,height:450})},{get:(target,key)=>key in target?target[key]:plain.has(key)||typeof key==='symbol'?undefined:noop});
  const sent=[];
  const context={document:{createElement:fake,getElementById:()=>null,addEventListener:noop,body:fake(),head:fake(),fullscreenElement:null},
    ResizeObserver:class{observe(){}},PointerEvent:class{},Event:class{},CustomEvent:class{},Image:class{},requestAnimationFrame:()=>1,setTimeout,clearTimeout,confirm:()=>true,
    navigator:{},location:{href:'https://example.test/'},URL,console,
    ClassPointerBridge:{isTeacher:false,embedded:true,embeddedStage:fake(),sendTeacher:message=>sent.push(JSON.parse(JSON.stringify(message))),status:noop,callTeacher:null}};
  context.window=context;vm.createContext(context);vm.runInContext(boardsSource,context);
  // Results come from another JavaScript world; copy them into plain objects before comparing.
  const boards=context.ClassPointerBoards;
  return{api:{...boards,exportBoard:()=>JSON.parse(JSON.stringify(boards.exportBoard()))},sent};
}
const line=(id,by)=>({id,color:'#1f2937',size:0.006,points:[{x:.1,y:.1},{x:.2,y:.2}],...(by?{by}:{})});
const picture=(id,data=PNG)=>({id,tool:'rect',color:'#1f2937',size:0.003,points:[{x:.1,y:.1},{x:.5,y:.6}],image:data});
test('a student board is saved with its marks and pictures, and only while it is open',()=>{
  const {api}=studentBoard();
  assert.equal(api.exportBoard(),null);assert.equal(api.importBoard({version:1,kind:'student-board',strokes:[]}),false);
  api.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes:[line('s1-a'),{...line('t1-a'),by:'teacher'},picture('s1-p')]});
  const saved=api.exportBoard();
  assert.equal(saved.version,1);assert.equal(saved.kind,'student-board');
  assert.deepEqual(saved.strokes.map(s=>[s.id,s.by]),[['s1-a','student'],['t1-a','teacher'],['s1-p','student']]);
  assert.deepEqual(saved.images,['s1-p']);assert.equal(saved.strokes[2].image,PNG);assert.equal(saved.activity,null);
  assert.doesNotThrow(()=>JSON.stringify(saved));
});
test('restoring a saved board replaces only my own marks, is checked like network data, and is sent as normal changes',()=>{
  const {api,sent}=studentBoard();
  api.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes:[line('s1-old'),{...line('t1-keep'),by:'teacher'}]});
  const ok=api.importBoard({version:1,kind:'student-board',strokes:[
    line('s9-a','student'),{...line('t9-b'),by:'teacher'},picture('s9-p'),
    picture('s9-evil','javascript:alert(1)'),picture('s9-html','data:text/html;base64,AAAA'),picture('s9-big','data:image/png;base64,'+'A'.repeat(150000)),
    {id:'s9-t',tool:'text',color:'#1f2937',size:.03,points:[{x:.2,y:.2}],text:'x'.repeat(201)},
    {...line('s9-c'),color:'red'},null,'junk',{...line('s9-d'),points:[{x:2,y:0}]}]});
  assert.equal(ok,true);
  const now=api.exportBoard().strokes;
  assert.deepEqual(now.map(s=>s.by),['teacher','student','student']);
  assert.equal(now[0].id,'t1-keep');
  assert.ok(now.slice(1).every(s=>s.id[0]==='s'&&!s.id.startsWith('s9-')));
  assert.equal(now[2].image,PNG);
  assert.deepEqual(sent.map(m=>m.type),['board-clear','board-add','board-add']);
  assert.ok(sent.slice(1).every(m=>m.stroke.id[0]==='s'&&!('by' in m.stroke)));
  for(const bad of [null,{},{version:2,kind:'student-board',strokes:[]},{version:1,kind:'lesson-whiteboard',strokes:[]},{version:1,kind:'student-board',strokes:'x'}])assert.equal(api.importBoard(bad),false);
});
test('at most 6 pictures per board, each small, and only as a rectangle with real corners',()=>{
  const {api}=studentBoard();
  api.fromTeacher({type:'board-mode',on:true,mode:'boards'});
  for(let i=0;i<8;i++)api.fromTeacher({type:'board-add',stroke:picture('t-pic'+i)});
  assert.equal(api.exportBoard().images.length,6);
  api.fromTeacher({type:'board-clear'});
  api.fromTeacher({type:'board-add',stroke:{...picture('t-flat'),points:[{x:.5,y:.5},{x:.1,y:.1}]}});      // corners the wrong way round
  api.fromTeacher({type:'board-add',stroke:{...picture('t-line'),tool:'line'}});                              // not a rectangle
  api.fromTeacher({type:'board-add',stroke:{...picture('t-num'),image:42}});
  api.fromTeacher({type:'board-add',stroke:picture('s-forged')});                                             // the teacher cannot add as the student
  assert.equal(api.exportBoard().strokes.length,0);
  // A whole board sent at once (a student rejoining) is held to the same limit.
  api.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes:Array.from({length:9},(_,i)=>picture('s-p'+i))});
  assert.equal(api.exportBoard().images.length,6);
});
test('moving a picture sends only its new place, and nobody can move the other side\'s marks',()=>{
  const {api}=studentBoard();
  api.fromTeacher({type:'board-mode',on:true,mode:'boards',strokes:[picture('s1-mine'),{...picture('t1-theirs'),by:'teacher'}]});
  api.fromTeacher({type:'board-move',id:'t1-theirs',newId:'t2-theirs',points:[{x:.2,y:.2},{x:.4,y:.5}]});
  api.fromTeacher({type:'board-move',id:'s1-mine',points:[{x:0,y:0},{x:.2,y:.2}]});               // not the teacher's mark
  api.fromTeacher({type:'board-move',id:'t2-theirs',newId:'s-stolen',points:[{x:0,y:0},{x:.2,y:.2}]}); // cannot hand it to the student
  api.fromTeacher({type:'board-move',id:'t2-theirs',points:[{x:0,y:0}]});                           // must stay a rectangle
  api.fromTeacher({type:'board-move',id:'t2-theirs',newId:'s1-mine',points:[{x:0,y:0},{x:.2,y:.2}]});
  const now=api.exportBoard().strokes;
  assert.deepEqual(now.map(s=>s.id),['s1-mine','t2-theirs']);
  assert.deepEqual(now[0].points,[{x:.1,y:.1},{x:.5,y:.6}]);
  assert.deepEqual(now[1].points,[{x:.2,y:.2},{x:.4,y:.5}]);assert.equal(now[1].image,PNG);
  assert.match(boardsSource,/act\(\{type:'board-move',id:from\.id,newId:item\.id,points:item\.points\}\)/);
});
test('student boards offer Paste and Copy board, and keep paste inside text fields alone',()=>{
  assert.match(boardsSource,/button\('📋 Paste'/);assert.match(boardsSource,/button\('📄 Copy board'/);
  assert.match(boardsSource,/Clip\.pasteInto\(target\)/);assert.match(boardsSource,/Clip\.copyFrom\(target\)/);
  assert.doesNotMatch(boardsSource,/addEventListener\('paste'/); // one paste listener for the page, in board-clipboard.js
  assert.match(clipSource,/input,textarea,\[contenteditable=""\],\[contenteditable="true"\]/);
});

// ---------- Teacher lesson whiteboard: save and restore ----------
test('a saved teacher whiteboard is checked before it is restored',()=>{
  const stroke={tool:'pen',color:'#1f2937',size:0.016,points:[{x:.1,y:.1},{x:.2,y:.2}]};
  const jpeg='data:image/jpeg;base64,'+'A'.repeat(64);
  const clean=Clip.cleanLessonBoard({version:1,kind:'lesson-whiteboard',
    pictures:[{data:jpeg,x:.1,y:.1,w:.3,h:.3},{data:'https://example.com/x.png',x:0,y:0,w:.3,h:.3},{data:jpeg,x:NaN,y:0,w:.3,h:.3},{data:jpeg,x:0,y:0,w:90,h:.3},null],
    strokes:[{...stroke,owner:'teacher'},{...stroke,owner:'student:peer-123'},{...stroke,tool:'evil'},{...stroke,points:[{x:5,y:5},{x:6,y:6}]},{tool:'text',color:'#1f2937',size:0.016,points:stroke.points,text:'שלום',owner:'student'}]},Core.cleanStroke);
  assert.equal(clean.pictures.length,1);
  assert.deepEqual(clean.strokes.map(s=>s.owner),['teacher','saved','saved']);
  assert.equal(clean.strokes[2].text,'שלום');
  assert.equal(Clip.cleanLessonBoard({version:1,kind:'student-board'},Core.cleanStroke),null);
  assert.equal(Clip.cleanLessonBoard({version:2,kind:'lesson-whiteboard'},Core.cleanStroke),null);
  assert.equal(Clip.cleanLessonBoard(null,Core.cleanStroke),null);
  const many=Clip.cleanLessonBoard({version:1,kind:'lesson-whiteboard',pictures:Array.from({length:30},()=>({data:jpeg,x:0,y:0,w:.2,h:.2})),strokes:Array.from({length:900},()=>stroke)},Core.cleanStroke);
  assert.equal(many.pictures.length,12);assert.equal(many.strokes.length,400);
});
test('restored marks replace the old ones, are capped at 400, and nobody but the teacher owns them',()=>{
  const store=new Core.HighlightStore(),stroke={tool:'pen',color:'#1f2937',size:0.016,points:[{x:.1,y:.1},{x:.2,y:.2}]};
  store.add('student:old',stroke);
  assert.equal(store.restore([{...stroke,owner:'teacher'},{...stroke,owner:'student:peer'},{tool:'nope'},{...stroke,owner:'saved'}]),3);
  assert.deepEqual(store.strokes.map(s=>s.owner),['teacher','saved','saved']);
  assert.equal(new Set(store.strokes.map(s=>s.id)).size,3);
  store.edit('teacher','undo');assert.equal(store.strokes.length,2); // the teacher can still undo his own restored mark
  assert.equal(store.restore(Array.from({length:500},()=>stroke)),400);
  assert.equal(store.restore('junk'),0);
});
test('the teacher whiteboard exposes paste, copy and the save / restore API',()=>{
  assert.match(pdfSource,/exportWhiteboard,importWhiteboard,exportPng,/);
  assert.match(pdfSource,/kind:'lesson-whiteboard'/);
  assert.match(pdfSource,/cleanLessonBoard\(saved,C\.cleanStroke\)/);
  assert.match(pdfSource,/register\(clipTarget\)/);
  assert.match(pdfSource,/clip\.textStrokes\(payload\.text/);
  assert.match(pdfSource,/data-text-mark/);
  assert.match(pdfSource,/Edit whiteboard text/);
  assert.match(pdfSource,/B\.edit\('erase',stroke\.id\)/);
  assert.doesNotMatch(pdfSource,/addEventListener\('paste'/);
  assert.match(boardsSource,/window\.ClassPointerBoards=\{fromTeacher,clearScreenMarks,exportBoard,importBoard,exportPng,/);
});
