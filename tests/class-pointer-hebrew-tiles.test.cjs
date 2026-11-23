'use strict';
// Hebrew word tiles and word boxes on the Class Pointer whiteboard (board-tiles-core.js and how student-boards.js uses it).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const T=require('../class-pointer-prototype/board-tiles-core.js');
const read=file=>fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');

const POSUK='בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃';

test('a pasted posuk becomes one tile per word and keeps every nikud mark',()=>{
  const r=T.parse(POSUK,{});
  assert.equal(r.error,undefined);
  assert.equal(r.activity.tiles.length,7);
  assert.equal(r.activity.tiles.map(t=>t.text).join(' '),POSUK);
  assert.equal(r.activity.boxes.length,7,'one box per tile unless the teacher says otherwise');
  assert.deepEqual(r.activity.tiles.map(t=>t.id),['t1','t2','t3','t4','t5','t6','t7']);
});

test('whole-word mode ignores | and pre-split mode cuts words into parts',()=>{
  const whole=T.parse('ו|אמר|ו הלך',{presplit:false});
  assert.deepEqual(whole.activity.tiles.map(t=>t.text),['ואמרו','הלך']);
  const split=T.parse('ו|אמר|ו הלך',{presplit:true});
  assert.deepEqual(split.activity.tiles.map(t=>t.text),['ו','אמר','ו','הלך']);
});

test('boxes: custom number, names that repeat, and none at all',()=>{
  const r=T.parse('א ב ג',{boxes:'6',labels:'prefix, shoresh; suffix'});
  assert.deepEqual(r.activity.boxes.map(b=>b.label),['prefix','shoresh','suffix','prefix','shoresh','suffix']);
  assert.equal(T.parse('א ב',{boxes:'0'}).activity.boxes.length,0);
  assert.ok(T.parse('א',{boxes:'99'}).error);
  assert.ok(T.parse('א',{boxes:'-1'}).error);
});

test('empty, too long, too many and oversized words are refused with a plain message, never cut short',()=>{
  assert.ok(T.parse('   ',{}).error);
  assert.ok(T.parse(Array.from({length:41},()=>'א').join(' '),{}).error);
  assert.ok(T.parse('א'.repeat(25),{}).error);
  assert.ok(T.parse('א '.repeat(900),{}).error);
});

test('hidden direction and control characters are removed from tiles',()=>{
  const sneaky='ש'+String.fromCharCode(0x202e)+'לום'+String.fromCharCode(0x200b)+' '+String.fromCharCode(7)+'x';
  const r=T.parse(sneaky,{});
  assert.deepEqual(r.activity.tiles.map(t=>t.text),['שלום','x']);
});

test('an activity from the network is checked: bad ids, duplicates and empty words are rejected',()=>{
  const good=T.parse('א ב',{}).activity;
  assert.deepEqual(T.cleanActivity(good),good);
  assert.equal(T.cleanActivity({...good,tiles:[{id:'t1',text:'א'},{id:'t1',text:'ב'}]}),null);
  assert.equal(T.cleanActivity({...good,tiles:[{id:'x1',text:'א'}]}),null);
  assert.equal(T.cleanActivity({...good,tiles:[{id:'t1',text:'  '}]}),null);
  assert.equal(T.cleanActivity({...good,boxes:[{id:'t1',label:''}]}),null);
  assert.equal(T.cleanActivity({kind:'word',text:'x'}),null);
  assert.equal(T.cleanActivity(null),null);
});

test('boxes fit on the board, do not overlap, and read right to left',()=>{
  for(const n of [1,3,5,6,12,24,40]){
    const act=T.parse(Array.from({length:n},()=>'אבג').join(' '),{}).activity,boxes=T.boxLayout(act);
    assert.equal(boxes.length,n);
    for(const b of boxes){assert.ok(b.x-b.w/2>=0&&b.x+b.w/2<=1,'box inside, n='+n);assert.ok(b.y-b.h/2>=0&&b.y+b.h/2<=1)}
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j];
      assert.ok(Math.abs(a.x-b.x)>=a.w-1e-9||Math.abs(a.y-b.y)>=a.h-1e-9,'boxes '+i+' and '+j+' overlap, n='+n);
    }
    if(n>1)assert.ok(boxes[0].x>boxes[1].x,'the first box is the right-most');
  }
});

