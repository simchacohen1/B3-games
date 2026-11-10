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
  const ITEM_TOOLS=['highlight','rect','ellipse','line','arrow','text'],ITEM_SIZES=SIZE_VALUES.concat([0.02,0.045]);
  function cleanStroke(s){
    if(!s||typeof s.id!=='string'||!/^[a-z0-9-]{2,40}$/i.test(s.id)||!COLORS.includes(s.color)||!Array.isArray(s.points)||!s.points.length||s.points.length>MAX_POINTS||!s.points.every(validPoint))return null;
    const tool=s.tool==null||s.tool==='pen'?null:s.tool;
    if(tool!==null&&!ITEM_TOOLS.includes(tool))return null;
    if(!(tool?ITEM_SIZES:SIZE_VALUES).includes(s.size))return null;
    const out={id:s.id,color:s.color,size:s.size,points:s.points.map(p=>({x:round(p.x),y:round(p.y)}))};
    if(tool){
      if(tool==='text'){if(typeof s.text!=='string'||!s.text.trim()||s.text.length>200||out.points.length!==1)return null;out.text=s.text}
      else if(tool!=='highlight'&&out.points.length!==2)return null;
      out.tool=tool;
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
      if(!s||s.id[0]!==by[0]||board.strokes.length>=MAX_STROKES||board.strokes.some(item=>item.id===s.id)||(s.image&&pictureCount(board)>=MAX_IMAGES))return false;
      s.by=by;board.strokes.push(s);board.drafts[by]=null;return true;
    }
    // Move or resize one of my own marks without sending it again (a picture stays where it is in the pile).
    if(op.type==='board-move'){
      const old=board.strokes.find(item=>item.by===by&&item.id===op.id);if(!old)return false;
      const s=cleanStroke({...old,id:typeof op.newId==='string'?op.newId:old.id,points:op.points});
      if(!s||s.id[0]!==by[0]||s.points.length!==old.points.length||(s.id!==old.id&&board.strokes.some(item=>item.id===s.id)))return false;
      s.by=by;board.strokes[board.strokes.indexOf(old)]=s;return true;
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
    if(Array.isArray(list))for(const raw of list.slice(0,MAX_STROKES)){const s=cleanStroke(raw);if(s&&!(s.image&&pictureCount(board)>=MAX_IMAGES)){s.by=raw.by==='teacher'?'teacher':'student';board.strokes.push(s)}}
    return board;
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
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||pid!==null||!o.enabled())return;
      event.preventDefault();pid=event.pointerId;canvas.setPointerCapture(pid);
      const p=pos(event);
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
      if(grab){movePicture(pos(event),true);grab=null}
      else if(o.tools.tool==='move'&&o.board().text)moveWord(pos(event),true);
      pid=null;if(draft)commit();
    };
    canvas.addEventListener('pointerup',finish);canvas.addEventListener('lostpointercapture',finish);
    canvas.addEventListener('pointercancel',event=>{if(event.pointerId!==pid)return;pid=null;grab=null;dropDraft()});
    return{
      draft:()=>draft,
      point:()=>hover,
      cancel(){if(pid!==null&&canvas.hasPointerCapture?.(pid))canvas.releasePointerCapture(pid);pid=null;grab=null;if(draft)dropDraft()}
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
    return{root,update,say};
  }

  // =====================================================================
  // Student page. Mode "boards": a private whiteboard. Mode "screens": share my screen with the teacher.
  // The teacher may pause ("block") one student; then that student sees a short message instead.
  // =====================================================================
  if(!isTeacher){
    let on=false,mode='boards',blocked=false,board=emptyBoard(),drawer=null,stream=null,call=null,shareWindow=null;
    const view=el('div','boards-view student-board');view.id='myBoard';view.dataset.stageUi='true';view.hidden=true;view.setAttribute('aria-label','My whiteboard');
    const bar=el('div','boards-bar'),title=el('strong','boards-title'),drawGroup=el('span','boards-group');
    const focus=el('div','boards-focus'),surface=el('div','board-fit'),canvas=el('canvas');
    canvas.setAttribute('aria-label','My whiteboard. Draw with the mouse, pen or finger.');
    bar.append(title,drawGroup);
    const tools=makeTools(drawGroup,COLORS[0],st=>{drawer?.cancel();surface.classList.toggle('erasing',st.tool==='eraser');surface.classList.toggle('moving',st.tool==='move')});
    drawGroup.append(
      button('↶ Undo','Undo my last line',()=>{const mine=board.strokes.filter(s=>s.by==='student');const last=mine[mine.length-1];if(last)act({type:'board-remove',ids:[last.id]})}),
      button('🗑 Clear','Clear everything I drew',()=>{if(board.strokes.some(s=>s.by==='student')&&confirm('Clear everything you drew on your board?'))act({type:'board-clear'})},'danger'));
    // What is picked with the drawing toolbar's Select tool (when the toolbar reports it).
    const pickedId=()=>{const state=window.FTTAnnotate?.state?.();return state?.surface==='board'?state.selected||null:null};
    const clip=clipboardTools(bar,{by:'student',priority:3,tools,open:()=>on&&mode==='boards'&&!blocked&&!view.hidden&&canvas.getClientRects().length>0,key:()=>'mine',board:()=>board,act:op=>act(op),point:()=>drawer?.point(),selected:pickedId});
    const editWord=wordEditor(bar,()=>board,text=>act({type:'board-text',text}),tools);
    const full=button('⛶ Full screen','Full screen',()=>(expanded()?$('exitFullScreenLesson'):$('fullScreenLesson'))?.click());
    bar.append(el('span','boards-spacer'));
    if(!B.embedded)bar.append(full);
    else{
      const back=button('↩ Back to Activity','Hide the whiteboard without losing your drawing',()=>{
        stage.style.display='none';returnBoard.hidden=false;
      });
      const returnBoard=button('📝 Show My Whiteboard','Return to your whiteboard',()=>{
        if(on&&mode==='boards'&&!blocked){stage.style.display='block';returnBoard.hidden=true;redraw()}
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
    // While the teacher is showing the lesson, nobody starts a new share. A share that is already running keeps its Stop button.
    const lessonShowing=()=>B.presenting?.()===true;
    const WAIT_FOR_LESSON='Your teacher is showing the lesson now. You can share your screen when the lesson stops.';
    sharePanel.append(shareText,shareBtn,preview,shareNote);
    // Paused panel.
    const pausedPanel=el('div','board-panel');pausedPanel.append(el('p','board-panel-text','⏸ Your teacher paused this for you.'),el('p','board-panel-note','Please wait. Your teacher can turn it back on.'));
    surface.appendChild(canvas);focus.append(surface,sharePanel,pausedPanel);view.append(bar,focus);stage.appendChild(view);shield(view);

    function ui(){
      const boardsOn=on&&mode==='boards'&&!blocked,screensOn=on&&mode==='screens'&&!blocked;
      title.textContent=mode==='screens'?'🖥 Share my screen':'📝 My board';
      drawGroup.hidden=!boardsOn;surface.hidden=!boardsOn;sharePanel.hidden=!screensOn;pausedPanel.hidden=!(on&&blocked);
      editWord.update();editWord.root.hidden=!boardsOn||activity?.kind!=='word';
      clip.root.hidden=!boardsOn||!Clip;clip.update();
      shareBtn.hidden=lessonShowing()&&!stream;
      shareText.textContent=stream?'✅ Your screen is being shared from this Pointer page.':lessonShowing()?WAIT_FOR_LESSON:'Use Share My Screen to open the same blue Share / red Stop Sharing controls used in your activities. Choose Entire Screen and keep that window open.';
      shareBtn.textContent=stream?'⏹ Stop Sharing':(shareWindow&&!shareWindow.closed?'↗ Sharing window open':'🖥 Share My Screen');shareBtn.classList.toggle('sharing',!!stream||!!(shareWindow&&!shareWindow.closed));
      preview.hidden=!stream;if(stream&&preview.srcObject!==stream){preview.srcObject=stream;preview.play().catch(()=>{})}if(!stream)preview.srcObject=null;
      full.textContent=expanded()?'⤢ Exit full screen':'⛶ Full screen';
    }
    const redraw=scheduler(()=>{if(view.hidden)return;ui();if(!surface.hidden){fit(focus,surface);paint(canvas,board,drawer?.draft())}});
    pictureLoaded=redraw;clipReady.then(redraw);
    document.addEventListener('classpointer:teacher-presenting',()=>redraw());
    function openShareWindow(){
      if(lessonShowing()){shareNote.textContent=WAIT_FOR_LESSON;redraw();return}
      if(shareWindow&&!shareWindow.closed){shareWindow.focus?.();return}
      const url=new URL('student-share-window.html?pointerShare=1',location.href);
      shareWindow=window.open(url.href,'classPointerStudentShare');
      if(shareWindow){shareNote.textContent='Sharing window opened. Approve Entire Screen there and leave it open while visiting activities.';shareWindow.focus?.();return}
      shareNote.textContent='Your browser blocked the separate window. You can share from this page, but navigation will stop sharing.';
      void startShare('screen');
    }
    function act(op){if(!on||mode!=='boards'||blocked)return;if(applyOp(board,op,'student'))B.sendTeacher(op);redraw()}
    // My whiteboard as a surface for the shared drawing toolbar. Its marks are ordinary board lines, so the teacher
    // sees them live in my tile, and my own Undo / Clear / Eraser work on them too.
    const boardOpen=()=>on&&mode==='boards'&&!blocked;
    const boardSurface={id:'board',idPrefix:'s',defaultTool:'pen',renders:true,maxItems:MAX_STROKES,maxPoints:MAX_POINTS,
      label:'Drawing on your whiteboard. Your teacher sees it.',
      rect:()=>{if(!boardOpen()||view.hidden||surface.hidden)return null;const r=canvas.getBoundingClientRect();return r.width&&r.height?r:null},
      getItems:()=>board.strokes.filter(item=>item.by==='student'),
      setItems(list){
        const mine=board.strokes.filter(item=>item.by==='student'),keep=new Set(list.map(item=>item.id)),had=new Set(mine.map(item=>item.id));
        const gone=mine.filter(item=>!keep.has(item.id)),moved=new Set();
        // A picture that was only moved keeps its picture: send its new place, not the whole picture again.
        for(const item of list){
          const from=!had.has(item.id)&&item.image?gone.find(old=>old.image===item.image&&!moved.has(old.id)):null;
          if(from){moved.add(from.id);moved.add(item.id);act({type:'board-move',id:from.id,newId:item.id,points:item.points})}
        }
        const removed=gone.filter(item=>!moved.has(item.id)).map(item=>item.id);
        if(removed.length)act({type:'board-remove',ids:removed});
        for(const item of list)if(!had.has(item.id)&&!moved.has(item.id)){const {by,...stroke}=item;act({type:'board-add',stroke})}
      },
      live(draft){if(!boardOpen())return;const op={type:'board-draft',stroke:draft||null};applyOp(board,op,'student');B.sendTeacher(op);redraw()}};
    // The toolbar is there only while my whiteboard is open (or while I share my screen).
    function syncAnnotate(){
      const FA=window.FTTAnnotate;if(!FA)return;
      if(boardOpen())FA.push(boardSurface);
      FA.setReason('whiteboard',boardOpen());
      if(!boardOpen())FA.release(boardSurface);
    }
    drawer=attachDrawing(canvas,{by:'student',tools,enabled:()=>on&&mode==='boards'&&!blocked,board:()=>board,apply:act,send:op=>{if(on&&mode==='boards'&&!blocked)B.sendTeacher(op)},redraw});

    async function startShare(){
      shareNote.textContent='';
      if(lessonShowing()){shareNote.textContent=WAIT_FOR_LESSON;return}
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
      redraw();
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
        board=on&&mode==='boards'&&!blocked?boardFromMessage(message.strokes,message.text):emptyBoard();
        // In embedded mode, screens are shared via the existing activity button;
        // never cover Shorashim with the old Pointer screen-sharing panel.
        show(on&&!(B.embedded&&mode==='screens'));
        if(!on){if(was)B.status('Your teacher closed the boards. Back to the lesson.')}
        else if(blocked){if(!wasBlocked)B.status('Your teacher paused your board for now.')}
        else if(!was||wasMode!==mode||wasBlocked)B.status(mode==='screens'?'Your teacher asked you to share your screen. Click Share my screen.':'Your teacher opened your own whiteboard. Draw with the pen. Your teacher can see your board.');
        syncAnnotate();
      }else if(on&&mode==='boards'&&!blocked)applyOp(board,message,'teacher');
      redraw();return true;
    }
    new ResizeObserver(redraw).observe(stage);document.addEventListener('fullscreenchange',redraw);
    // ---------- Save and restore (used by "Save whiteboard") ----------
    // Everything on my board, in drawing order. A pasted picture is a mark with an `image`; `images` lists their ids.
    function exportBoard(){
      if(!boardOpen())return null;
      return{version:1,kind:'student-board',strokes:board.strokes.map(s=>({...s,points:s.points.map(p=>({x:p.x,y:p.y}))})),
        images:board.strokes.filter(s=>s.image).map(s=>s.id),text:board.text?{...board.text}:null,activity:activity?{...activity}:null};
    }
    // Replaces my own marks with the saved ones. Saved data is checked like anything from the network, sent to the
    // teacher as normal board changes (so every limit holds), and the teacher's marks and activity are left alone.
    function importBoard(data){
      if(!boardOpen()||!data||data.version!==1||data.kind!=='student-board'||!Array.isArray(data.strokes))return false;
      act({type:'board-clear'});
      for(const raw of data.strokes.slice(0,MAX_STROKES)){
        if(!raw||raw.by==='teacher')continue;
        const stroke=cleanStroke({...raw,id:newId('s')});
        if(stroke)act({type:'board-add',stroke});
      }
      const word=cleanWord(data.text);
      if(word&&activity?.kind==='word'&&board.text)act({type:'board-text',text:word});
      return true;
    }
    const exportPng=()=>boardOpen()?boardPng(board):Promise.reject(Error('Your whiteboard is not open.'));
    window.ClassPointerBoards={fromTeacher,clearScreenMarks,exportBoard,importBoard,exportPng,reset(){clearScreenMarks();drawer.cancel();stopShare(false);on=false;blocked=false;mode='boards';chooseActivity(null,redraw);board=emptyBoard();show(false);syncAnnotate()}};
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
  const cancelPaste=button('Cancel','Close the paste preview',()=>closePreview());
  previewPanel.append(previewTitle,previewBody,confirmPaste,cancelPaste);pastePreview.append(previewPanel);stage.appendChild(pastePreview);
  let pendingPaste=null;
  function closePreview(){pendingPaste=null;pastePreview.hidden=true;pastePreview.style.display='none';previewBody.replaceChildren()}
  function showPaste(value){
    pendingPaste=value;previewBody.replaceChildren();
    if(value.kind==='word')previewBody.append(el('p',null,value.text));
    else{
      const img=el('img');img.src=URL.createObjectURL(value.file);img.alt='Copied picture preview';img.style.cssText='max-width:100%;max-height:45vh;object-fit:contain';
      img.addEventListener('load',()=>URL.revokeObjectURL(img.src),{once:true});
      previewBody.append(img);
    }
    if(value.note)previewBody.append(el('p',null,value.note));
    pastePreview.hidden=false;pastePreview.style.display='flex';confirmPaste.focus();
  }
  async function commitPaste(){
    const item=pendingPaste;if(!item)return;
    closePreview();
    if(item.kind==='image')await sendImageFile(item.file);
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
  activityBar.append(el('strong',null,'Send to all boards:'),wordInput,instructionInput,sendWord,sendImage,pasteAll,removeActivity,imageFile,activityLabel,el('span','boards-paste-hint','📋 Ctrl+V here to send copied text or pictures'));
  wordInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendWord.click()}});
  imageFile.addEventListener('change',async()=>{
    const file=imageFile.files?.[0];imageFile.value='';
    if(file)await sendImageFile(file);
  });
  async function sendImageFile(file){
    if(!/^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type)||file.size>8*1024*1024){B.fail('Please choose a JPG, PNG, WebP or GIF smaller than 8 MB.');return}
    sendImage.disabled=true;activityLabel.textContent='Preparing picture…';
    try{
      const data=await pictureData(file);
      if(!data)throw Error('Picture is too large to send to the class. Try a simpler or smaller image.');
      sendActivity({kind:'image',data});
    }catch(e){B.fail(e.message||'Could not load that picture.')}
    finally{sendImage.disabled=false;updateActivityLabel()}
  }

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
    activityLabel.textContent=activity?.kind==='word'?'Showing: '+activity.text:activity?.kind==='image'?'Coloring page sent to all students':'Boards are blank now';
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

  const grid=el('div','boards-grid'),empty=el('p','boards-empty','No students have joined yet. Their tiles appear here as they join.');
  // Screens mode: who is in the class but has not started sharing yet (live; see renderWaiting).
  const waiting=el('div','boards-waiting');waiting.hidden=true;waiting.setAttribute('role','status');waiting.setAttribute('aria-live','polite');
  view.append(gridBar,gridPermissions,waiting,activityBar,focusBar,grid,empty,focus);stage.appendChild(view);shield(view);

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
  function boardFor(m){const key=keyFor(m);let b=boards.get(key);if(!b){b=emptyBoard();boards.set(key,b)}return b}
  const isBlocked=m=>blocked.has(keyFor(m));
  const focusMember=()=>focusId?admitted().find(m=>m.id===focusId)||null:null;
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
    if(mode==='boards'){message.activity=activity;if(!paused){const b=boardFor(m);b.drafts={student:null,teacher:null};message.strokes=b.strokes;message.text=b.text}}
    B.send(m.connection,message);
  }

  // ---------- Painting (only tiles that changed, once per frame) ----------
  const dirtySet=new Set();let frame=0;
  function dirty(id){dirtySet.add(id);if(!frame)frame=requestAnimationFrame(flush)}
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
  function flush(){
    frame=0;
    if(!view.hidden)for(const id of dirtySet){
      const m=admitted().find(entry=>entry.id===id);if(!m)continue;
      const disabled=excluded(m,mode),paused=isBlocked(m)||disabled,screens=mode==='screens',tile=tiles.get(id),live=screens?streamOf(m):null;
      if(tile&&!grid.hidden){
        tile.node.classList.toggle('blocked',paused);tile.node.classList.toggle('screen',screens);
        tile.block.textContent=paused?'✅':'🚫';tile.block.title=(paused?'Allow ':'Pause ')+m.name;tile.block.setAttribute('aria-label',tile.block.title);
        tile.note.textContent=disabled?'Not selected for '+(screens?'screen sharing':'whiteboard'):paused?'⏸ Paused':screens&&!live?'Waiting for their screen…':'';
        tile.canvas.hidden=screens;tile.video.hidden=!screens||paused||!live;
        setVideo(tile.video,screens&&!paused?live:null);
        if(!screens){const b=boardFor(m);paint(tile.canvas,b,null);tile.node.classList.toggle('drawing',!paused&&!!b.drafts.student)}else tile.node.classList.remove('drawing');
      }
      if(id===focusId){
        focusBlock.textContent=paused?'✅ Allow':'🚫 Pause';focusBlock.title=(paused?'Allow ':'Pause ')+m.name;
        drawGroup.hidden=screens||paused;surface.hidden=screens||paused;screenBox.hidden=!screens||paused;pausedBox.hidden=!paused;
        focusWord.update();focusWord.root.hidden=screens||paused||activity?.kind!=='word';
        focusClip.root.hidden=screens||paused||!Clip;focusClip.update();
        if(screens&&!paused){setVideo(screenVideo,live);screenVideo.hidden=!live;screenNote.hidden=!!live;screenNote.textContent='Waiting for '+m.name+' to share their screen…'}
        else setVideo(screenVideo,null);
        screenInk?.refresh();
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
    const list=mode==='screens'?present.filter(m=>!excluded(m,'screens')&&!!streamOf(m)):present.filter(m=>!excluded(m,'boards'));
    const ids=new Set(list.map(m=>m.id));
    for(const [id,tile] of tiles)if(!ids.has(id)){tile.video.srcObject=null;tile.node.remove();tiles.delete(id)}
    for(const m of list)if(!tiles.has(m.id)){const tile=makeTile(m);grid.appendChild(tile.node);tiles.set(m.id,tile);dirty(m.id)}
    const paused=list.filter(isBlocked).length;
    count.textContent=list.length?list.length+(list.length===1?(mode==='screens'?' screen':' whiteboard'):(mode==='screens'?' screens':' whiteboards'))+(paused?' · '+paused+' paused':''):'';
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
    updateActivityLabel();
  }
  function sendActivity(next){
    if(!on||mode!=='boards')return;
    const item=cleanActivity(next);
    if(next&&!item){B.fail('Please enter a word or choose a valid picture.');return}
    const hasWork=Array.from(boards.values()).some(b=>b.strokes.length||(activity?.kind==='word'&&b.text&&JSON.stringify(b.text)!==JSON.stringify(defaultWord())));
    if(hasWork&&!confirm('This will erase the students\' current marks and start a new activity. Continue?'))return;
    boards.clear();chooseActivity(item,dirtyAll);
    for(const m of admitted())sendMode(m);
    dirtyAll();updateActivityLabel();
    B.status(item?.kind==='word'?'The word is on every student\'s board. Their answers appear live.':item?.kind==='image'?'The coloring page is on every student\'s board. Watch them color in real time.':'All boards are blank.');
  }
  function setFocus(id){
    drawer?.cancel();focusId=id&&admitted().some(m=>m.id===id)?id:null;const m=focusMember();
    focusBar.hidden=!m;gridBar.hidden=!!m;activityBar.hidden=!!m||mode!=='boards';focus.hidden=!m;focusWord.root.hidden=!m||mode!=='boards'||activity?.kind!=='word';if(m)who.textContent=m.name+(mode==='screens'?'’s screen':'’s board');
    if(!m)setVideo(screenVideo,null);
    screenInk?.refresh();
    controls();gridSize='';syncTiles();if(m)dirty(m.id);else dirtyAll();
  }
  function setOn(next){
    if(next&&!B.started())return;
    on=next;suspended=false;if(!next)++workspaceRevision;drawer?.cancel();focusId=null;gridSize='';
    screenPermissionEnabled=next?(screenPermissionEnabled||mode==='screens'):false;
    for(const m of admitted())sendMode(m);
    view.hidden=!on;screenInk?.refresh();
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
    suspended=true;view.hidden=true;focusId=null;gridSize='';
    setVideo(screenVideo,null);screenInk?.refresh();
    for(const tile of tiles.values())setVideo(tile.video,null);
    // Hide student whiteboards so My Screen can appear, without revoking any
    // student's ongoing screen capture or erasing board contents.
    for(const m of admitted())B.send(m.connection,{type:'board-mode',on:false});
    document.dispatchEvent(new Event('classpointer:sharing-state'));
    B.status('Back to My screen. Student screens and whiteboards are kept; open their tab any time.');
  }
  function toggleBlock(m){
    const key=keyFor(m);if(blocked.has(key))blocked.delete(key);else blocked.add(key);
    drawer?.cancel();sendMode(m);syncTiles();dirty(m.id);
    // A student sharing from Shorashim or another activity is not joined to Pointer, so hiding his video is not enough:
    // record the pause as a screen-sharing permission so his browser stops capturing and the teacher stops receiving.
    if(mode==='screens'){const person=personId(m);if(person)updatePermission(person,'screens',!blocked.has(key))}
    B.status(blocked.has(key)?m.name+' is paused.':m.name+' is allowed again.');
  }
  // The teacher writes on the board that is open large; the same change goes to that student.
  function act(op){const m=focusMember();if(!m||!on||mode!=='boards'||isBlocked(m))return;if(applyOp(boardFor(m),op,'teacher'))B.send(m.connection,op);dirty(m.id)}
  drawer=attachDrawing(canvas,{by:'teacher',tools,enabled:()=>{const m=focusMember();return on&&mode==='boards'&&!!m&&!isBlocked(m)},board:()=>focusBoard()||emptyBoard(),apply:act,
    send:op=>{const m=focusMember();if(m&&on&&mode==='boards')B.send(m.connection,op)},redraw:()=>{if(focusId)dirty(focusId)}});

  document.addEventListener('classpointer:send-to-whiteboards',()=>void sendEveryone('boards'));
  document.addEventListener('classpointer:send-to-screens',()=>void sendEveryone('screens'));
  // A boy sharing from Shorashim (or another activity) connected, changed or stopped: refresh the tiles and the large viewer.
  document.addEventListener('classpointer:activity-screens',()=>{if(on){syncTiles();dirtyAll()}});
  toggle?.addEventListener('click',()=>setOn(!on));
  setInterval(()=>{if(toggle)toggle.disabled=!on&&!B.started();if(on)syncTiles()},700);
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
    // A PNG picture of the student board that is open large.
    exportPng(){const board=focusBoard();return board&&mode==='boards'?boardPng(board):Promise.reject(Error('Open one student whiteboard first.'))},
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
    studentJoined(m){window.ClassPointerScreenMarks?.resend(m);const b=boardFor(m);b.drafts={student:null,teacher:null};renderPermissions();if(on){sendMode(m);syncTiles()}},
    studentLeft(m){closeScreen(m);if(m.boardKey&&boards.has(m.boardKey))boards.get(m.boardKey).drafts={student:null,teacher:null};if(on)syncTiles()},
    endClass(){
      window.ClassPointerScreenMarks?.reset();drawer?.cancel();for(const m of B.members().values())closeScreen(m);
      // The enclosing classroom ends by deleting the entire Firebase session.
      // Do not send an asynchronous child update here: it could recreate an
      // orphan studentScreenSharing flag after the session is removed.
      boards.clear();blocked.clear();denied.screens.clear();denied.boards.clear();classStudents=[];permissionsLoad=null;renderPermissions();chooseActivity(null,dirtyAll);mode='screens';suspended=false;screenPermissionEnabled=false;++workspaceRevision;controls();
      for(const tile of tiles.values()){tile.video.srcObject=null;tile.node.remove()}tiles.clear();
      if(on){on=false;focusId=null;view.hidden=true}
      if(toggle){toggle.setAttribute('aria-pressed','false');toggle.textContent='🖥 Student Screens';toggle.disabled=true}
    }
  };

  // ---------- Shared whiteboard: a blank page in the lesson for everyone ----------
  $('openWhiteboard')?.addEventListener('click',async()=>{
    if(!window.ClassPointerPdf?.openSnapshot)return;
    // Opening the shared whiteboard only hides the student gallery. It must not switch off student screen
    // sharing: screens that are already shared keep going (setOn(false) ended every one of them).
    if(on&&!suspended)hideWorkspace();
    const c=document.createElement('canvas');c.width=1600;c.height=900;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
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
