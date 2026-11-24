'use strict';
// Pages (slides) in one whiteboard file: the page-list rules and that old one-page files still open.
const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../class-pointer-prototype/board-pages-core.js');
const pg=id=>({id});
const ids=list=>list.map(p=>p.id);

test('a version 1 file is one page; a version 2 file lists its pages; other kinds are refused',()=>{
  const old={version:1,kind:'lesson-whiteboard',pictures:[],strokes:[]};
  assert.deepEqual(P.pagesOf(old,'lesson-whiteboard'),[old]);
  const two={version:2,kind:'student-board',current:1,pages:[{strokes:[]},{strokes:[]}]};
  assert.equal(P.pagesOf(two,'student-board').length,2);
  assert.equal(P.currentOf(two,2),1);
  assert.equal(P.pagesOf(two,'lesson-whiteboard'),null);
  assert.equal(P.pagesOf({version:2,kind:'student-board',pages:[]},'student-board'),null);
  assert.equal(P.pagesOf({version:3,kind:'student-board',pages:[{}]},'student-board'),null);
  assert.equal(P.pagesOf(null,'student-board'),null);
  assert.equal(P.pagesOf([],'student-board'),null);
});

test('a saved file never holds more than the page limit, and a bad current page falls back to the first',()=>{
  const many={version:2,kind:'student-board',pages:Array.from({length:50},()=>({}))};
  assert.equal(P.pagesOf(many,'student-board').length,P.MAX_PAGES);
  assert.equal(P.wrap('student-board',many.pages,3).pages.length,P.MAX_PAGES);
  assert.equal(P.currentOf({current:99},3),0);
  assert.equal(P.currentOf({current:-1},3),0);
  assert.equal(P.currentOf({current:'x'},3),0);
  const file=P.wrap('lesson-whiteboard',[{},{}],1);
  assert.deepEqual([file.version,file.kind,file.current],[2,'lesson-whiteboard',1]);
});

test('add, delete and move pages, never below one or above the limit',()=>{
  let list=[pg('a')];
  list=P.insert(list,1,pg('b'));list=P.insert(list,1,pg('c'));
  assert.deepEqual(ids(list),['a','c','b']);
  assert.deepEqual(ids(P.insert(list,-5,pg('z'))),['z','a','c','b']);
  assert.deepEqual(ids(P.move(list,'b',0)),['b','a','c']);
  assert.deepEqual(ids(P.move(list,'a',99)),['c','b','a']);
  assert.equal(P.move(list,'a',0),list);
  assert.equal(P.move(list,'nope',1),list);
  assert.deepEqual(ids(P.remove(list,'c')),['a','b']);
  assert.equal(P.remove([pg('only')],'only').length,1);
  assert.equal(P.remove(list,'nope'),list);
  let full=Array.from({length:P.MAX_PAGES},(_,i)=>pg('p'+i));
  assert.equal(P.insert(full,0,pg('x')),full);
});

test('after a delete the page that takes its place is shown, or the last one',()=>{
  const list=[pg('a'),pg('b'),pg('c')];
  assert.equal(P.after(list,'a'),0);   // the old second page is now first
  assert.equal(P.after(list,'b'),1);   // the old third page took its place
  assert.equal(P.after(list,'c'),1);   // the last page was removed: show the new last
  assert.equal(P.after(list,'zzz'),0);
  assert.equal(P.after([pg('a')],'a'),0);
});

test('a new page order from the network must name exactly the pages that exist',()=>{
  const list=[pg('a'),pg('b'),pg('c')];
  assert.deepEqual(ids(P.reorder(list,['c','a','b'])),['c','a','b']);
  assert.equal(P.reorder(list,['a','b']),list);
  assert.equal(P.reorder(list,['a','a','b']),list);
  assert.equal(P.reorder(list,['a','b','x']),list);
  assert.equal(P.reorder(list,'abc'),list);
});

test('page ids are short, safe and different each time',()=>{
  const a=P.newId(),b=P.newId();
  assert.notEqual(a,b);assert.ok(P.validId(a));
  for(const bad of ['','a b','<x>',null,5,'x'.repeat(40)])assert.equal(P.validId(bad),false);
});

// ---------- saved files: version 1 still opens, version 2 holds pages ----------
const Clip=require('../class-pointer-prototype/board-clipboard.js');
const Core=require('../class-pointer-prototype/saved-work-core.js');
const C=require('../class-pointer-prototype/classroom-core.js');
const picture='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const stroke=text=>({owner:'teacher',tool:'text',color:'#1f2937',size:.0078,points:[{x:.1,y:.1},{x:.4,y:.15}],text});
const page=text=>({pictures:[{data:picture,x:0,y:0,w:1,h:1}],strokes:[stroke(text)]});