test('tiles start in the tray, above the boxes, inside the board',()=>{
  const act=T.parse(POSUK,{}).activity,state=T.defaultState(act),boxTop=Math.min(...T.boxLayout(act).map(b=>b.y-b.h/2));
  assert.equal(state.length,7);
  for(const t of state){assert.ok(t.x>0&&t.x<1&&t.y>0&&t.y<boxTop,'tile '+t.id+' starts in the tray');assert.equal(t.box,'')}
});

test('moving a tile: it goes on top, and a box holds only one tile',()=>{
  const act=T.parse('א ב ג',{}).activity;let state=T.defaultState(act);
  state=T.move(act,state,{id:'t1',x:.3,y:.7,box:'b1'});
  assert.equal(state[state.length-1].id,'t1');
  assert.equal(state.find(t=>t.id==='t1').box,'b1');
  assert.equal(T.move(act,state,{id:'t2',x:.3,y:.7,box:'b1'}),null,'b1 is taken');
  assert.ok(T.move(act,state,{id:'t1',x:.31,y:.7,box:'b1'}),'the tile in the box may move inside it');
  assert.equal(T.move(act,state,{id:'zz',x:.5,y:.5,box:''}),null,'unknown tile');
  assert.equal(T.move(act,state,{id:'t2',x:2,y:.5,box:''}),null,'off the board');
  assert.equal(T.move(act,state,{id:'t2',x:.5,y:.5,box:'b9'}),null,'unknown box');
});

test('a tile that claims a box always sits in the middle of that box',()=>{
  const act=T.parse('א ב',{}).activity,box=T.boxLayout(act)[0];
  const tile=T.cleanTile(act,{id:'t1',x:.05,y:.95,box:'b1'});
  assert.deepEqual([tile.x,tile.y,tile.box],[Math.round(box.x*1e4)/1e4,Math.round(box.y*1e4)/1e4,'b1']);
  assert.deepEqual(T.cleanState(act,[{id:'t2',x:.9,y:.9,box:'b1'}]).find(t=>t.id==='t2').x,Math.round(box.x*1e4)/1e4);
});

test('a student can only move tiles: the words are never part of what is sent',()=>{
  const act=T.parse('א ב',{}).activity,state=T.cleanState(act,[{id:'t1',x:.2,y:.2,box:'',text:'HACKED'}]);
  assert.deepEqual(Object.keys(state[0]).sort(),['box','id','x','y']);
});

test('saved or received positions are cleaned: duplicates dropped, missing tiles start at home, one tile per box',()=>{
  const act=T.parse('א ב ג',{}).activity;
  const state=T.cleanState(act,[{id:'t1',x:.2,y:.8,box:'b1'},{id:'t1',x:.9,y:.9,box:''},{id:'t2',x:.4,y:.8,box:'b1'},{id:'nope',x:.1,y:.1,box:''},{id:'t3',x:'x',y:.1,box:''}]);
  assert.equal(state.length,3);
  assert.deepEqual(state.map(t=>t.id).sort(),['t1','t2','t3']);
  assert.equal(state.find(t=>t.id==='t1').box,'b1');
  assert.equal(state.find(t=>t.id==='t2').box,'','the second tile claiming b1 is let go');
  assert.equal(T.cleanState(act,'junk').length,3);
  assert.equal(T.cleanState(null,[]),null);
});

