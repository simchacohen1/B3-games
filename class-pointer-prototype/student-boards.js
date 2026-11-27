'use strict';
// Class Pointer whiteboards.
//  • Whiteboard (teacher button): a blank board shown to everyone. It reuses the webpage/PDF lesson mode,
//    so zoom, pointers, Pen, Highlight and student permissions all work as usual.
//  • Student boards (teacher button): every admitted student gets a tile in a grid that resizes with the number of
//    students. Mode for the whole class: Whiteboards (each student draws on a private board; the teacher can open
//    one large and write on it) or Screens (each student shares his screen; open one large to point or draw on it — he sees your marks). 🚫 pauses one student.
// Board lines travel over the existing PeerJS data connection as small "board-*" messages. Nothing is stored online.
// Both sides apply the same operations, so the teacher's copy and the student's copy stay identical. Who made a
// change ("student" or "teacher") always comes from the connection, never from the message itself.
(function(){
  const B=window.ClassPointerBridge;
  if(!B)return;
  const $=id=>id==='stage'&&B.embedded?B.embeddedStage:document.getElementById(id),stage=$('stage'),isTeacher=B.isTeacher;
  const PALETTE=[['#1f2937','Black'],['#777777','Gray'],['#ffffff','White'],['#1d4ed8','Blue'],['#29b6f6','Sky Blue'],['#4dd0e1','Turquoise'],['#009688','Teal'],['#c62828','Red'],['#ff7043','Coral'],['#ef6c00','Orange'],['#ffc107','Gold'],['#fff176','Yellow'],['#cddc39','Lime'],['#8bc34a','Light Green'],['#2e7d32','Green'],['#a5d6a7','Mint'],['#7b1fa2','Purple'],['#ab47bc','Violet'],['#b39ddb','Lavender'],['#ec407a','Pink'],['#f48fb1','Light Pink'],['#795548','Brown'],['#bcaaa4','Tan'],['#ffd1a9','Peach']];
  const COLORS=PALETTE.map(item=>item[0]);
  const SIZES=[[0.003,'Thin',5],[0.006,'Medium',9],[0.012,'Thick',14],[0.03,'Color',22]];
  const SIZE_VALUES=SIZES.map(item=>item[0]);
  // Boards are 16:9. Points are 0..1 across and down the board. Line sizes are a fraction of the board width.
  const ASPECT=16/9,MAX_STROKES=400,MAX_POINTS=600,STEP=0.0015,ERASE=0.01,DRAFT_MS=80;
  let seq=0;
  const newId=letter=>letter+Date.now().toString(36)+'-'+(++seq).toString(36);
  const round=value=>Math.round(value*1e4)/1e4;
  // A pasted picture is an ordinary board mark: a rectangle (two corners) that also carries a small picture.
  // So it is added, moved, removed, undone, limited and sent exactly like every other mark.
  const MAX_IMAGE=150000,MAX_IMAGES=6,IMAGE_DATA=/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+=*$/i,RTL=/[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
  const FULL='This board is full. Clear some marks first.';
  // Paste and Copy (board-clipboard.js). Pages that did not load it get it from beside this file.
  const here=document.currentScript?.src;
  let Clip=window.ClassPointerClipboard||null;
  const clipReady=Clip?Promise.resolve(Clip):new Promise(resolve=>{
    const done=()=>resolve(Clip=window.ClassPointerClipboard||null);
    if(!here){done();return}
    const script=document.createElement('script');script.src=new URL('board-clipboard.js',here).href;script.onload=done;script.onerror=done;document.head.append(script);
  });

  function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
  function button(text,title,onClick,cls){const node=el('button',cls,text);node.type='button';if(title)node.title=title;if(onClick)node.addEventListener('click',onClick);return node}
  function scheduler(fn){let frame=0;return()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;fn()})}}
  function expanded(){return document.fullscreenElement===stage||stage.classList.contains('lesson-fullscreen')}
  // Board UI sits inside the lesson (so it follows full screen) but must never move a pointer or start a highlight.
  function shield(node){
    ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick','wheel'].forEach(type=>node.addEventListener(type,event=>event.stopPropagation()));
    node.addEventListener('pointerenter',()=>stage.dispatchEvent(new PointerEvent('pointerleave')));
  }

  // ---------- Board data ----------
  const validPoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  // Lines from the shared drawing toolbar (annotation-toolbar.js) may also be a highlight, a shape or a text box.
  const ITEM_TOOLS=['highlight','rect','ellipse','triangle','line','arrow','text'],ITEM_SIZES=SIZE_VALUES.concat([0.02,0.045]);
  function cleanStroke(s){
    if(!s||typeof s.id!=='string'||!/^[a-z0-9-]{2,40}$/i.test(s.id)||!COLORS.includes(s.color)||!Array.isArray(s.points)||!s.points.length||s.points.length>MAX_POINTS||!s.points.every(validPoint))return null;
    const tool=s.tool==null||s.tool==='pen'?null:s.tool;
    if(tool!==null&&!ITEM_TOOLS.includes(tool))return null;
    // Words may be any size a teacher's words can be (an editable copy of the teacher's board keeps them); lines keep the fixed sizes.
    if(tool==='text'?!(Number.isFinite(s.size)&&s.size>=.01&&s.size<=.08):!(tool?ITEM_SIZES:SIZE_VALUES).includes(s.size))return null;
    const out={id:s.id,color:s.color,size:tool==='text'?round(s.size):s.size,points:s.points.map(p=>({x:round(p.x),y:round(p.y)}))};
    // On a group board the teacher's page marks each line with the code of the student who drew it ("m3").
    if(typeof s.who==='string'&&/^m[0-9]{1,5}$/.test(s.who))out.who=s.who;
    if(tool){
      if(tool==='text'){if(typeof s.text!=='string'||!s.text.trim()||s.text.length>200||out.points.length!==1)return null;out.text=s.text;
        // Left is the usual and stored as nothing; the lines of the words may also be centered or right.
        if(s.align==='center'||s.align==='right')out.align=s.align}
      else if(tool!=='highlight'&&out.points.length!==2)return null;
      out.tool=tool;
      // A closed shape may be filled with its own color (a picture, which is also a rectangle, never is).
      if(s.fill===true&&['rect','ellipse','triangle'].includes(tool)&&s.image==null)out.fill=true;
    }
    if(s.image!=null){
      // A picture: small, a real picture data: URL, and its corners are top-left then bottom-right.
      const [a,b]=out.points;
      if(tool!=='rect'||typeof s.image!=='string'||s.image.length>MAX_IMAGE||!IMAGE_DATA.test(s.image)||b.x-a.x<.02||b.y-a.y<.02)return null;
      out.image=s.image;
    }
    return out;
  }
  const pictureCount=board=>board.strokes.filter(s=>s.image).length;
  // One teacher-owned activity is copied to every student's independent board.
  // Uploaded pictures remain locked under the boys' marks. Word activities have a
  // separate, editable text object on each boy's board.
  const MAX_ACTIVITY_IMAGE=420000;
  let activity=null,activityImage=null;
  // Hebrew word tiles and word boxes (board-tiles-core.js). Without that file a tiles activity is simply not shown.
  const Tiles=window.ClassPointerTiles||null;
  function cleanActivity(raw){
    if(!raw||raw.kind==='blank')return null;
    if(raw.kind==='tiles')return Tiles?Tiles.cleanActivity(raw):null;
    if(raw.kind==='word'&&typeof raw.text==='string'){
      const text=raw.text.trim().slice(0,80),instruction=String(raw.instruction||'').trim().slice(0,120);
      if(text)return{kind:'word',text,instruction};
    }
    if(raw.kind==='image'&&typeof raw.data==='string'&&raw.data.length<=MAX_ACTIVITY_IMAGE&&/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(raw.data))
    {
      // The teacher's subject folder (when it came from one) and the "Mark as important" tick travel with the picture, so
      // each student's saved copy is marked with the subject and arrives starred.
      const subject=String(raw.subject||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,40);
      // Each send has its own id: a student keeps a copy for every send, but not twice when the same send is delivered again
      // (a reconnect, or a student joining late).
      const id=/^[A-Za-z0-9_-]{8,48}$/.test(String(raw.id||''))?String(raw.id):'';
      return{kind:'image',data:raw.data,...(id?{id}:{}),...(subject?{subject}:{}),...(raw.important===true?{important:true}:{})};
    }
    return null;
  }
  function chooseActivity(next,done){
    activity=cleanActivity(next);activityImage=null;
    if(activity?.kind==='tiles')Tiles.loadFont(done);
    if(activity?.kind==='image'){
      const img=new Image();
      img.onload=()=>{if(activity?.data===img.src){activityImage=img;done()}};
      img.onerror=()=>{if(activity?.data===img.src)done()};
      img.src=activity.data;
    }
    done();
  }
  const TEXT_MIN=.10,TEXT_MAX=.60;
  function defaultWord(){
    return activity?.kind==='word'?{value:activity.text,size:.30,color:'#1f2937',x:.50,y:.49}:null;
  }
  function cleanWord(raw){
    if(!raw||typeof raw.value!=='string'||raw.value.length>80||typeof raw.color!=='string'||!/^#[0-9a-f]{6}$/i.test(raw.color)||
      !Number.isFinite(raw.size)||raw.size<TEXT_MIN||raw.size>TEXT_MAX||!validPoint(raw))return null;
    return{value:raw.value,size:round(raw.size),color:raw.color.toLowerCase(),x:round(raw.x),y:round(raw.y)};
  }
  function paintActivity(ctx,w,h,board){
    const bx=board.box||{x:0,y:0,w:1,h:1};
    if(board.bg){const bg=pictureOf(board.bg);if(bg)ctx.drawImage(bg,bx.x*w,bx.y*h,bx.w*w,bx.h*h)}
    if(activity?.kind==='image'){
      if(activityImage?.complete&&activityImage.naturalWidth)ctx.drawImage(activityImage,bx.x*w,bx.y*h,bx.w*w,bx.h*h);
    }else if(activity?.kind==='tiles'){
      Tiles.paint(ctx,w,h,activity,board.tiles);
    }else if(activity?.kind==='word'){
      const word=board.text||defaultWord();
      ctx.save();ctx.direction='rtl';ctx.textAlign='center';ctx.textBaseline='middle';
      if(activity.instruction){
        ctx.fillStyle='#59667c';ctx.font='600 '+Math.max(9,h*0.064)+'px Arial, sans-serif';
        ctx.fillText(activity.instruction,w/2,h*0.14,w*0.92);
      }
      if(word&&word.value){
        ctx.fillStyle=word.color;
        let size=Math.max(10,h*word.size);
        ctx.font='700 '+size+'px Arial, sans-serif';
        while(size>12&&ctx.measureText(word.value).width>w*.90){size*=.9;ctx.font='700 '+size+'px Arial, sans-serif'}
        ctx.fillText(word.value,word.x*w,word.y*h,w*.95);
      }
      ctx.restore();
    }
  }
  // ---------- Pages (slides) ----------
  // A board is a list of pages. `board` (the "set") answers for the page being shown (its strokes, drafts, text, tiles
  // and background), so everything that draws or edits a board works on that page unchanged. Page ids are how the two
  // sides name a page on the network; the first page of every board is FIRST_PAGE. Without board-pages-core.js there
  // is only ever that one page.
  const Pages=window.ClassPointerPages||null,FIRST_PAGE='pg0',PAGE_BG_MAX=200000;
  // Teacher: pictures that were sent as pages [{id,bg}] (+ send info), so every board starts with them.
  let classPages=null;
  function cleanBg(raw){return typeof raw==='string'&&raw.length<=PAGE_BG_MAX&&/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(raw)?raw:''}
  // Where the sent picture sits on a board, as a share of the board (x, y, width, height). Null is "fills the board".
  function cleanBox(raw){
    if(!raw||![raw.x,raw.y,raw.w,raw.h].every(Number.isFinite))return null;
    const w=raw.w,h=raw.h;
    if(w<.05||h<.05||w>4||h>4||raw.x<-w*.9||raw.x>1-w*.1||raw.y<-h*.9||raw.y>1-h*.1)return null;
    return{x:round(raw.x),y:round(raw.y),w:round(w),h:round(h)};
  }
  function newPage(id,bg){return{id:id||FIRST_PAGE,strokes:[],drafts:{student:null,teacher:null},text:defaultWord(),tiles:activity?.kind==='tiles'?Tiles.defaultState(activity):null,bg:bg||'',box:null}}
  function makeSet(pages){
    const set={pages:pages&&pages.length?pages:[newPage()],viewId:'',curId:''};
    set.viewId=set.curId=set.pages[0].id;
    Object.defineProperty(set,'at',{get(){const i=set.pages.findIndex(p=>p.id===set.viewId);return i<0?0:i}});
    for(const key of ['strokes','drafts','text','tiles','bg','box'])Object.defineProperty(set,key,{get(){return set.pages[set.at][key]},set(value){set.pages[set.at][key]=value}});
    return set;
  }
  const pageId=set=>set.pages[set.at].id;
  // A change to the page being shown names that page, so it still lands on the right page if the other side is elsewhere.
  const pagedOp=(set,op)=>Pages&&!/^board-page/.test(op.type)?{...op,pg:pageId(set)}:op;
  const clearDrafts=set=>{if(set)for(const page of set.pages)page.drafts={student:null,teacher:null}};
  function emptyBoard(){
    return makeSet(classPages?classPages.map(p=>{
      const page=newPage(p.id,p.bg);
      // Pieces sent as editable items: each board gets its own copy of them, owned by the teacher.
      if(Array.isArray(p.strokes))page.strokes=p.strokes.map(s=>({...s,points:s.points.map(q=>({...q})),by:'teacher'}));
      return page;
    }):null);
  }
  // Student line ids start with "s", teacher line ids with "t". Each side may remove or clear only its own lines;
  // only the teacher may clear a whole board.
  function applyOp(board,op,by){
    if(op.type==='board-text'){
      if(activity?.kind!=='word'||!board.text)return false;
      const text=cleanWord(op.text);if(!text)return false;
      board.text=text;return true;
    }
    // A tile moved (by the student, or by the teacher on a student's board). Only the tile's place changes, never its words.
    if(op.type==='board-tile'){
      if(activity?.kind!=='tiles'||!board.tiles)return false;
      const next=Tiles.move(activity,board.tiles,op.tile);
      if(!next)return false;
      board.tiles=next;return true;
    }
    // The picture the teacher sent (the page background or the class picture) is the student's own copy to move and resize.
    if(op.type==='board-box'){
      if(by!=='student')return false;
      const b=cleanBox(op.box);if(!b)return false;
      board.box=b;return true;
    }
    if(op.type==='board-add'){
      const s=cleanStroke(op.stroke);
      if(!s||s.id[0]!==by[0]||board.strokes.length>=MAX_STROKES||board.strokes.some(item=>item.id===s.id)||(s.image&&pictureCount(board)>=MAX_IMAGES))return false;
      s.by=by;board.strokes.push(s);board.drafts[by]=null;return true;
    }
    // Move or resize one of my own marks without sending it again (a picture stays where it is in the pile).
    if(op.type==='board-move'){
      // A student on their own (not a group's) board may also move and resize what the teacher put there (op.any): it is their copy.
      const old=board.strokes.find(item=>item.id===op.id&&(item.by===by||(by==='student'&&op.any===true&&item.by==='teacher')));if(!old)return false;
      const s=cleanStroke({...old,id:typeof op.newId==='string'?op.newId:old.id,points:op.points});
      if(!s||s.id[0]!==(old.by===by?by[0]:'s')||(old.by!==by&&s.id===old.id)||s.points.length!==old.points.length||(s.id!==old.id&&board.strokes.some(item=>item.id===s.id)))return false;
      s.by=by;board.strokes[board.strokes.indexOf(old)]=s;return true;
    }
    if(op.type==='board-remove'){
      if(!Array.isArray(op.ids))return false;
      const ids=new Set(op.ids.slice(0,MAX_STROKES).filter(id=>typeof id==='string')),before=board.strokes.length;
      // The teacher may also remove a student's mark (op.any). A student may remove the teacher's marks only from their own board (a group
      // board never passes it on: groupOp keeps just the student's own lines).
      const anyOwner=op.any===true;
      board.strokes=board.strokes.filter(s=>!((anyOwner||s.by===by)&&ids.has(s.id)));return board.strokes.length!==before;
    }
    // Teacher only: put a mark on the board that is owned by the student (the teacher moved, resized or recolored the
    // student's own mark, or undid that). It may take the place of the mark it replaces. The student can still change it.
    if(op.type==='board-put'){
      if(by!=='teacher')return false;
      const s=cleanStroke(op.stroke);if(!s)return false;
      const at=typeof op.replaces==='string'?board.strokes.findIndex(item=>item.id===op.replaces):-1;
      if(board.strokes.some((item,i)=>i!==at&&item.id===s.id)||(at<0&&board.strokes.length>=MAX_STROKES))return false;
      if(s.image&&pictureCount(board)-(at>=0&&board.strokes[at].image?1:0)>=MAX_IMAGES)return false;
      s.by=op.owner==='student'?'student':'teacher';
      if(at>=0)board.strokes[at]=s;else board.strokes.push(s);
      return true;
    }
    // Layers: the marks named in `ids` are put in that order, in the places those marks already hold in the pile. A student
    // orders only their own marks (the teacher's marks and everyone else's keep their places); the teacher may order any.
    if(op.type==='board-order'){
      if(!Array.isArray(op.ids))return false;
      const want=[...new Set(op.ids.slice(0,MAX_STROKES).filter(id=>typeof id==='string'))],rank=new Map(want.map((id,i)=>[id,i])),slots=[],picked=[];
      board.strokes.forEach((s,i)=>{if(rank.has(s.id)&&(by==='teacher'||s.by===by)){slots.push(i);picked.push(s)}});
      if(picked.length<2)return false;
      const sorted=picked.slice().sort((a,b)=>rank.get(a.id)-rank.get(b.id));
      if(sorted.every((s,i)=>s===picked[i]))return false;
      slots.forEach((at,i)=>{board.strokes[at]=sorted[i]});return true;
    }
    if(op.type==='board-clear'){
      board.strokes=op.all===true&&by==='teacher'?[]:board.strokes.filter(s=>s.by!==by);board.drafts={student:null,teacher:null};return true;
    }
    if(op.type==='board-draft'){
      const s=op.stroke?cleanStroke(op.stroke):null;board.drafts[by]=s&&s.id[0]===by[0]?s:null;return true;
    }
    return false;
  }
  // Where a change from the network goes: the page it names (`pg`), or the page being shown when it names none.
  function applyTo(set,op,by){
    if(!op||typeof op.type!=='string')return false;
    if(op.type.startsWith('board-page'))return applyPageOp(set,op,by);
    const page=op.pg===undefined?set.pages[set.at]:set.pages.find(item=>item.id===op.pg);
    return page?applyOp(page,op,by):false;
  }
  // Only the student changes the pages of their own board (the teacher can look at any page, and send pages to everyone).
  function applyPageOp(set,op,by){
    if(!Pages||by!=='student')return false;
    const list=set.pages;
    if(op.type==='board-page-add'){
      if(!Pages.validId(op.id)||list.length>=Pages.MAX_PAGES||list.some(p=>p.id===op.id))return false;
      const at=typeof op.after==='string'?list.findIndex(p=>p.id===op.after):-1;
      set.pages=Pages.insert(list,(at<0?list.length-1:at)+1,newPage(op.id));return true;
    }
    if(op.type==='board-page-remove'){
      const place=Pages.after(list,op.id),next=Pages.remove(list,op.id);
      if(next===list)return false;
      const wasCurrent=set.curId===op.id,wasShown=set.viewId===op.id;
      set.pages=next;
      if(wasCurrent)set.curId=next[place].id;
      if(wasShown)set.viewId=wasCurrent?set.curId:next[place].id;
      return true;
    }
    if(op.type==='board-page-at'){
      if(!list.some(p=>p.id===op.pg))return false;
      const following=set.viewId===set.curId;
      set.curId=op.pg;if(following)set.viewId=op.pg;return true;
    }
    if(op.type==='board-page-move'){
      const next=Pages.reorder(list,op.order);
      if(next===list)return false;
      set.pages=next;return true;
    }
    return false;
  }
  // The shared drawing toolbar hands over the whole list of one side's marks; turn the difference into board changes.
  // A picture that was only moved keeps its picture: send its new place, not the whole picture again.
  function syncBoardItems(board,by,list,act,own,anyOwner){
    // `own` (a group board): only my own lines are mine to add, remove or move; my group's other lines are left alone.
    // `anyOwner` (a student's own board): the teacher's marks are theirs to change too.
    const isMine=item=>(item.by===by&&(!own||own(item)))||(anyOwner===true&&item.by==='teacher');
    const mine=board.strokes.filter(isMine),keep=new Set(list.map(item=>item.id)),had=new Set(mine.map(item=>item.id));
    const gone=mine.filter(item=>!keep.has(item.id)),moved=new Set();
    for(const item of list){
      const from=!had.has(item.id)&&item.image?gone.find(old=>old.image===item.image&&!moved.has(old.id)):null;
      if(from){moved.add(from.id);moved.add(item.id);act({type:'board-move',id:from.id,newId:item.id,points:item.points,...(from.by!==by?{any:true}:{})})}
    }
    const removed=gone.filter(item=>!moved.has(item.id)).map(item=>item.id);
    if(removed.length)act({type:'board-remove',ids:removed,...(removed.some(id=>board.strokes.find(item=>item.id===id)?.by!==by)?{any:true}:{})});
    for(const item of list)if(!had.has(item.id)&&!moved.has(item.id)){const {by:_by,...stroke}=item;act({type:'board-add',stroke})}
    syncOrder(board,list,act,item=>item.by===by&&(!own||own(item)));
  }
  // The toolbar's list is the pile (last on top). A mark that was moved or recolored is added again at the top, and a Bring
  // forward / Send back only changes the order, so after the adds and removes send the order when it is not the list's.
  function syncOrder(board,list,act,mine){
    const want=list.map(item=>item.id),listed=new Set(want),now=board.strokes.filter(item=>mine(item)&&listed.has(item.id)).map(item=>item.id);
    if(now.length>1&&now.length===want.length&&now.some((id,i)=>id!==want[i]))act({type:'board-order',ids:want});
  }
  // The teacher's toolbar sees every mark on a student's board. A change to the student's own mark (move, resize,
  // recolor, nudge, delete, or undo of those) keeps it the student's, and only the teacher can make it. The toolbar's
  // Clear gives an empty list: that clears the teacher's own marks only, never the student's work.
  function syncTeacherBoardItems(board,list,act){
    const owner=new Map(board.strokes.map(item=>[item.id,item.by])),keep=new Set(list.map(item=>item.id));
    const gone=board.strokes.filter(item=>!keep.has(item.id)),fresh=list.filter(item=>!owner.has(item.id));
    const strip=item=>{const {by:_by,...stroke}=item;return stroke};
    const same=(a,b)=>(a.tool||'pen')===(b.tool||'pen')&&(a.text||'')===(b.text||'')&&a.points.length===b.points.length&&(a.image||'')===(b.image||'');
    if(gone.length===1&&fresh.length===1&&gone[0].by==='student'&&same(gone[0],fresh[0])){
      act({type:'board-put',stroke:strip(fresh[0]),replaces:gone[0].id,owner:'student'});return;
    }
    const clearing=!list.length&&gone.length>1;
    const theirs=clearing?[]:gone.filter(item=>item.by==='student').map(item=>item.id);
    if(theirs.length)act({type:'board-remove',ids:theirs,any:true});
    // Marks that are the teacher's own: added, removed or moved as before. (A student's mark that came back is put back as his.)
    const mine=list.filter(item=>item.id[0]==='t'&&(!owner.has(item.id)||owner.get(item.id)==='teacher'));
    syncBoardItems(board,'teacher',mine,act);
    for(const item of fresh)if(item.id[0]==='s')act({type:'board-put',stroke:strip(item),owner:'student'});
    syncOrder(board,list,act,()=>true);
  }
  function cleanGroup(raw){
    if(!raw||typeof raw!=='object'||!/^g[0-9]{1,4}$/.test(String(raw.id))||!/^m[0-9]{1,5}$/.test(String(raw.me)))return null;
    const text=value=>String(value==null?'':value).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g,' ').replace(/\s+/g,' ').trim().slice(0,30);
    const members=(Array.isArray(raw.members)?raw.members:[]).slice(0,12).map(text).filter(Boolean);
    return{id:raw.id,name:text(raw.name)||'Group',me:raw.me,members};
  }
  function pageFromMessage(id,bg,list,rawText,rawTiles,rawBox){
    const page=newPage(id,bg);page.box=cleanBox(rawBox);
    if(activity?.kind==='word')page.text=cleanWord(rawText)||defaultWord();
    if(activity?.kind==='tiles')page.tiles=Tiles.cleanState(activity,rawTiles);
    if(Array.isArray(list))for(const raw of list.slice(0,MAX_STROKES)){const s=cleanStroke(raw);if(s&&!(s.image&&pictureCount(page)>=MAX_IMAGES)){s.by=raw.by==='teacher'?'teacher':'student';page.strokes.push(s)}}
    return page;
  }
  // The board a student gets from the teacher: one page the old way, or the list of pages when there is more than one.
  function boardFromMessage(list,rawText,rawTiles,extra){
    if(Pages&&Array.isArray(extra?.pages)&&extra.pages.length){
      const pages=[],seen=new Set();
      for(const raw of extra.pages.slice(0,Pages.MAX_PAGES)){
        if(!raw||!Pages.validId(raw.id)||seen.has(raw.id))continue;
        seen.add(raw.id);pages.push(pageFromMessage(raw.id,cleanBg(raw.bg),raw.strokes,raw.text,raw.tiles,raw.box));
      }
      if(pages.length){
        const set=makeSet(pages);
        set.viewId=set.curId=pages.some(p=>p.id===extra.at)?extra.at:pages[0].id;
        return set;
      }
    }
    return makeSet([pageFromMessage(FIRST_PAGE,'',list,rawText,rawTiles,extra?.box)]);
  }

  // ---------- Page strip (shared by the student and the teacher looking at a student's board) ----------
  // Page 2 of 4, previous / next, and (for a student's own board) add, delete and move; "Pages" shows a small picture of each.
  function pageStrip(o){
    const root=el('span','boards-group board-pages-group'),panel=el('div','board-pages-thumbs'),label=el('span','board-pages-label');
    panel.hidden=true;let open=false,sig='';
    const edit=o.canEdit===true,set=()=>o.set();
    const go=to=>{const s=set();if(s&&to>=0&&to<s.pages.length)o.go(s.pages[to].id)};
    const prev=button('\u25C0','Previous page',()=>{const s=set();if(s)go(s.at-1)},'board-pages-step'),
      next=button('\u25B6','Next page',()=>{const s=set();if(s)go(s.at+1)},'board-pages-step'),
      more=button('\u25B4 Pages','Show a small picture of every page',()=>{open=!open;sig='';update()});
    root.append(prev,label,next);
    let add,del,left,right;
    if(edit){
      add=button('\uFF0B Page','Add a blank page after this one',()=>o.add());
      left=button('\u21E6','Move this page earlier',()=>{const s=set();if(s)o.move(pageId(s),s.at-1)});
      right=button('\u21E8','Move this page later',()=>{const s=set();if(s)o.move(pageId(s),s.at+1)});
      del=button('\uD83D\uDDD1 Page','Delete this page',()=>{const s=set();if(s)o.remove(pageId(s))},'danger');
      root.append(add,left,right,del);
    }
    root.append(more);
    function update(){
      const s=set(),show=!!s&&!!Pages&&(!o.visible||o.visible());
      root.hidden=!show;panel.hidden=!show||!open;
      if(!show)return;
      const n=s.pages.length,at=s.at,studentAt=s.pages.findIndex(p=>p.id===s.curId);
      label.textContent='Page '+(at+1)+' of '+n+(!edit&&s.viewId!==s.curId?' \u00B7 student is on page '+(studentAt+1):'');
      prev.disabled=at===0;next.disabled=at>=n-1;
      if(edit){add.disabled=n>=Pages.MAX_PAGES;del.disabled=n<=1;left.disabled=at===0;right.disabled=at>=n-1}
      more.textContent=(open?'\u25BE':'\u25B4')+' Pages';
      if(!open)return;
      let waiting=false;
      const mark=s.pages.map(p=>{const last=p.strokes[p.strokes.length-1];if(p.bg&&!pictureOf(p.bg))waiting=true;return p.id+':'+p.strokes.length+':'+(last?last.id+':'+last.points.length:'')+':'+(p.bg?1:0)+(p.box?':'+p.box.x+','+p.box.y+','+p.box.w+','+p.box.h:'')});
      const now=[s.viewId,s.curId,...mark].join('|');
      if(now===sig&&!waiting)return;
      sig=waiting?'':now;
      panel.replaceChildren(...s.pages.map((page,i)=>{
        const c=el('canvas');c.width=128;c.height=72;
        const ctx=c.getContext('2d');if(ctx)paintOn(ctx,128,72,page,[]);
        const b=el('button','board-page-thumb'+(i===at?' current':''));b.type='button';b.title='Go to page '+(i+1);b.setAttribute('aria-label','Page '+(i+1));
        b.append(c,el('span','board-page-num',String(i+1)));b.addEventListener('click',()=>go(i));return b;
      }));
    }
    return{root,panel,update};
  }

  // ---------- Drawing on a canvas ----------
  // Pasted pictures are decoded once and kept; pictureLoaded() repaints when one becomes ready.
  const pictures=new Map();let pictureLoaded=()=>{};
  function pictureOf(data){
    let image=pictures.get(data);
    if(!image){
      if(pictures.size>=80)pictures.clear();
      image=new Image();image.onload=()=>pictureLoaded();image.src=data;pictures.set(data,image);
    }
    return image.complete&&image.naturalWidth?image:null;
  }
  // Text boxes. Hebrew lines run right to left and line up on the right edge of the box.
  function textOn(ctx,s,w,h){
    const size=Math.max(4,s.size*w),lines=s.text.split('\n').slice(0,8),rtl=RTL.test(s.text);
    ctx.save();ctx.fillStyle=s.color;ctx.font='600 '+size+'px Arial, "Segoe UI", sans-serif';ctx.textBaseline='top';
    ctx.direction=rtl?'rtl':'ltr';ctx.textAlign=rtl?'right':'left';
    const x=s.points[0].x*w+(rtl?Math.max(8,...lines.map(line=>ctx.measureText(line).width)):0);
    lines.forEach((line,i)=>ctx.fillText(line,x,s.points[0].y*h+i*size*1.25));
    ctx.restore();
  }
  function strokeOn(ctx,s,w,h){
    if(s.image){
      const [a,b]=s.points,image=pictureOf(s.image);
      if(image)ctx.drawImage(image,a.x*w,a.y*h,(b.x-a.x)*w,(b.y-a.y)*h);
      else{ctx.fillStyle='#e5e7eb';ctx.fillRect(a.x*w,a.y*h,(b.x-a.x)*w,(b.y-a.y)*h)}
      return;
    }
    if(s.tool==='text'){textOn(ctx,s,w,h);return}
    if(s.tool&&window.FTTAnnotate){window.FTTAnnotate.drawItem(ctx,s,p=>[p.x*w,p.y*h],w);return}
    const pts=s.points,width=Math.max(1,s.size*w);ctx.strokeStyle=s.color;ctx.fillStyle=s.color;
    if(pts.every(p=>p.x===pts[0].x&&p.y===pts[0].y)){ctx.beginPath();ctx.arc(pts[0].x*w,pts[0].y*h,width/2,0,Math.PI*2);ctx.fill();return}
    ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(pts[0].x*w,pts[0].y*h);
    // Curves through the midpoints keep handwriting smooth.
    for(let i=1;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];ctx.quadraticCurveTo(a.x*w,a.y*h,(a.x+b.x)/2*w,(a.y+b.y)/2*h)}
    const last=pts[pts.length-1];ctx.lineTo(last.x*w,last.y*h);ctx.stroke();
  }
  function paint(canvas,board,local){
    const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
    const dpr=Math.min(window.devicePixelRatio||1,2),pw=Math.round(w*dpr),ph=Math.round(h*dpr);
    if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    paintOn(ctx,w,h,board,[board.drafts.student,board.drafts.teacher,local]);
  }
  function paintOn(ctx,w,h,board,drafts){
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);paintActivity(ctx,w,h,board);ctx.lineCap='round';ctx.lineJoin='round';
    for(const s of board.strokes)strokeOn(ctx,s,w,h);
    for(const s of drafts)if(s)strokeOn(ctx,s,w,h);
  }
  // A PNG picture of a whole board (for Copy board and for saving).
  function boardPng(board){
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;
    paintOn(canvas.getContext('2d'),canvas.width,canvas.height,board,[]);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not make a picture of the board.')),'image/png'));
  }
  // Largest 16:9 board that fits inside the box.
  function fit(box,surface){
    const r=box.getBoundingClientRect(),cs=getComputedStyle(box);
    const aw=r.width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),ah=r.height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
    if(aw<=0||ah<=0)return;
    let w=aw,h=w/ASPECT;if(h>ah){h=ah;w=h*ASPECT}
    surface.style.width=Math.floor(w)+'px';surface.style.height=Math.floor(h)+'px';
  }
  function segDist(p,a,b){
    const ax=a.x,ay=a.y/ASPECT,dx=b.x-ax,dy=b.y/ASPECT-ay,px=p.x,py=p.y/ASPECT,len=dx*dx+dy*dy;
    const t=len?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len)):0;
    return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
  }

  // Pen, eraser, colors and sizes. Returns a live settings object.
  function makeTools(bar,startColor,onChange){
    const st={tool:'pen',color:startColor,size:SIZE_VALUES[1]};
    const pen=button('✏️ Pen','Pen',()=>{st.tool='pen';sync()});
    const eraser=button('🧽 Eraser','Eraser: drag over your own lines to remove them',()=>{st.tool='eraser';sync()});
    const swatches=el('span','boards-swatches');swatches.setAttribute('role','group');swatches.setAttribute('aria-label','Pen color');
    const colorButtons=PALETTE.map(([color,name])=>{const b=button('',name,()=>{st.color=color;st.tool='pen';sync()});b.style.setProperty('--c',color);b.setAttribute('aria-label',name);swatches.appendChild(b);return[b,color]});
    const sizes=el('span','boards-sizes');sizes.setAttribute('role','group');sizes.setAttribute('aria-label','Pen size');
    const sizeButtons=SIZES.map(([value,name,dot])=>{const b=button('',name,()=>{st.size=value;if(st.tool!=='pen')st.tool='pen';sync()});const i=el('i');i.style.setProperty('--d',dot+'px');b.appendChild(i);b.setAttribute('aria-label',name);sizes.appendChild(b);return[b,value]});
    function sync(){
      pen.setAttribute('aria-pressed',String(st.tool==='pen'));eraser.setAttribute('aria-pressed',String(st.tool==='eraser'));
      colorButtons.forEach(([b,color])=>b.setAttribute('aria-pressed',String(color===st.color)));
      sizeButtons.forEach(([b,value])=>b.setAttribute('aria-pressed',String(value===st.size)));
      onChange(st);
    }
    st.setTool=(kind)=>{if(['pen','eraser','move'].includes(kind)){st.tool=kind;sync()}};
    bar.append(pen,eraser,swatches,sizes);sync();return st;
  }

  // Per-boy editable word tools (also available to the teacher when a board is enlarged).
  function wordEditor(bar,getBoard,write,tools){
    const root=el('span','boards-word-editor'),input=el('input'),smaller=button('A−','Make Hebrew text smaller',()=>resize(-.05)),
      bigger=button('A+','Make Hebrew text bigger',()=>resize(.05)),color=el('input'),move=button('↔ Move','Drag the Hebrew word around the board',()=>{
        tools.setTool(tools.tool==='move'?'pen':'move');update();
      });
    input.type='text';input.dir='auto';input.maxLength=80;input.placeholder='Edit the word';input.setAttribute('aria-label','Edit Hebrew text');
    color.type='color';color.value='#1f2937';color.setAttribute('aria-label','Hebrew text color');
    root.append(el('span',null,'Text:'),input,smaller,bigger,color,move);bar.append(root);
    function change(changes){
      const current=getBoard()?.text;if(!current)return;
      const next={...current,...changes};write(next);update();
    }
    function resize(delta){
      const text=getBoard()?.text;
      if(text)change({size:round(Math.min(TEXT_MAX,Math.max(TEXT_MIN,text.size+delta)))});
    }
    input.addEventListener('input',()=>change({value:input.value.slice(0,80)}));
    color.addEventListener('input',()=>change({color:color.value}));
    function update(){
      const text=getBoard()?.text;
      root.hidden=activity?.kind!=='word'||!text;
      if(!text)return;
      if(document.activeElement!==input&&input.value!==text.value)input.value=text.value;
      if(document.activeElement!==color&&color.value!==text.color)color.value=text.color;
      smaller.disabled=text.size<=TEXT_MIN;bigger.disabled=text.size>=TEXT_MAX;
      move.setAttribute('aria-pressed',String(tools.tool==='move'));
    }
    update();return{root,update};
  }

  // Mouse, pen, text move and touch input on one board canvas.
  // o: by ('student'|'teacher'), tools, enabled(), board(), apply(op) (apply locally + send), send(op) (send only), redraw()
  function attachDrawing(canvas,o){
    let draft=null,pid=null,timer=0,lastSent=0,lastTextMove=0,grab=null,hover=null;
    const pos=event=>{const r=canvas.getBoundingClientRect();return{x:round(Math.min(1,Math.max(0,(event.clientX-r.left)/r.width))),y:round(Math.min(1,Math.max(0,(event.clientY-r.top)/r.height)))}};
    // Where the mouse is over this board (a pasted thing lands there), even while the drawing toolbar is on top.
    document.addEventListener('pointermove',event=>{
      const r=canvas.getBoundingClientRect();
      hover=r.width&&event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom?pos(event):null;
    },{passive:true,capture:true});
    // Move tool: drag one of my own pictures.
    function pictureAt(p){
      const list=o.board().strokes;
      for(let i=list.length-1;i>=0;i--){const s=list[i];if(s.image&&s.by===o.by&&p.x>=s.points[0].x&&p.x<=s.points[1].x&&p.y>=s.points[0].y&&p.y<=s.points[1].y)return s}
      return null;
    }
    function movePicture(p,final){
      if(!final&&Date.now()-lastTextMove<70)return;
      lastTextMove=Date.now();
      const s=o.board().strokes.find(item=>item.id===grab.id);if(!s)return;
      const w=s.points[1].x-s.points[0].x,h=s.points[1].y-s.points[0].y;
      const x=Math.min(1-w,Math.max(0,p.x-grab.dx)),y=Math.min(1-h,Math.max(0,p.y-grab.dy));
      o.apply({type:'board-move',id:s.id,points:[{x,y},{x:x+w,y:y+h}]});
    }
    // While a line is being drawn, the other side sees it live (about 12 updates a second).
    function sendDraft(){
      if(timer)return;
      const wait=DRAFT_MS-(Date.now()-lastSent);
      const go=()=>{timer=0;if(!draft)return;lastSent=Date.now();o.send({type:'board-draft',stroke:{...draft,points:draft.points.slice()}})};
      if(wait<=0)go();else timer=setTimeout(go,wait);
    }
    function dropDraft(){clearTimeout(timer);timer=0;if(draft){draft=null;o.send({type:'board-draft',stroke:null})}o.redraw()}
    function commit(){clearTimeout(timer);timer=0;const s=draft;draft=null;if(s)o.apply({type:'board-add',stroke:s});else o.redraw()}
    function erase(p){
      const hit=[];
      for(const s of o.board().strokes){
        // Pictures are not rubbed out by accident while erasing lines on top of them (use ✕ Remove picture or Undo).
        if(s.by!==o.by||s.image)continue;const reach=ERASE+s.size/2;
        if(s.points.some((q,i)=>segDist(p,i?s.points[i-1]:q,q)<=reach))hit.push(s.id);
      }
      if(hit.length)o.apply({type:'board-remove',ids:hit});
    }
    function moveWord(p,final){
      const t=o.board().text;if(!t)return;
      if(!final&&Date.now()-lastTextMove<70)return;
      lastTextMove=Date.now();
      o.apply({type:'board-text',text:{...t,x:p.x,y:p.y}});
    }
    // Hebrew word tiles: picking one up works with any tool, so a student never has to switch tools to move a word.
    const tileDrag=Tiles?Tiles.dragger({activity:()=>activity,state:()=>o.board().tiles,size:()=>({w:canvas.clientWidth,h:canvas.clientHeight}),
      apply:op=>o.apply(op),redraw:()=>o.redraw()}):null;
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||pid!==null||!o.enabled())return;
      event.preventDefault();pid=event.pointerId;canvas.setPointerCapture(pid);
      const p=pos(event);
      if(tileDrag&&activity?.kind==='tiles'&&tileDrag.down(p))return;
      // With the drawing toolbar on Select or Pointer this board is not a pen: an empty press does nothing.
      const fa=o.by==='student'?window.FTTAnnotate?.state?.():null;
      if(fa&&fa.mode==='open'&&fa.surface==='board'&&(fa.tool==='select'||fa.tool==='pointer')){pid=null;try{canvas.releasePointerCapture(event.pointerId)}catch(_){}return}
      if(o.tools.tool==='move'){
        const picture=pictureAt(p);
        grab=picture?{id:picture.id,dx:p.x-picture.points[0].x,dy:p.y-picture.points[0].y}:null;
        if(!grab){if(!o.board().text){pid=null;return}moveWord(p,true)}
        return;
      }
      if(o.tools.tool==='eraser'){erase(p);return}
      draft={id:newId(o.by[0]),color:o.tools.color,size:o.tools.size,points:[p]};o.redraw();sendDraft();
    });
    canvas.addEventListener('pointermove',event=>{
      if(event.pointerId!==pid)return;
      if(tileDrag?.active()){tileDrag.move(pos(event),false);return}
      const list=event.getCoalescedEvents?.();
      for(const item of list&&list.length?list:[event]){
        const p=pos(item);
        if(o.tools.tool==='eraser'){erase(p);continue}
        if(o.tools.tool==='move'){if(grab)movePicture(p,false);else moveWord(p,false);continue}
        if(!draft)continue;
        const last=draft.points[draft.points.length-1];
        if(Math.hypot(p.x-last.x,(p.y-last.y)/ASPECT)<STEP)continue;
        draft.points.push(p);
        // Very long lines are saved in pieces so no message gets too big.
        if(draft.points.length>=MAX_POINTS){const {color,size}=draft;commit();draft={id:newId(o.by[0]),color,size,points:[p]}}
      }
      if(draft){o.redraw();sendDraft()}
    });
    const finish=event=>{
      if(event.pointerId!==pid)return;
      if(tileDrag?.active()){tileDrag.up(pos(event));pid=null;return}
      if(grab){movePicture(pos(event),true);grab=null}
      else if(o.tools.tool==='move'&&o.board().text)moveWord(pos(event),true);
      pid=null;if(draft)commit();
    };
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('lostpointercapture',finish);
    canvas.addEventListener('pointercancel',event=>{if(event.pointerId!==pid)return;pid=null;grab=null;tileDrag?.cancel();dropDraft()});
    return{
      tiles:tileDrag,
      draft:()=>draft,
      point:()=>hover,
      cancel(){if(pid!==null&&canvas.hasPointerCapture?.(pid))canvas.releasePointerCapture(pid);pid=null;grab=null;tileDrag?.cancel();if(draft)dropDraft()}
    };
  }

  // 📋 Paste, 📄 Copy board and the picture buttons for one large board (a student's own board, or the board the
  // teacher opened large). Pasted pictures and words become ordinary board marks, so the other side sees them live.
  // o: by, priority, tools, open(), key(), board(), act(op), point(), selected()
  function clipboardTools(bar,o){
    const root=el('span','boards-clip'),pictureGroup=el('span','boards-pictures'),note=el('span','boards-note');
    note.setAttribute('role','status');
    let noteTimer=0,measurer=null;
    function say(text){note.textContent=text||'';clearTimeout(noteTimer);if(text)noteTimer=setTimeout(()=>{note.textContent=''},7000)}
    const ink=()=>o.tools.color==='#ffffff'?COLORS[0]:o.tools.color;
    const has=id=>!!o.board()?.strokes.some(s=>s.id===id);
    const target={priority:o.priority,active:o.open,say,
      async paste(payload){
        const key=o.key(),board=o.board();
        if(payload.kind==='image'){
          if(pictureCount(board)>=MAX_IMAGES){say('This board already has '+MAX_IMAGES+' pictures. Remove one first.');return}
          say('Adding your picture…');
          const picture=await Clip.encodeImage(payload.blob,{maxChars:MAX_IMAGE});
          // The teacher may have opened another student's board while the picture was being made ready.
          if(!o.open()||o.key()!==key){say('');return}
          const id=newId(o.by[0]);
          o.act({type:'board-add',stroke:{id,tool:'rect',color:COLORS[0],size:SIZE_VALUES[0],points:Clip.placeImage(picture.width,picture.height,{aspect:ASPECT,center:o.point()||undefined}),image:picture.data}});
          say(has(id)?'Picture pasted. Use ✋ Move picture to move it.':FULL);
        }else{
          measurer=measurer||document.createElement('canvas').getContext('2d');measurer.font='600 100px Arial, "Segoe UI", sans-serif';
          const laid=Clip.layoutText(payload.text,line=>measurer.measureText(line).width,{aspect:ASPECT,center:o.point()||undefined});
          let added=0;
          for(const item of laid.items){
            const id=newId(o.by[0]);
            o.act({type:'board-add',stroke:{id,tool:'text',color:ink(),size:item.size,points:[{x:item.x,y:item.y}],text:item.text}});
            if(has(id))added++;
          }
          say(!added?FULL:payload.cut||laid.cut||added<laid.items.length?Clip.MSG.textCut:'Words pasted.');
        }
        update();
      },
      // Ctrl+C: the picked text box or picture when the drawing toolbar has one picked, otherwise the whole board.
      async copy(){
        const board=o.board(),id=o.selected?.(),item=id?board.strokes.find(s=>s.id===id):null;
        if(item?.tool==='text'){await Clip.copyText(item.text);say('Words copied.');return}
        await Clip.copyImage(item?.image?Clip.pngOf(item.image):boardPng(board));
        say(item?.image?'Picture copied.':'Copied a picture of the board. Press '+Clip.KEY+'+V to paste it somewhere.');
      }};
    // The picture the buttons work on: the one picked with the drawing toolbar, otherwise my newest one.
    function mine(){
      const list=o.open()?o.board().strokes.filter(s=>s.image&&s.by===o.by):[],id=o.selected?.();
      return list.find(s=>s.id===id)||list[list.length-1]||null;
    }
    function resize(factor){
      const s=mine();if(!s)return;
      const [a,b]=s.points,w0=b.x-a.x,h0=b.y-a.y;
      // Keep the picture's shape, on the board, and never tiny.
      const f=factor>1?Math.min(factor,1/w0,1/h0):Math.min(1,Math.max(factor,.05/Math.min(w0,h0)));
      const w=w0*f,h=h0*f,x=Math.min(1-w,Math.max(0,(a.x+b.x)/2-w/2)),y=Math.min(1-h,Math.max(0,(a.y+b.y)/2-h/2));
      o.act({type:'board-move',id:s.id,points:[{x,y},{x:x+w,y:y+h}]});
    }
    const move=button('✋ Move picture','Drag a picture to move it',()=>{
      // A student with the drawing toolbar open moves things with its Select tool.
      const FA=window.FTTAnnotate,state=FA?.state?.();
      if(o.by==='student'&&state?.mode==='open'&&state.surface==='board'){FA.select('select');say('Drag the picture to move it.');return}
      o.tools.setTool(o.tools.tool==='move'?'pen':'move');update();
    });
    pictureGroup.append(move,button('➖ Smaller','Make the picture smaller',()=>resize(.8)),button('➕ Bigger','Make the picture bigger',()=>resize(1.25)),
      button('✕ Remove picture','Take the picture off the board',()=>{const s=mine();if(s)o.act({type:'board-remove',ids:[s.id]});update()},'danger'));
    root.append(button('📋 Paste','Put the picture or words you copied on this board. You can also press Ctrl+V.',()=>{if(Clip)void Clip.pasteInto(target)}),
      button('📄 Copy board','Copy a picture of this board, so you can paste it somewhere else',()=>{if(Clip)void Clip.copyFrom(target)}),pictureGroup,note);
    bar.append(root);
    function update(){pictureGroup.hidden=!mine();move.setAttribute('aria-pressed',String(o.tools.tool==='move'))}
    clipReady.then(clip=>{if(clip)clip.register(target);else root.hidden=true});
    update();
    return{root,update,say,paste:()=>{if(Clip)void Clip.pasteInto(target)}};
  }

  // =====================================================================
  // Student page. Mode "boards": a private whiteboard. Mode "screens": share my screen with the teacher.
  // The teacher may pause ("block") one student; then that student sees a short message instead.
  // =====================================================================
  if(!isTeacher){
    // My group (when the teacher put me in one): {id, name, me, members}. `me` is the code my lines carry.
    let group=null;
    const ownItem=item=>!group||!item.who||item.who===group.me;
    let on=false,mode='boards',blocked=false,board=emptyBoard(),drawer=null,stream=null,call=null,shareWindow=null,teacherPresenting=false;
    // Which whiteboard this is. It changes when the board is replaced (New Slides, a board the teacher sends, a saved file
    // opened), so the automatic save (saved-work.js) never writes one whiteboard over another.
    let boardSerial=0;
    // Tell the page when this student's whiteboard is actually on display (activity-share.js hides Share My Screen meanwhile).
    let announced=null;
    function announceBoard(){
      const shown=on&&mode==='boards'&&!blocked&&!view.hidden&&(!B.embedded||stage.style.display!=='none');
      if(shown===announced)return;announced=shown;
      try{document.dispatchEvent(new CustomEvent('classpointer:student-board',{detail:{on:shown}}))}catch{}
    }
    // Whatever the teacher presents comes first: no Share My Screen button meanwhile, and a share from this page is paused until the teacher stops.
    document.addEventListener('classpointer:teacher-presenting',event=>{
      teacherPresenting=event.detail?.on===true;
      try{stream?.getVideoTracks().forEach(t=>{t.enabled=!teacherPresenting})}catch{}
      try{redraw()}catch{}
    });
    const view=el('div','boards-view student-board');view.id='myBoard';view.dataset.stageUi='true';view.hidden=true;view.setAttribute('aria-label','My whiteboard');
    const bar=el('div','boards-bar'),title=el('strong','boards-title'),drawGroup=el('span','boards-group');
    const focus=el('div','boards-focus'),surface=el('div','board-fit'),canvas=el('canvas');
    canvas.setAttribute('aria-label','My whiteboard. Draw with the mouse, pen or finger.');
    bar.append(title,drawGroup);
    // Pages (slides): add, delete, move and look at every page of my own board.
    const studentPages=pageStrip({canEdit:true,set:()=>board,visible:()=>on&&mode==='boards'&&!blocked,
      go:id=>act({type:'board-page-at',pg:id}),
      add:()=>{if(board.pages.length>=Pages.MAX_PAGES){B.status('A whiteboard can have up to '+Pages.MAX_PAGES+' pages.');return}const id=Pages.newId();act({type:'board-page-add',id,after:pageId(board)});act({type:'board-page-at',pg:id})},
      remove:id=>{if(board.pages.length>1&&confirm('Delete this page and everything on it?'))act({type:'board-page-remove',id})},
      move:(id,to)=>{const order=Pages.move(board.pages,id,to).map(p=>p.id);act({type:'board-page-move',order})}});
    bar.append(studentPages.root);
    // New Slides: a fresh blank whiteboard right from the board. The one I have is saved in My files first (saved-work.js);
    // when that cannot be done I am asked before anything is lost. A group board is shared, so only the teacher starts a new one.
    async function newSlides(){
      if(!on||mode!=='boards'||blocked||group)return false;
      const used=board.pages.length>1||board.pages.some(p=>p.strokes.some(s=>s.by==='student'));
      const kept=used?await window.FTTSavedWork?.auto?.flush?.().catch(()=>null):null;
      if(used&&!kept?.ok&&!confirm('Your whiteboard could not be saved to My files. If you start new slides, what you drew will be lost. Start new slides anyway?'))return false;
      for(const page of board.pages.slice(1))act({type:'board-page-remove',id:page.id});
      act({type:'board-page-at',pg:board.pages[0].id});
      clearMine();boardSerial++;redraw();
      B.status(used&&kept?.ok?'New blank slides. Your last whiteboard is saved in My files.':'New blank slides.');
      return true;
    }
    const newSlidesBtn=button('🆕 New Slides','Start a new, blank whiteboard. The one you have now is saved in My files first.',()=>void newSlides());
    bar.append(newSlidesBtn);
    const tools=makeTools(drawGroup,COLORS[0],st=>{drawer?.cancel();surface.classList.toggle('erasing',st.tool==='eraser');surface.classList.toggle('moving',st.tool==='move')});
    drawGroup.append(
      button('↶ Undo','Undo my last line',()=>{const mine=board.strokes.filter(s=>s.by==='student'&&ownItem(s));const last=mine[mine.length-1];if(last)act({type:'board-remove',ids:[last.id]})}),
      button('🗑 Clear','Clear everything I drew',()=>{if(board.strokes.some(s=>s.by==='student'&&ownItem(s))&&confirm(group?'Clear everything you drew on this page? Your group\'s other lines stay.':'Clear everything you drew on your board?'))clearMine()},'danger'));
    // What is picked with the drawing toolbar's Select tool (when the toolbar reports it).
    const pickedId=()=>{const state=window.FTTAnnotate?.state?.();return state?.surface==='board'?state.selected||null:null};
    const clip=clipboardTools(bar,{by:'student',priority:3,tools,open:()=>on&&mode==='boards'&&!blocked&&!view.hidden&&canvas.getClientRects().length>0,key:()=>'mine',board:()=>board,act:op=>act(op),point:()=>drawer?.point(),selected:pickedId});
    const editWord=wordEditor(bar,()=>board,text=>act({type:'board-text',text}),tools);
    const full=button('⛶ Full screen','Full screen',()=>(expanded()?$('exitFullScreenLesson'):$('fullScreenLesson'))?.click());
    bar.append(el('span','boards-spacer'));
    if(!B.embedded)bar.append(full);
    else{
      const back=button('↩ Back to Activity','Hide the whiteboard without losing your drawing',()=>{
        stage.style.display='none';returnBoard.hidden=false;announceBoard();
      });
      const returnBoard=button('📝 Show My Whiteboard','Return to your whiteboard',()=>{
        if(on&&mode==='boards'&&!blocked){stage.style.display='block';returnBoard.hidden=true;redraw();announceBoard()}
      });
      returnBoard.id='fttReturnPointerBoard';
      returnBoard.hidden=true;
      returnBoard.style.cssText='position:fixed;bottom:16px;left:16px;z-index:2147483640;background:#245ce4;color:white;border:2px solid white;border-radius:12px;padding:12px 18px;font:700 15px system-ui;box-shadow:0 6px 22px #0004';
      document.body.append(returnBoard);bar.append(back);
      stage.addEventListener('classpointer:board-state',()=>{returnBoard.hidden=true});
    }
    // Screens mode panel.
    const sharePanel=el('div','board-panel'),shareText=el('p','board-panel-text'),shareNote=el('p','board-panel-note'),preview=el('video','board-preview');
    preview.muted=true;preview.autoplay=true;preview.playsInline=true;preview.hidden=true;
    const shareBtn=button('🖥 Share My Screen','Open the persistent Share My Screen / Stop Sharing window; your screen continues to share as you visit other activities',()=>stream?stopShare(true):openShareWindow(),'board-share-btn');
    sharePanel.append(shareText,shareBtn,preview,shareNote);
    // Paused panel.
    const pausedPanel=el('div','board-panel');pausedPanel.append(el('p','board-panel-text','⏸ Your teacher paused this for you.'),el('p','board-panel-note','Please wait. Your teacher can turn it back on.'));
    surface.appendChild(canvas);focus.append(surface,sharePanel,pausedPanel);view.append(bar,studentPages.panel,focus);stage.appendChild(view);shield(view);

    function ui(){
      const boardsOn=on&&mode==='boards'&&!blocked,screensOn=on&&mode==='screens'&&!blocked;
      title.textContent=mode==='screens'?'🖥 Share my screen':group?'\uD83D\uDC65 '+group.name:'📝 My board';title.title=group&&mode!=='screens'?'Your group: '+group.members.join(', '):'';
      // The left drawing toolbar carries Pen, Eraser, colors, Undo and Clear, so the old tool row is hidden (one toolbar).
      // The slim top bar keeps the title, Paste, Copy board, Save, My files, Back to Activity and Full screen.
      const oneToolbar=boardsOn&&!!window.FTTAnnotate;view.classList.toggle('boards-annotated',oneToolbar);
      drawGroup.hidden=!boardsOn||oneToolbar;surface.hidden=!boardsOn;sharePanel.hidden=!screensOn;pausedPanel.hidden=!(on&&blocked);
      editWord.update();editWord.root.hidden=!boardsOn||activity?.kind!=='word';studentPages.update();newSlidesBtn.hidden=!boardsOn||!!group;announceBoard();
      clip.root.hidden=!boardsOn||!Clip;clip.update();
      shareText.textContent=stream?'✅ Your screen is being shared from this Pointer page.':'Use Share My Screen to open the same blue Share / red Stop Sharing controls used in your activities. Choose Entire Screen and keep that window open.';
      shareBtn.hidden=teacherPresenting;
      shareBtn.textContent=stream?'⏹ Stop Sharing':(shareWindow&&!shareWindow.closed?'↗ Sharing window open':'🖥 Share My Screen');shareBtn.classList.toggle('sharing',!!stream||!!(shareWindow&&!shareWindow.closed));
      preview.hidden=!stream;if(stream&&preview.srcObject!==stream){preview.srcObject=stream;preview.play().catch(()=>{})}if(!stream)preview.srcObject=null;
      full.textContent=expanded()?'⤢ Exit full screen':'⛶ Full screen';
    }
    const redraw=scheduler(()=>{if(view.hidden)return;ui();if(!surface.hidden){fit(focus,surface);paint(canvas,board,drawer?.draft())}});
    pictureLoaded=redraw;clipReady.then(redraw);
    /* share-window-open:start */
    // Opens the sharing window by name WITHOUT ever reloading one that already exists. window.open(url, name) would
    // navigate an existing window to url, and a page reload ends a screen capture. window.open('', name) only
    // returns the existing window, which is then just brought to the front; a window that did not exist yet comes
    // back blank and is sent to the sharing page once.
    function openShareWindowOnce(win,url,name){
      let target=null;
      try{target=win.open('',name)}catch{}
      if(!target)return{win:null,existing:false};
      let existing=false;
      try{existing=/\/student-share-window\.html$/.test(String(target.location.pathname))}catch{}
      if(existing){try{target.focus?.()}catch{}return{win:target,existing:true}}
      try{target.location.href=url}catch{try{target.close?.()}catch{}return{win:null,existing:false}}
      return{win:target,existing:false};
    }
    /* share-window-open:end */
    function openShareWindow(){
      if(teacherPresenting)return;
      if(shareWindow&&!shareWindow.closed){shareWindow.focus?.();return}
      const url=new URL('student-share-window.html?pointerShare=1',location.href);
      // After this page is refreshed it no longer holds the window it opened, so it asks the browser for the window by
      // name. An open sharing window is only brought to the front: reloading it would end the share.
      const opened=openShareWindowOnce(window,url.href,'classPointerStudentShare');
      shareWindow=opened.win;
      if(shareWindow){shareNote.textContent=opened.existing?'Your sharing window is already open and keeps sharing. Click its tab to see it.':'Sharing window opened. Approve Entire Screen there and leave it open while visiting activities.';return}
      shareNote.textContent='Your browser blocked the separate window. You can share from this page, but navigation will stop sharing.';
      void startShare('screen');
    }
    // Clear what I drew: my own lines on this page. On a group board that must never remove my group's lines.
    function clearMine(){
      if(!group){act({type:'board-clear'});return}
      const ids=board.strokes.filter(s=>s.by==='student'&&ownItem(s)).map(s=>s.id);
      if(ids.length)act({type:'board-remove',ids});
    }
    function act(op){if(!on||mode!=='boards'||blocked)return;const sent=pagedOp(board,op);if(applyTo(board,sent,'student'))B.sendTeacher(sent);redraw()}
    // My whiteboard as a surface for the shared drawing toolbar. Its marks are ordinary board lines, so the teacher
    // sees them live in my tile, and my own Undo / Clear / Eraser work on them too.
    const boardOpen=()=>on&&mode==='boards'&&!blocked;
    // `arrange`: the right-click menu, layers (Bring forward / Send back) and text alignment of the shared toolbar.
    const boardSurface={id:'board',idPrefix:'s',defaultTool:'select',renders:true,arrange:true,maxItems:MAX_STROKES,maxPoints:MAX_POINTS,
      pasteFromClipboard:()=>clip.paste(),
      label:'Drawing on your whiteboard. Your teacher sees it.',
      rect:()=>{if(!boardOpen()||view.hidden||surface.hidden)return null;const r=canvas.getBoundingClientRect();return r.width&&r.height?r:null},
      getItems:()=>{const own=board.strokes.filter(item=>(item.by==='student'&&ownItem(item))||(!group&&item.by==='teacher')),pic=sentPicture();return pic?[pic,...own]:own},
      setItems(list){
        // The toolbar gives a moved or resized item a new id, so the sent picture is found by its picture too.
        const own=sentPicture(),pic=own?list.find(item=>item.id===own.id)||list.find(item=>item.image===own.image&&!board.strokes.some(s=>s.id===item.id)):null;
        if(pic)sentId=pic.id;
        if(pic&&!group&&pic.points.length===2){
          const [a,b]=pic.points,box=cleanBox({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)}),now=board.box||{x:0,y:0,w:1,h:1};
          if(box&&(Math.abs(box.x-now.x)>.0005||Math.abs(box.y-now.y)>.0005||Math.abs(box.w-now.w)>.0005||Math.abs(box.h-now.h)>.0005))act({type:'board-box',box});
        }
        syncBoardItems(board,'student',list.filter(item=>item!==pic),act,group?ownItem:null,!group);
      },
      // Hebrew word tiles can be picked up with any drawing tool.
      // The teacher's sent word can be picked up with Select (and dragged) as well.
      solid:true,
      grab:{hit:p=>boardOpen()&&((!!drawer?.tiles&&activity?.kind==='tiles'&&drawer.tiles.hit(p))||wordHit(p)),
        down:p=>{if(!boardOpen())return false;if(drawer?.tiles&&activity?.kind==='tiles'&&drawer.tiles.hit(p))return drawer.tiles.down(p);return wordDown(p)},
        move:(p,f)=>{if(wordGrab)wordMove(p,f);else drawer?.tiles?.move(p,f)},up:p=>{if(wordGrab){if(p)wordMove(p,true);wordGrab=null}else drawer?.tiles?.up(p)},cancel:()=>{wordGrab=null;drawer?.tiles?.cancel()}},
      live(draft){if(!boardOpen())return;const op=pagedOp(board,{type:'board-draft',stroke:draft||null});applyTo(board,op,'student');B.sendTeacher(op);redraw()}};
    // The picture the teacher sent (a page background, or the class picture) is shown to the toolbar as one more item at the
    // bottom of the pile, so Select can pick it, move it and resize it. It is only this student's own copy that changes.
    let sentId='sbg';
    function sentPicture(){
      const data=board.bg||(activity?.kind==='image'?activity.data:'');
      if(!data||group)return null;
      const b=board.box||{x:0,y:0,w:1,h:1};
      return{id:sentId,tool:'rect',color:'#1f2937',size:.006,points:[{x:b.x,y:b.y},{x:b.x+b.w,y:b.y+b.h}],image:data,by:'teacher'};
    }
    // The word the teacher sent: where it is on the board, so a press on it can pick it up (Select tool only).
    let wordGrab=null,wordAt=0;
    function wordBox(){
      const t=board.text,w=canvas.clientWidth,h=canvas.clientHeight;
      if(activity?.kind!=='word'||!t||!t.value||!w||!h)return null;
      const ctx=canvas.getContext('2d');let size=Math.max(10,h*t.size);
      ctx.save();ctx.font='700 '+size+'px Arial, sans-serif';
      while(size>12&&ctx.measureText(t.value).width>w*.90){size*=.9;ctx.font='700 '+size+'px Arial, sans-serif'}
      const width=Math.min(w*.95,ctx.measureText(t.value).width);ctx.restore();
      return{cx:t.x*w,cy:t.y*h,hw:width/2+8,hh:size*.6,w,h};
    }
    function wordHit(p){
      if(window.FTTAnnotate?.state?.().tool!=='select')return false;
      const b=wordBox();return !!b&&Math.abs(p.x*b.w-b.cx)<=b.hw&&Math.abs(p.y*b.h-b.cy)<=b.hh;
    }
    function wordDown(p){
      if(!wordHit(p))return false;
      wordGrab={dx:p.x-board.text.x,dy:p.y-board.text.y};return true;
    }
    function wordMove(p,final){
      if(!wordGrab||!board.text)return;
      if(!final&&Date.now()-wordAt<70)return;wordAt=Date.now();
      act({type:'board-text',text:{...board.text,x:round(Math.min(1,Math.max(0,p.x-wordGrab.dx))),y:round(Math.min(1,Math.max(0,p.y-wordGrab.dy)))}});
    }
    // The toolbar is there only while my whiteboard is open (or while I share my screen).
    function syncAnnotate(){
      const FA=window.FTTAnnotate;if(!FA)return;
      if(boardOpen())FA.push(boardSurface);
      FA.setReason('whiteboard',boardOpen());
      if(!boardOpen())FA.release(boardSurface);
    }
    drawer=attachDrawing(canvas,{by:'student',tools,enabled:()=>on&&mode==='boards'&&!blocked,board:()=>board,apply:act,send:op=>{if(on&&mode==='boards'&&!blocked)B.sendTeacher(pagedOp(board,op))},redraw});

    async function startShare(){
      shareNote.textContent='';
      if(!navigator.mediaDevices?.getDisplayMedia||!B.callTeacher){shareNote.textContent='Screen sharing works on a computer in Chrome or Edge.';return}
      shareBtn.disabled=true;
      try{
        // The browser still requires a student click and controls its native picker.
        // Ask for a monitor capture and reject a tab/window if the browser reports one.
        const s=await navigator.mediaDevices.getDisplayMedia({
          video:{displaySurface:'monitor',frameRate:{ideal:5,max:8},width:{ideal:1600},height:{ideal:900}},
          audio:false,selfBrowserSurface:'exclude',surfaceSwitching:'exclude',monitorTypeSurfaces:'include'
        });
        const surface=s.getVideoTracks()[0]?.getSettings?.().displaySurface;
        if(surface&&surface!=='monitor'){
          s.getTracks().forEach(t=>t.stop());
          shareNote.textContent='Please choose Entire Screen in the browser preview window.';
          return;
        }
        if(!on||mode!=='screens'||blocked){s.getTracks().forEach(t=>t.stop());return}
        stopShare(false);
        const c=B.callTeacher(s);
        if(!c){s.getTracks().forEach(t=>t.stop());shareNote.textContent='Could not send your screen. Try again.';return}
        stream=s;call=c;
        s.getVideoTracks()[0]?.addEventListener('ended',()=>{if(stream===s)stopShare(true)},{once:true});
        window.FTTAnnotate?.setReason('sharing',true);
        c.on?.('close',()=>{if(call===c)stopShare(false)});c.on?.('error',()=>{if(call===c){stopShare(false);shareNote.textContent='The connection to your teacher failed. Try sharing again.'}});
        B.sendTeacher({type:'board-screen',sharing:true});
      }catch(error){shareNote.textContent=error?.name==='NotAllowedError'?'Sharing was canceled. Click the button to try again.':'Could not share your screen. Try again.'}
      finally{shareBtn.disabled=false;redraw()}
    }
    function stopShare(tell){
      const s=stream,c=call;stream=null;call=null;
      c?.close();s?.getTracks().forEach(t=>t.stop());
      if(tell&&on&&s)B.sendTeacher({type:'board-screen',sharing:false});
      if(s){clearScreenMarks();window.FTTAnnotate?.setReason('sharing',false)}
      redraw();
    }
    function show(next){
      view.hidden=!next;document.body.classList.toggle('boards-on',next);
      if(B.embedded){stage.style.display=next?'block':'none';stage.dispatchEvent(new Event('classpointer:board-state'))}
      if(next)stage.dispatchEvent(new PointerEvent('pointerleave'));
      redraw();announceBoard();
    }
    // ---------- The teacher's pointer and drawings on MY shared screen ----------
    // The teacher opens my screen large and points or draws on it (screen-annotate.js). Positions are 0..1 across
    // and down my whole captured screen, so they are placed on this page using where the browser window sits on
    // the screen. A see-through layer never blocks my clicks. Only the teacher can draw here.
    const screenInk={strokes:[],draft:null,point:null,layer:null,canvas:null,banner:null,frame:0};
    const inkPoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
    function inkStroke(s){
      // Shapes and text boxes from the teacher's drawing toolbar (annotation-toolbar.js).
      if(window.FTTAnnotate&&s&&s.tool!=='pen'&&s.tool!=='highlight')return window.FTTAnnotate.cleanItem(s,{idPrefix:'t',maxPoints:400});
      if(!s||typeof s.id!=='string'||!/^t[a-z0-9-]{1,40}$/i.test(s.id)||!['pen','highlight'].includes(s.tool)||typeof s.color!=='string'||!/^#[0-9a-f]{6}$/i.test(s.color)||
        !Number.isFinite(s.size)||s.size<.001||s.size>.05||!Array.isArray(s.points)||!s.points.length||s.points.length>400||!s.points.every(inkPoint))return null;
      return{id:s.id,tool:s.tool,color:s.color,size:s.size,points:s.points.map(p=>({x:p.x,y:p.y}))};
    }
    function inkLayer(){
      if(screenInk.layer)return screenInk.layer;
      const layer=el('div','cp-my-screen-ink');
      layer.style.cssText='position:fixed;inset:0;z-index:2147483646;pointer-events:none';
      const canvas=el('canvas');canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';canvas.setAttribute('aria-hidden','true');
      const banner=el('div',null,'✏️ Your teacher is showing you something on your screen');banner.setAttribute('role','status');
      banner.style.cssText='position:fixed;top:10px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:#7f1d1d;color:#fff;font:700 15px system-ui,sans-serif;box-shadow:0 4px 18px #0005;pointer-events:none';
      layer.append(canvas,banner);document.body.append(layer);
      Object.assign(screenInk,{layer,canvas,banner});
      window.addEventListener('resize',drawInk);
      return layer;
    }
    // Where this page's top-left corner is on the captured screen, in screen pixels.
    function pageOnScreen(){
      const sx=Number.isFinite(window.screenX)?window.screenX:0,sy=Number.isFinite(window.screenY)?window.screenY:0;
      const left=Number.isFinite(screen.left)?screen.left:Number.isFinite(screen.availLeft)?screen.availLeft:0;
      const top=Number.isFinite(screen.top)?screen.top:Number.isFinite(screen.availTop)?screen.availTop:0;
      const border=Math.max(0,(window.outerWidth-window.innerWidth)/2)||0;
      const chrome=Math.max(0,window.outerHeight-window.innerHeight-border)||0;
      return{x:sx-left+border,y:sy-top+chrome,w:screen.width||window.innerWidth,h:screen.height||window.innerHeight};
    }
    function drawInk(){
      screenInk.frame=0;
      const any=screenInk.strokes.length||screenInk.draft||screenInk.point;
      if(!any){if(screenInk.layer)screenInk.layer.hidden=true;return}
      inkLayer().hidden=false;
      const c=screenInk.canvas,w=window.innerWidth,h=window.innerHeight,dpr=Math.min(window.devicePixelRatio||1,2);
      if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr)}
      const ctx=c.getContext('2d'),o=pageOnScreen(),at=p=>[p.x*o.w-o.x,p.y*o.h-o.y];
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';
      for(const s of [...screenInk.strokes,...(screenInk.draft?[screenInk.draft]:[])]){
        if(window.FTTAnnotate){window.FTTAnnotate.drawItem(ctx,s,at,o.w);continue}
        ctx.save();ctx.globalAlpha=s.tool==='highlight'?.38:1;ctx.strokeStyle=s.color;ctx.lineWidth=Math.max(2,s.size*o.w);
        ctx.beginPath();const [x0,y0]=at(s.points[0]);ctx.moveTo(x0,y0);if(s.points.length===1)ctx.lineTo(x0+.1,y0);
        for(const p of s.points.slice(1)){const [x,y]=at(p);ctx.lineTo(x,y)}ctx.stroke();ctx.restore();
      }
      if(screenInk.point){
        const [x,y]=at(screenInk.point);
        ctx.save();ctx.fillStyle='rgba(239,68,68,.35)';ctx.strokeStyle='#ef4444';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,16,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle='#ef4444';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
        ctx.font='700 13px system-ui,sans-serif';const label='Teacher',tw=ctx.measureText(label).width;
        ctx.fillStyle='#7f1d1d';ctx.fillRect(x-tw/2-6,y+20,tw+12,20);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,y+30);ctx.restore();
      }
    }
    function scheduleInk(){if(!screenInk.frame)screenInk.frame=requestAnimationFrame(drawInk)}
    function screenMarksFromTeacher(message){
      if(message.type==='board-screen-marks'){screenInk.strokes=Array.isArray(message.strokes)?message.strokes.slice(0,80).map(inkStroke).filter(Boolean):[]}
      else{screenInk.point=inkPoint(message.point)?{x:message.point.x,y:message.point.y}:null;screenInk.draft=inkStroke(message.draft)}
      scheduleInk();
    }
    function clearScreenMarks(){screenInk.strokes=[];screenInk.draft=null;screenInk.point=null;scheduleInk()}
    function fromTeacher(message){
      if(!message||typeof message.type!=='string'||!message.type.startsWith('board-'))return false;
      if(message.type==='board-screen-marks'||message.type==='board-screen-live'){screenMarksFromTeacher(message);return true}
      if(message.type==='board-mode'){
        drawer.cancel();
        const was=on,wasMode=mode,wasBlocked=blocked;
        on=message.on===true;mode=message.mode==='screens'?'screens':'boards';blocked=on&&message.blocked===true;
        if(!on||mode!=='screens'||blocked)stopShare(false);
        chooseActivity(on&&mode==='boards'?message.activity:null,redraw);
        group=on&&mode==='boards'&&!blocked?cleanGroup(message.group):null;
        // A picture the teacher sent to every board: keep this student's own copy in My files (saved-work.js).
        if(activity?.kind==='image'&&on&&mode==='boards'&&!blocked)window.FTTSavedWork?.keepTeacherCopy?.({kind:'image',data:activity.data,id:activity.id,subject:activity.subject,important:activity.important});
        board=on&&mode==='boards'&&!blocked?boardFromMessage(message.strokes,message.text,message.tiles,message):emptyBoard();
        if(message.send)boardSerial++;
        // Pictures the teacher sent as pages: keep this student's own copy in My files (saved-work.js).
        if(on&&mode==='boards'&&!blocked&&message.send&&Pages&&Array.isArray(message.pages)&&board.pages.length&&board.pages.every(p=>p.bg))window.FTTSavedWork?.keepTeacherPages?.({id:message.send.id,subject:message.send.subject,important:message.send.important,pages:board.pages.map(p=>({bg:p.bg}))});
        // In embedded mode, screens are shared via the existing activity button;
        // never cover Shorashim with the old Pointer screen-sharing panel.
        show(on&&!(B.embedded&&mode==='screens'));
        if(!on){if(was)B.status('Your teacher closed the boards. Back to the lesson.')}
        else if(blocked){if(!wasBlocked)B.status('Your teacher paused your board for now.')}
        else if(!was||wasMode!==mode||wasBlocked)B.status(mode==='screens'?'Your teacher asked you to share your screen. Click Share my screen.':'Your teacher opened your own whiteboard. Draw with the pen. Your teacher can see your board.');
        syncAnnotate();
      }else if(message.type==='board-peer'){
        // A line, page change or draft from someone in my group (the teacher's page passes it on after checking it).
        if(on&&mode==='boards'&&!blocked&&group)applyTo(board,message.op,'student');
      }else if(on&&mode==='boards'&&!blocked)applyTo(board,message,'teacher');
      redraw();return true;
    }
    new ResizeObserver(redraw).observe(stage);document.addEventListener('fullscreenchange',redraw);
    // ---------- Save and restore (used by "Save whiteboard") ----------
    // Everything on my board, in drawing order. A pasted picture is a mark with an `image`; `images` lists their ids.
    // One page of my board: its marks (a pasted picture is a mark with an `image`; `images` lists their ids), words, tiles and background.
    function pageData(page){
      return{strokes:page.strokes.map(s=>({...s,points:s.points.map(p=>({x:p.x,y:p.y}))})),
        images:page.strokes.filter(s=>s.image).map(s=>s.id),text:page.text?{...page.text}:null,
        // Where every Hebrew tile is (the words themselves are in `activity`).
        ...(activity?.kind==='tiles'&&page.tiles?{tiles:page.tiles.map(t=>({...t}))}:{}),
        ...(page.bg?{bg:page.bg}:{})};
    }
    // A board with one page and no page background is saved exactly as it always was (version 1). More pages, or a
    // background that came as a page from the teacher, make a version 2 file that lists the pages (board-pages-core.js).
    function exportBoard(){
      if(!boardOpen())return null;
      if(!Pages||(board.pages.length===1&&!board.pages[0].bg)){
        const one=pageData(board.pages[0]);
        return{version:1,kind:'student-board',strokes:one.strokes,images:one.images,text:one.text,activity:activity?{...activity}:null,...(one.tiles?{tiles:one.tiles}:{})};
      }
      return{...Pages.wrap('student-board',board.pages.map(pageData),board.at),activity:activity?{...activity}:null};
    }
    // Puts the saved marks of ONE page on the page being shown. Saved data is checked like anything from the network,
    // sent to the teacher as normal board changes (so every limit holds), and the teacher's marks and activity are left alone.
    function restorePage(data){
      clearMine();
      for(const raw of data.strokes.slice(0,MAX_STROKES)){
        if(!raw||raw.by==='teacher')continue;
        const stroke=cleanStroke({...raw,id:newId('s')});
        if(stroke)act({type:'board-add',stroke});
      }
      const word=cleanWord(data.text);
      if(word&&activity?.kind==='word'&&board.text)act({type:'board-text',text:word});
      // A copy of a picture the teacher sent (see keepTeacherCopy in saved-work.js): bring the picture back as the
      // locked background when the teacher has no picture of their own on this board now.
      const picture=cleanActivity(data.activity);
      if(picture?.kind==='image'&&!activity)chooseActivity(picture,redraw);
      // Hebrew tiles: put each tile back where the student left it. If the teacher is not showing tiles now, the saved
      // words and boxes come back too (on this student's board only).
      const savedTiles=Tiles&&data.activity?.kind==='tiles'?Tiles.cleanActivity(data.activity):null;
      if(savedTiles){
        if(!activity){chooseActivity(savedTiles,redraw);board.tiles=Tiles.cleanState(activity,data.tiles)}
        else if(activity.kind==='tiles'&&JSON.stringify(activity.tiles)===JSON.stringify(savedTiles.tiles)&&JSON.stringify(activity.boxes)===JSON.stringify(savedTiles.boxes)){
          // A box can hold one tile, so tiles are put down one by one, free ones first.
          const wanted=Tiles.cleanState(activity,data.tiles);
          for(const tile of board.tiles)act({type:'board-tile',tile:{id:tile.id,x:tile.x,y:tile.y,box:''}});
          for(const tile of wanted)act({type:'board-tile',tile});
        }
      }
    }
    // Replaces my own marks with the saved ones. A version 1 file is one page; a version 2 file brings back its pages.
    function importBoard(data){
      if(!boardOpen()||!data||data.kind!=='student-board')return false;
      boardSerial++;
      if(data.version===1){
        if(!Array.isArray(data.strokes))return false;
        // One page: any other pages on my board go, and the saved marks fill the first page.
        if(Pages){for(const page of board.pages.slice(1))act({type:'board-page-remove',id:page.id});act({type:'board-page-at',pg:board.pages[0].id})}
        restorePage(data);return true;
      }
      const list=Pages?Pages.pagesOf(data,'student-board'):null;
      if(!list)return false;
      // My pages become the saved file's pages: the extra ones go, then one page is made for each saved page.
      for(const page of board.pages.slice(1))act({type:'board-page-remove',id:page.id});
      const ids=[board.pages[0].id];
      act({type:'board-page-at',pg:ids[0]});
      list.forEach((raw,index)=>{
        if(index>0){const id=Pages.newId();act({type:'board-page-add',id,after:ids[ids.length-1]});ids.push(id);act({type:'board-page-at',pg:id})}
        restorePage({strokes:Array.isArray(raw.strokes)?raw.strokes:[],text:raw.text,tiles:raw.tiles,activity:data.activity});
        // A page picture from the teacher comes back as the background of this page, on this board only.
        const bg=cleanBg(raw.bg),page=board.pages.find(p=>p.id===ids[index]);
        if(bg&&page&&!page.bg)page.bg=bg;
      });
      act({type:'board-page-at',pg:ids[Pages.currentOf(data,ids.length)]});
      redraw();
      return true;
    }
    const exportPng=()=>boardOpen()?boardPng(board):Promise.reject(Error('Your whiteboard is not open.'));
    window.ClassPointerBoards={fromTeacher,clearScreenMarks,exportBoard,importBoard,exportPng,boardId:()=>boardOpen()?'b'+boardSerial:null,newSlides:()=>newSlides(),reset(){clearScreenMarks();drawer.cancel();stopShare(false);on=false;blocked=false;mode='boards';chooseActivity(null,redraw);board=emptyBoard();show(false);syncAnnotate()}};
    return;
  }

  // =====================================================================
  // Teacher page: a grid of every student's board or shared screen, plus the shared whiteboard button.
  // =====================================================================
  const boards=new Map(),tiles=new Map(),blocked=new Set();
  let on=false,mode='screens',focusId=null,drawer=null,gridSize='',suspended=false;
  // Switching workspaces hides this gallery, not the student's approved screen capture.
  let screenPermissionEnabled=false,workspaceRevision=0;
  // Separate, default-allow permissions: a teacher can exclude one boy without
  // changing classmates' access or his independent Pointer/Highlight settings.
  const denied={screens:new Set(),boards:new Set()};
  let classStudents=[],permissionsLoad=null,permissionsWrite=Promise.resolve();
  // ---------- Groups: students who share one board ----------
  // The teacher puts the students who are here into groups (board-groups-core.js). A group has ONE board, kept on the
  // teacher's page: a line a member draws is checked here, marked with that member's code, and passed on to the others in
  // the group, so everyone sees the same board live. The teacher watches one tile for each group and can draw on it.
  // Who is in which group is remembered in this browser for the rest of the day, so a student who leaves and comes back
  // returns to the same group.
  const Groups=window.ClassPointerGroups||null;
  const GROUP_STORE='fttPointerGroups:'+(()=>{try{return new URLSearchParams(location.search).get('class')||''}catch(_){return ''}})();
  const GROUP_KEEP_MS=12*60*60*1000;
  function loadGroups(){
    if(!Groups)return null;
    try{const saved=JSON.parse(localStorage.getItem(GROUP_STORE)||'null');if(saved&&Date.now()-Number(saved.at)<GROUP_KEEP_MS)return Groups.clean(saved.state)}catch(_){}
    return Groups.empty();
  }
  let gstate=loadGroups();
  function saveGroups(){if(!Groups)return;try{if(gstate.groups.length)localStorage.setItem(GROUP_STORE,JSON.stringify({at:Date.now(),state:gstate}));else localStorage.removeItem(GROUP_STORE)}catch(_){}}
  const policy=()=>Object.fromEntries(['screens','boards'].map(kind=>[kind,Object.fromEntries(Array.from(denied[kind],id=>[id,true]))]));
  function personId(m){
    if(m.studentId&&classStudents.some(student=>student.id===m.studentId&&student.name.toLowerCase()===String(m.name).toLowerCase()))return m.studentId;
    return classStudents.find(student=>student.name.toLowerCase()===String(m.name).toLowerCase())?.id||m.studentId||null;
  }
  function excluded(m,kind){const id=personId(m);return !!id&&denied[kind].has(id)}
  function savePolicy(){
    const p=policy();
    permissionsWrite=permissionsWrite.catch(()=>{}).then(()=>window.ClassPointerDashboard?.updateActivityPermissions(p));
    permissionsWrite.catch(error=>B.fail('Could not update student sharing permissions: '+(error?.message||'Try again.')));
  }
  function updatePermission(id,kind,allowed){
    if(!id)return;
    if(allowed)denied[kind].delete(id);else denied[kind].add(id);
    // Allowing from the Students panel also lifts a tile Pause for him.
    if(allowed&&kind==='screens')for(const m of admitted())if(personId(m)===id)blocked.delete(keyFor(m));
    renderPermissions();
    for(const m of admitted())if(personId(m)===id){if(on)sendMode(m);dirty(m.id)}
    if(on)syncTiles();
    savePolicy();
  }
  function bulkPermission(kind,allowed){
    const ids=classStudents.length?classStudents.map(person=>person.id):admitted().map(personId).filter(Boolean);
    for(const id of ids){if(allowed)denied[kind].delete(id);else denied[kind].add(id)}
    renderPermissions();
    if(on){for(const m of admitted()){sendMode(m);dirty(m.id)}syncTiles()}
    savePolicy();
  }
  const permissionsPanels=[];
  function createPermissionsPanel(){
    const outer=el('div','sharing-permissions'),header=el('strong',null,'Student screen & whiteboard permissions');
    outer.append(header,el('p',null,'Everyone is enabled by default. Uncheck a student without affecting the others.'));
    for(const [kind,title] of [['screens','Screen sharing'],['boards','Whiteboards']]){
      const actions=el('div','sharing-permission-actions');
      actions.append(el('strong',null,title),button('Select all','Enable '+title+' for every student',()=>bulkPermission(kind,true)),
        button('Clear all','Disable '+title+' for every student',()=>bulkPermission(kind,false)));
      outer.append(actions);
    }
    const list=el('div','sharing-permissions-roster');outer.append(list);
    permissionsPanels.push(list);return outer;
  }
  function renderPermissions(){
    document.dispatchEvent(new CustomEvent('classpointer:sharing-permissions'));
    const students=classStudents.length?classStudents:admitted().map(m=>({id:personId(m),name:m.name})).filter(m=>m.id);
    for(const list of permissionsPanels){
      list.replaceChildren();
      if(!students.length){list.append(el('p',null,'Loading class roster…'));continue}
      for(const person of students){
        const row=el('div','sharing-permissions-row'),name=el('span',null,person.name);row.append(name);
        for(const [kind,label] of [['screens','Screen'],['boards','Board']]){
          const wrap=el('label'),input=el('input');input.type='checkbox';input.checked=!denied[kind].has(person.id);
          input.setAttribute('aria-label',label+' sharing for '+person.name);
          input.addEventListener('change',()=>updatePermission(person.id,kind,input.checked));
          wrap.append(input,document.createTextNode(label));row.append(wrap);
        }
        list.append(row);
      }
    }
  }
  async function loadPermissionsRoster(){
    if(permissionsLoad)return permissionsLoad;
    permissionsLoad=(async()=>{
      try{
        classStudents=await window.ClassPointerDashboard?.students()||[];
      }catch(error){B.fail('Could not load class roster for sharing permissions: '+(error?.message||'Try again.'))}
      renderPermissions();renderWaiting();
    })();
    return permissionsLoad;
  }
  const toggle=$('studentBoards');
  // Teacher can bring the whole signed-in class directly to screens or boards.
  // These same controls remain available from the Students menu in full screen.
  const sendScreens=button('📣 Send to Screen Sharing','Ask students to share from their current activity; each student must approve sharing',()=>void sendEveryone('screens'));
  const sendBoards=button('📝 Send to Whiteboards','Open a whiteboard over each student’s current activity',()=>void sendEveryone('boards'));
  toggle?.after(sendScreens,sendBoards);
  const dockLaunch=el('div','pointer-bulk-actions');
  dockLaunch.style.cssText='display:flex;gap:6px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid #cbd5e1';
  const dockScreens=button('🖥 Send screens','Ask the class to share their screens',()=>void sendEveryone('screens'));
  const dockBoards=button('📝 Send whiteboards','Open individual whiteboards without leaving student activities',()=>void sendEveryone('boards'));
  dockLaunch.append(dockScreens,dockBoards);
  document.getElementById('tbStudentsMenu')?.prepend(dockLaunch);
  const menuPermissions=createPermissionsPanel();
  document.getElementById('tbStudentsMenu')?.append(menuPermissions);
  const view=el('div','boards-view');view.id='boardsView';view.dataset.stageUi='true';view.hidden=true;view.setAttribute('aria-label','Student whiteboards and screens');

  // Grid bar: mode switch for the whole class.
  const gridBar=el('div','boards-bar'),count=el('span','boards-count'),modes=el('span','boards-modes');
  modes.setAttribute('role','group');modes.setAttribute('aria-label','What students do');
  const modeBoards=button('📝 Whiteboards','Every student draws on their own whiteboard',()=>setMode('boards'));
  const modeScreens=button('🖥 Screens','Every student shares their screen with you. Click a screen to open it large and point or draw on it.',()=>setMode('screens'));
  modes.append(modeBoards,modeScreens);
  const chooseParticipants=button('👥 Choose students','Choose whose screens and whiteboards may participate',()=>{
    gridPermissions.hidden=!gridPermissions.hidden;
  });
  const gridPermissions=createPermissionsPanel();gridPermissions.hidden=true;
  const clearAll=button('🗑 Clear all boards','Erase every student whiteboard',()=>{
    if(!confirm('Erase every student whiteboard? This cannot be undone.'))return;
    boards.clear();for(const m of admitted())sendMode(m);dirtyAll();
  },'danger');
  // Groups: students who share one board.
  const groupsBtn=button('\uD83D\uDC65 Groups','Put the students in small groups. Each group shares one board',()=>openGroupsDialog());
  const saveGroupsBtn=button('\uD83D\uDCBE Save group boards','Save every group\u2019s board in your whiteboard files',()=>void saveGroupBoards());
  groupsBtn.hidden=!Groups;saveGroupsBtn.hidden=true;
  const groupsDialog=el('div','boards-groups-dialog');groupsDialog.hidden=true;groupsDialog.setAttribute('role','dialog');groupsDialog.setAttribute('aria-label','Groups');
  groupsDialog.style.cssText='position:fixed;inset:0;z-index:2147483500;background:#0b1837a8;display:none;align-items:center;justify-content:center;padding:18px';
  gridBar.append(el('strong','boards-title','🧑‍🎨 Students'),count,modes,chooseParticipants,el('span','boards-hint','Click a tile to open it large · 🚫 pauses a student'),el('span','boards-spacer'),clearAll,
    button('✕ Close boards','Return everyone to the lesson. Whiteboards are kept until the class ends.',()=>setOn(false)));

  // Teacher sends an identical, non-erasable activity background to all boys.
  // Each student retains a private pen layer that only the teacher can see.
  const activityBar=el('div','boards-activity-bar'),wordInput=el('input'),instructionInput=el('input'),activityLabel=el('span','boards-activity-label');
  const imageFile=el('input');
  imageFile.type='file';imageFile.accept='image/jpeg,image/png,image/webp,image/gif';imageFile.hidden=true;
  wordInput.type='text';wordInput.dir='auto';wordInput.maxLength=80;wordInput.placeholder='Hebrew word or shoresh';wordInput.setAttribute('aria-label','Hebrew word or shoresh');
  instructionInput.type='text';instructionInput.dir='auto';instructionInput.maxLength=120;instructionInput.placeholder='Instructions (optional)';instructionInput.setAttribute('aria-label','Activity instructions');
  const sendWord=button('📤 Send word','Show this word on every student whiteboard',()=>{
    const value=wordInput.value.trim();
    if(!value){wordInput.focus();return}
    sendActivity({kind:'word',text:value,instruction:instructionInput.value});
  });
  const sendImage=button('🖼 Coloring page','Upload a picture or coloring page for every student to color',()=>imageFile.click());
  // Explicit clipboard action for teachers: preview before replacing each student's
  // common background. Every boy's own drawing layer remains independent.
  const pasteAll=button('📋 Paste to All Boards','Paste copied words or an image on every student whiteboard',()=>{
    if(!classTarget.active()){B.status('Open Student whiteboards before pasting.');return}
    if(Clip)void Clip.pasteInto(classTarget);
  });
  const pastePreview=el('div','boards-paste-preview');pastePreview.hidden=true;
  pastePreview.setAttribute('role','dialog');pastePreview.setAttribute('aria-label','Preview paste to all whiteboards');
  pastePreview.style.cssText='position:fixed;inset:0;z-index:2147483500;background:#0b1837a8;display:none;align-items:center;justify-content:center;padding:18px';
  const previewPanel=el('div','boards-paste-panel');previewPanel.style.cssText='background:white;color:#142642;border-radius:15px;padding:18px;max-width:min(650px,95vw);max-height:85vh;overflow:auto;box-shadow:0 16px 55px #0005';
  const previewTitle=el('h3',null,'Send to every whiteboard?'),previewBody=el('div','boards-paste-content');
  previewBody.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:55vh;overflow:auto;margin:12px 0';
  const confirmPaste=button('✓ Send to all boards','Replace the common background on every student board',()=>void commitPaste());
  const cancelPaste=button('Cancel','Close the paste preview',()=>{closePreview();B.status('Nothing was sent.')});
  previewPanel.append(previewTitle,previewBody,confirmPaste,cancelPaste);pastePreview.append(previewPanel);stage.appendChild(pastePreview);
  let pendingPaste=null;
  function closePreview(){pendingPaste=null;pastePreview.hidden=true;pastePreview.style.display='none';previewBody.replaceChildren()}
  function showPaste(value){
    pendingPaste=value;previewBody.replaceChildren();
    if(value.kind==='word')previewBody.append(el('p',null,value.text));
    else{
      const img=el('img');img.src=URL.createObjectURL(value.kind==='pages'?value.files[0]:value.file);img.alt=value.kind==='pages'?'First page preview':'Copied picture preview';img.style.cssText='max-width:100%;max-height:45vh;object-fit:contain';
      img.addEventListener('load',()=>URL.revokeObjectURL(img.src),{once:true});
      previewBody.append(img);
      // Each student's copy is saved in their My files; if ticked it arrives already starred (they can unstar it).
      const tick=el('label',null),box=el('input');box.type='checkbox';box.id='boardsImportant';
      tick.style.cssText='display:flex;align-items:center;gap:8px;margin:10px 0;font-weight:700';
      tick.append(box,el('span',null,'⭐ Mark as important (every student\'s copy arrives starred)'));
      previewBody.append(tick);
      // A whiteboard goes as pieces students can select, move and resize, unless the teacher wants it static.
      if(value.pieces){
        const lock=el('label',null),lockBox=el('input');lockBox.type='checkbox';lockBox.id='boardsLocked';
        lock.style.cssText='display:flex;align-items:center;gap:8px;margin:10px 0;font-weight:700';
        lock.append(lockBox,el('span',null,'🔒 Send as a locked picture (students can only draw on top of it)'));
        previewBody.append(lock);
      }
      // Anything a student has drawn (even a stray tap) is replaced by the new board. Say so here, before the green button.
      if(hasStudentWork()){const warn=el('p',null,'⚠ Some students have marks on their boards. Sending replaces their boards with this one.');warn.style.cssText='margin:10px 0;padding:8px 10px;border-radius:10px;background:#fff4d6;color:#7a4b00;font-weight:700';previewBody.append(warn)}
    }
    if(value.note)previewBody.append(el('p',null,value.note));
    pastePreview.hidden=false;pastePreview.style.display='flex';confirmPaste.focus();
    // Nothing goes to the students until the teacher presses the green button, so the status line says so.
    B.status('Not sent yet. Press ✓ Send to all boards to send this to every student.');
  }
  async function commitPaste(){
    const item=pendingPaste;if(!item)return;
    const important=!!previewBody.querySelector('#boardsImportant')?.checked,locked=!!previewBody.querySelector('#boardsLocked')?.checked;
    closePreview();
    if(item.pieces&&!locked&&await sendPieces(item.pieces,{confirmed:true,subject:item.subject}))return;
    // The preview already told the teacher that students' marks are replaced, and the green button was the yes: no second question.
    if(item.kind==='image')await sendImageFile(item.file,{subject:item.subject,important,confirmed:true});
    else if(item.kind==='pages')await sendPagesFiles(item.files,{subject:item.subject,important,confirmed:true});
    else{wordInput.value=item.text;sendActivity({kind:'word',text:item.text,instruction:instructionInput.value})}
  }
  // The gallery of all boards: Ctrl+V and the 📋 Paste to All Boards button both end in the same preview, and
  // nothing is sent until the teacher presses ✓ Send to all boards. Words too long for a class word (80 letters,
  // one line) are never cut short: they are sent as a picture instead, and the preview says so.
  const classTarget={priority:1,active:()=>on&&!suspended&&!view.hidden&&mode==='boards'&&!focusId,say:text=>B.status(text),
    async paste(payload){
      if(payload.kind==='image'){showPaste({kind:'image',file:payload.blob});return}
      if(payload.text.length<=80&&!payload.text.includes('\n')){showPaste({kind:'word',text:payload.text});return}
      const made=await Clip.textImage(payload.text);
      showPaste({kind:'image',file:made.blob,note:'These words are too long for one class word, so they will be sent as a picture.'+(payload.cut||made.cut?' Only the first part fits.':'')});
    }};
  clipReady.then(clip=>{if(clip)clip.register(classTarget);else pasteAll.hidden=true});
  const removeActivity=button('✕ Blank boards','Remove the shared word or picture and clear the current drawings',()=>sendActivity(null));
  // 🔤 Hebrew tiles: the teacher types or pastes Hebrew (nikud is kept). Each word becomes a tile that every student can
  // drag into the word boxes on their own board. "Split into parts" lets the teacher cut words with | (ו|אמר|ו).
  const sendTiles=button('🔤 Hebrew tiles','Type or paste Hebrew words. Each word becomes a tile students drag into word boxes',()=>openTilesDialog());
  const tilesDialog=el('div','boards-tiles-dialog');tilesDialog.hidden=true;tilesDialog.setAttribute('role','dialog');tilesDialog.setAttribute('aria-label','Hebrew word tiles');
  tilesDialog.style.cssText='position:fixed;inset:0;z-index:2147483500;background:#0b1837a8;display:none;align-items:center;justify-content:center;padding:18px';
  // Every student gets the board they now belong to (a group's, or their own again), and the gallery is redrawn.
  function applyGroups(){
    saveGroups();
    const live=new Set(gstate.groups.map(g=>'group:'+g.id));
    for(const key of Array.from(boards.keys()))if(key.startsWith('group:')&&!live.has(key))boards.delete(key);
    for(const key of Array.from(blocked))if(key.startsWith('group:')&&!live.has(key))blocked.delete(key);
    drawer?.cancel();
    for(const m of admitted())sendMode(m);
    controls();gridSize='';syncTiles();dirtyAll();syncAnnotate();
  }
  const hasGroupWork=()=>Array.from(boards.entries()).some(([key,set])=>key.startsWith('group:')&&set.pages.some(p=>p.strokes.length));
  function openGroupsDialog(){
    if(!Groups||mode!=='boards')return;
    if(!B.started()){B.fail('Wait for your classroom to finish opening, then try again.');return}
    const panel=el('div','boards-groups-panel');
    panel.style.cssText='background:white;color:#142642;border-radius:15px;padding:18px;width:min(720px,95vw);max-height:90vh;overflow:auto;box-shadow:0 16px 55px #0005;display:grid;gap:12px';
    const box='padding:6px;border:2px solid #94a3b8;border-radius:9px;font:600 15px system-ui';
    const note=el('p');note.setAttribute('role','status');note.style.cssText='margin:0;min-height:1.3em;font-weight:700;color:#475569';
    const say=(text,bad)=>{note.style.color=bad?'#b91c1c':'#475569';note.textContent=text||''};
    const close=()=>{Groups.dropEmpty(gstate);applyGroups();groupsDialog.hidden=true;groupsDialog.style.display='none';groupsDialog.replaceChildren()};
    function people(){
      const rows=[],seen=new Set();
      for(const m of admitted()){
        if(excluded(m,'boards'))continue;
        const key=personKeyOf(m);if(seen.has(key))continue;seen.add(key);rows.push({key,name:m.name,here:true});
      }
      for(const key of Object.keys(gstate.assign))if(!seen.has(key)){seen.add(key);rows.push({key,name:gstate.assign[key].n||key,here:false})}
      return rows;
    }
    function render(){
      panel.replaceChildren();
      const rows=people(),here=rows.filter(p=>p.here);
      // 1. Make random groups
      const make=el('div');make.style.cssText='display:flex;gap:10px;flex-wrap:wrap;align-items:center';
      const how=el('select');how.style.cssText=box;
      for(const [value,label] of [['count','Number of groups'],['size','Students in each group']]){const o=el('option',null,label);o.value=value;how.append(o)}
      const amount=el('input');amount.type='number';amount.min='1';amount.max='30';amount.value=String(Math.max(2,Math.round(here.length/3))||2);amount.style.cssText=box+';width:80px';amount.setAttribute('aria-label','How many');
      how.addEventListener('change',()=>{amount.value=how.value==='size'?'3':String(Math.max(2,Math.round(here.length/3))||2)});
      const go=button('\uD83C\uDFB2 Make random groups','Shuffle the students who are here into groups',()=>{
        const result=Groups.split(gstate,here.map(p=>({key:p.key,name:p.name})),how.value==='size'?{size:amount.value}:{count:amount.value});
        if(result.error){say(result.error,true);return}
        if(hasGroupWork()&&!confirm('Making new groups starts new group boards, and the old group boards are erased. (Save group boards first to keep them.) Continue?'))return;
        gstate=result.state;applyGroups();render();
        say(gstate.groups.length+' group'+(gstate.groups.length===1?'':'s')+' made. Every student now sees their group\u2019s board. You can move students below.');
      },'main');
      make.append(how,amount,go);
      // 2. Group names
      const names=el('div');names.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
      for(const g of gstate.groups){
        const input=el('input');input.type='text';input.maxLength=Groups.LIMITS.name;input.value=g.name;input.style.cssText=box+';width:150px';input.setAttribute('aria-label','Name of '+g.name);
        input.addEventListener('change',()=>{
          if(Groups.rename(gstate,g.id,input.value)){saveGroups();for(const m of admitted())if(groupIdOf(m)===g.id)sendMode(m);syncTiles()}
          input.value=Groups.groupById(gstate,g.id)?.name||g.name;
        });
        names.append(input);
      }
      // 3. Each student: which group
      const list=el('div');list.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px';
      for(const p of rows){
        const row=el('label');row.style.cssText='display:flex;gap:8px;align-items:center;justify-content:space-between;font-weight:700';
        const select=el('select');select.style.cssText=box;
        const choices=[['','No group'],...gstate.groups.map(g=>[g.id,g.name]),['__new','\uFF0B New group']];
        for(const [value,label] of choices){const o=el('option',null,label);o.value=value;select.append(o)}
        select.value=Groups.groupOf(gstate,p.key);
        select.addEventListener('change',()=>{
          let target=select.value;
          if(target==='__new'){const g=Groups.newGroup(gstate);if(!g){say('There can be at most '+Groups.LIMITS.groups+' groups.',true);render();return}target=g.id}
          if(Groups.move(gstate,p.key,target,p.name))applyGroups();
          render();
        });
        row.append(el('span',null,p.name+(p.here?'':' (away)')),select);list.append(row);
      }
      const buttons=el('div');buttons.style.cssText='display:flex;gap:10px;flex-wrap:wrap';
      const ungroup=button('Ungroup everyone','Everyone goes back to their own board (group boards are erased)',()=>{
        if(!gstate.groups.length){say('There are no groups.');return}
        if(hasGroupWork()&&!confirm('The group boards will be erased. (Save group boards first to keep them.) Ungroup everyone?'))return;
        gstate=Groups.ungroup();for(const key of Array.from(boards.keys()))if(key.startsWith('group:'))boards.delete(key);
        applyGroups();render();say('Everyone is back on their own board.');
      },'danger');
      const done=button('Done','Close',close,'main');
      buttons.append(done,ungroup);
      panel.append(el('h3',null,'\uD83D\uDC65 Groups'),
        el('p',null,here.length?here.length+' student'+(here.length===1?' is':'s are')+' here. Each group shares one board: whatever one student draws, the others see.':'No students are here yet.'),
        make,note,gstate.groups.length?el('strong',null,'Group names'):el('span'),names,el('strong',null,'Students'),list,buttons);
    }
    render();
    groupsDialog.replaceChildren(panel);groupsDialog.hidden=false;groupsDialog.style.display='flex';
  }
  // ---------- Save group boards: each group's board becomes a whiteboard file of the teacher's own ----------
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function pageJpeg(page,limit){
    for(const data of new Set([page.bg,...page.strokes.map(line=>line.image)].filter(Boolean)))for(let i=0;i<30&&!pictureOf(data);i++)await pause(100);
    const c=document.createElement('canvas');c.width=1280;c.height=720;
    paintOn(c.getContext('2d'),c.width,c.height,page,[]);
    let data='';
    for(const quality of [0.85,0.7,0.55,0.4]){data=c.toDataURL('image/jpeg',quality);if(data.length<=limit)break}
    c.width=0;
    return data.length<=limit?data:null;
  }
  // One group's board as something saved-work.js can save: its name, a picture of every page, and a picture of page 1.
  // null when the board has nothing on it yet.
  async function groupItem(g){
    const set=boards.get('group:'+g.id);
    if(!set||!set.pages.some(page=>page.strokes.length||page.bg))return null;
    const limit=Math.max(150000,Math.min(600000,Math.floor(8500000/set.pages.length)));
    const pages=[];
    for(const page of set.pages){
      const jpeg=await pageJpeg(page,limit);
      if(!jpeg)throw Error('A page of '+g.name+' is too detailed to save.');
      pages.push(jpeg);
    }
    const members=Groups.membersOf(gstate,g.id).map(key=>gstate.assign[key].n).filter(Boolean).join(', ');
    return{name:g.name+(members?' - '+members:''),pages,picture:await boardPng(set.pages[0])};
  }
  // The group board that is open large right now (its group id), or ''. The regular Save on the toolbar saves this one.
  const openGroupId=()=>mode==='boards'&&on&&!suspended&&!view.hidden&&typeof focusId==='string'&&focusId.startsWith('g:')&&Groups?.groupById(gstate,focusId.slice(2))?focusId.slice(2):'';
  async function saveGroupBoards(){
    const api=window.FTTSavedWork;
    if(typeof api?.saveGroupBoards!=='function'){B.status('Saving is not ready yet. Try again in a moment.');return}
    saveGroupsBtn.disabled=true;
    try{
      const items=[];
      for(const g of gstate.groups){const item=await groupItem(g);if(item)items.push(item)}
      if(!items.length){B.status('The group boards are empty. There is nothing to save yet.');return}
      await api.saveGroupBoards(items);
    }catch(error){B.fail(error?.message||'Could not save the group boards.')}
    finally{saveGroupsBtn.disabled=false}
  }
  function openTilesDialog(){
    if(!Tiles)return;
    const panel=el('div','boards-tiles-panel');
    panel.style.cssText='background:white;color:#142642;border-radius:15px;padding:18px;width:min(640px,95vw);max-height:90vh;overflow:auto;box-shadow:0 16px 55px #0005;display:grid;gap:10px';
    const field=(label,node)=>{const wrap=el('label');wrap.style.cssText='display:grid;gap:4px;font-weight:700';wrap.append(el('span',null,label),node);return wrap};
    const text=el('textarea');text.rows=4;text.dir='rtl';text.lang='he';text.maxLength=Tiles.LIMITS.source;
    text.style.cssText='font:400 26px "David Libre","Frank Ruehl CLM","Times New Roman",serif;padding:8px;border:2px solid #94a3b8;border-radius:10px;width:100%;box-sizing:border-box';
    text.placeholder='Paste or type the Hebrew words here';text.setAttribute('aria-label','Hebrew words');
    const whole=el('input'),parts=el('input');for(const r of [whole,parts]){r.type='radio';r.name='boardsTilesMode'}whole.checked=true;
    const modeRow=el('div');modeRow.style.cssText='display:flex;gap:18px;flex-wrap:wrap;font-weight:700';
    const wholeLabel=el('label',null),partsLabel=el('label',null);
    wholeLabel.append(whole,' Whole words (students get each word as one tile)');
    partsLabel.append(parts,' Already split into parts (write | between parts, like ו|אמר|ו)');
    modeRow.append(wholeLabel,partsLabel);
    const boxes=el('input');boxes.type='number';boxes.min='0';boxes.max=String(Tiles.LIMITS.boxes);boxes.placeholder='One box for each tile';boxes.style.cssText='padding:6px;border:2px solid #94a3b8;border-radius:8px;width:100%;box-sizing:border-box';
    const labels=el('input');labels.type='text';labels.dir='auto';labels.maxLength=120;labels.placeholder='Box names (optional), separated by commas, for example: prefix, shoresh, suffix';labels.style.cssText=boxes.style.cssText;
    const instruction=el('input');instruction.type='text';instruction.dir='auto';instruction.maxLength=Tiles.LIMITS.instruction;instruction.placeholder='Instructions (optional)';instruction.style.cssText=boxes.style.cssText;
    const note=el('p');note.setAttribute('role','status');note.style.cssText='margin:0;min-height:1.3em;font-weight:700;color:#475569';
    const close=()=>{tilesDialog.hidden=true;tilesDialog.style.display='none';tilesDialog.replaceChildren()};
    const build=()=>Tiles.parse(text.value,{presplit:parts.checked,boxes:boxes.value,labels:labels.value,instruction:instruction.value});
    const refresh=()=>{const r=text.value.trim()?build():null;note.style.color=r?.error?'#b91c1c':'#475569';note.textContent=!r?'':r.error||(r.activity.tiles.length+' tile'+(r.activity.tiles.length===1?'':'s')+' and '+r.activity.boxes.length+' box'+(r.activity.boxes.length===1?'':'es')+'.')};
    for(const node of [text,whole,parts,boxes,labels,instruction])node.addEventListener('input',refresh);
    for(const node of [whole,parts])node.addEventListener('change',refresh);
    const send=button('✓ Send to all boards','Every student gets their own copy of these tiles and boxes',()=>{
      const r=build();if(r.error){note.style.color='#b91c1c';note.textContent=r.error;return}
      close();sendActivity(r.activity);
    });
    const cancel=button('Cancel','Close without sending',()=>{close();B.status('Nothing was sent.')});
    const row=el('div');row.style.cssText='display:flex;gap:10px;flex-wrap:wrap';row.append(send,cancel);
    panel.append(el('h3',null,'Hebrew word tiles'),field('Hebrew words',text),modeRow,field('Number of word boxes',boxes),field('Box names',labels),field('Instructions',instruction),note,row);
    tilesDialog.replaceChildren(panel);tilesDialog.hidden=false;tilesDialog.style.display='flex';text.focus();
  }
  tilesDialog.addEventListener('keydown',e=>{if(e.key==='Escape')tilesDialog.querySelector('button:last-child')?.click()});
  stage.appendChild(tilesDialog);shield(tilesDialog);
  stage.appendChild(groupsDialog);shield(groupsDialog);
  if(!Tiles)sendTiles.hidden=true;
  // Groups sit first in this bar: it is the bar that shows on the teacher page (the gallery's own top bar is hidden there).
  activityBar.append(groupsBtn,saveGroupsBtn,el('strong',null,'Send to all boards:'),wordInput,instructionInput,sendWord,sendTiles,sendImage,pasteAll,removeActivity,imageFile,activityLabel,el('span','boards-paste-hint','📋 Ctrl+V here to send copied text or pictures'));
  wordInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendWord.click()}});
  imageFile.addEventListener('change',async()=>{
    const file=imageFile.files?.[0];imageFile.value='';
    if(file)await sendImageFile(file);
  });
  const newSendId=()=>{try{return crypto.randomUUID()}catch(_){return 's'+Date.now().toString(36)+Math.random().toString(36).slice(2,10)}};
  async function sendImageFile(file,extra={}){
    if(!/^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type)||file.size>8*1024*1024){B.fail('Please choose a JPG, PNG, WebP or GIF smaller than 8 MB.');return}
    sendImage.disabled=true;activityLabel.textContent='Preparing picture…';
    try{
      const data=await pictureData(file);
      if(!data)throw Error('Picture is too large to send to the class. Try a simpler or smaller image.');
      sendActivity({kind:'image',data,id:newSendId(),subject:extra.subject,important:extra.important===true},{confirmed:extra.confirmed===true});
    }catch(e){B.fail(e.message||'Could not load that picture.')}
    finally{sendImage.disabled=false;updateActivityLabel()}
  }

  function pictureData(file,limit){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),img=new Image();
      img.onload=()=>{
        URL.revokeObjectURL(url);
        try{
          // Sending a reduced picture avoids high network usage for a class of 12.
          // All boards have the same fixed 16:9 coordinates.
          const c=document.createElement('canvas');c.width=1200;c.height=675;
          const ctx=c.getContext('2d');
          function draw(){
            ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
            const scale=Math.min(c.width/img.width,c.height/img.height);
            const w=img.width*scale,h=img.height*scale;
            ctx.drawImage(img,(c.width-w)/2,(c.height-h)/2,w,h);
          }
          draw();let data=c.toDataURL('image/jpeg',0.76);
          const most=limit||MAX_ACTIVITY_IMAGE;
          if(data.length>most){
            c.width=900;c.height=506;draw();data=c.toDataURL('image/jpeg',0.55);
          }
          // Sending several pages: keep stepping down until it fits.
          for(const [width,height,quality] of limit?[[800,450,0.5],[640,360,0.45],[640,360,0.35]]:[]){
            if(data.length<=most)break;
            c.width=width;c.height=height;draw();data=c.toDataURL('image/jpeg',quality);
          }
          resolve(data.length<=most?data:null);
        }catch(e){reject(e)}
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('This image could not be opened.'))};
      img.src=url;
    });
  }
  function updateActivityLabel(){
    activityLabel.textContent=classPages?'Pages sent: '+classPages.length+' page'+(classPages.length===1?'':'s'):activity?.kind==='tiles'?'Hebrew tiles sent: '+activity.tiles.length+' tile'+(activity.tiles.length===1?'':'s'):activity?.kind==='word'?'Showing: '+activity.text:activity?.kind==='image'?'Coloring page sent to all students':'Boards are blank now';
  }

  // Focus bar: one student large.
  const focusBar=el('div','boards-bar'),who=el('strong','boards-title'),drawGroup=el('span','boards-group');focusBar.hidden=true;
  const focusBlock=button('','',()=>{const m=focusMember();if(m)toggleBlock(m)});
  focusBar.append(button('◀ Back to gallery','Back to all students (sharing continues)',()=>setFocus(null)),who,focusBlock,drawGroup);
  const focus=el('div','boards-focus'),surface=el('div','board-fit'),canvas=el('canvas');focus.hidden=true;
  canvas.setAttribute('aria-label','Student board. Your marks appear on the student’s screen.');
  surface.appendChild(canvas);
  const screenBox=el('div','board-screen-large'),screenVideo=el('video'),screenNote=el('p','board-panel-text');
  screenVideo.muted=true;screenVideo.autoplay=true;screenVideo.playsInline=true;screenBox.append(screenVideo,screenNote);
  const pausedBox=el('div','board-panel');pausedBox.append(el('p','board-panel-text','⏸ Paused'),el('p','board-panel-note','This student is paused. Click ✅ Allow to turn their board or screen back on.'));
  focus.append(surface,screenBox,pausedBox);
  // Point and draw on the student's screen that is open large (screen-annotate.js). He sees the marks on his own screen.
  const screenInk=window.ClassPointerScreenMarks?.attach(screenBox,screenVideo,()=>{
    const m=focusMember();
    if(!m||!on||suspended||mode!=='screens'||isBlocked(m)||excluded(m,'screens'))return null;
    return{id:m.studentId||personId(m)||m.id,name:m.name,members:[m]};
  })||null;
  const tools=makeTools(drawGroup,COLORS[2],st=>{drawer?.cancel();surface.classList.toggle('erasing',st.tool==='eraser');surface.classList.toggle('moving',st.tool==='move')});
  drawGroup.append(el('span','boards-spacer'),
    button('↶ Undo','Undo my last mark on this board',()=>{const b=focusBoard();if(!b)return;const mine=b.strokes.filter(s=>s.by==='teacher');const last=mine[mine.length-1];if(last)act({type:'board-remove',ids:[last.id]})}),
    button('🧽 Clear mine','Erase only my marks on this board',()=>act({type:'board-clear'})),
    button('🗑 Clear board','Erase this whole board, including the student’s work',()=>{const m=focusMember();if(m&&confirm('Erase '+m.name+'’s whole board?'))act({type:'board-clear',all:true})},'danger'));

  // The teacher can look at any page of the student's board (it follows the page the student is on until a page is chosen).
  const focusPages=pageStrip({canEdit:false,set:()=>focusBoard(),visible:()=>mode==='boards'&&!!focusMember()&&!isBlocked(focusMember()),
    go:id=>{const set=focusBoard();if(set){set.viewId=id;drawer?.cancel();if(focusId)dirty(focusId)}}});
  focusBar.append(focusPages.root);
  const grid=el('div','boards-grid'),empty=el('p','boards-empty','No students have joined yet. Their tiles appear here as they join.');
  // Screens mode: who is in the class but has not started sharing yet (live; see renderWaiting).
  const waiting=el('div','boards-waiting');waiting.hidden=true;waiting.setAttribute('role','status');waiting.setAttribute('aria-live','polite');
  view.append(gridBar,gridPermissions,waiting,activityBar,focusBar,focusPages.panel,grid,empty,focus);stage.appendChild(view);shield(view);

  // Include students verified by the background activity connection without
  // sending them to a separate Pointer page. Choose one tab per student.
  const admitted=()=>{
    const joined=Array.from(B.members().values()).filter(m=>m.admitted);
    const seen=new Set(joined.map(m=>m.studentId||m.name.toLocaleLowerCase()));
    const remote=Array.from(B.presence?.().values()||[]).filter(m=>m.admitted&&m.connection?.open)
      .sort((a,b)=>Number(a.activity==='Screen sharing window')-Number(b.activity==='Screen sharing window')||b.connectedAt-a.connectedAt);
    for(const m of remote){const key=m.studentId||m.name.toLocaleLowerCase();if(!seen.has(key)){seen.add(key);joined.push(m)}}
    return joined;
  };
  // A board belongs to a student name, so a student who refreshes or rejoins gets his board (and block) back.
  function keyFor(m){
    if(!m.boardKey){const base='name:'+String(m.name||'student').toLowerCase();m.boardKey=admitted().some(o=>o!==m&&o.boardKey===base)?base+'#'+m.id:base}
    return m.boardKey;
  }
  const groupsOn=()=>!!Groups&&gstate.groups.length>0;
  const personKeyOf=m=>personId(m)||keyFor(m);
  const groupIdOf=m=>groupsOn()?Groups.groupOf(gstate,personKeyOf(m)):'';
  const groupNameOf=gid=>Groups?.groupById(gstate,gid)?.name||'Group';
  // The board a student draws on: their group's board, or their own.
  const boardKeyOf=m=>{const gid=groupIdOf(m);return gid?'group:'+gid:keyFor(m)};
  function boardFor(m){const key=boardKeyOf(m);let b=boards.get(key);if(!b){b=emptyBoard();boards.set(key,b)}return b}
  const isBlocked=m=>{const gid=groupIdOf(m);return blocked.has(keyFor(m))||(!!gid&&blocked.has('group:'+gid))};
  // Everyone who shares this student's board (just the student when there is no group), who may still take part.
  function audience(m){
    const gid=groupIdOf(m);
    if(!gid)return[m];
    return admitted().filter(x=>groupIdOf(x)===gid&&!excluded(x,'boards')&&!isBlocked(x));
  }
  const sendBoard=(m,message)=>{for(const x of audience(m))B.send(x.connection,message)};
  // A tile (and the large view) stands for one student, or for one whole group ("g:" + the group's id).
  const unitIdOf=m=>mode==='boards'&&groupIdOf(m)?'g:'+groupIdOf(m):m.id;
  function repOf(id){
    if(typeof id==='string'&&id.startsWith('g:')){const gid=id.slice(2);return admitted().find(m=>groupIdOf(m)===gid)||null}
    return admitted().find(m=>m.id===id)||null;
  }
  // What the teacher's page may pass on from a member of a group: it is checked against the board it is now on, marked with
  // the member's code, and a member can only change their own lines. Anything else is dropped (null).
  function groupOp(set,op,code){
    if(!op||typeof op.type!=='string'||!code)return null;
    const page=op.pg===undefined?set.pages[set.at]:set.pages.find(p=>p.id===op.pg);
    const mineOf=ids=>(Array.isArray(ids)?ids:[]).filter(id=>{const line=page?.strokes.find(x=>x.id===id);return !!line&&line.by==='student'&&(!line.who||line.who===code)});
    switch(op.type){
      case 'board-add':case 'board-draft':
        return{...op,stroke:op.stroke&&typeof op.stroke==='object'?{...op.stroke,who:code}:op.stroke};
      case 'board-move':{
        const line=page?.strokes.find(x=>x.by==='student'&&x.id===op.id);
        return line&&(!line.who||line.who===code)?op:null;
      }
      case 'board-remove':{const ids=mineOf(op.ids);return ids.length?{...op,ids}:null}
      // Layers: a member orders only their own lines.
      case 'board-order':{const ids=mineOf(op.ids);return ids.length>1?{...op,ids}:null}
      case 'board-clear':{
        const ids=(page?.strokes||[]).filter(x=>x.by==='student'&&(!x.who||x.who===code)).map(x=>x.id);
        return ids.length?{type:'board-remove',...(op.pg!==undefined?{pg:op.pg}:{}),ids}:null;
      }
      case 'board-text':case 'board-tile':case 'board-page-add':case 'board-page-remove':case 'board-page-move':case 'board-page-at':return op;
      default:return null;
    }
  }
  function relayToGroup(m,op){
    // Each member moves between pages on their own, so a page change of one is not copied to the others.
    if(op.type==='board-page-at')return;
    const message={type:'board-peer',op};
    for(const x of audience(m))if(x!==m)B.send(x.connection,message);
  }
  const focusMember=()=>focusId?repOf(focusId):null;
  const focusBoard=()=>{const m=focusMember();return m?boardFor(m):null};
  const focusWord=wordEditor(focusBar,()=>focusBoard(),text=>act({type:'board-text',text}),tools);
  // Paste and Copy on the one board that is open large. What the teacher pastes goes to that student.
  const focusClip=clipboardTools(focusBar,{by:'teacher',priority:2,tools,key:()=>focusId,board:()=>focusBoard(),act:op=>act(op),point:()=>drawer?.point(),
    open:()=>{const m=focusMember();return on&&!suspended&&!view.hidden&&mode==='boards'&&!!m&&!isBlocked(m)}});
  pictureLoaded=()=>dirtyAll();
  function closeScreen(m){const c=m.screenCall;m.screenCall=null;m.screenStream=null;try{c?.close()}catch(_){}if(c)window.ClassPointerScreenMarks?.clearFor(m.studentId||personId(m)||m.id)}
  function sendMode(m){
    if(!on||suspended||excluded(m,mode)){if(!on||excluded(m,mode))closeScreen(m);B.send(m.connection,{type:'board-mode',on:false});return}
    const paused=isBlocked(m);if(paused||mode!=='screens')closeScreen(m);
    const message={type:'board-mode',on:true,mode,blocked:paused};
    if(mode==='boards'){message.activity=activity;if(!paused){
      const b=boardFor(m);clearDrafts(b);message.strokes=b.strokes;message.text=b.text;message.tiles=b.tiles;if(b.box)message.box=b.box;
      const gid=groupIdOf(m);
      if(gid){
        const code=Groups.codeOf(gstate,personKeyOf(m));
        if(code)message.group={id:gid,name:groupNameOf(gid),me:code,members:Groups.membersOf(gstate,gid).map(k=>gstate.assign[k].n||'').filter(Boolean).slice(0,12)};
      }
      // More than one page, a page that is not the first one, or pictures sent as pages: the whole list goes along.
      if(Pages&&(b.pages.length>1||b.pages[0].id!==FIRST_PAGE||b.pages[0].bg)){
        message.pages=b.pages.map(p=>({id:p.id,strokes:p.strokes,text:p.text,tiles:p.tiles,...(p.bg?{bg:p.bg}:{}),...(p.box?{box:p.box}:{})}));message.at=b.curId;
        if(classPages?.send&&b.pages.every(p=>p.bg))message.send=classPages.send;
      }
    }}
    B.send(m.connection,message);
  }

  // ---------- Painting (only tiles that changed, once per frame) ----------
  const dirtySet=new Set();let frame=0;
  // `id` may be a student's id: on a group board it is the group's tile that has to be painted.
  function dirty(id){const m=typeof id==='string'&&!id.startsWith('g:')?admitted().find(entry=>entry.id===id):null;dirtySet.add(m?unitIdOf(m):id);if(!frame)frame=requestAnimationFrame(flush)}
  function dirtyAll(){for(const id of tiles.keys())dirtySet.add(id);if(focusId)dirtySet.add(focusId);if(!frame)frame=requestAnimationFrame(flush)}
  function setVideo(video,stream){if(video.srcObject!==stream){video.srcObject=stream||null;if(stream)video.play().catch(()=>{})}}
  // A student's live screen. A boy who joined Pointer shares by a direct call (m.screenStream). A boy sharing from
  // Shorashim or another activity is not joined to Pointer: his verified screen is held by activity-screen-teacher.js.
  function streamOf(m){
    if(m.screenStream)return m.screenStream;
    const shares=window.ClassPointerActivityShares;if(!shares?.streamFor)return null;
    const id=personId(m);
    return (id&&shares.streamFor(id))||(m.studentId&&shares.streamFor(m.studentId))||null;
  }
  // The student's share ended by itself and he has not resumed yet: his last picture is shown, but labelled.
  function stoppedOf(m){
    if(m.screenStream)return false;
    const shares=window.ClassPointerActivityShares;if(!shares?.stopped)return false;
    const id=personId(m);
    return !!((id&&shares.stopped(id))||(m.studentId&&shares.stopped(m.studentId)));
  }
  function flush(){
    frame=0;
    if(!view.hidden)for(const id of dirtySet){
      const m=repOf(id);if(!m)continue;
      const disabled=excluded(m,mode),paused=isBlocked(m)||disabled,screens=mode==='screens',tile=tiles.get(id),live=screens?streamOf(m):null;
      if(tile&&!grid.hidden){
        tile.node.classList.toggle('blocked',paused);tile.node.classList.toggle('screen',screens);
        tile.block.textContent=paused?'✅':'🚫';tile.block.title=(paused?'Allow ':'Pause ')+m.name;tile.block.setAttribute('aria-label',tile.block.title);
        tile.note.textContent=disabled?'Not selected for '+(screens?'screen sharing':'whiteboard'):paused?'⏸ Paused':screens&&!live?'Waiting for their screen…':screens&&stoppedOf(m)?'⏸ Sharing stopped. Waiting for them to resume…':'';
        tile.canvas.hidden=screens;tile.video.hidden=!screens||paused||!live;
        setVideo(tile.video,screens&&!paused?live:null);
        if(!screens){const b=boardFor(m);paint(tile.canvas,b,null);tile.node.classList.toggle('drawing',!paused&&!!b.drafts.student)}else tile.node.classList.remove('drawing');
      }
      if(id===focusId){
        focusBlock.textContent=paused?'✅ Allow':'🚫 Pause';focusBlock.title=(paused?'Allow ':'Pause ')+nameOf(m);
        drawGroup.hidden=screens||paused;surface.hidden=screens||paused;screenBox.hidden=!screens||paused;pausedBox.hidden=!paused;
        focusWord.update();focusWord.root.hidden=screens||paused||activity?.kind!=='word';
        focusClip.root.hidden=screens||paused||!Clip;focusClip.update();focusPages.update();
        if(screens&&!paused){const stopped=!!live&&stoppedOf(m);setVideo(screenVideo,live);screenVideo.hidden=!live;screenNote.hidden=!!live&&!stopped;screenNote.textContent=stopped?'⏸ '+m.name+' stopped sharing. Waiting for them to resume…':'Waiting for '+m.name+' to share their screen…'}
        else setVideo(screenVideo,null);
        screenInk?.refresh();
        if(!surface.hidden){fit(focus,surface);paint(canvas,boardFor(m),drawer?.draft())}
      }
    }
    dirtySet.clear();
  }

  // ---------- Grid: one tile per student, as large as the lesson area allows ----------
  function makeTile(unit){
    const node=el('div','board-tile'),c=el('canvas'),v=el('video'),note=el('span','board-note'),label=el('span','board-name',unit.name);
    const tile={node,canvas:c,video:v,note,block:null,label,unit};
    node.tabIndex=0;node.setAttribute('role','button');node.title='Open '+unit.name+'’s tile large';
    v.muted=true;v.autoplay=true;v.playsInline=true;v.hidden=true;
    const block=button('🚫','Pause '+unit.name,event=>{event.stopPropagation();toggleBlock(tile.unit.rep)},'board-block');
    tile.block=block;
    node.append(c,v,note,label,block);
    node.addEventListener('click',()=>setFocus(tile.unit.id));
    node.addEventListener('keydown',event=>{if(event.target===node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setFocus(tile.unit.id)}});
    return tile;
  }
  // The tiles of the gallery: one for each student, or (boards, with groups) one for each group and one for each student
  // who is in no group. `rep` is the student who stands for the tile when something has to be sent or looked up.
  function unitsOf(list){
    if(mode!=='boards'||!groupsOn())return list.map(m=>({id:m.id,rep:m,name:m.name,group:''}));
    const units=[],byGroup=new Map();
    for(const m of list){
      const gid=groupIdOf(m);
      if(!gid){units.push({id:m.id,rep:m,name:m.name,group:''});continue}
      let unit=byGroup.get(gid);
      if(!unit){unit={id:'g:'+gid,rep:m,name:'',group:gid,members:[]};byGroup.set(gid,unit);units.push(unit)}
      unit.members.push(m.name);
    }
    for(const unit of byGroup.values())unit.name='\uD83D\uDC65 '+groupNameOf(unit.group)+' · '+unit.members.join(', ');
    return units;
  }
  // "Who has not started sharing?" Every boy on the class roster who may share his screen is either sharing (live
  // stream) or listed here. Boys who are connected to the class show in orange; boys not connected show in grey.
  let waitingKey='';
  function renderWaiting(){
    if(!on||mode!=='screens'||focusId||view.hidden){if(!waiting.hidden){waiting.hidden=true;waitingKey=''}return}
    const present=admitted(),people=[];
    if(classStudents.length){
      for(const person of classStudents){
        const m=present.find(entry=>personId(entry)===person.id);
        people.push({name:person.name,member:m||null,off:denied.screens.has(person.id)});
      }
    }else for(const m of present)people.push({name:m.name,member:m,off:excluded(m,'screens')});
    const eligible=people.filter(p=>!p.off),sharing=eligible.filter(p=>p.member&&streamOf(p.member)),notYet=eligible.filter(p=>!(p.member&&streamOf(p.member)));
    const key=JSON.stringify([sharing.length,notYet.map(p=>[p.name,!!p.member,!!(p.member&&isBlocked(p.member))])]);
    if(key===waitingKey&&!waiting.hidden)return;
    waitingKey=key;
    if(!eligible.length){waiting.hidden=true;return}
    waiting.hidden=false;waiting.classList.toggle('all-sharing',!notYet.length);
    const head=el('div','boards-waiting-head');
    head.append(el('strong',null,notYet.length?'⏳ '+notYet.length+' not sharing yet':'✅ Everyone is sharing'),
      el('span','boards-waiting-count',sharing.length+' of '+eligible.length+' sharing'));
    // Tell a new teacher what to do next.
    head.append(el('span','boards-waiting-tip',sharing.length?'👆 Click a screen to open it large. There you can point or draw on it.':'Each student clicks the blue Share My Screen button on their computer and chooses Entire Screen.'));
    const chips=el('div','boards-waiting-list');
    for(const p of notYet){
      const here=!!p.member,paused=here&&isBlocked(p.member);
      const chip=el('span','boards-waiting-chip'+(here?' here':' away'),p.name+(paused?' (paused)':here?'':' (not connected)'));
      chip.title=paused?p.name+' is paused':here?p.name+' is in the class but has not started sharing':p.name+' is not connected to the class right now';
      chips.append(chip);
    }
    waiting.replaceChildren(head,chips);
  }
  function syncTiles(){
    const present=admitted();
    // Screen tiles exist only for streams that are actually live. One stream
    // therefore fills the available gallery; tiles shrink as more join.
    const people=mode==='screens'?present.filter(m=>!excluded(m,'screens')&&!!streamOf(m)):present.filter(m=>!excluded(m,'boards'));
    const list=unitsOf(people);
    const ids=new Set(list.map(u=>u.id));
    for(const [id,tile] of tiles)if(!ids.has(id)){tile.video.srcObject=null;tile.node.remove();tiles.delete(id)}
    for(const unit of list){
      let tile=tiles.get(unit.id);
      if(!tile){tile=makeTile(unit);grid.appendChild(tile.node);tiles.set(unit.id,tile);dirty(unit.id)}
      tile.unit=unit;
      if(tile.label.textContent!==unit.name){tile.label.textContent=unit.name;tile.node.title='Open '+unit.name+'’s tile large';dirty(unit.id)}
    }
    const paused=list.filter(u=>isBlocked(u.rep)).length,grouped=list.some(u=>u.group);
    count.textContent=list.length?list.length+(grouped?(list.length===1?' board':' boards'):list.length===1?(mode==='screens'?' screen':' whiteboard'):(mode==='screens'?' screens':' whiteboards'))+(paused?' · '+paused+' paused':''):'';
    empty.textContent=mode==='screens'?'Waiting for students to share their screens…':'Waiting for students to join their whiteboards…';
    if(focusId&&!ids.has(focusId)){setFocus(null);return}
    grid.hidden=!!focusId||!list.length;empty.hidden=!!focusId||!!list.length;
    renderWaiting();
    layoutGrid();
  }
  function layoutGrid(){
    const n=tiles.size;if(!n||grid.hidden||view.hidden)return;
    const cs=getComputedStyle(grid),gap=parseFloat(cs.columnGap)||10,pad=parseFloat(cs.paddingLeft)||10;
    const W=grid.clientWidth-pad*2,H=grid.clientHeight-pad*2;if(W<=0||H<=0)return;
    const key=n+'|'+W+'|'+H;if(key===gridSize)return;gridSize=key;
    let best={cols:1,w:0};
    for(let cols=1;cols<=n;cols++){
      const rows=Math.ceil(n/cols);let w=(W-gap*(cols-1))/cols,h=w/ASPECT;const maxH=(H-gap*(rows-1))/rows;
      if(h>maxH){h=maxH;w=h*ASPECT}
      if(w>best.w)best={cols,w};
    }
    const w=Math.max(60,Math.floor(best.w)),h=Math.floor(w/ASPECT);
    grid.style.gridTemplateColumns='repeat('+best.cols+','+w+'px)';
    for(const [id,tile] of tiles){tile.node.style.width=w+'px';tile.node.style.height=h+'px';dirty(id)}
  }
  function controls(){
    modeBoards.setAttribute('aria-pressed',String(mode==='boards'));modeScreens.setAttribute('aria-pressed',String(mode==='screens'));
    clearAll.hidden=mode!=='boards';activityBar.hidden=mode!=='boards'||!!focusId;
    groupsBtn.hidden=!Groups||mode!=='boards';saveGroupsBtn.hidden=!groupsOn()||mode!=='boards';
    updateActivityLabel();
  }
  // Is there anything on a student's board that a new send would erase? (Marks, answers, or pages they added.)
  function hasStudentWork(){
    return Array.from(boards.values()).some(set=>set.pages.length>1||set.pages.some(b=>b.strokes.length||(activity?.kind==='word'&&b.text&&JSON.stringify(b.text)!==JSON.stringify(defaultWord()))||(activity?.kind==='tiles'&&b.tiles&&JSON.stringify(b.tiles)!==JSON.stringify(Tiles.defaultState(activity)))));
  }
  // Pictures sent to every board as pages: pages=[{id,bg}] (bg = a small JPEG picture), info={id,subject,important}.
  // Each student gets every picture as the background of one page, with a private drawing layer on each, and keeps
  // their own copy in My files. Like any new activity it replaces what is on the boards, so the teacher is asked first.
  async function sendPages(pages,info={}){
    if(!Pages||!on||mode!=='boards')return false;
    const clean=[],seen=new Set(),given=Array.isArray(pages)?pages.slice(0,Pages.MAX_PAGES):[];
    for(const page of given){
      const bg=cleanBg(page?.bg);
      if(bg&&Pages.validId(page.id)&&!seen.has(page.id)){seen.add(page.id);clean.push({id:page.id,bg})}
    }
    if(!clean.length||clean.length!==given.length){B.status('Those pages could not be sent. Try again.');return false}
    if(hasStudentWork()&&info.confirmed!==true&&!confirm('This will erase the students\' current marks and pages and start the new pages. Continue?')){B.status('Nothing was sent. Students still have their marks.');return false}
    const subject=String(info.subject||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,40);
    const id=/^[A-Za-z0-9_-]{8,48}$/.test(String(info.id||''))?String(info.id):newSendId();
    boards.clear();chooseActivity(null,dirtyAll);
    classPages=clean;classPages.send={id,...(subject?{subject}:{}),...(info.important===true?{important:true}:{})};
    for(const m of admitted())sendMode(m);
    dirtyAll();updateActivityLabel();
    const here=admitted(),skipped=here.filter(m=>excluded(m,'boards')||isBlocked(m)),got=here.length-skipped.length;
    B.status('Sent '+clean.length+' page'+(clean.length===1?'':'s')+' to '+got+' of '+here.length+' student'+(here.length===1?'':'s')+'. '+(skipped.length?'Not sent to '+skipped.slice(0,5).map(m=>m.name).join(', ')+(skipped.length>5?' and more':'')+' (their whiteboard is paused or off).':'Each student gets their own copy in My files.'));
    return true;
  }
  // The same, from picture files (one PNG per page): each is made small enough that every student can also save a copy.
  async function sendPagesFiles(files,extra={}){
    if(!Pages||!files.length){return false}
    sendImage.disabled=true;activityLabel.textContent='Preparing '+files.length+' page'+(files.length===1?'':'s')+'…';
    try{
      // The student's saved copy must fit in their 3 MB file, so the pictures share about 2.4 MB between them.
      const budget=Math.max(60000,Math.min(PAGE_BG_MAX,Math.floor(2400000/files.length)));
      const pages=[];
      for(const file of files){
        const bg=await pictureData(file,budget);
        if(!bg)throw Error('A page is too detailed to send. Remove a big picture from it, or send fewer pages.');
        pages.push({id:Pages.newId(),bg});
      }
      return await sendPages(pages,{id:newSendId(),subject:extra.subject,important:extra.important===true,confirmed:extra.confirmed===true});
    }catch(e){B.fail(e.message||'Could not prepare the pages.');return false}
    finally{sendImage.disabled=false;updateActivityLabel()}
  }
  // ---------- The teacher's whiteboard as editable pieces ----------
  // Each mark of the whiteboard (words, pictures, shapes, lines) becomes a board mark of the teacher's on every student's board, so
  // the student can select, move and resize it. Anything that cannot travel as a piece (too big, too many) is painted into the page
  // background instead, so nothing is lost.
  const MARK_TOOLS={pen:'pen',pencil:'pen',crayon:'pen',highlight:'highlight',underline:'line',box:'rect',line:'line','pen-arrow':'arrow',arrow:'arrow',rectangle:'rect',rect:'rect',ellipse:'ellipse',triangle:'triangle',text:'text',picture:'rect'};
  let markSeq=0;
  const nearestOf=(list,value)=>list.reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a);
  function nearestColor(hex){
    const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||''));if(!m)return COLORS[0];
    const n=parseInt(m[1],16),r=n>>16,g=(n>>8)&255,b=n&255;let best=COLORS[0],bd=1e9;
    for(const c of COLORS){const k=parseInt(c.slice(1),16),d=(r-(k>>16))**2+(g-((k>>8)&255))**2+(b-(k&255))**2;if(d<bd){bd=d;best=c}}
    return best;
  }
  const clamp01=v=>Math.min(1,Math.max(0,v));
  let measureCtx=null;
  // The words of a teacher's text box, broken into lines the way they sit in the box, and the box's top-left corner as one point.
  function wordsLayout(raw){
    const [a,b]=raw.points,size=Math.min(.08,Math.max(.01,Number(raw.size)||.04));
    measureCtx=measureCtx||document.createElement('canvas').getContext('2d');
    measureCtx.font='600 '+(size*1000)+'px Arial, "Segoe UI", sans-serif';
    const left=Math.min(a.x,b?b.x:a.x),right=Math.max(a.x,b?b.x:a.x),top=Math.min(a.y,b?b.y:a.y),boxW=Math.max(.05,right-left)*1000;
    const lines=[];
    for(const para of String(raw.text||'').split('\n')){
      let line='';
      for(const word of para.split(/\s+/).filter(Boolean)){
        const next=line?line+' '+word:word;
        if(line&&measureCtx.measureText(next).width>boxW){lines.push(line);line=word}else line=next;
      }
      lines.push(line);
    }
    const widest=Math.max(0,...lines.map(line=>measureCtx.measureText(line).width))/1000,align=raw.align==='center'||raw.align==='right'?raw.align:'left';
    const x=align==='right'?right-widest:align==='center'?left+((right-left)-widest)/2:left;
    return{lines,size,align,x:clamp01(x),y:clamp01(top)};
  }
  function markToBoardMark(raw){
    const tool=MARK_TOOLS[raw?.tool||'pen'];
    if(!raw||!tool||!Array.isArray(raw.points)||!raw.points.length||!raw.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return null;
    const id='t'+Date.now().toString(36)+'-'+(++markSeq).toString(36),color=nearestColor(raw.color);
    if(tool==='text'){
      const w=wordsLayout(raw);
      if(!w.lines.length||w.lines.length>8)return null;
      const text=w.lines.join('\n');
      return cleanStroke({id,tool:'text',color,size:w.size,points:[{x:w.x,y:w.y}],text,...(w.align!=='left'?{align:w.align}:{})});
    }
    if(raw.tool==='picture'){
      if(typeof raw.image!=='string'||raw.points.length!==2||!raw.points.every(validPoint))return null;
      const [a,b]=raw.points;
      return cleanStroke({id,tool:'rect',color:COLORS[0],size:.006,points:[{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y)},{x:Math.max(a.x,b.x),y:Math.max(a.y,b.y)}],image:raw.image});
    }
    let points=raw.points.slice(0,MAX_POINTS).map(p=>({x:clamp01(p.x),y:clamp01(p.y)}));
    if(tool!=='pen'&&tool!=='highlight')points=[points[0],points[points.length-1]];
    const size=nearestOf(tool==='pen'?SIZE_VALUES:ITEM_SIZES,Number(raw.size)||.006);
    return cleanStroke({id,tool:tool==='pen'?null:tool,color,size,points,...(raw.fill===true?{fill:true}:{})});
  }
  async function sendPieces(pieces,info={}){
    if(!Pages||!on||mode!=='boards'||!Array.isArray(pieces)||!pieces.length)return false;
    const clean=[];
    for(const piece of pieces.slice(0,Pages.MAX_PAGES)){
      const strokes=[],left=[];let images=0;
      for(const raw of piece.strokes||[]){
        const s=strokes.length<MAX_STROKES-1?markToBoardMark(raw):null;
        if(s&&(!s.image||images<MAX_IMAGES)){if(s.image)images++;strokes.push(s)}else left.push(raw);
      }
      let bg='';
      if(left.length||piece.hasBackground){
        try{bg=cleanBg(await piece.render(left,PAGE_BG_MAX-1000))}catch(_){bg=''}
        if(!bg){B.status('A page is too detailed to send as pieces. Try "Send as a locked picture".');return false}
      }
      clean.push({id:Pages.newId(),strokes,bg});
    }
    if(clean.length===1)clean[0].id=FIRST_PAGE;
    if(hasStudentWork()&&info.confirmed!==true&&!confirm('This will erase the students\' current marks and pages and start the new board. Continue?')){B.status('Nothing was sent. Students still have their marks.');return false}
    boards.clear();chooseActivity(null,dirtyAll);
    classPages=clean;
    for(const m of admitted())sendMode(m);
    dirtyAll();updateActivityLabel();
    const here=admitted(),skipped=here.filter(m=>excluded(m,'boards')||isBlocked(m)),got=here.length-skipped.length;
    B.status('Sent the whiteboard to '+got+' of '+here.length+' student'+(here.length===1?'':'s')+' as pieces they can select, move and resize.'+(skipped.length?' Not sent to '+skipped.slice(0,5).map(m=>m.name).join(', ')+' (their whiteboard is paused or off).':''));
    return true;
  }
  function sendActivity(next,opts={}){
    if(!on||mode!=='boards')return;
    const item=cleanActivity(next);
    if(next&&!item){B.fail('Please enter a word or choose a valid picture.');return}
    const hasWork=hasStudentWork();
    if(hasWork&&opts.confirmed!==true&&!confirm('This will erase the students\' current marks and start a new activity. Continue?')){B.status('Nothing was sent. Students still have their marks.');return}
    classPages=null;boards.clear();chooseActivity(item,dirtyAll);
    for(const m of admitted())sendMode(m);
    dirtyAll();updateActivityLabel();
    if(item?.kind==='image'){
      // How many boards got it, and who did not (a paused or turned-off whiteboard gets nothing).
      const here=admitted(),skipped=here.filter(m=>excluded(m,'boards')||isBlocked(m)),got=here.length-skipped.length;
      B.status('Sent to '+got+' of '+here.length+' student'+(here.length===1?'':'s')+'. '+(skipped.length?'Not sent to '+skipped.slice(0,5).map(m=>m.name).join(', ')+(skipped.length>5?' and more':'')+' (their whiteboard is paused or off).':'Each student gets their own copy in My files.'));
    }else B.status(item?.kind==='tiles'?'The tiles and word boxes are on every student\'s board. Click a student\'s board to watch them move the words live.':item?.kind==='word'?'The word is on every student\'s board. Their answers appear live.':'All boards are blank.');
  }
  function setFocus(id){
    drawer?.cancel();focusId=id&&repOf(id)?id:null;const m=focusMember();
    focusBar.hidden=!m;gridBar.hidden=!!m;activityBar.hidden=!!m||mode!=='boards';focus.hidden=!m;focusWord.root.hidden=!m||mode!=='boards'||activity?.kind!=='word';if(m)who.textContent=mode==='boards'&&groupIdOf(m)?groupNameOf(groupIdOf(m))+' · '+groupMemberNames(groupIdOf(m)):m.name+(mode==='screens'?'’s screen':'’s board');
    if(!m)setVideo(screenVideo,null);
    screenInk?.refresh();
    controls();gridSize='';syncTiles();if(m)dirty(focusId);else dirtyAll();
    focusPages.update();syncAnnotate();
  }
  function setOn(next){
    if(next&&!B.started())return;
    on=next;suspended=false;if(!next)++workspaceRevision;drawer?.cancel();focusId=null;gridSize='';
    screenPermissionEnabled=next?(screenPermissionEnabled||mode==='screens'):false;
    for(const m of admitted())sendMode(m);
    view.hidden=!on;screenInk?.refresh();syncAnnotate();
    if(toggle){toggle.setAttribute('aria-pressed',String(on));toggle.textContent=on?'✕ Close student screens':'🖥 Student Screens'}
    // Only an explicit close disables capture; selecting Whiteboards must not.
    if(!on||mode==='screens')window.ClassPointerDashboard?.setStudentScreenSharing(screenPermissionEnabled).catch(error=>B.status('Could not update screen sharing permission: '+error.message));
    document.dispatchEvent(new Event('classpointer:sharing-state'));
    if(on){stage.dispatchEvent(new PointerEvent('pointerleave'));setFocus(null);B.status(mode==='screens'?'Students were asked to share their screens. Their screens appear in the tiles.':'Student whiteboards are open. Click a board to see it large and write on it. Use 🖥 Screens to see students’ screens instead.')}
    else B.status('Student boards closed. Everyone is back to the lesson. Whiteboards are kept until the class ends.');
  }
  function setMode(next){
    if(next===mode)return;
    mode=next;drawer?.cancel();
    if(mode==='screens'){
      screenPermissionEnabled=true;
      window.ClassPointerDashboard?.setStudentScreenSharing(true).catch(error=>B.status('Could not update screen sharing permission: '+error.message));
    }
    document.dispatchEvent(new Event('classpointer:sharing-state'));
    for(const m of admitted())sendMode(m);
    setFocus(focusId);
    B.status(mode==='screens'?'Students were asked to share their screens. Click a screen to open it large; there you can point or draw on it.':'Students are back on their whiteboards.');
  }
  // Teacher-facing sharing switch. Session availability and sharing permission are
  // separate: closing the gallery is no longer necessary to revoke permission.
  window.ClassPointerSharing={
    enabled:()=>screenPermissionEnabled,
    enable(){
      if(!B.started())return false;
      if(!on)setOn(true);
      if(mode!=='screens')setMode('screens');
      return true;
    },
    disable(){
      if(on&&mode==='screens')setOn(false);
      else{
        screenPermissionEnabled=false;
        window.ClassPointerDashboard?.setStudentScreenSharing(false)?.catch(error=>B.status('Could not disable sharing: '+error.message));
        document.dispatchEvent(new Event('classpointer:sharing-state'));
      }
      return true;
    }
  };
  async function sendEveryone(destination){
    if(!B.started()){B.fail('Wait for your classroom to finish opening, then try again.');return}
    const revision=++workspaceRevision;
    const buttons=[sendScreens,sendBoards,dockScreens,dockBoards];
    buttons.forEach(b=>b.disabled=true);
    try{
      // Publish the right mode without navigating students out of their activities.
      // Students already connected receive board-mode immediately; new arrivals
      // receive it from studentJoined() once they enter the same class.
      if(!on){mode=destination;setOn(true)}
      else if(mode!==destination)setMode(destination);
      suspended=false;view.hidden=false;gridSize='';setFocus(null);
      for(const m of admitted())sendMode(m);
      document.dispatchEvent(new Event('classpointer:sharing-state'));
      const dashboard=window.ClassPointerDashboard;
      if(!dashboard?.requestStudentDestination)throw Error('Classroom broadcast is not ready.');
      await loadPermissionsRoster();
      await permissionsWrite;
      // If another workspace was selected while roster/policy was loading,
      // do not publish an obsolete request over the user's latest selection.
      if(revision!==workspaceRevision)return;
      await dashboard.requestStudentDestination(destination,policy());
      B.status(destination==='screens'
        ?'Every student now sees a Share My Screen button. Their screens appear here. Click My screen to bring them back to your lesson.'
        :'Every student now has their own whiteboard. Their work appears here. Click My screen to bring them back to your lesson.');
    }catch(error){
      B.fail('Could not send the class: '+(error?.message||'Please try again.'));
    }finally{buttons.forEach(b=>b.disabled=false)}
  }
  function hideWorkspace(){
    ++workspaceRevision;
    if(!on||suspended)return;
    suspended=true;view.hidden=true;focusId=null;gridSize='';syncAnnotate();
    setVideo(screenVideo,null);screenInk?.refresh();
    for(const tile of tiles.values())setVideo(tile.video,null);
    // Hide student whiteboards so My Screen can appear, without revoking any
    // student's ongoing screen capture or erasing board contents.
    for(const m of admitted())B.send(m.connection,{type:'board-mode',on:false});
    document.dispatchEvent(new Event('classpointer:sharing-state'));
    B.status('Back to My screen. Student screens and whiteboards are kept; open their tab any time.');
  }
  function groupMemberNames(gid){return admitted().filter(x=>groupIdOf(x)===gid).map(x=>x.name).join(', ')}
  const nameOf=m=>mode==='boards'&&groupIdOf(m)?groupNameOf(groupIdOf(m)):m.name;
  function toggleBlock(m){
    // On a group board the pause is the group's: everyone in the group is paused or allowed together.
    const gid=mode==='boards'?groupIdOf(m):'';
    const key=gid?'group:'+gid:keyFor(m);if(blocked.has(key))blocked.delete(key);else blocked.add(key);
    drawer?.cancel();for(const x of gid?admitted().filter(y=>groupIdOf(y)===gid):[m])sendMode(x);syncTiles();dirty(m.id);syncAnnotate();
    // A student sharing from Shorashim or another activity is not joined to Pointer, so hiding his video is not enough:
    // record the pause as a screen-sharing permission so his browser stops capturing and the teacher stops receiving.
    if(mode==='screens'){const person=personId(m);if(person)updatePermission(person,'screens',!blocked.has(key))}
    B.status(blocked.has(key)?nameOf(m)+' is paused.':nameOf(m)+' is allowed again.');
  }
  // The teacher writes on the board that is open large; the same change goes to that student.
  function act(op){const m=focusMember();if(!m||!on||mode!=='boards'||isBlocked(m))return;const set=boardFor(m),sent=pagedOp(set,op);if(applyTo(set,sent,'teacher'))sendBoard(m,sent);dirty(m.id)}
  drawer=attachDrawing(canvas,{by:'teacher',tools,enabled:()=>{const m=focusMember();return on&&mode==='boards'&&!!m&&!isBlocked(m)&&(!window.FTTAnnotate||tools.tool==='move')},board:()=>focusBoard()||emptyBoard(),apply:act,
    send:op=>{const m=focusMember();if(m&&on&&mode==='boards')sendBoard(m,pagedOp(boardFor(m),op))},redraw:()=>{if(focusId)dirty(focusId)}});

  // ---------- The shared drawing toolbar on the student board that is open large ----------
  // This is the same toolbar as on my main whiteboard (annotation-toolbar.js). Its marks become ordinary board lines
  // ("t" ids, by the teacher), so the student sees them live on his own whiteboard and they come back after he
  // refreshes. A shared screen gets the same tools from screen-annotate.js.
  const FA=window.FTTAnnotate;
  const boardOpen=()=>{const m=focusMember();return on&&!suspended&&!view.hidden&&mode==='boards'&&!focus.hidden&&!!m&&!isBlocked(m)};
  const boardInk=FA&&{id:'student-board',idPrefix:'t',autoOpen:true,defaultTool:'select',renders:true,arrange:true,pasteFromClipboard:()=>focusClip.paste(),maxItems:MAX_STROKES,maxPoints:MAX_POINTS,
    tools:['select','highlight','text','shape','eraser','pen'],hideUnused:true,
    toolLabels:{select:['🖱️','Select','Click any mark on this board, the student’s or yours, to pick it: drag to move it, drag a corner to resize it, click a color or a size. Click words again to type in them.',-1]},
    keys:{h:{tool:'highlight'},d:{tool:'pen'},e:{tool:'eraser'},u:'undo'},
    historyKey:()=>'board:'+(focusMember()?.studentId||focusId||''),
    label:()=>{const m=focusMember();return m?(groupIdOf(m)?'You are writing on the board of '+groupNameOf(groupIdOf(m))+'. They see it live.':'You are writing on '+m.name+'’s board. They see it live.'):''},
    rect:()=>{if(!boardOpen())return null;const r=canvas.getBoundingClientRect();return r.width&&r.height?r:null},
    // Every mark on the board: the student's too, so Select, move, resize, recolor, nudge and delete work on them.
    getItems:()=>focusBoard()?.strokes.slice()||[],
    setItems(list){if(boardOpen())syncTeacherBoardItems(focusBoard(),list,act)},
    // The teacher can move a student's tiles too (for example to show where a word goes).
    grab:{hit:p=>!!drawer?.tiles&&activity?.kind==='tiles'&&boardOpen()&&drawer.tiles.hit(p),down:p=>!!drawer?.tiles&&activity?.kind==='tiles'&&boardOpen()&&drawer.tiles.down(p),move:(p,f)=>drawer?.tiles?.move(p,f),up:p=>drawer?.tiles?.up(p),cancel:()=>drawer?.tiles?.cancel()},
    live(draft){
      const m=focusMember();if(!m||!boardOpen())return;
      const set=boardFor(m),op=pagedOp(set,{type:'board-draft',stroke:draft||null});
      applyTo(set,op,'teacher');sendBoard(m,op);dirty(m.id);
    }};
  // The grid of all the boards: nothing can be drawn there, so the toolbar and the drawing layer step aside
  // (a click always opens the board, whatever tool was picked) and the full toolbar comes back inside one board.
  const gridOpen=()=>on&&!suspended&&!view.hidden&&!focusId&&!grid.hidden;
  const gridSurface=FA&&{id:'student-grid',bare:true,rect:()=>{if(!gridOpen())return null;const r=grid.getBoundingClientRect();return r.width&&r.height?r:null},getItems:()=>[],setItems(){}};
  function syncAnnotate(){
    if(!boardInk)return;
    if(boardOpen())FA.push(boardInk);else FA.release(boardInk);
    if(gridOpen())FA.push(gridSurface);else FA.release(gridSurface);
  }
  // The old pen, eraser, color and size buttons are replaced by that toolbar (the Move button for a word stays).
  if(FA)for(const node of Array.from(drawGroup.children))if(!node.classList.contains('danger')&&!node.classList.contains('boards-spacer'))node.style.display='none';

  document.addEventListener('classpointer:send-to-whiteboards',()=>void sendEveryone('boards'));
  document.addEventListener('classpointer:send-to-screens',()=>void sendEveryone('screens'));
  // A boy sharing from Shorashim (or another activity) connected, changed or stopped: refresh the tiles and the large viewer.
  document.addEventListener('classpointer:activity-screens',()=>{if(on){syncTiles();dirtyAll()}});
  toggle?.addEventListener('click',()=>setOn(!on));
  setInterval(()=>{if(toggle)toggle.disabled=!on&&!B.started();if(on)syncTiles();syncAnnotate()},700);
  new ResizeObserver(()=>{if(!on)return;layoutGrid();if(focusId)dirty(focusId)}).observe(stage);
  controls();renderPermissions();void loadPermissionsRoster();

  // Read/write access for the teacher's Students table (teacher-dashboard.js).
  window.ClassPointerSharingPermissions={
    students:()=>(classStudents.length?classStudents:admitted().map(m=>({id:personId(m),name:m.name})).filter(m=>m.id)).map(p=>({id:p.id,name:p.name})),
    loaded:()=>classStudents.length>0,
    personId:m=>personId(m),
    allowed:(id,kind)=>!!id&&!denied[kind]?.has(id),
    set:(id,kind,on)=>{if(denied[kind])updatePermission(id,kind,!!on)},
    bulk:(kind,on)=>{if(denied[kind])bulkPermission(kind,!!on)},
    load:()=>loadPermissionsRoster()
  };
  window.ClassPointerBoards={
    // What the teacher is looking at, for the tabs above the lesson: null (My screen), 'screens' or 'boards'.
    workspace:()=>on&&!suspended&&!view.hidden?mode:null,
    // The regular Save (saved-work.js) saves a group board that is open large: is one open, and what is on it?
    groupBoardOpen:()=>!!openGroupId(),
    async openGroupBoardItem(){const gid=openGroupId();return gid?groupItem(Groups.groupById(gstate,gid)):null},
    // Groups, for the drawing toolbar (classroom-annotate.js): the gallery's own top bar is hidden on the teacher page, so the
    // toolbar carries the Groups button. `available` = student whiteboards are showing; `active` = there are groups.
    groups:{
      available:()=>!!Groups&&on&&!suspended&&!view.hidden&&mode==='boards',
      active:()=>groupsOn(),
      open:()=>openGroupsDialog(),
      save:()=>saveGroupBoards(),
      // The groups and who is in each (names only), so the whiteboard's student zones can be given to a whole group.
      list:()=>groupsOn()?gstate.groups.map(g=>({id:g.id,name:g.name,names:Groups.membersOf(gstate,g.id).map(key=>gstate.assign[key].n).filter(Boolean)})):[]
    },
    // A PNG picture of the student board that is open large.
    exportPng(){const board=focusBoard();return board&&mode==='boards'?boardPng(board):Promise.reject(Error('Open one student whiteboard first.'))},
    // Teacher: offer a picture (a PNG of a whiteboard) to every student whiteboard. It opens the usual
    // "Send to every whiteboard?" preview and sends nothing until the teacher confirms. Each student then has the
    // picture locked on their own board, with a private drawing layer of their own on top, so everyone gets a copy.
    async sendPictureToAll(blob,note,options={}){
      if(!B.started()){B.fail('Wait for your classroom to finish opening, then try again.');return false}
      if(!blob||!/^image\/(png|jpeg|webp)$/.test(blob.type||'')){B.fail('There is no whiteboard picture to send.');return false}
      if(!on||mode!=='boards'||suspended||view.hidden)await sendEveryone('boards');
      if(!on||mode!=='boards')return false;
      showPaste({kind:'image',file:blob,subject:options.subject||'',pieces:options.pieces||null,note:note||'Every student gets their own copy to draw on. What they draw stays on their own board.'});
      return true;
    },
    // Teacher: offer one picture per whiteboard page to every student whiteboard, as pages. Opens the same
    // "Send to every whiteboard?" preview and sends nothing until the teacher confirms.
    async sendPagesToAll(blobs,note,options={}){
      if(!Pages)return this.sendPictureToAll(blobs[0],note,options);
      if(!B.started()){B.fail('Wait for your classroom to finish opening, then try again.');return false}
      const files=Array.isArray(blobs)?blobs:[];
      if(!files.length||!files.every(blob=>blob&&/^image\/(png|jpeg|webp)$/.test(blob.type||''))){B.fail('There is no whiteboard picture to send.');return false}
      if(!on||mode!=='boards'||suspended||view.hidden)await sendEveryone('boards');
      if(!on||mode!=='boards')return false;
      showPaste({kind:'pages',files,subject:options.subject||'',pieces:options.pieces||null,note:note||'Every student gets their own copy of these pages to draw on. What they draw stays on their own board.'});
      return true;
    },
    sendPages,sendPieces,
    navigateWorkspace(destination){
      if(destination==='teach'){hideWorkspace();return true}
      if(destination!=='screens'&&destination!=='whiteboards')return false;
      if(!B.started())return false;
      void sendEveryone(destination==='screens'?'screens':'boards');
      return true;
    },
    fromStudent(m,message){
      // His own page reports that he stopped sharing from his sharing tab: take his screen tile away straight away.
      if(m.presence&&m.studentId&&message.type==='board-screen'&&message.sharing===false&&message.from==='share-tab'){window.ClassPointerActivityShares?.studentStopped?.(m.studentId);return}
      if(!on)return;
      if(m.presence&&admitted().find(entry=>entry.studentId===m.studentId)!==m)return;
      if(message.type==='board-screen'){if(message.sharing!==true){closeScreen(m);dirty(m.id)}return}
      if(mode!=='boards'||isBlocked(m)||excluded(m,'boards'))return;
      const set=boardFor(m);
      if(!groupIdOf(m)){if(applyTo(set,message,'student'))dirty(m.id);return}
      // A member of a group: checked, marked with their code, and shown to the whole group.
      const checked=groupOp(set,message,Groups.codeOf(gstate,personKeyOf(m)));
      if(checked&&applyTo(set,checked,'student')){dirty(m.id);relayToGroup(m,checked)}
    },
    // A student's screen arrives as a one-way media call (student → teacher). Only accepted in Screens mode.
    incomingCall(call){
      const m=admitted().find(item=>item.peerId===call.peer);
      if(!m||!on||mode!=='screens'||isBlocked(m)||excluded(m,'screens'))return false;
      closeScreen(m);m.screenCall=call;
      call.on('stream',incoming=>{if(m.screenCall!==call)return;m.screenStream=incoming;dirty(m.id)});
      const end=()=>{if(m.screenCall===call){m.screenCall=null;m.screenStream=null;dirty(m.id)}};
      call.on('close',end);call.on('error',end);
      call.answer();return true;
    },
    studentJoined(m){window.ClassPointerScreenMarks?.resend(m);clearDrafts(boardFor(m));renderPermissions();if(on){sendMode(m);syncTiles()}},
    studentLeft(m){closeScreen(m);clearDrafts(boards.get(boardKeyOf(m)));if(on)syncTiles()},
    endClass(){
      if(Groups){gstate=Groups.empty();saveGroups()}
      window.ClassPointerScreenMarks?.reset();drawer?.cancel();for(const m of B.members().values())closeScreen(m);
      // The enclosing classroom ends by deleting the entire Firebase session.
      // Do not send an asynchronous child update here: it could recreate an
      // orphan studentScreenSharing flag after the session is removed.
      classPages=null;boards.clear();blocked.clear();denied.screens.clear();denied.boards.clear();classStudents=[];permissionsLoad=null;renderPermissions();chooseActivity(null,dirtyAll);mode='screens';suspended=false;screenPermissionEnabled=false;++workspaceRevision;controls();
      for(const tile of tiles.values()){tile.video.srcObject=null;tile.node.remove()}tiles.clear();
      if(on){on=false;focusId=null;view.hidden=true}
      if(toggle){toggle.setAttribute('aria-pressed','false');toggle.textContent='🖥 Student Screens';toggle.disabled=true}
    }
  };

  // ---------- Shared whiteboard: a blank page in the lesson for everyone ----------
  $('openWhiteboard')?.addEventListener('click',async()=>{
    if(!window.ClassPointerPdf?.openSnapshot)return;
    if(on)setOn(false);
    // The board is made in the shape of the lesson area, so it fills it from side to side with nothing to scroll.
    const ratio=window.ClassPointerPdf.boardRatio?.()||9/16;
    const c=document.createElement('canvas');c.width=1600;c.height=Math.round(1600*ratio);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    try{
      const ok=await window.ClassPointerPdf.openSnapshot(c.toDataURL('image/jpeg',0.92),c.width,c.height,{name:'Whiteboard',label:'whiteboard',kind:'whiteboard',
        status:'Whiteboard open for everyone. Use ✒️ Pen to write. Students with Writing allowed can write too. Use the red Stop button when you are done.'});
      if(!ok)return;
      const tool=$('teacherTool'),color=$('teacherColor');
      if(tool.value!=='pen'){tool.value='pen';tool.dispatchEvent(new Event('change',{bubbles:true}))}
      if(color.value==='#ffcc00'){color.value='#1f2937';color.dispatchEvent(new Event('change',{bubbles:true}))}
    }catch(error){B.fail(error?.message||'Could not open the whiteboard.')}
  });
})();
