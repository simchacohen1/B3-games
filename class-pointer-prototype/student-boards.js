'use strict';
// Class Pointer whiteboards.
//  • Whiteboard (teacher button): a blank board shown to everyone. It reuses the webpage/PDF lesson mode,
//    so zoom, pointers, Pen, Highlight and student permissions all work as usual.
//  • Student boards (teacher button): every admitted student gets a tile in a grid that resizes with the number of
//    students. Mode for the whole class: Whiteboards (each student draws on a private board; the teacher can open
//    one large and write on it) or Screens (each student shares his screen; view only). 🚫 pauses one student.
// Board lines travel over the existing PeerJS data connection as small "board-*" messages. Nothing is stored online.
// Both sides apply the same operations, so the teacher's copy and the student's copy stay identical. Who made a
// change ("student" or "teacher") always comes from the connection, never from the message itself.
(function(){
  const B=window.ClassPointerBridge;
  if(!B)return;
  const $=id=>document.getElementById(id),stage=$('stage'),isTeacher=B.isTeacher;
  const PALETTE=[['#1f2937','Black'],['#1d4ed8','Blue'],['#c62828','Red'],['#2e7d32','Green'],['#7b1fa2','Purple'],['#ef6c00','Orange']];
  const COLORS=PALETTE.map(item=>item[0]);
  const SIZES=[[0.003,'Thin',5],[0.006,'Medium',9],[0.012,'Thick',14],[0.03,'Color',22]];
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
  // One teacher-owned activity is copied to every student's independent board.
  // Uploaded pictures remain locked under the boys' marks. Word activities have a
  // separate, editable text object on each boy's board.
  const MAX_ACTIVITY_IMAGE=420000;
  let activity=null,activityImage=null;
  function cleanActivity(raw){
    if(!raw||raw.kind==='blank')return null;
    if(raw.kind==='word'&&typeof raw.text==='string'){
      const text=raw.text.trim().slice(0,80),instruction=String(raw.instruction||'').trim().slice(0,120);
      if(text)return{kind:'word',text,instruction};
    }
    if(raw.kind==='image'&&typeof raw.data==='string'&&raw.data.length<=MAX_ACTIVITY_IMAGE&&/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(raw.data))
      return{kind:'image',data:raw.data};
    return null;
  }
  function chooseActivity(next,done){
    activity=cleanActivity(next);activityImage=null;
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
    if(activity?.kind==='image'){
      if(activityImage?.complete&&activityImage.naturalWidth)ctx.drawImage(activityImage,0,0,w,h);
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
  function emptyBoard(){return{strokes:[],drafts:{student:null,teacher:null},text:defaultWord()}}
  // Student line ids start with "s", teacher line ids with "t". Each side may remove or clear only its own lines;
  // only the teacher may clear a whole board.
  function applyOp(board,op,by){
    if(op.type==='board-text'){
      if(activity?.kind!=='word'||!board.text)return false;
      const text=cleanWord(op.text);if(!text)return false;
      board.text=text;return true;
    }
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
  function boardFromMessage(list,rawText){
    const board=emptyBoard();
    if(activity?.kind==='word')board.text=cleanWord(rawText)||defaultWord();
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
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);paintActivity(ctx,w,h,board);ctx.lineCap='round';ctx.lineJoin='round';
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
    let draft=null,pid=null,timer=0,lastSent=0,lastTextMove=0;
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
    function moveWord(p,final){
      const t=o.board().text;if(!t)return;
      if(!final&&Date.now()-lastTextMove<70)return;
      lastTextMove=Date.now();
      o.apply({type:'board-text',text:{...t,x:p.x,y:p.y}});
    }
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||pid!==null||!o.enabled())return;
      event.preventDefault();pid=event.pointerId;canvas.setPointerCapture(pid);
      const p=pos(event);
      if(o.tools.tool==='move'){if(!o.board().text){pid=null;return}moveWord(p,true);return}
      if(o.tools.tool==='eraser'){erase(p);return}
      draft={id:newId(o.by[0]),color:o.tools.color,size:o.tools.size,points:[p]};o.redraw();sendDraft();
    });
    canvas.addEventListener('pointermove',event=>{
      if(event.pointerId!==pid)return;
      const list=event.getCoalescedEvents?.();
      for(const item of list&&list.length?list:[event]){
        const p=pos(item);
        if(o.tools.tool==='eraser'){erase(p);continue}
        if(o.tools.tool==='move'){moveWord(p,false);continue}
        if(!draft)continue;
        const last=draft.points[draft.points.length-1];
        if(Math.hypot(p.x-last.x,(p.y-last.y)/ASPECT)<STEP)continue;
        draft.points.push(p);
        // Very long lines are saved in pieces so no message gets too big.
        if(draft.points.length>=MAX_POINTS){const {color,size}=draft;commit();draft={id:newId(o.by[0]),color,size,points:[p]}}
      }
      if(draft){o.redraw();sendDraft()}
    });
    const finish=event=>{if(event.pointerId!==pid)return;if(o.tools.tool==='move'&&o.board().text)moveWord(pos(event),true);pid=null;if(draft)commit()};
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('lostpointercapture',finish);
    canvas.addEventListener('pointercancel',event=>{if(event.pointerId!==pid)return;pid=null;dropDraft()});
    return{
      draft:()=>draft,
      cancel(){if(pid!==null&&canvas.hasPointerCapture?.(pid))canvas.releasePointerCapture(pid);pid=null;if(draft)dropDraft()}
    };
  }

  // =====================================================================
  // Student page. Mode "boards": a private whiteboard. Mode "screens": share my screen with the teacher.
  // The teacher may pause ("block") one student; then that student sees a short message instead.
  // =====================================================================
  if(!isTeacher){
    let on=false,mode='boards',blocked=false,board=emptyBoard(),drawer=null,stream=null,call=null;
    const view=el('div','boards-view student-board');view.id='myBoard';view.dataset.stageUi='true';view.hidden=true;view.setAttribute('aria-label','My whiteboard');
    const bar=el('div','boards-bar'),title=el('strong','boards-title'),drawGroup=el('span','boards-group');
    const focus=el('div','boards-focus'),surface=el('div','board-fit'),canvas=el('canvas');
    canvas.setAttribute('aria-label','My whiteboard. Draw with the mouse, pen or finger.');
    bar.append(title,drawGroup);
    const tools=makeTools(drawGroup,COLORS[0],st=>{drawer?.cancel();surface.classList.toggle('erasing',st.tool==='eraser');surface.classList.toggle('moving',st.tool==='move')});
    drawGroup.append(
      button('↶ Undo','Undo my last line',()=>{const mine=board.strokes.filter(s=>s.by==='student');const last=mine[mine.length-1];if(last)act({type:'board-remove',ids:[last.id]})}),
      button('🗑 Clear','Clear everything I drew',()=>{if(board.strokes.some(s=>s.by==='student')&&confirm('Clear everything you drew on your board?'))act({type:'board-clear'})},'danger'));
    const editWord=wordEditor(bar,()=>board,text=>act({type:'board-text',text}),tools);
    const full=button('⛶ Full screen','Full screen',()=>(expanded()?$('exitFullScreenLesson'):$('fullScreenLesson'))?.click());
    bar.append(el('span','boards-spacer'),full);
    // Screens mode panel.
    const sharePanel=el('div','board-panel'),shareText=el('p','board-panel-text'),shareNote=el('p','board-panel-note'),preview=el('video','board-preview');
    preview.muted=true;preview.autoplay=true;preview.playsInline=true;preview.hidden=true;
    const shareOptions=el('div','board-share-options');
    shareOptions.style.cssText='display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:12px 0';
    const tabBtn=button('▣ Share a browser tab','Choose any browser tab using the browser visual picker',()=>startShare('browser'),'board-share-btn');
    const screenBtn=button('🖥 Share entire screen','Choose a full monitor using the browser visual picker',()=>startShare('monitor'),'board-share-btn');
    shareOptions.append(tabBtn,screenBtn);
    const shareBtn=button('⏹ Stop sharing','Stop sharing with your teacher',()=>stopShare(true),'board-share-btn');
    sharePanel.append(shareText,shareOptions,shareBtn,preview,shareNote);
    // Paused panel.
    const pausedPanel=el('div','board-panel');pausedPanel.append(el('p','board-panel-text','⏸ Your teacher paused this for you.'),el('p','board-panel-note','Please wait. Your teacher can turn it back on.'));
    surface.appendChild(canvas);focus.append(surface,sharePanel,pausedPanel);view.append(bar,focus);stage.appendChild(view);shield(view);

    function ui(){
      const boardsOn=on&&mode==='boards'&&!blocked,screensOn=on&&mode==='screens'&&!blocked;
      title.textContent=mode==='screens'?'🖥 Share my screen':'📝 My board';
      drawGroup.hidden=!boardsOn;surface.hidden=!boardsOn;sharePanel.hidden=!screensOn;pausedPanel.hidden=!(on&&blocked);
      editWord.update();editWord.root.hidden=!boardsOn||activity?.kind!=='word';
      shareText.textContent=stream?'✅ Live preview of what your teacher sees:':'Choose a browser tab or your entire screen. The browser shows visual thumbnails before you click Share.';
      shareOptions.hidden=!!stream;shareBtn.hidden=!stream;shareBtn.classList.toggle('sharing',!!stream);
      preview.hidden=!stream;if(stream&&preview.srcObject!==stream){preview.srcObject=stream;preview.play().catch(()=>{})}if(!stream)preview.srcObject=null;
      full.textContent=expanded()?'⤢ Exit full screen':'⛶ Full screen';
    }
    const redraw=scheduler(()=>{if(view.hidden)return;ui();if(!surface.hidden){fit(focus,surface);paint(canvas,board,drawer?.draft())}});
    function act(op){if(!on||mode!=='boards'||blocked)return;if(applyOp(board,op,'student'))B.sendTeacher(op);redraw()}
    drawer=attachDrawing(canvas,{by:'student',tools,enabled:()=>on&&mode==='boards'&&!blocked,board:()=>board,apply:act,send:op=>{if(on&&mode==='boards'&&!blocked)B.sendTeacher(op)},redraw});

    async function startShare(surface){
      shareNote.textContent='';
      if(!navigator.mediaDevices?.getDisplayMedia||!B.callTeacher){shareNote.textContent='Screen sharing works on a computer in Chrome or Edge.';return}
      tabBtn.disabled=true;screenBtn.disabled=true;
      try{
        // Browser owns the permission picker and its visual thumbnails. displaySurface
        // is a preference; the student still must choose and approve the source.
        const s=await navigator.mediaDevices.getDisplayMedia({
          video:{displaySurface:surface==='monitor'?'monitor':'browser',frameRate:{ideal:5,max:8},width:{ideal:1600},height:{ideal:900}},
          audio:false,preferCurrentTab:surface!=='monitor',
          selfBrowserSurface:surface==='monitor'?'exclude':'include',surfaceSwitching:'include'
        });
        if(!on||mode!=='screens'||blocked){s.getTracks().forEach(t=>t.stop());return}
        stopShare(false);
        const c=B.callTeacher(s);
        if(!c){s.getTracks().forEach(t=>t.stop());shareNote.textContent='Could not send your screen. Try again.';return}
        stream=s;call=c;
        s.getVideoTracks()[0]?.addEventListener('ended',()=>{if(stream===s)stopShare(true)},{once:true});
        c.on?.('close',()=>{if(call===c)stopShare(false)});c.on?.('error',()=>{if(call===c){stopShare(false);shareNote.textContent='The connection to your teacher failed. Try sharing again.'}});
        B.sendTeacher({type:'board-screen',sharing:true});
      }catch(error){shareNote.textContent=error?.name==='NotAllowedError'?'Sharing was canceled. Click the button to try again.':'Could not share your screen. Try again.'}
      finally{tabBtn.disabled=false;screenBtn.disabled=false;redraw()}
    }
    function stopShare(tell){
      const s=stream,c=call;stream=null;call=null;
      c?.close();s?.getTracks().forEach(t=>t.stop());
      if(tell&&on&&s)B.sendTeacher({type:'board-screen',sharing:false});
      redraw();
    }
    function show(next){
      view.hidden=!next;document.body.classList.toggle('boards-on',next);
      if(next)stage.dispatchEvent(new PointerEvent('pointerleave'));
      redraw();
    }
    function fromTeacher(message){
      if(!message||typeof message.type!=='string'||!message.type.startsWith('board-'))return false;
      if(message.type==='board-mode'){
        drawer.cancel();
        const was=on,wasMode=mode,wasBlocked=blocked;
        on=message.on===true;mode=message.mode==='screens'?'screens':'boards';blocked=on&&message.blocked===true;
        if(!on||mode!=='screens'||blocked)stopShare(false);
        chooseActivity(on&&mode==='boards'?message.activity:null,redraw);
        board=on&&mode==='boards'&&!blocked?boardFromMessage(message.strokes,message.text):emptyBoard();
        show(on);
        if(!on){if(was)B.status('Your teacher closed the boards. Back to the lesson.')}
        else if(blocked){if(!wasBlocked)B.status('Your teacher paused your board for now.')}
        else if(!was||wasMode!==mode||wasBlocked)B.status(mode==='screens'?'Your teacher asked you to share your screen. Click Share my screen.':'Your teacher opened your own whiteboard. Draw with the pen. Your teacher can see your board.');
      }else if(on&&mode==='boards'&&!blocked)applyOp(board,message,'teacher');
      redraw();return true;
    }
    new ResizeObserver(redraw).observe(stage);document.addEventListener('fullscreenchange',redraw);
    window.ClassPointerBoards={fromTeacher,reset(){drawer.cancel();stopShare(false);on=false;blocked=false;mode='boards';chooseActivity(null,redraw);board=emptyBoard();show(false)}};
    return;
  }

  // =====================================================================
  // Teacher page: a grid of every student's board or shared screen, plus the shared whiteboard button.
  // =====================================================================
  const boards=new Map(),tiles=new Map(),blocked=new Set();
  let on=false,mode='screens',focusId=null,drawer=null,gridSize='';
  // Separate, default-allow permissions: a teacher can exclude one boy without
  // changing classmates' access or his independent Pointer/Highlight settings.
  const denied={screens:new Set(),boards:new Set()};
  let classStudents=[],permissionsLoad=null,permissionsWrite=Promise.resolve();
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
    outer.append(header,el('p',null,'Everyone is enabled by default. Uncheck a boy without affecting the others.'));
    for(const [kind,title] of [['screens','Screen sharing'],['boards','Whiteboards']]){
      const actions=el('div','sharing-permission-actions');
      actions.append(el('strong',null,title),button('Select all','Enable '+title+' for every boy',()=>bulkPermission(kind,true)),
        button('Clear all','Disable '+title+' for every boy',()=>bulkPermission(kind,false)));
      outer.append(actions);
    }
    const list=el('div','sharing-permissions-roster');outer.append(list);
    permissionsPanels.push(list);return outer;
  }
  function renderPermissions(){
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
      renderPermissions();
    })();
    return permissionsLoad;
  }
  const toggle=$('studentBoards');
  // Teacher can bring the whole signed-in class directly to screens or boards.
  // These same controls remain available from the Students menu in full screen.
  const sendScreens=button('📣 Send to Screen Sharing','Bring this class to Classroom Pointer screens; each student must approve sharing',()=>void sendEveryone('screens'));
  const sendBoards=button('📝 Send to Whiteboards','Bring this class to individual Classroom Pointer whiteboards',()=>void sendEveryone('boards'));
  toggle?.after(sendScreens,sendBoards);
  const dockLaunch=el('div','pointer-bulk-actions');
  dockLaunch.style.cssText='display:flex;gap:6px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid #cbd5e1';
  const dockScreens=button('🖥 Send screens','Ask the class to share their screens',()=>void sendEveryone('screens'));
  const dockBoards=button('📝 Send whiteboards','Open individual whiteboards for the class',()=>void sendEveryone('boards'));
  dockLaunch.append(dockScreens,dockBoards);
  document.getElementById('tbStudentsMenu')?.prepend(dockLaunch);
  const menuPermissions=createPermissionsPanel();
  document.getElementById('tbStudentsMenu')?.append(menuPermissions);
  const view=el('div','boards-view');view.id='boardsView';view.dataset.stageUi='true';view.hidden=true;view.setAttribute('aria-label','Student whiteboards and screens');

  // Grid bar: mode switch for the whole class.
  const gridBar=el('div','boards-bar'),count=el('span','boards-count'),modes=el('span','boards-modes');
  modes.setAttribute('role','group');modes.setAttribute('aria-label','What students do');
  const modeBoards=button('📝 Whiteboards','Every student draws on his own whiteboard',()=>setMode('boards'));
  const modeScreens=button('🖥 Screens','Every student shares his screen with you (view only)',()=>setMode('screens'));
  modes.append(modeBoards,modeScreens);
  const chooseParticipants=button('👥 Choose students','Choose whose screens and whiteboards may participate',()=>{
    gridPermissions.hidden=!gridPermissions.hidden;
  });
  const gridPermissions=createPermissionsPanel();gridPermissions.hidden=true;
  const clearAll=button('🗑 Clear all boards','Erase every student whiteboard',()=>{
    if(!confirm('Erase every student whiteboard? This cannot be undone.'))return;
    boards.clear();for(const m of admitted())sendMode(m);dirtyAll();
  },'danger');
  gridBar.append(el('strong','boards-title','🧑‍🎨 Students'),count,modes,chooseParticipants,el('span','boards-hint','Click a tile to open it · 🚫 pauses a student'),el('span','boards-spacer'),clearAll,
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
  const removeActivity=button('✕ Blank boards','Remove the shared word or picture and clear the current drawings',()=>sendActivity(null));
  activityBar.append(el('strong',null,'Send to all boards:'),wordInput,instructionInput,sendWord,sendImage,removeActivity,imageFile,activityLabel,el('span','boards-paste-hint','📋 Ctrl+V here to send copied text or pictures'));
  wordInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendWord.click()}});
  imageFile.addEventListener('change',async()=>{
    const file=imageFile.files?.[0];imageFile.value='';
    if(file)await sendImageFile(file);
  });
  async function sendImageFile(file){
    if(!/^image\/(jpeg|png|webp|gif)$/.test(file.type)||file.size>8*1024*1024){B.fail('Please choose a JPG, PNG, WebP or GIF smaller than 8 MB.');return}
    sendImage.disabled=true;activityLabel.textContent='Preparing picture…';
    try{
      const data=await pictureData(file);
      if(!data)throw Error('Picture is too large to send to the class. Try a simpler or smaller image.');
      sendActivity({kind:'image',data});
    }catch(e){B.fail(e.message||'Could not load that picture.')}
    finally{sendImage.disabled=false;updateActivityLabel()}
  }
  // Ctrl+V on the teacher grid broadcasts pasted pictures directly (from screenshots,
  // webpages, etc.) or pasted words. Normal pasting inside text fields still works.
  document.addEventListener('paste',event=>{
    if(!on||mode!=='boards'||focusId||!event.clipboardData)return;
    const imageItem=Array.from(event.clipboardData.items||[]).find(item=>/^image\/(jpeg|png|webp|gif)$/.test(item.type));
    if(imageItem){
      const file=imageItem.getAsFile();if(!file)return;
      event.preventDefault();void sendImageFile(file);return;
    }
    const target=event.target;
    if(target?.closest?.('input,textarea,[contenteditable="true"]'))return;
    const value=event.clipboardData.getData('text/plain')?.trim();
    if(!value)return;
    event.preventDefault();wordInput.value=value.slice(0,80);
    sendActivity({kind:'word',text:wordInput.value,instruction:instructionInput.value});
  });

  function pictureData(file){
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
          if(data.length>MAX_ACTIVITY_IMAGE){
            c.width=900;c.height=506;draw();data=c.toDataURL('image/jpeg',0.55);
          }
          resolve(data.length<=MAX_ACTIVITY_IMAGE?data:null);
        }catch(e){reject(e)}
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('This image could not be opened.'))};
      img.src=url;
    });
  }
  function updateActivityLabel(){
    activityLabel.textContent=activity?.kind==='word'?'Showing: '+activity.text:activity?.kind==='image'?'Coloring page sent to all boys':'Blank boards';
  }

  // Focus bar: one student large.
  const focusBar=el('div','boards-bar'),who=el('strong','boards-title'),drawGroup=el('span','boards-group');focusBar.hidden=true;
  const focusBlock=button('','',()=>{const m=focusMember();if(m)toggleBlock(m)});
  focusBar.append(button('◀ All students','Back to all students',()=>setFocus(null)),who,focusBlock,drawGroup);
  const focus=el('div','boards-focus'),surface=el('div','board-fit'),canvas=el('canvas');focus.hidden=true;
  canvas.setAttribute('aria-label','Student board. Your marks appear on the student’s screen.');
  surface.appendChild(canvas);
  const screenBox=el('div','board-screen-large'),screenVideo=el('video'),screenNote=el('p','board-panel-text');
  screenVideo.muted=true;screenVideo.autoplay=true;screenVideo.playsInline=true;screenBox.append(screenVideo,screenNote);
  const pausedBox=el('div','board-panel');pausedBox.append(el('p','board-panel-text','⏸ Paused'),el('p','board-panel-note','This student is paused. Click ✅ Allow to turn his board or screen back on.'));
  focus.append(surface,screenBox,pausedBox);
  const tools=makeTools(drawGroup,COLORS[2],st=>{drawer?.cancel();surface.classList.toggle('erasing',st.tool==='eraser');surface.classList.toggle('moving',st.tool==='move')});
  drawGroup.append(el('span','boards-spacer'),
    button('↶ Undo','Undo my last mark on this board',()=>{const b=focusBoard();if(!b)return;const mine=b.strokes.filter(s=>s.by==='teacher');const last=mine[mine.length-1];if(last)act({type:'board-remove',ids:[last.id]})}),
    button('🧽 Clear mine','Erase only my marks on this board',()=>act({type:'board-clear'})),
    button('🗑 Clear board','Erase this whole board, including the student’s work',()=>{const m=focusMember();if(m&&confirm('Erase '+m.name+'’s whole board?'))act({type:'board-clear',all:true})},'danger'));

  const grid=el('div','boards-grid'),empty=el('p','boards-empty','No students have joined yet. Their tiles appear here as they join.');
  view.append(gridBar,gridPermissions,activityBar,focusBar,grid,empty,focus);stage.appendChild(view);shield(view);

  const admitted=()=>Array.from(B.members().values()).filter(m=>m.admitted);
  // A board belongs to a student name, so a student who refreshes or rejoins gets his board (and block) back.
  function keyFor(m){
    if(!m.boardKey){const base='name:'+String(m.name||'student').toLowerCase();m.boardKey=admitted().some(o=>o!==m&&o.boardKey===base)?base+'#'+m.id:base}
    return m.boardKey;
  }
  function boardFor(m){const key=keyFor(m);let b=boards.get(key);if(!b){b=emptyBoard();boards.set(key,b)}return b}
  const isBlocked=m=>blocked.has(keyFor(m));
  const focusMember=()=>focusId?B.members().get(focusId)||null:null;
  const focusBoard=()=>{const m=focusMember();return m?boardFor(m):null};
  const focusWord=wordEditor(focusBar,()=>focusBoard(),text=>act({type:'board-text',text}),tools);
  function closeScreen(m){const c=m.screenCall;m.screenCall=null;m.screenStream=null;try{c?.close()}catch(_){}}
  function sendMode(m){
    if(!on||excluded(m,mode)){closeScreen(m);B.send(m.connection,{type:'board-mode',on:false});return}
    const paused=isBlocked(m);if(paused||mode!=='screens')closeScreen(m);
    const message={type:'board-mode',on:true,mode,blocked:paused};
    if(mode==='boards'){message.activity=activity;if(!paused){const b=boardFor(m);b.drafts={student:null,teacher:null};message.strokes=b.strokes;message.text=b.text}}
    B.send(m.connection,message);
  }

  // ---------- Painting (only tiles that changed, once per frame) ----------
  const dirtySet=new Set();let frame=0;
  function dirty(id){dirtySet.add(id);if(!frame)frame=requestAnimationFrame(flush)}
  function dirtyAll(){for(const id of tiles.keys())dirtySet.add(id);if(focusId)dirtySet.add(focusId);if(!frame)frame=requestAnimationFrame(flush)}
  function setVideo(video,stream){if(video.srcObject!==stream){video.srcObject=stream||null;if(stream)video.play().catch(()=>{})}}
  function flush(){
    frame=0;
    if(!view.hidden)for(const id of dirtySet){
      const m=B.members().get(id);if(!m)continue;
      const disabled=excluded(m,mode),paused=isBlocked(m)||disabled,screens=mode==='screens',tile=tiles.get(id);
      if(tile&&!grid.hidden){
        tile.node.classList.toggle('blocked',paused);tile.node.classList.toggle('screen',screens);
        tile.block.textContent=paused?'✅':'🚫';tile.block.title=(paused?'Allow ':'Pause ')+m.name;tile.block.setAttribute('aria-label',tile.block.title);
        tile.note.textContent=disabled?'Not selected for '+(screens?'screen sharing':'whiteboard'):paused?'⏸ Paused':screens&&!m.screenStream?'Waiting for his screen…':'';
        tile.canvas.hidden=screens;tile.video.hidden=!screens||paused||!m.screenStream;
        setVideo(tile.video,screens&&!paused?m.screenStream:null);
        if(!screens){const b=boardFor(m);paint(tile.canvas,b,null);tile.node.classList.toggle('drawing',!paused&&!!b.drafts.student)}else tile.node.classList.remove('drawing');
      }
      if(id===focusId){
        focusBlock.textContent=paused?'✅ Allow':'🚫 Pause';focusBlock.title=(paused?'Allow ':'Pause ')+m.name;
        drawGroup.hidden=screens||paused;surface.hidden=screens||paused;screenBox.hidden=!screens||paused;pausedBox.hidden=!paused;
        focusWord.update();focusWord.root.hidden=screens||paused||activity?.kind!=='word';
        if(screens&&!paused){setVideo(screenVideo,m.screenStream);screenVideo.hidden=!m.screenStream;screenNote.hidden=!!m.screenStream;screenNote.textContent='Waiting for '+m.name+' to share his screen…'}
        else setVideo(screenVideo,null);
        if(!surface.hidden){fit(focus,surface);paint(canvas,boardFor(m),drawer?.draft())}
      }
    }
    dirtySet.clear();
  }

  // ---------- Grid: one tile per student, as large as the lesson area allows ----------
  function makeTile(m){
    const node=el('div','board-tile'),c=el('canvas'),v=el('video'),note=el('span','board-note');
    node.tabIndex=0;node.setAttribute('role','button');node.title='Open '+m.name+'’s tile large';
    v.muted=true;v.autoplay=true;v.playsInline=true;v.hidden=true;
    const block=button('🚫','Pause '+m.name,event=>{event.stopPropagation();toggleBlock(m)},'board-block');
    node.append(c,v,note,el('span','board-name',m.name),block);
    node.addEventListener('click',()=>setFocus(m.id));
    node.addEventListener('keydown',event=>{if(event.target===node&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setFocus(m.id)}});
    return{node,canvas:c,video:v,note,block};
  }
  function syncTiles(){
    const list=admitted(),ids=new Set(list.map(m=>m.id));
    for(const [id,tile] of tiles)if(!ids.has(id)){tile.video.srcObject=null;tile.node.remove();tiles.delete(id)}
    for(const m of list)if(!tiles.has(m.id)){const tile=makeTile(m);grid.appendChild(tile.node);tiles.set(m.id,tile);dirty(m.id)}
    const paused=list.filter(isBlocked).length;
    count.textContent=list.length?list.length+(list.length===1?' student':' students')+(paused?' · '+paused+' paused':''):'';
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
  function controls(){
    modeBoards.setAttribute('aria-pressed',String(mode==='boards'));modeScreens.setAttribute('aria-pressed',String(mode==='screens'));
    clearAll.hidden=mode!=='boards';activityBar.hidden=mode!=='boards'||!!focusId;
    updateActivityLabel();
  }
  function sendActivity(next){
    if(!on||mode!=='boards')return;
    const item=cleanActivity(next);
    if(next&&!item){B.fail('Please enter a word or choose a valid picture.');return}
    const hasWork=Array.from(boards.values()).some(b=>b.strokes.length||(activity?.kind==='word'&&b.text&&JSON.stringify(b.text)!==JSON.stringify(defaultWord())));
    if(hasWork&&!confirm('This will erase the boys\' current marks and start a new activity. Continue?'))return;
    boards.clear();chooseActivity(item,dirtyAll);
    for(const m of admitted())sendMode(m);
    dirtyAll();updateActivityLabel();
    B.status(item?.kind==='word'?'The word is on every boy\'s board. Their answers appear live.':item?.kind==='image'?'The coloring page is on every boy\'s board. Watch them color in real time.':'All boards are blank.');
  }
  function setFocus(id){
    drawer?.cancel();focusId=id&&B.members().get(id)?id:null;const m=focusMember();
    focusBar.hidden=!m;gridBar.hidden=!!m;activityBar.hidden=!!m||mode!=='boards';focus.hidden=!m;focusWord.root.hidden=!m||mode!=='boards'||activity?.kind!=='word';if(m)who.textContent=m.name+(mode==='screens'?'’s screen':'’s board');
    if(!m)setVideo(screenVideo,null);
    controls();gridSize='';syncTiles();if(m)dirty(m.id);else dirtyAll();
  }
  function setOn(next){
    if(next&&!B.started())return;
    on=next;drawer?.cancel();focusId=null;gridSize='';
    for(const m of admitted())sendMode(m);
    view.hidden=!on;
    if(toggle){toggle.setAttribute('aria-pressed',String(on));toggle.textContent=on?'✕ Close student screens':'🖥 Student Screens'}
    window.ClassPointerDashboard?.setStudentScreenSharing(on&&mode==='screens').catch(error=>B.status('Could not update screen sharing permission: '+error.message));
    if(on){stage.dispatchEvent(new PointerEvent('pointerleave'));setFocus(null);B.status(mode==='screens'?'Students were asked to share their screens. Their screens appear in the tiles.':'Student whiteboards are open. Click a board to see it large and write on it. Use 🖥 Screens to see students’ screens instead.')}
    else B.status('Student boards closed. Everyone is back to the lesson. Whiteboards are kept until the class ends.');
  }
  function setMode(next){
    if(next===mode)return;
    mode=next;drawer?.cancel();
    window.ClassPointerDashboard?.setStudentScreenSharing(on&&mode==='screens').catch(error=>B.status('Could not update screen sharing permission: '+error.message));
    for(const m of admitted())sendMode(m);
    setFocus(focusId);
    B.status(mode==='screens'?'Students were asked to share their screens. Their screens appear in the tiles (view only).':'Students are back on their whiteboards.');
  }
  async function sendEveryone(destination){
    if(!B.started()){B.fail('Wait for your classroom to finish opening, then try again.');return}
    const buttons=[sendScreens,sendBoards,dockScreens,dockBoards];
    buttons.forEach(b=>b.disabled=true);
    try{
      // Publish the right mode before directing students to the classroom.
      // Students already connected receive board-mode immediately; new arrivals
      // receive it from studentJoined() once they enter the same class.
      if(!on){mode=destination;setOn(true)}
      else if(mode!==destination)setMode(destination);
      const dashboard=window.ClassPointerDashboard;
      if(!dashboard?.requestStudentDestination)throw Error('Classroom broadcast is not ready.');
      await loadPermissionsRoster();
      await permissionsWrite;
      await dashboard.requestStudentDestination(destination,policy());
      B.status(destination==='screens'
        ?'Sent this class to Screen Sharing. Each boy clicks Share my screen and approves the browser prompt.'
        :'Sent this class to individual Whiteboards. Their boards will appear here as they join.');
    }catch(error){
      B.fail('Could not send the class: '+(error?.message||'Please try again.'));
    }finally{buttons.forEach(b=>b.disabled=false)}
  }
  function toggleBlock(m){
    const key=keyFor(m);if(blocked.has(key))blocked.delete(key);else blocked.add(key);
    drawer?.cancel();sendMode(m);syncTiles();dirty(m.id);
    B.status(blocked.has(key)?m.name+' is paused.':m.name+' is allowed again.');
  }
  // The teacher writes on the board that is open large; the same change goes to that student.
  function act(op){const m=focusMember();if(!m||!on||mode!=='boards'||isBlocked(m))return;if(applyOp(boardFor(m),op,'teacher'))B.send(m.connection,op);dirty(m.id)}
  drawer=attachDrawing(canvas,{by:'teacher',tools,enabled:()=>{const m=focusMember();return on&&mode==='boards'&&!!m&&!isBlocked(m)},board:()=>focusBoard()||emptyBoard(),apply:act,
    send:op=>{const m=focusMember();if(m&&on&&mode==='boards')B.send(m.connection,op)},redraw:()=>{if(focusId)dirty(focusId)}});

  document.addEventListener('classpointer:send-to-whiteboards',()=>void sendEveryone('boards'));
  document.addEventListener('classpointer:send-to-screens',()=>void sendEveryone('screens'));
  toggle?.addEventListener('click',()=>setOn(!on));
  setInterval(()=>{if(toggle)toggle.disabled=!on&&!B.started();if(on)syncTiles()},700);
  new ResizeObserver(()=>{if(!on)return;layoutGrid();if(focusId)dirty(focusId)}).observe(stage);
  controls();renderPermissions();void loadPermissionsRoster();

  window.ClassPointerBoards={
    fromStudent(m,message){
      if(!on)return;
      if(message.type==='board-screen'){if(message.sharing!==true){closeScreen(m);dirty(m.id)}return}
      if(mode!=='boards'||isBlocked(m)||excluded(m,'boards'))return;
      if(applyOp(boardFor(m),message,'student'))dirty(m.id);
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
    studentJoined(m){const b=boardFor(m);b.drafts={student:null,teacher:null};renderPermissions();if(on){sendMode(m);syncTiles()}},
    studentLeft(m){closeScreen(m);if(m.boardKey&&boards.has(m.boardKey))boards.get(m.boardKey).drafts={student:null,teacher:null};if(on)syncTiles()},
    endClass(){
      drawer?.cancel();for(const m of B.members().values())closeScreen(m);
      // The enclosing classroom ends by deleting the entire Firebase session.
      // Do not send an asynchronous child update here: it could recreate an
      // orphan studentScreenSharing flag after the session is removed.
      boards.clear();blocked.clear();denied.screens.clear();denied.boards.clear();classStudents=[];permissionsLoad=null;renderPermissions();chooseActivity(null,dirtyAll);mode='screens';controls();
      for(const tile of tiles.values()){tile.video.srcObject=null;tile.node.remove()}tiles.clear();
      if(on){on=false;focusId=null;view.hidden=true}
      if(toggle){toggle.setAttribute('aria-pressed','false');toggle.textContent='🖥 Student Screens';toggle.disabled=true}
    }
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

