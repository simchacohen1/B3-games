'use strict';
/* Teacher → student: point and draw on a student's shared screen.
   When the teacher opens one student's live screen large (Student screens gallery or the floating
   screen tray), a small toolbar appears over it: Watch, Point, Pen, Highlight, colors, Undo, Clear.
   Marks use positions from 0 to 1 across and down the student's captured screen. They travel to that
   student's own browser tabs over the existing, server-verified PeerJS data connections as two small
   messages ("board-screen-live" for the moving pointer and the line being drawn, "board-screen-marks"
   for finished lines). The student's page shows them in a see-through layer on top of his screen
   (student-boards.js). Nothing is stored online, and the student cannot draw back through this channel. */
(function(){
  const B=window.ClassPointerBridge;
  if(!B||!B.isTeacher)return;
  const COLORS=[['#ef4444','Red'],['#facc15','Yellow'],['#22c55e','Green'],['#3b82f6','Blue'],['#111827','Black']];
  const TOOLS=[['watch','👀','Watch','Just watch. Your mouse does nothing on the student’s screen.'],
    ['point','👆','Point','Move your mouse over the screen. The student sees a red “Teacher” pointer.'],
    ['pen','✏️','Pen','Draw on the student’s screen.'],
    ['highlight','🖍','Highlight','Mark over words on the student’s screen.']];
  const SIZES={pen:.004,highlight:.02},MAX_STROKES=80,MAX_POINTS=400,LIVE_MS=50;
  const marks=new Map(); // student id -> {strokes:[], seq}
  let shared={tool:'watch',color:COLORS[0][0]};
  const hosts=new Set();
  const valid=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  const round=v=>Math.round(v*1e4)/1e4;
  const record=id=>{let r=marks.get(id);if(!r){r={strokes:[],seq:0};marks.set(id,r)}return r};

  // Every open, admitted connection of this student: he may have several tabs; whichever one he is
  // looking at shows the marks. The student id was confirmed by the server when he connected.
  function connections(target){
    const list=[];
    const add=m=>{if(m?.admitted&&m.connection?.open&&!list.includes(m.connection))list.push(m.connection)};
    if(target.id){
      for(const m of B.presence?.().values()||[])if(m.studentId===target.id)add(m);
      for(const m of B.members?.().values()||[])if(m.studentId===target.id)add(m);
    }
    for(const m of target.members||[])add(m);
    return list;
  }
  function sendTo(target,message){for(const c of connections(target))B.send(c,message)}

  function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  function btn(text,title,onClick,cls){const b=el('button',cls,text);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.addEventListener('click',onClick);return b}

  /* host: positioned element that holds the video. getTarget(): {id, name, members?} for the student
     whose screen is shown large, or null when this host is not the one in use. */
  function attach(host,video,getTarget){
    const bar=el('div','cp-screen-tools');bar.dataset.stageUi='true';bar.setAttribute('role','toolbar');
    const canvas=el('canvas','cp-screen-ink');canvas.dataset.stageUi='true';
    canvas.setAttribute('aria-label','Student screen. Your pointer and drawings appear on the student’s own screen.');
    const toolButtons=new Map(),colorButtons=new Map();
    const tools=el('span','cp-screen-group');
    for(const [tool,icon,name,help] of TOOLS){const b=btn(icon+' '+name,help,()=>{shared.tool=tool;hideLivePoint();syncAll()});tools.append(b);toolButtons.set(tool,b)}
    const swatches=el('span','cp-screen-group cp-screen-swatches');swatches.setAttribute('role','group');swatches.setAttribute('aria-label','Drawing color');
    for(const [color,name] of COLORS){const b=btn('',name,()=>{shared.color=color;if(shared.tool==='watch'||shared.tool==='point')shared.tool='pen';syncAll()});b.style.setProperty('--c',color);swatches.append(b);colorButtons.set(color,b)}
    const undo=btn('↶ Undo','Undo your last mark on this student’s screen',()=>{const t=current();if(!t)return;const r=record(t.id);r.strokes.pop();sendMarks(t);render()});
    const clear=btn('🧽 Clear','Erase all your marks from this student’s screen',()=>{const t=current();if(!t)return;record(t.id).strokes=[];sendMarks(t);render()});
    const help=el('span','cp-screen-help');help.setAttribute('role','status');
    const edits=el('span','cp-screen-group');edits.append(undo,clear);
    bar.append(tools,swatches,edits,help);
    // The toolbar sits above the picture (never over the student's work); the ink layer sits exactly on the picture.
    host.prepend(bar);host.append(canvas);
    // Clicks here must never move the teacher's own lesson pointer or close the enlarged view.
    for(const type of ['pointerdown','pointermove','pointerup','click','dblclick','wheel'])bar.addEventListener(type,e=>e.stopPropagation());

    let draft=null,pid=null,livePoint=null,liveTimer=0,lastLive=0,frame=0,lastTarget=null;
    function current(){const t=getTarget();return t&&t.id&&video.srcObject&&video.videoWidth?t:null}
    function sendMarks(t){sendTo(t,{type:'board-screen-marks',strokes:record(t.id).strokes})}
    function sendLive(force){
      const t=current();if(!t)return;
      const go=()=>{liveTimer=0;lastLive=Date.now();sendTo(t,{type:'board-screen-live',point:livePoint,draft:draft?{...draft,points:draft.points.slice()}:null})};
      clearTimeout(liveTimer);liveTimer=0;
      const wait=LIVE_MS-(Date.now()-lastLive);
      if(force||wait<=0)go();else liveTimer=setTimeout(go,wait);
    }
    function hideLivePoint(){if(livePoint||draft){livePoint=null;draft=null;sendLive(true);render()}}
    // The picture inside the video element (object-fit: contain leaves dark bars at the sides).
    function picture(){
      const hr=host.getBoundingClientRect(),vr=video.getBoundingClientRect(),w=video.videoWidth,h=video.videoHeight;
      if(!w||!h||!vr.width||!vr.height)return null;
      const s=Math.min(vr.width/w,vr.height/h),pw=w*s,ph=h*s;
      return{left:vr.left-hr.left+(vr.width-pw)/2,top:vr.top-hr.top+(vr.height-ph)/2,width:pw,height:ph};
    }
    function pos(e){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return null;const p={x:round((e.clientX-r.left)/r.width),y:round((e.clientY-r.top)/r.height)};return valid(p)?p:null}
    function drawStroke(ctx,s,w,h){
      const pts=s.points;if(!pts.length)return;
      ctx.save();ctx.globalAlpha=s.tool==='highlight'?.38:1;ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.lineWidth=Math.max(2,s.size*w);ctx.beginPath();ctx.moveTo(pts[0].x*w,pts[0].y*h);
      if(pts.length===1)ctx.lineTo(pts[0].x*w+.1,pts[0].y*h);
      for(const p of pts.slice(1))ctx.lineTo(p.x*w,p.y*h);
      ctx.stroke();ctx.restore();
    }
    function render(){
      frame=0;
      const t=current(),box=t&&picture();
      const showBar=!!t;bar.hidden=!showBar;canvas.hidden=!box;
      // Switched to another student (or closed the large view): take the pointer off the previous screen.
      if(lastTarget?.id!==t?.id){if(lastTarget){livePoint=null;draft=null;pid=null;sendTo(lastTarget,{type:'board-screen-live',point:null,draft:null})}}
      lastTarget=t;
      for(const [tool,b] of toolButtons)b.setAttribute('aria-pressed',String(tool===shared.tool));
      for(const [color,b] of colorButtons)b.setAttribute('aria-pressed',String(color===shared.color));
      const r=t?record(t.id):null;undo.disabled=!r?.strokes.length;clear.disabled=!r?.strokes.length;
      help.textContent=!t?'':shared.tool==='watch'?'Choose 👆 Point or ✏️ Pen to show '+t.name+' something. He sees it on his own screen.':
        shared.tool==='point'?t.name+' sees your red pointer on his screen.':t.name+' sees your drawing on his screen. Use 🧽 Clear when you are done.';
      canvas.style.cursor=shared.tool==='watch'?'default':shared.tool==='point'?'none':'crosshair';
      canvas.style.pointerEvents=shared.tool==='watch'?'none':'auto';
      if(!box)return;
      Object.assign(canvas.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
      const dpr=Math.min(window.devicePixelRatio||1,2),pw=Math.round(box.width*dpr),ph=Math.round(box.height*dpr);
      if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph}
      const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,box.width,box.height);
      for(const s of r.strokes)drawStroke(ctx,s,box.width,box.height);
      if(draft)drawStroke(ctx,draft,box.width,box.height);
      if(livePoint){
        const x=livePoint.x*box.width,y=livePoint.y*box.height;
        ctx.save();ctx.fillStyle='rgba(239,68,68,.35)';ctx.strokeStyle='#ef4444';ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#ef4444';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.restore();
      }
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(render)};
    canvas.addEventListener('pointerdown',e=>{
      e.stopPropagation();const t=current();if(!t||e.button!==0||shared.tool==='watch')return;
      const p=pos(e);if(!p)return;e.preventDefault();
      if(shared.tool==='point'){livePoint=p;sendLive(true);schedule();return}
      if(record(t.id).strokes.length>=MAX_STROKES){help.textContent='That is a lot of marks. Use 🧽 Clear first.';return}
      pid=e.pointerId;try{canvas.setPointerCapture(pid)}catch{}
      draft={id:'t'+Date.now().toString(36)+'-'+(++record(t.id).seq).toString(36),tool:shared.tool,color:shared.color,size:SIZES[shared.tool],points:[p]};
      sendLive();schedule();
    });
    canvas.addEventListener('pointermove',e=>{
      e.stopPropagation();if(!current())return;
      const p=pos(e);if(!p)return;
      if(shared.tool==='point'){livePoint=p;sendLive();schedule();return}
      if(!draft||e.pointerId!==pid)return;
      const last=draft.points[draft.points.length-1];
      if(Math.hypot(p.x-last.x,p.y-last.y)<.002||draft.points.length>=MAX_POINTS)return;
      draft.points.push(p);sendLive();schedule();
    });
    function finish(e){
      if(e&&e.pointerId!==pid)return;pid=null;
      const t=current(),s=draft;draft=null;
      if(t&&s){const r=record(t.id);if(r.strokes.length<MAX_STROKES)r.strokes.push(s);sendMarks(t)}
      sendLive(true);schedule();
    }
    canvas.addEventListener('pointerup',e=>{e.stopPropagation();finish(e)});
    canvas.addEventListener('pointercancel',finish);
    canvas.addEventListener('click',e=>e.stopPropagation());
    canvas.addEventListener('pointerleave',()=>{if(shared.tool==='point'&&livePoint){livePoint=null;sendLive(true);schedule()}});
    video.addEventListener('loadedmetadata',schedule);video.addEventListener('resize',schedule);
    if(typeof ResizeObserver==='function')new ResizeObserver(schedule).observe(host);
    const api={refresh:schedule,leave:hideLivePoint};hosts.add(api);schedule();
    return api;
  }
  function syncAll(){for(const h of hosts)h.refresh()}
  window.ClassPointerScreenMarks={
    attach,
    // The student stopped sharing or left: forget the marks so an old drawing never reappears on a new screen.
    clearFor(id){if(!id||!marks.has(id))return;marks.delete(id);sendTo({id},{type:'board-screen-marks',strokes:[]});sendTo({id},{type:'board-screen-live',point:null,draft:null});syncAll()},
    // A student's tab (re)connected: give it the marks that are already on his screen.
    resend(m){const id=m?.studentId;const r=id&&marks.get(id);if(r?.strokes.length&&m.connection?.open)B.send(m.connection,{type:'board-screen-marks',strokes:r.strokes})},
    reset(){marks.clear();syncAll()},
    count:id=>marks.get(id)?.strokes.length||0
  };
})();