test('the teacher whiteboard: a one-page (version 1) file opens as one page, exactly as before',()=>{
  const opened=Clip.cleanLessonBoard({version:1,kind:'lesson-whiteboard',pictures:[page('a').pictures[0]],strokes:[stroke('old')]},C.cleanStroke);
  assert.equal(opened.pages.length,1);assert.equal(opened.current,0);
  assert.equal(opened.strokes[0].text,'old');assert.equal(opened.pictures.length,1);
});

test('the teacher whiteboard: a version 2 file keeps every page and the page that was shown',()=>{
  const file=P.wrap('lesson-whiteboard',[page('one'),page('two'),page('three')],2);
  const opened=Clip.cleanLessonBoard(file,C.cleanStroke);
  assert.deepEqual(opened.pages.map(p=>p.strokes[0].text),['one','two','three']);
  assert.equal(opened.current,2);
  assert.equal(opened.strokes[0].text,'three');
});

test('the teacher whiteboard: a bad page is cleaned like any file, other kinds and versions are refused',()=>{
  const messy={version:2,kind:'lesson-whiteboard',current:9,pages:[{pictures:[{data:'javascript:alert(1)',x:0,y:0,w:1,h:1}],strokes:[{tool:'pen',points:'no'}]},page('ok')]};
  const opened=Clip.cleanLessonBoard(messy,C.cleanStroke);
  assert.equal(opened.pages.length,2);assert.equal(opened.pages[0].pictures.length,0);assert.equal(opened.pages[0].strokes.length,0);
  assert.equal(opened.current,0);
  assert.equal(Clip.cleanLessonBoard({version:2,kind:'student-board',pages:[page('x')]},C.cleanStroke),null);
  assert.equal(Clip.cleanLessonBoard({version:3,kind:'lesson-whiteboard',pages:[page('x')]},C.cleanStroke),null);
  assert.equal(Clip.cleanLessonBoard({version:2,kind:'lesson-whiteboard',pages:[]},C.cleanStroke),null);
  const many={version:2,kind:'lesson-whiteboard',pages:Array.from({length:60},()=>page('x'))};
  assert.equal(Clip.cleanLessonBoard(many,C.cleanStroke).pages.length,P.MAX_PAGES);
});

test('saved files: parseBoard opens version 1 and version 2 of the right kind, nothing else',()=>{
  const text=data=>JSON.stringify(data);
  assert.ok(Core.parseBoard(text({version:1,kind:'student-board',strokes:[]}),'student-board',1e6));
  assert.ok(Core.parseBoard(text(P.wrap('student-board',[{strokes:[]},{strokes:[]}],0)),'student-board',1e6));
  assert.equal(Core.parseBoard(text({version:2,kind:'student-board',pages:[]}),'student-board',1e6),null);
  assert.equal(Core.parseBoard(text({version:2,kind:'student-board'}),'student-board',1e6),null);
  assert.equal(Core.parseBoard(text({version:2,kind:'lesson-whiteboard',pages:[{}]}),'student-board',1e6),null);
  assert.equal(Core.parseBoard(text({version:3,kind:'student-board',pages:[{}]}),'student-board',1e6),null);
  assert.equal(Core.parseBoard(text({version:2,kind:'student-board',pages:Array.from({length:21},()=>({}))}),'student-board',1e6),null);
});

test('saved files: the number of pages is written beside a multi-page file and left out of a one-page file',()=>{
  const multi=Core.fileMetadata({name:'Notes',kind:'whiteboard',boardPages:4,savedAt:1});
  assert.equal(multi.boardPages,'4');
  assert.equal('boardPages' in Core.fileMetadata({name:'Notes',kind:'whiteboard',boardPages:1,savedAt:1}),false);
  assert.equal('boardPages' in Core.fileMetadata({name:'Notes',kind:'whiteboard',savedAt:1}),false);
  assert.equal(Core.fileFromMetadata({name:'abc.json',customMetadata:multi,size:5}).boardPages,4);
  assert.equal('boardPages' in Core.fileFromMetadata({name:'abc.json',customMetadata:Core.fileMetadata({name:'x',kind:'whiteboard',savedAt:1}),size:5}),false);
});
