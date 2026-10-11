'use strict';
// Class Pointer whiteboards.
//  • Whiteboard (teacher button): a blank board shown to everyone. It reuses the webpage/PDF lesson mode,
//    so zoom, pointers, Pen, Highlight and student permissions all work as usual.
//  • Student boards (teacher button): every admitted student gets a private board. The teacher sees all of
//    them in a grid that resizes with the number of students, clicks one to see it large, and can write on it.
// Board lines travel over the existing PeerJS data connection as small "board-*" messages. Nothing is stored online.
// Both sides apply the same operations, so the teacher's copy and the student's copy stay identical. Who made a
// change ("student" or "teacher") always comes from the connection, never from the message itself.
(function(){
  const B=window.ClassPointerBridge;
  if(!B)return;
  const $=id=>document.getElementById(id),stage=$('stage'),isTeacher=B.isTeacher;
  const PALETTE=[['#1f2937','Black'],['#1d4ed8','Blue'],['#c62828','Red'],['#2e7d32','Green'],['#7b1fa2','Purple'],['#ef6c00','Orange']];
  const COLORS=PALETTE.map(item=>item[0]);
  const SIZES=[[0.003,'Thin',5],[0.006,'Medium',9],[0.012,'Thick',14]];
  const SIZE_VALUES=SIZES.map(item=>item[0]);
  // Boards are 16:9. Points are 0..1 across and down the board. Line sizes are a fraction of the board width.
  const ASPECT=16/9,MAX_STROKES=400,MAX_POINTS=600,STEP=0.0015,ERASE=0.01,DRAFT_MS=80;
  let seq=0;
  const newId=letter=>letter+Date.now().toString(36)+'-'+(++seq).toString(36);
  const round=value=>Math.round(value*1e4)/1e4;

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
  function cleanStroke(s){
    if(!s||typeof s.id!=='string'||!/^[a-z0-9-]{2,40}$/i.test(s.id)||!COLORS.includes(s.color)||!SIZE_VALUES.includes(s.size)||!Array.isArray(s.points)||!s.points.length||s.points.length>MAX_POINTS||!s.points.every(validPoint))return null;
    return{id:s.id,color:s.color,size:s.size,points:s.points.map(p=>({x:round(p.x),y:round(p.y)}))};
  }
  function emptyBoard(){return{strokes:[],drafts:{student:null,teacher:null}}}
  // Student line ids start with "s", teacher line ids with "t". Each side may remove or clear only its own lines;
  // only the teacher may clear a whole board.
  function applyOp(board,op,by){
    if(op.type==='board-add'){
      const s=cleanStroke(op.stroke);
      if(!s||s.id[0]!==by[0]||board.strokes.length>=MAX_STROKES||board.strokes.some(item=>item.id===s.id))return false;
      s.by=by;board.strokes.push(s);board.drafts[by]=null;return true;
    }
    if(op.type==='board-remove'){
      if(!Array.isArray(op.ids))return false;
      const ids=new Set(op.ids.slice(0,MAX_STROKES).filter(id=>typeof id==='string')),before=board.strokes.length;
      board.strokes=board.strokes.filter(s=>!(s.by===by&&ids.has(s.id)));return board.strokes.length!==before;
    }
    if(op.type==='board-clear'){
      board.strokes=op.all===true&&by==='teacher'?[]:board.strokes.filter(s=>s.by!==by);board.drafts={student:null,teacher:null};return true;
    }
    if(op.type==='board-draft'){
      const s=op.stroke?cleanStroke(op.stroke):null;board.drafts[by]=s&&s.id[0]===by[0]?s:null;return true;
    }
    return false;
  }
  function boardFromMessage(list){
    const board=emptyBoard();
    if(Array.isArray(list))for(const raw of list.slice(0,MAX_STROKES)){const s=cleanStroke(raw);if(s){s.by=raw.by==='teacher'?'teacher':'student';board.strokes.push(s)}}
    return board;
  }

  // ---------- Drawing on a canvas ----------
  function strokeOn(ctx,s,w,h){
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
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';
    for(const s of board.strokes)strokeOn(ctx,s,w,h);
    for(const s of [board.drafts.student,board.drafts.teacher,local])if(s)strokeOn(ctx,s,w,h);
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
    bar.append(pen,eraser,swatches,sizes);sync();return st;
  }

  // Mouse, pen and touch input on one board canvas.
  // o: by ('student'|'teacher'), tools, enabled(), board(), apply(op) (apply locally + send), send(op) (send only), redraw()
  function attachDrawing(canvas,o){
    let draft=null,pid=null,timer=0,lastSent=0;
    const pos=event=>{const r=canvas.getBoundingClientRect();return{x:round(Math.min(1,Math.max(0,(event.clientX-r.left)/r.width))),y:round(Math.min(1,Math.max(0,(event.clientY-r.top)/r.height)))}};
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
        if(s.by!==o.by)continue;const reach=ERASE+s.size/2;
        if(s.points.some((q,i)=>segDist(p,i?s.points[i-1]:q,q)<=reach))hit.push(s.id);
      }
      if(hit.length)o.apply({type:'board-remove',ids:hit});
    }
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||pid!==null||!o.enabled())return;
      event.preventDefault();pid=event.pointerId;canvas.setPointerCapture(pid);
      const p=pos(event);
      if(o.tools.tool==='eraser'){erase(p);return}
      draft={id:newId(o.by[0]),color:o.tools.color,size:o.tools.size,points:[p]};o.redraw();sendDraft();
    });
    canvas.addEventListener('pointermove',event=>{
      if(event.pointerId!==pid)return;
      const list=event.getCoalescedEvents?.();
      for(const item of list&&list.length?list:[event]){
        const p=pos(item);
        if(o.tools.tool==='eraser'){erase(p);continue}
        if(!draft)continue;
        const last=draft.points[draft.points.length-1];
        if(Math.hypot(p.x-last.x,(p.y-last.y)/ASPECT)<STEP)continue;
        draft.points.push(p);
        // Very long lines are saved in pieces so no message gets too big.
        if(draft.points.length>=MAX_POINTS){const {color,size}=draft;commit();draft={id:newId(o.by[0]),color,size,points:[p]}}
      }
      if(draft){o.redraw();sendDraft()}
    });
    const finish=event=>{if(event.pointerId!==pid)return;pid=null;if(draft)commit()};
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('lostpointercapture',finish);
    canvas.addEventListener('pointercancel',event=>{if(event.pointerId!==pid)return;pid=null;dropDraft()});
    return{
      draft:()=>draft,
      cancel(){if(pid!==null&&canvas.hasPointerCapture?.(pid))canvas.releasePointerCapture(pid);pid=null;if(draft)dropDraft()}
    };
  }

  // =====================================================================
  // Student page: one private board, shown when the teacher turns boards on.
  // =====================================================================
  if(!isTeacher){
    let on=false,board=emptyBoard(),drawer=null;
    const view=el('div','boards-view student-board');view.id='myBoard';view.dataset.stageUi='true';view.hidden=true;view.setAttribute('aria-label','My whiteboard');
    const bar=el('div','boards-bar'),focus=el('div','boards-focus'),surface=el('div','board-fit'),canvas=el('canvas');
    canvas.setAttribute('aria-label','My whiteboard. Draw with the mouse, pen or finger.');
    bar.append(el('strong','boards-title','📝 My board'));
    const tools=makeTools(bar,COLORS[0],st=>{drawer?.cancel();surface.classList.toggle('erasing',st.tool==='eraser')});
    const undo=button('↶ Undo','Undo my last line',()=>{const mine=board.strokes.filter(s=>s.by==='student');const last=mine[mine.length-1];if(last)act({type:'board-remove',ids:[last.id]})});
    const clear=button('🗑 Clear','Clear everything I drew',()=>{if(board.strokes.some(s=>s.by==='student')&&confirm('Clear everything you drew on your board?'))act({type:'board-clear'})},'danger');
    const full=button('⛶ Full screen','Full screen',()=>(expanded()?$('exitFullScreenLesson'):$('fullScreenLesson'))?.click());
    bar.append(el('span','boards-spacer'),undo,clear,full);
    surface.appendChild(canvas);focus.appendChild(surface);view.append(bar,focus);stage.appendChild(view);shield(view);
    const redraw=scheduler(()=>{
      if(view.hidden)return;
      full.textContent=expanded()?'⤢ Exit full screen':'⛶ Full screen';
      fit(focus,surface);paint(canvas,board,drawer?.draft());
    });
    function act(op){if(!on)return;if(applyOp(board,op,'student'))B.sendTeacher(op);redraw()}
    drawer=attachDrawing(canvas,{by:'student',tools,enabled:()=>on,board:()=>board,apply:act,send:op=>{if(on)B.sendTeacher(op)},redraw});
    function show(next){
      view.hidden=!next;document.body.classList.toggle('boards-on',next);
      if(next)stage.dispatchEvent(new PointerEvent('pointerleave'));
      redraw();
    }
    function fromTeacher(message){
      if(!message||typeof message.type!=='string'||!message.type.startsWith('board-'))return false;
      if(message.type==='board-mode'){
        drawer.cancel();const was=on;on=message.on===true;board=on?boardFromMessage(message.strokes):emptyBoard();show(on);
        if(on&&!was)B.status('Your teacher opened your own whiteboard. Draw with the pen. Your teacher can see your board.');
        else if(!on&&was)B.status('Your teacher closed the whiteboards. Back to the lesson.');
      }else if(on&&message.type!=='board-mode')applyOp(board,message,'teacher');
      redraw();return true;
    }
    new ResizeObserver(redraw).observe(stage);document.addEventListener('fullscreenchange',redraw);
    window.ClassPointerBoards={fromTeacher,reset(){drawer.cancel();on=false;board=emptyBoard();show(false)}};
    return;
  }

  // =====================================================================
  // Teacher page: a grid of every student's board, plus the shared whiteboard button.
  // =====================================================================
  const boards=new Map(),tiles=new Map();
  let on=false,focusId=null,drawer=null,gridSize='';
  const toggle=$('studentBoards');
  const view=el('div','boards-view');view.id='boardsView';view.dataset.stageUi='true';view.hidden=true;view.setAttribute('aria-label','Student whiteboards');

  const gridBar=el('div','boards-bar'),count=el('span','boards-count');
  gridBar.append(el('strong','boards-title','🧑‍🎨 Student boards'),count,el('span','boards-hint','Click a board to open it large'),el('span','boards-spacer'),
    button('🗑 Clear all boards','Erase every student board',()=>{
      if(!confirm('Erase every student board? This cannot be undone.'))return;
      boards.clear();for(const m of admitted())sendMode(m);dirtyAll();
    },'danger'),
    button('✕ Close boards','Return everyone to the lesson. Boards are kept until the class ends.',()=>setOn(false)));

  const focusBar=el('div','boards-bar'),who=el('strong','boards-title');focusBar.hidden=true;
  focusBar.append(button('◀ All boards','Back to all boards',()=>setFocus(null)),who);
  const focus=el('div','boards-focus'),surface=el('div','board-fit'),canvas=el('canvas');focus.hidden=true;
  canvas.setAttribute('aria-label','Student board. Your marks appear on the student’s screen.');
  surface.appendChild(canvas);focus.appendChild(surface);
  const tools=makeTools(focusBar,COLORS[2],st=>{drawer?.cancel();surface.classList.toggle('erasing',st.tool==='eraser')});
  focusBar.append(el('span','boards-spacer'),
    button('↶ Undo','Undo my last mark on this board',()=>{const b=focusBoard();if(!b)return;const mine=b.strokes.filter(s=>s.by==='teacher');const last=mine[mine.length-1];if(last)act({type:'board-remove',ids:[last.id]})}),
    button('🧽 Clear mine','Erase only my marks on this board',()=>act({type:'board-clear'})),
    button('🗑 Clear board','Erase this whole board, including the student’s work',()=>{const m=focusMember();if(m&&confirm('Erase '+m.name+'’s whole board?'))act({type:'board-clear',all:true})},'danger'));

  const grid=el('div','boards-grid'),empty=el('p','boards-empty','No students have joined yet. Their boards appear here as they join.');
  view.append(gridBar,focusBar,grid,empty,focus);stage.appendChild(view);shield(view);

  const admitted=()=>Array.from(B.members().values()).filter(m=>m.admitted);
  // A board belongs to a student name, so a student who refreshes or rejoins gets his board back.
  function keyFor(m){
    if(!m.boardKey){const base='name:'+String(m.name||'student').toLowerCase();m.boardKey=admitted().some(o=>o!==m&&o.boardKey===base)?base+'#'+m.id:base}
    return m.boardKey;
  }
  function boardFor(m){const key=keyFor(m);let b=boards.get(key);if(!b){b=emptyBoard();boards.set(key,b)}return b}
  const focusMember=()=>focusId?B.members().get(focusId)||null:null;
  const focusBoard=()=>{const m=focusMember();return m?boardFor(m):null};
  function sendMode(m){
    if(!on){B.send(m.connection,{type:'board-mode',on:false});return}
    const b=boardFor(m);b.drafts={student:null,teacher:null};B.send(m.connection,{type:'board-mode',on:true,strokes:b.strokes});
  }

  // ---------- Painting (only boards that changed, once per frame) ----------
  const dirtySet=new Set();let frame=0;
  function dirty(id){dirtySet.add(id);if(!frame)frame=requestAnimationFrame(flush)}
  function dirtyAll(){for(const id of tiles.keys())dirtySet.add(id);if(focusId)dirtySet.add(focusId);if(!frame)frame=requestAnimationFrame(flush)}
  function flush(){
    frame=0;
    if(!view.hidden)for(const id of dirtySet){
      const m=B.members().get(id);if(!m)continue;const b=boardFor(m),tile=tiles.get(id);
      if(tile&&!grid.hidden){paint(tile.canvas,b,null);tile.node.classList.toggle('drawing',!!b.drafts.student)}
      if(id===focusId){fit(focus,surface);paint(canvas,b,drawer?.draft())}
    }
    dirtySet.clear();
  }

  // ---------- Grid: one tile per student, as large as the lesson area allows ----------
  function syncTiles(){
    const list=admitted(),ids=new Set(list.map(m=>m.id));
    for(const [id,tile] of tiles)if(!ids.has(id)){tile.node.remove();tiles.delete(id)}
    for(const m of list)if(!tiles.has(m.id)){
      const node=button('','Open '+m.name+'’s board',()=>setFocus(m.id),'board-tile'),c=el('canvas');
      node.append(c,el('span','board-name',m.name));grid.appendChild(node);tiles.set(m.id,{node,canvas:c});dirty(m.id);
    }
    count.textContent=list.length?list.length+(list.length===1?' student':' students'):'';
    if(focusId&&!ids.has(focusId)){setFocus(null);return}
    grid.hidden=!!focusId||!list.length;empty.hidden=!!focusId||!!list.length;
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
  function setFocus(id){
    drawer?.cancel();focusId=id&&B.members().get(id)?id:null;const m=focusMember();
    focusBar.hidden=!m;gridBar.hidden=!!m;focus.hidden=!m;if(m)who.textContent=m.name+'’s board';
    gridSize='';syncTiles();if(m)dirty(m.id);else dirtyAll();
  }
  function setOn(next){
    if(next&&!B.started())return;
    on=next;drawer?.cancel();focusId=null;gridSize='';
    for(const m of admitted())sendMode(m);
    view.hidden=!on;
    if(toggle){toggle.setAttribute('aria-pressed',String(on));toggle.textContent=on?'✕ Close student boards':'🧑‍🎨 Student boards'}
    if(on){stage.dispatchEvent(new PointerEvent('pointerleave'));setFocus(null);B.status('Student boards are open. Each student draws on his own board. Click a board to see it large and write on it.')}
    else B.status('Student boards closed. Everyone is back to the lesson. The boards are kept until the class ends.');
  }
  // The teacher writes on the board that is open large; the same change goes to that student.
  function act(op){const m=focusMember();if(!m||!on)return;if(applyOp(boardFor(m),op,'teacher'))B.send(m.connection,op);dirty(m.id)}
  drawer=attachDrawing(canvas,{by:'teacher',tools,enabled:()=>on&&!!focusMember(),board:()=>focusBoard()||emptyBoard(),apply:act,
    send:op=>{const m=focusMember();if(m&&on)B.send(m.connection,op)},redraw:()=>{if(focusId)dirty(focusId)}});

  toggle?.addEventListener('click',()=>setOn(!on));
  setInterval(()=>{if(toggle)toggle.disabled=!on&&!B.started();if(on)syncTiles()},700);
  new ResizeObserver(()=>{if(!on)return;layoutGrid();if(focusId)dirty(focusId)}).observe(stage);

  window.ClassPointerBoards={
    fromStudent(m,message){if(!on)return;if(applyOp(boardFor(m),message,'student'))dirty(m.id)},
    studentJoined(m){const b=boardFor(m);b.drafts={student:null,teacher:null};if(on){sendMode(m);syncTiles()}},
    studentLeft(m){if(m.boardKey&&boards.has(m.boardKey))boards.get(m.boardKey).drafts={student:null,teacher:null};if(on)syncTiles()},
    endClass(){drawer?.cancel();boards.clear();for(const tile of tiles.values())tile.node.remove();tiles.clear();if(on){on=false;focusId=null;view.hidden=true}
      if(toggle){toggle.setAttribute('aria-pressed','false');toggle.textContent='🧑‍🎨 Student boards';toggle.disabled=true}}
  };

  // ---------- Shared whiteboard: a blank page in the lesson for everyone ----------
  $('openWhiteboard')?.addEventListener('click',async()=>{
    if(!window.ClassPointerPdf?.openSnapshot)return;
    if(on)setOn(false);
    const c=document.createElement('canvas');c.width=1600;c.height=900;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    try{
      const ok=await window.ClassPointerPdf.openSnapshot(c.toDataURL('image/jpeg',0.92),c.width,c.height,{name:'Whiteboard',label:'whiteboard',kind:'whiteboard',
        status:'Whiteboard open for everyone. Use ✒️ Pen to write. Students with Writing allowed can write too. Close whiteboard is at the bottom.'});
      if(!ok)return;
      const tool=$('teacherTool'),color=$('teacherColor');
      if(tool.value!=='pen'){tool.value='pen';tool.dispatchEvent(new Event('change',{bubbles:true}))}
      if(color.value==='#ffcc00'){color.value='#1f2937';color.dispatchEvent(new Event('change',{bubbles:true}))}
    }catch(error){B.fail(error?.message||'Could not open the whiteboard.')}
  });
})();