test('dropping on a free box snaps the tile into its middle; dropping on a full box sends it back',()=>{
  const act=T.parse('א ב',{}).activity;let state=T.defaultState(act);
  const box=T.boxLayout(act)[0];
  const first=T.drop(act,state,'t1',box.x+.01,box.y-.01,{x:.5,y:.2,box:''});
  assert.deepEqual([first.box,first.x,first.y],['b1',Math.round(box.x*1e4)/1e4,Math.round(box.y*1e4)/1e4]);
  state=T.move(act,state,first);
  const second=T.drop(act,state,'t2',box.x,box.y,{x:.3,y:.2,box:''});
  assert.deepEqual([second.box,second.x,second.y],['',.3,.2],'the box is taken, so the tile goes back');
  const free=T.drop(act,state,'t2',.5,.3,{x:.3,y:.2,box:''});
  assert.deepEqual([free.box,free.x,free.y],['',.5,.3],'dropped on empty board it stays where it is let go');
});

test('hit test finds the top tile under a point and nothing in empty space',()=>{
  const act=T.parse('א ב',{}).activity,state=[{id:'t1',x:.5,y:.3,box:''},{id:'t2',x:.5,y:.3,box:''}];
  assert.equal(T.tileAt(act,state,{x:.5,y:.3},1000,562).id,'t2');
  assert.equal(T.tileAt(act,state,{x:.05,y:.95},1000,562),null);
});

test('the dragger picks up, moves and snaps a tile, and cancel puts it back',()=>{
  const act=T.parse('א ב',{}).activity;let state=T.defaultState(act);const sent=[];
  const io={activity:()=>act,state:()=>state,size:()=>({w:1000,h:562}),redraw(){},apply(op){const next=T.move(act,state,op.tile);if(next){state=next;sent.push(op.tile)}}};
  const d=T.dragger(io),start=state.find(t=>t.id==='t1'),box=T.boxLayout(act)[1];
  assert.equal(d.down({x:.01,y:.99}),false,'empty space is not a tile');
  assert.equal(d.down({x:start.x,y:start.y}),true);
  d.move({x:.5,y:.6},true);
  d.up({x:box.x,y:box.y});
  const end=state.find(t=>t.id==='t1');
  assert.equal(end.box,'b2');
  assert.ok(sent.length>=3);
  assert.equal(d.active(),false);
  const home=state.find(t=>t.id==='t2');
  d.down({x:home.x,y:home.y});d.move({x:.5,y:.5},true);d.cancel();
  const back=state.find(t=>t.id==='t2');
  assert.deepEqual([back.x,back.y,back.box],[home.x,home.y,'']);
});

test('student-boards.js is wired to the tiles: messages, saving, restoring, and a teacher button',()=>{
  const s=read('class-pointer-prototype/student-boards.js');
  assert.match(s,/ClassPointerTiles/);
  assert.match(s,/op\.type==='board-tile'/);
  assert.match(s,/message\.tiles=b\.tiles/);
  assert.match(s,/boardFromMessage\(message\.strokes,message\.text,message\.tiles\)/);
  assert.match(s,/tiles:board\.tiles\.map/,'the student\'s tile places are saved with the board');
  assert.match(s,/data\.tiles/,'and put back when it is opened');
  assert.match(s,/Hebrew tiles/);
  assert.match(s,/grab:\{hit:/,'tiles can be picked up through the drawing toolbar');
  const tb=read('class-pointer-prototype/annotation-toolbar.js');
  assert.match(tb,/surface\.grab/);
});

test('every page that loads the whiteboard also loads the tiles script first, with the same version',()=>{
  const html=read('class-pointer-prototype/classroom.html'),share=read('class-pointer-prototype/activity-share.js');
  assert.ok(html.indexOf('board-tiles-core.js')>0&&html.indexOf('board-tiles-core.js')<html.indexOf('student-boards.js'));
  assert.ok(share.indexOf('board-tiles-core.js')>0&&share.indexOf('board-tiles-core.js')<share.indexOf('student-boards.js'));
  assert.ok(fs.existsSync(path.resolve(__dirname,'..','class-pointer-prototype/fonts/DavidLibre-Regular.ttf')),'the Hebrew font is bundled');
});
