'use strict';
/* Fun Torah annotation toolbar: one shared overlay that sits on top of any screen.
   Tools: Pointer, Hand, Select, Highlighter, Text box, Shapes, Eraser and Pen.

   Who sees it
   • Students: nothing at all, unless a "reason" is on: they are sharing their screen ("sharing") or the teacher
     opened student whiteboards ("whiteboard"). When a reason starts, the toolbar opens by itself. The student can
     shrink it to a small pencil button and open it again. When every reason ends it disappears completely and all
     of its marks are removed. There is no other way for a student to open it.
   • Teachers (setRole('teacher')): the pencil button is always there. The toolbar opens by itself on the
     teacher whiteboard, while sharing, and when the teacher opens a student's shared screen large.

   Where marks go ("surfaces")
   The toolbar draws on the top surface in a small stack. The default surface is the whole browser window (marks
   stay on this page only; a shared screen shows them because they are on the screen). Other scripts push their
   own surface while it is in use:
   • student-boards.js  — the student's own whiteboard (marks become normal board lines the teacher sees live);
   • screen-annotate.js — a student's shared screen, open large on the teacher's page (marks are sent to that
                          student and appear on his own screen);
   • classroom-annotate.js — the teacher's Class Pointer lesson (the toolbar drives the lesson's own tools).

   Pass-through: while the toolbar is shrunk to the pencil, or the Hand or Pointer tool is chosen, this overlay
   catches no clicks at all, so the page underneath works normally.

   Marks: {id, tool, color, size, points:[{x,y}], text?}. x and y are 0..1 across and down the surface; size is a
   fraction of the surface width. tool is pen | highlight | rect | ellipse | line | arrow | text. */
(function(){
  if(window.FTTAnnotate)return;
  const PALETTE=[['#1f2937','Black'],['#c62828','Red'],['#1d4ed8','Blue'],['#2e7d32','Green'],['#ef6c00','Orange'],['#7b1fa2','Purple'],['#fff176','Yellow'],['#ffffff','White']];
  const SIZE_SETS={pen:[.003,.006,.012],highlight:[.012,.02,.03],shape:[.003,.006,.012],text:[.02,.03,.045]};
  const KINDS=['pen','highlight','rect','ellipse','line','arrow','text'];
  const SHAPES=[['rect','▭','Rectangle'],['ellipse','◯','Circle'],['line','━','Line'],['arrow','➜','Arrow']];
  const TOOLS=[
    ['pointer','🔴','Pointer','Show a pointer dot. Clicks still reach the page.'],
    ['hand','✋','Hand','Use the page normally: click, type and scroll.'],
    ['select','⬚','Select','Click a mark to pick it. Drag to move it. Delete removes it. Double-click text to change it.'],
    ['highlight','🖍','Highlight','Highlight over words.'],
    ['text','T','Text','Click where the text should go, then type.'],
    ['shape','◻','Shapes','Drag to draw a rectangle, circle, line or arrow.'],
    ['eraser','🧽','Eraser','Drag over a mark to erase it.'],
    ['pen','✏️','Pen','Draw freehand.']];
  const CAPTURES=new Set(['select','highlight','text','shape','eraser','pen']);
  const MAX_TEXT=200,MAX_ITEMS_DEFAULT=200,MAX_POINTS_DEFAULT=600,HISTORY=40;
  const Z=2147483645;
  const round=v=>Math.round(v*1e4)/1e4;
  const clamp01=v=>Math.max(0,Math.min(1,v));
  const validPoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
  let seq=0;
  const newId=prefix=>(prefix||'a')+Date.now().toString(36)+'-'+(++seq).toString(36);

  // ---------- Shared drawing (also used by student-boards.js and screen-annotate.js) ----------
  // Checks a mark that came from somewhere else. Returns a clean copy or null.
  function cleanItem(raw,opts={}){
    if(!raw||typeof raw.id!=='string'||!/^[a-z0-9-]{2,44}$/i.test(raw.id))return null;
    if(opts.idPrefix&&raw.id[0]!==opts.idPrefix)return null;
    const tool=raw.tool==null?'pen':raw.tool;
    if(!KINDS.includes(tool)||typeof raw.color!=='string'||!/^#[0-9a-f]{6}$/i.test(raw.color))return null;
    if(!Number.isFinite(raw.size)||raw.size<.001||raw.size>.06)return null;
    const max=opts.maxPoints||MAX_POINTS_DEFAULT;
    if(!Array.isArray(raw.points)||!raw.points.length||raw.points.length>max||!raw.points.every(validPoint))return null;
    const out={id:raw.id,tool,color:raw.color.toLowerCase(),size:raw.size,points:raw.points.map(p=>({x:round(p.x),y:round(p.y)}))};
    if(['rect','ellipse','line','arrow'].includes(out.tool)){if(out.points.length!==2)return null}
    if(tool==='text'){
      if(typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>MAX_TEXT||out.points.length!==1)return null;
      out.text=raw.text;
    }
    return out;
  }
  // at(p) turns a 0..1 point into canvas pixels; w is the surface width in pixels.
  function drawItem(ctx,s,at,w){
    const tool=s.tool||'pen',pts=s.points;if(!pts||!pts.length)return;
    ctx.save();
    ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineCap='round';ctx.lineJoin='round';
    const lw=Math.max(1.5,s.size*w);ctx.lineWidth=lw;
    if(tool==='highlight')ctx.globalAlpha=.38;
    if(tool==='text'){
      const [x,y]=at(pts[0]),fs=Math.max(9,s.size*w);
      ctx.font='600 '+fs+'px Arial, "Segoe UI", sans-serif';ctx.textBaseline='top';ctx.textAlign='left';
      String(s.text||'').split('\n').slice(0,8).forEach((line,i)=>ctx.fillText(line,x,y+i*fs*1.25));
    }else if(tool==='rect'||tool==='ellipse'||tool==='line'||tool==='arrow'){
      const [x1,y1]=at(pts[0]),[x2,y2]=at(pts[pts.length-1]);ctx.beginPath();
      if(tool==='rect')ctx.rect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
      else if(tool==='ellipse')ctx.ellipse((x1+x2)/2,(y1+y2)/2,Math.abs(x2-x1)/2,Math.abs(y2-y1)/2,0,0,Math.PI*2);
      else{
        ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);
        if(tool==='arrow'){
          const a=Math.atan2(y2-y1,x2-x1),head=Math.max(10,lw*3.5);
          ctx.moveTo(x2,y2);ctx.lineTo(x2-head*Math.cos(a-.45),y2-head*Math.sin(a-.45));
          ctx.moveTo(x2,y2);ctx.lineTo(x2-head*Math.cos(a+.45),y2-head*Math.sin(a+.45));
        }
      }
      ctx.stroke();
    }else{
      const xy=pts.map(at);
      if(xy.every(p=>p[0]===xy[0][0]&&p[1]===xy[0][1])){ctx.beginPath();ctx.arc(xy[0][0],xy[0][1],lw/2,0,Math.PI*2);ctx.fill()}
      else{
        ctx.beginPath();ctx.moveTo(xy[0][0],xy[0][1]);
        for(let i=1;i<xy.length-1;i++){const a=xy[i],b=xy[i+1];ctx.quadraticCurveTo(a[0],a[1],(a[0]+b[0])/2,(a[1]+b[1])/2)}
        const last=xy[xy.length-1];ctx.lineTo(last[0],last[1]);ctx.stroke();
      }
    }
    ctx.restore();
  }
  const measurer=document.createElement('canvas').getContext('2d');
  // Box around a mark, in pixels of a surface w×h.
  function boxOf(s,w,h){
    const pts=s.points.map(p=>[p.x*w,p.y*h]);
    if(s.tool==='text'){
      const fs=Math.max(9,s.size*w),lines=String(s.text||'').split('\n').slice(0,8);
      measurer.font='600 '+fs+'px Arial, "Segoe UI", sans-serif';
      const width=Math.max(8,...lines.map(l=>measurer.measureText(l).width));
      return{x1:pts[0][0],y1:pts[0][1],x2:pts[0][0]+width,y2:pts[0][1]+lines.length*fs*1.25};
    }
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),pad=Math.max(1.5,s.size*w)/2;
    return{x1:Math.min(...xs)-pad,y1:Math.min(...ys)-pad,x2:Math.max(...xs)+pad,y2:Math.max(...ys)+pad};
  }
  function segDist(px,py,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len)):0;
    return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
  }
  // Is pixel point (px,py) on the mark? inside: a click anywhere inside a closed shape's box counts (Select).
  function hits(s,px,py,w,h,inside){
    const tool=s.tool||'pen',reach=Math.max(7,Math.max(1.5,s.size*w)/2+5),b=boxOf(s,w,h);
    if(px<b.x1-reach||px>b.x2+reach||py<b.y1-reach||py>b.y2+reach)return false;
    if(tool==='text')return true;
    const pts=s.points.map(p=>[p.x*w,p.y*h]);
    if(tool==='rect'||tool==='ellipse'){
      if(inside)return true;
      const [a,c]=[pts[0],pts[1]];
      if(tool==='rect'){
        const x1=Math.min(a[0],c[0]),x2=Math.max(a[0],c[0]),y1=Math.min(a[1],c[1]),y2=Math.max(a[1],c[1]);
        return [[x1,y1,x2,y1],[x2,y1,x2,y2],[x2,y2,x1,y2],[x1,y2,x1,y1]].some(e=>segDist(px,py,...e)<=reach);
      }
      const cx=(a[0]+c[0])/2,cy=(a[1]+c[1])/2,rx=Math.max(1,Math.abs(c[0]-a[0])/2),ry=Math.max(1,Math.abs(c[1]-a[1])/2);
      const d=Math.hypot((px-cx)/rx,(py-cy)/ry);return Math.abs(d-1)*Math.min(rx,ry)<=reach;
    }
    if(pts.length===1)return Math.hypot(px-pts[0][0],py-pts[0][1])<=reach;
    for(let i=1;i<pts.length;i++)if(segDist(px,py,pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1])<=reach)return true;
    return false;
  }

  // ---------- State ----------
  let role=null;                 // null | 'student' | 'teacher'
  const reasons=new Set();       // 'sharing', 'whiteboard', ...
  const stack=[];                // surfaces pushed by other scripts (top = last)
  let mode='hidden';             // hidden | mini | open
  let autoOpened=false;
  const st={tool:'hand',shape:'rect',color:PALETTE[1][0],sizeIndex:1};
  const toolColors={pen:PALETTE[1][0],highlight:PALETTE[6][0],shape:PALETTE[1][0],text:PALETTE[1][0]};
  const history=new Map();       // surface id -> [items snapshots]
  const seen=new WeakSet();     // surfaces that have been in use since they were pushed
  let selected=null,drag=null,draft=null,laser=null,editor=null,frame=0,lastSurface=null,lastRectKey='';

  // The whole-window surface: marks stay on this page only.
  const viewport={id:'viewport',idPrefix:'a',items:[],defaultTool:'hand',
    label:()=>role==='teacher'?'Drawing on your screen.':'Drawing on your screen. Your teacher sees it while you share.',
    rect:()=>({left:0,top:0,width:window.innerWidth,height:window.innerHeight}),
    getItems(){return this.items},setItems(list){this.items=list}};

  function surface(){
    for(let i=stack.length-1;i>=0;i--){const s=stack[i];let r=null;try{r=s.rect()}catch{}if(r&&r.width>4&&r.height>4)return s}
    return viewport;
  }
  const isDelegate=s=>!!s.delegate;
  function supports(s,tool){return !s.tools||s.tools.includes(tool)}
  // Undo history is kept per surface (and per student, for a student's screen).
  const hk=s=>{try{return s.historyKey?.()||s.id}catch{return s.id}};
  function itemsOf(s){try{return (s.getItems?.()||[]).slice()}catch{return[]}}
  function colorsOf(s){return s.colors||PALETTE}
  function sizesOf(s,tool){return s.sizes?.(tool)||SIZE_SETS[tool==='shape'?'shape':tool==='text'?'text':tool==='highlight'?'highlight':'pen']}
  function currentSize(s){const list=sizesOf(s,st.tool);return list[Math.min(st.sizeIndex,list.length-1)]}
  function visible(){return role==='teacher'||reasons.size>0}

  // ---------- DOM ----------
  const css=`
#fttAnnotate{position:fixed;inset:0;z-index:${Z};pointer-events:none;font:600 13px system-ui,"Segoe UI",sans-serif}
#fttAnnotate[hidden],#fttAnnotate [hidden]{display:none!important}
#fttAnnotate .fa-ink{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none}
#fttAnnotate .fa-capture{position:fixed;pointer-events:auto;touch-action:none;background:transparent}
#fttAnnotate .fa-capture[data-tool="pen"],#fttAnnotate .fa-capture[data-tool="highlight"],#fttAnnotate .fa-capture[data-tool="shape"]{cursor:crosshair}
#fttAnnotate .fa-capture[data-tool="text"]{cursor:text}
#fttAnnotate .fa-capture[data-tool="eraser"]{cursor:cell}
#fttAnnotate .fa-capture[data-tool="select"]{cursor:default}
#fttAnnotate .fa-bar{position:fixed;left:12px;top:max(12px,calc(50vh - 300px));pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 5px;border-radius:16px;background:#fff;color:#1f2937;box-shadow:0 8px 30px #0f172a40,0 0 0 1px #0f172a1f;max-height:calc(100vh - 24px);overflow:auto;user-select:none}
#fttAnnotate .fa-grip{cursor:grab;color:#94a3b8;font-size:12px;letter-spacing:-2px;padding:0 0 2px;touch-action:none}
#fttAnnotate button{font:inherit;color:inherit;margin:0;box-shadow:none;text-transform:none;letter-spacing:normal}
#fttAnnotate .fa-tool{display:flex;flex-direction:column;align-items:center;justify-content:center;width:54px;min-height:44px;padding:3px 2px;border:0;border-radius:11px;background:transparent;cursor:pointer;line-height:1.05}
#fttAnnotate .fa-tool:hover:enabled{background:#eef2ff}
#fttAnnotate .fa-tool[aria-pressed="true"]{background:#dbeafe;color:#1e3a8a;box-shadow:inset 0 0 0 2px #3b82f6}
#fttAnnotate .fa-tool:disabled{opacity:.35;cursor:default}
#fttAnnotate .fa-ico{font-size:19px;line-height:22px}
#fttAnnotate .fa-tool[data-tool="text"] .fa-ico{font:800 20px Georgia,serif}
#fttAnnotate .fa-name{font-size:10px;font-weight:700;margin-top:1px}
#fttAnnotate .fa-sep{width:40px;height:1px;background:#e2e8f0;margin:3px 0;flex:none}
#fttAnnotate .fa-colors{display:grid;grid-template-columns:repeat(2,22px);gap:5px;padding:2px 0}
#fttAnnotate .fa-color{width:22px;height:22px;border-radius:50%;border:2px solid #cbd5e1;background:var(--c);padding:0;cursor:pointer}
#fttAnnotate .fa-color[aria-pressed="true"]{outline:3px solid #3b82f6;outline-offset:1px}
#fttAnnotate .fa-sizes{display:flex;gap:2px}
#fttAnnotate .fa-size{width:17px;height:24px;border:0;border-radius:6px;background:transparent;display:grid;place-items:center;cursor:pointer;padding:0}
#fttAnnotate .fa-size i{display:block;width:var(--d);height:var(--d);border-radius:50%;background:#1f2937}
#fttAnnotate .fa-size[aria-pressed="true"]{background:#dbeafe}
#fttAnnotate .fa-small{width:54px;min-height:30px;border:0;border-radius:9px;background:transparent;cursor:pointer;font-size:12px;font-weight:700}
#fttAnnotate .fa-small:hover:enabled{background:#f1f5f9}
#fttAnnotate .fa-small:disabled{opacity:.35;cursor:default}
#fttAnnotate .fa-min{background:#f1f5f9}
#fttAnnotate .fa-shapes{position:fixed;pointer-events:auto;display:flex;gap:4px;padding:5px;border-radius:12px;background:#fff;box-shadow:0 8px 30px #0f172a40,0 0 0 1px #0f172a1f}
#fttAnnotate .fa-shapes button{width:42px;height:38px;border:0;border-radius:9px;background:transparent;font-size:18px;cursor:pointer}
#fttAnnotate .fa-shapes button[aria-pressed="true"]{background:#dbeafe;box-shadow:inset 0 0 0 2px #3b82f6}
#fttAnnotate .fa-tip{position:fixed;pointer-events:none;max-width:260px;padding:6px 10px;border-radius:10px;background:#0f172a;color:#fff;font-size:12px;box-shadow:0 4px 14px #0004}
#fttAnnotate .fa-pencil{position:fixed;left:12px;top:calc(50% - 26px);pointer-events:auto;width:52px;height:52px;border-radius:50%;border:3px solid #fff;background:#2563eb;color:#fff;font-size:24px;line-height:1;cursor:grab;box-shadow:0 6px 22px #0f172a55;display:grid;place-items:center;touch-action:none;user-select:none}
#fttAnnotate .fa-pencil:hover{background:#1d4ed8}
#fttAnnotate .fa-pencil.dragging{cursor:grabbing}
#fttAnnotate .fa-editor{position:fixed;pointer-events:auto;min-width:120px;min-height:1.4em;margin:0;padding:2px 4px;border:2px dashed #3b82f6;border-radius:4px;background:#ffffffd9;resize:none;overflow:hidden;font-family:Arial,"Segoe UI",sans-serif;font-weight:600;line-height:1.25;outline:none;unicode-bidi:plaintext}
#fttAnnotate[data-side="right"] .fa-bar{left:auto;right:12px}
#fttAnnotate[data-side="right"] .fa-pencil{left:auto;right:12px}
@media (max-height:640px){#fttAnnotate .fa-tool{min-height:36px}#fttAnnotate .fa-name{display:none}}
@media print{#fttAnnotate{display:none!important}}`;
  const root=document.createElement('div');root.id='fttAnnotate';root.hidden=true;root.setAttribute('data-ftt-annotate','');
  const ink=document.createElement('canvas');ink.className='fa-ink';ink.setAttribute('aria-hidden','true');
  const capture=document.createElement('div');capture.className='fa-capture';capture.hidden=true;
  capture.setAttribute('aria-label','Drawing area');
  const bar=document.createElement('div');bar.className='fa-bar';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Drawing tools');bar.setAttribute('aria-orientation','vertical');
  const grip=document.createElement('div');grip.className='fa-grip';grip.textContent='⠿⠿';grip.title='Drag to move the toolbar';
  const pencil=document.createElement('button');pencil.type='button';pencil.className='fa-pencil';pencil.textContent='✏️';
  pencil.title='Open drawing tools (drag to move)';pencil.setAttribute('aria-label','Open drawing tools');
  const shapeMenu=document.createElement('div');shapeMenu.className='fa-shapes';shapeMenu.hidden=true;shapeMenu.setAttribute('role','group');shapeMenu.setAttribute('aria-label','Shape');
  const tip=document.createElement('div');tip.className='fa-tip';tip.hidden=true;tip.setAttribute('role','status');
  const btn=(cls,html,title,on)=>{const b=document.createElement('button');b.type='button';b.className=cls;if(html!=null)b.innerHTML=html;b.title=title;b.setAttribute('aria-label',title);b.addEventListener('click',on);return b};
  const toolButtons=new Map();
  bar.append(grip);
  for(const [tool,icon,name,help] of TOOLS){
    const b=btn('fa-tool','<span class="fa-ico"></span><span class="fa-name"></span>',name+': '+help,()=>chooseTool(tool,true));
    b.dataset.tool=tool;b.querySelector('.fa-ico').textContent=icon;b.querySelector('.fa-name').textContent=name;
    bar.append(b);toolButtons.set(tool,b);
  }
  const shapeButtons=new Map();
  for(const [shape,icon,name] of SHAPES){const b=btn('',null,name,()=>{st.shape=shape;shapeMenu.hidden=true;chooseTool('shape')});b.textContent=icon;shapeMenu.append(b);shapeButtons.set(shape,b)}
  const sep1=document.createElement('div');sep1.className='fa-sep';
  const colorBox=document.createElement('div');colorBox.className='fa-colors';colorBox.setAttribute('role','group');colorBox.setAttribute('aria-label','Color');
  const sizeBox=document.createElement('div');sizeBox.className='fa-sizes';sizeBox.setAttribute('role','group');sizeBox.setAttribute('aria-label','Size');
  const sep2=document.createElement('div');sep2.className='fa-sep';
  const undoBtn=btn('fa-small','↶ Undo','Undo my last change',()=>undo());
  const clearBtn=btn('fa-small','🗑 Clear','Erase all my marks here',()=>clearAll());
  const minBtn=btn('fa-small fa-min','➖ Hide','Shrink the toolbar to a pencil button. Clicks go to the page.',()=>minimize());
  bar.append(sep1,colorBox,sizeBox,sep2,undoBtn,clearBtn,minBtn);
  root.append(ink,capture,shapeMenu,bar,pencil,tip);
  pencil.addEventListener('click',()=>openBar());
  // Clicks on the toolbar never reach the page or the lesson underneath.
  for(const node of [bar,pencil,shapeMenu])for(const type of ['pointerdown','pointerup','click','dblclick','wheel','contextmenu'])node.addEventListener(type,e=>e.stopPropagation());

  function mount(){
    if(root.isConnected||!document.body)return;
    const style=document.createElement('style');style.id='fttAnnotateCss';style.textContent=css;
    (document.head||document.documentElement).append(style);document.body.append(root);
  }

  // ---------- Toolbar state ----------
  function chooseTool(tool,fromClick){
    const s=surface();if(!supports(s,tool))return;
    if(tool==='shape'&&fromClick&&st.tool==='shape'){shapeMenu.hidden=!shapeMenu.hidden;placeShapeMenu();return}
    finishEditor(true);
    if(st.tool!==tool){selected=tool==='select'?selected:null;laser=null;try{s.live?.(null,null)}catch{}}
    st.tool=tool;shapeMenu.hidden=tool!=='shape'||!fromClick;placeShapeMenu();
    // Each drawing tool keeps its own color (the highlighter starts yellow).
    if(toolColors[tool]&&colorsOf(s).some(c=>c[0]===toolColors[tool]))st.color=toolColors[tool];
    applyDelegate();sync();
  }
  function placeShapeMenu(){
    if(shapeMenu.hidden)return;
    const r=toolButtons.get('shape').getBoundingClientRect(),b=bar.getBoundingClientRect(),w=shapeMenu.offsetWidth||190;
    const left=b.left+b.width/2>window.innerWidth/2?b.left-w-8:b.right+8;
    shapeMenu.style.left=Math.round(Math.max(4,left))+'px';shapeMenu.style.top=Math.round(r.top)+'px';
  }
  function applyDelegate(){
    const s=surface();if(!isDelegate(s))return;
    try{s.delegate.apply({tool:st.tool,shape:st.shape,color:st.color,size:currentSize(s),open:mode==='open'})}catch(e){console.warn('Drawing tools:',e)}
  }
  function sync(){
    mount();
    const s=surface(),show=visible()&&mode!=='hidden';
    root.hidden=!show;
    if(!show){capture.hidden=true;scheduleRender();return}
    if(lastSurface!==s){
      // A different surface: keep the tool when it works there, otherwise use the surface's own starting tool.
      if(lastSurface&&lastSurface!==s){selected=null;draft=null;laser=null;finishEditor(true);try{lastSurface.live?.(null,null)}catch{}}
      // The first time a surface is in use, start with its own tool (Pen on a whiteboard, Hand on a page).
      if(!seen.has(s)){seen.add(s);if(mode==='open'&&s.defaultTool&&supports(s,s.defaultTool))st.tool=s.defaultTool}
      if(!supports(s,st.tool))st.tool=s.defaultTool||'hand';
      lastSurface=s;applyDelegate();
    }
    const open=mode==='open';
    bar.hidden=!open;pencil.hidden=open;if(!open){shapeMenu.hidden=true;tip.hidden=true}
    for(const [tool,b] of toolButtons){b.disabled=!supports(s,tool);b.setAttribute('aria-pressed',String(tool===st.tool));}
    const shapeIcon=SHAPES.find(x=>x[0]===st.shape);toolButtons.get('shape').querySelector('.fa-ico').textContent=shapeIcon?shapeIcon[1]:'◻';
    for(const [shape,b] of shapeButtons)b.setAttribute('aria-pressed',String(shape===st.shape));
    // Colors and sizes for this surface.
    const colors=colorsOf(s);if(!colors.some(c=>c[0]===st.color))st.color=colors[Math.min(1,colors.length-1)][0];
    const colorKey=colors.map(c=>c[0]).join();
    if(colorBox.dataset.key!==colorKey){
      colorBox.dataset.key=colorKey;colorBox.replaceChildren(...colors.map(([c,name])=>{const b=btn('fa-color',null,name,()=>{if(['pointer','hand','select','eraser'].includes(st.tool)&&supports(s,'pen'))st.tool='pen';st.color=c;if(toolColors[st.tool])toolColors[st.tool]=c;applyDelegate();sync()});b.dataset.color=c;b.style.setProperty('--c',c);return b}));
    }
    for(const b of colorBox.children)b.setAttribute('aria-pressed',String(b.dataset.color===st.color));
    const drawing=['pen','highlight','shape','text'].includes(st.tool);
    colorBox.hidden=!drawing&&!isDelegate(s);sizeBox.hidden=!drawing;
    const sizes=sizesOf(s,st.tool);st.sizeIndex=Math.min(st.sizeIndex,sizes.length-1);
    sizeBox.replaceChildren(...sizes.map((v,i)=>{const b=btn('fa-size','<i></i>',['Small','Medium','Large'][i]||'Size',()=>{st.sizeIndex=i;applyDelegate();sync()});b.querySelector('i').style.setProperty('--d',(5+i*4)+'px');b.setAttribute('aria-pressed',String(i===st.sizeIndex));return b}));
    const mine=isDelegate(s)?null:itemsOf(s);
    undoBtn.disabled=isDelegate(s)?!s.delegate.undo:!(history.get(hk(s))||[]).length;
    clearBtn.disabled=isDelegate(s)?!s.delegate.clear:!mine.length;
    placeShapeMenu();layoutCapture();scheduleRender();
  }
  function layoutCapture(){
    const s=surface(),r=s.rect?.();
    const on=mode==='open'&&!isDelegate(s)&&CAPTURES.has(st.tool)&&!!r;
    capture.hidden=!on;capture.dataset.tool=st.tool;
    if(on){
      const key=[r.left,r.top,r.width,r.height].map(Math.round).join();
      if(key!==lastRectKey){lastRectKey=key;Object.assign(capture.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'})}
    }else lastRectKey='';
  }
  function showTip(text){
    if(!text||mode!=='open'){tip.hidden=true;return}
    tip.textContent=text;tip.hidden=false;
    const r=bar.getBoundingClientRect(),right=r.left+r.width/2>window.innerWidth/2;
    tip.style.left=Math.round(right?Math.max(4,r.left-270):r.right+10)+'px';tip.style.top=Math.max(8,Math.round(r.bottom-40))+'px';
    clearTimeout(showTip.timer);showTip.timer=setTimeout(()=>{tip.hidden=true},4500);
  }

  function openBar(auto){
    if(!visible())return;
    autoOpened=!!auto;mode='open';sync();
    const s=surface();showTip(typeof s.label==='function'?s.label():s.label);
  }
  function minimize(){
    if(mode==='hidden')return;
    finishEditor(true);selected=null;draft=null;laser=null;try{surface().live?.(null,null)}catch{}
    mode='mini';autoOpened=false;
    const s=surface();if(isDelegate(s))try{s.delegate.minimized?.()}catch{}
    sync();
  }
  function hideAll(){
    finishEditor(false);selected=null;draft=null;laser=null;
    for(const s of [viewport,...stack])try{s.live?.(null,null)}catch{}
    // A student's marks leave with the toolbar.
    if(role!=='teacher'){viewport.items=[];history.delete('viewport')}
    mode='hidden';sync();
  }

  // ---------- Marks: change, undo, clear ----------
  function commit(s,next){
    const hist=history.get(hk(s))||[];hist.push(itemsOf(s));if(hist.length>HISTORY)hist.shift();history.set(hk(s),hist);
    try{s.setItems(next)}catch(e){console.warn('Drawing tools:',e)}
    sync();
  }
  function undo(){
    const s=surface();
    if(isDelegate(s)){try{s.delegate.undo?.()}catch{}return}
    const hist=history.get(hk(s))||[];if(!hist.length)return;
    selected=null;try{s.setItems(hist.pop())}catch{}sync();
  }
  function clearAll(){
    const s=surface();
    if(isDelegate(s)){try{s.delegate.clear?.()}catch{}return}
    if(!itemsOf(s).length)return;selected=null;commit(s,[]);
  }

  // ---------- Drawing input ----------
  function rel(e,s){
    const r=s.rect();if(!r||!r.width||!r.height)return null;
    return{x:round(clamp01((e.clientX-r.left)/r.width)),y:round(clamp01((e.clientY-r.top)/r.height)),px:e.clientX-r.left,py:e.clientY-r.top,w:r.width,h:r.height};
  }
  function topHit(s,p,inside){
    const items=itemsOf(s);
    for(let i=items.length-1;i>=0;i--)if(hits(items[i],p.px,p.py,p.w,p.h,inside))return items[i];
    return null;
  }
  let pid=null,liveTimer=0,lastLive=0;
  function sendLive(force){
    const s=surface();if(!s.live)return;
    const go=()=>{liveTimer=0;lastLive=Date.now();try{s.live(draft?{...draft,points:draft.points.slice()}:null,laser)}catch{}};
    clearTimeout(liveTimer);liveTimer=0;const wait=60-(Date.now()-lastLive);
    if(force||wait<=0)go();else liveTimer=setTimeout(go,wait);
  }
  capture.addEventListener('pointerdown',e=>{
    if(e.button!==0||pid!==null)return;
    const s=surface(),p=rel(e,s);if(!p)return;
    shapeMenu.hidden=true;
    e.preventDefault();e.stopPropagation();
    if(st.tool==='text'){
      const hit=topHit(s,p,true);
      if(hit&&hit.tool==='text'){startEditor(s,hit);return}
      if(editor){finishEditor(true);return}
      startEditor(s,null,p);return;
    }
    if(editor)finishEditor(true);
    pid=e.pointerId;try{capture.setPointerCapture(pid)}catch{}
    if(st.tool==='select'){
      const hit=topHit(s,p,true);selected=hit?hit.id:null;
      drag=hit?{start:p,item:hit,moved:false}:null;scheduleRender();return;
    }
    if(st.tool==='eraser'){drag={erased:new Set(),before:itemsOf(s)};eraseAt(s,p);return}
    const max=s.maxItems||MAX_ITEMS_DEFAULT;
    if(itemsOf(s).length>=max){showTip('That is a lot of marks. Use 🗑 Clear or the eraser first.');pid=null;return}
    const tool=st.tool==='shape'?st.shape:st.tool;
    draft={id:newId(s.idPrefix),tool,color:st.color,size:currentSize(s),points:tool==='pen'||tool==='highlight'?[{x:p.x,y:p.y}]:[{x:p.x,y:p.y},{x:p.x,y:p.y}]};
    sendLive();scheduleRender();
  });
  capture.addEventListener('pointermove',e=>{
    if(e.pointerId!==pid)return;
    const s=surface(),p=rel(e,s);if(!p)return;e.stopPropagation();
    if(st.tool==='select'){
      if(!drag)return;const dx=p.x-drag.start.x,dy=p.y-drag.start.y;
      if(!drag.moved&&Math.hypot(p.px-drag.start.px,p.py-drag.start.py)<3)return;
      drag.moved=true;drag.dx=dx;drag.dy=dy;scheduleRender();return;
    }
    if(st.tool==='eraser'){if(drag)eraseAt(s,p);return}
    if(!draft)return;
    if(draft.tool==='pen'||draft.tool==='highlight'){
      const list=e.getCoalescedEvents?.()||[];
      for(const ev of list.length?list:[e]){
        const q=rel(ev,s);if(!q)continue;const last=draft.points[draft.points.length-1];
        if(Math.hypot((q.x-last.x)*q.w,(q.y-last.y)*q.h)<2)continue;
        if(draft.points.length>=(s.maxPoints||MAX_POINTS_DEFAULT)-1)break;
        draft.points.push({x:q.x,y:q.y});
      }
    }else draft.points[1]={x:p.x,y:p.y};
    sendLive();scheduleRender();
  });
  function endPointer(e,cancel){
    if(e&&e.pointerId!==pid)return;pid=null;
    const s=surface();
    if(st.tool==='select'){
      if(drag?.moved&&!cancel)moveItem(s,drag.item,drag.dx,drag.dy);
      drag=null;scheduleRender();return;
    }
    if(st.tool==='eraser'){
      if(drag&&drag.erased.size){const before=drag.before;const hist=history.get(hk(s))||[];hist.push(before);if(hist.length>HISTORY)hist.shift();history.set(hk(s),hist)}
      drag=null;sync();return;
    }
    const d=draft;draft=null;
    if(d&&!cancel){
      const tiny=d.points.length===2&&['rect','ellipse','line','arrow'].includes(d.tool)&&Math.hypot(d.points[0].x-d.points[1].x,d.points[0].y-d.points[1].y)<.004;
      if(!tiny)commit(s,itemsOf(s).concat(d));
    }
    sendLive(true);scheduleRender();
  }
  capture.addEventListener('pointerup',e=>endPointer(e,false));
  capture.addEventListener('pointercancel',e=>endPointer(e,true));
  capture.addEventListener('lostpointercapture',e=>{if(e.pointerId===pid)endPointer(e,false)});
  capture.addEventListener('dblclick',e=>{
    if(st.tool!=='select')return;const s=surface(),p=rel(e,s);if(!p)return;
    const hit=topHit(s,p,true);if(hit?.tool==='text'){e.preventDefault();startEditor(s,hit)}
  });
  for(const type of ['click','contextmenu','wheel'])capture.addEventListener(type,e=>{if(type!=='wheel')e.preventDefault();e.stopPropagation()},{passive:false});
  // The browser moves focus on mouse down; a new text box must keep it so the typing goes into it.
  capture.addEventListener('mousedown',e=>e.preventDefault());
  capture.addEventListener('click',()=>{if(editor&&document.activeElement!==editor.ta)try{editor.ta.focus({preventScroll:true})}catch{}});

  function eraseAt(s,p){
    const items=itemsOf(s),keep=items.filter(it=>!hits(it,p.px,p.py,p.w,p.h,false));
    if(keep.length===items.length)return;
    for(const it of items)if(!keep.includes(it))drag.erased.add(it.id);
    try{s.setItems(keep)}catch{}if(selected&&!keep.some(i=>i.id===selected))selected=null;scheduleRender();
  }
  function moveItem(s,item,dx,dy){
    // Keep the whole mark on the surface.
    const xs=item.points.map(p=>p.x),ys=item.points.map(p=>p.y);
    dx=Math.max(-Math.min(...xs),Math.min(1-Math.max(...xs),dx));dy=Math.max(-Math.min(...ys),Math.min(1-Math.max(...ys),dy));
    const moved={...item,id:newId(s.idPrefix),points:item.points.map(p=>({x:round(p.x+dx),y:round(p.y+dy)}))};
    commit(s,itemsOf(s).map(i=>i.id===item.id?moved:i));selected=moved.id;scheduleRender();
  }
  function deleteSelected(){
    const s=surface();if(!selected||isDelegate(s))return false;
    const items=itemsOf(s),next=items.filter(i=>i.id!==selected);selected=null;
    if(next.length!==items.length){commit(s,next);return true}
    return false;
  }

  // Text boxes: a real text field while typing, then a mark.
  function startEditor(s,item,p){
    finishEditor(true);
    const r=s.rect();if(!r)return;
    const size=item?item.size:currentSize(s),color=item?item.color:st.color,at=item?item.points[0]:{x:p.x,y:p.y};
    const ta=document.createElement('textarea');ta.className='fa-editor';ta.maxLength=MAX_TEXT;ta.rows=1;ta.dir='auto';
    ta.setAttribute('aria-label','Type your text. Press Enter to finish, Shift+Enter for a new line.');
    const fs=Math.max(9,size*r.width);
    Object.assign(ta.style,{left:(r.left+at.x*r.width-6)+'px',top:(r.top+at.y*r.height-4)+'px',fontSize:fs+'px',color,maxWidth:Math.max(140,r.left+r.width-(r.left+at.x*r.width))+'px'});
    ta.value=item?item.text:'';
    const grow=()=>{ta.style.height='auto';ta.style.height=ta.scrollHeight+'px';ta.style.width='auto';ta.style.width=Math.max(120,Math.min(ta.scrollWidth+8,r.width))+'px'};
    ta.addEventListener('input',grow);
    ta.addEventListener('keydown',e=>{
      e.stopPropagation();
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();finishEditor(true)}
      else if(e.key==='Escape'){e.preventDefault();finishEditor(false)}
    });
    ta.addEventListener('blur',()=>setTimeout(()=>{if(editor&&editor.ta===ta)finishEditor(true)},0));
    for(const type of ['pointerdown','click'])ta.addEventListener(type,e=>e.stopPropagation());
    editor={ta,s,item,at,size,color};root.append(ta);grow();
    if(item){selected=null;scheduleRender()}
    setTimeout(()=>{try{ta.focus({preventScroll:true})}catch{ta.focus()}},0);
  }
  function finishEditor(save){
    if(!editor)return;const {ta,s,item,at,size,color}=editor;editor=null;
    const text=ta.value.replace(/\r/g,'').split('\n').slice(0,8).join('\n').slice(0,MAX_TEXT);ta.remove();
    if(!save)return scheduleRender();
    const items=itemsOf(s);
    if(!text.trim()){if(item)commit(s,items.filter(i=>i.id!==item.id));return}
    if(item&&item.text===text)return scheduleRender();
    const mark={id:newId(s.idPrefix),tool:'text',color,size,points:[{x:at.x,y:at.y}],text};
    if(!item&&items.length>=(s.maxItems||MAX_ITEMS_DEFAULT)){showTip('That is a lot of marks. Use 🗑 Clear first.');return}
    commit(s,item?items.map(i=>i.id===item.id?mark:i):items.concat(mark));
  }

  // Pointer tool: a dot follows the mouse, without catching any clicks.
  document.addEventListener('pointermove',e=>{
    if(mode!=='open'||st.tool!=='pointer')return;
    const s=surface();if(isDelegate(s))return;const r=s.rect();if(!r)return;
    const x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
    const next=x>=0&&x<=1&&y>=0&&y<=1?{x:round(x),y:round(y)}:null;
    if(!next&&!laser)return;laser=next;sendLive();scheduleRender();
  },{passive:true,capture:true});
  document.addEventListener('pointerleave',()=>{if(laser){laser=null;sendLive(true);scheduleRender()}});
  window.addEventListener('blur',()=>{if(laser){laser=null;sendLive(true);scheduleRender()}});

  // Keyboard: Delete removes the selected mark, Ctrl+Z undoes, Escape lets go.
  document.addEventListener('keydown',e=>{
    if(mode!=='open'||root.hidden)return;
    if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    if((e.key==='Delete'||e.key==='Backspace')&&selected){if(deleteSelected()){e.preventDefault();e.stopPropagation()}}
    else if(e.key==='Escape'&&(selected||!shapeMenu.hidden)){selected=null;shapeMenu.hidden=true;scheduleRender()}
    else if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'&&CAPTURES.has(st.tool)){e.preventDefault();e.stopPropagation();undo()}
  },true);

  // Moving the toolbar by its grip.
  (function(){
    let start=null;
    grip.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();const r=bar.getBoundingClientRect();
      start={x:e.clientX,y:e.clientY,left:r.left,top:r.top};try{grip.setPointerCapture(e.pointerId)}catch{}grip.style.cursor='grabbing';
    });
    grip.addEventListener('pointermove',e=>{
      if(!start)return;const r=bar.getBoundingClientRect();
      const left=Math.max(4,Math.min(window.innerWidth-r.width-4,start.left+e.clientX-start.x));
      const top=Math.max(4,Math.min(window.innerHeight-r.height-4,start.top+e.clientY-start.y));
      Object.assign(bar.style,{left:left+'px',top:top+'px',right:'auto'});placeShapeMenu();
    });
    const end=()=>{start=null;grip.style.cursor=''};grip.addEventListener('pointerup',end);grip.addEventListener('pointercancel',end);
  })();

  // Dragging the pencil button — remembers position across sessions.
  (function(){
    const STORAGE_KEY='fttPencilPos';
    let pencilDrag=null,hasMoved=false;

    // Restore saved position.
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(saved&&Number.isFinite(saved.left)&&Number.isFinite(saved.top)){
        const left=Math.max(4,Math.min(window.innerWidth-56,saved.left));
        const top=Math.max(4,Math.min(window.innerHeight-56,saved.top));
        Object.assign(pencil.style,{left:left+'px',top:top+'px',right:'auto'});
      }
    }catch{}

    pencil.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      pencilDrag={id:e.pointerId,startX:e.clientX,startY:e.clientY,r:pencil.getBoundingClientRect()};
      hasMoved=false;
      try{pencil.setPointerCapture(e.pointerId)}catch{}
      pencil.classList.add('dragging');
    });
    pencil.addEventListener('pointermove',e=>{
      if(!pencilDrag||e.pointerId!==pencilDrag.id)return;
      const dx=e.clientX-pencilDrag.startX,dy=e.clientY-pencilDrag.startY;
      if(!hasMoved&&Math.hypot(dx,dy)<5)return; // ignore tiny jitter
      hasMoved=true;e.stopPropagation();
      const left=Math.max(4,Math.min(window.innerWidth-56,pencilDrag.r.left+dx));
      const top=Math.max(4,Math.min(window.innerHeight-56,pencilDrag.r.top+dy));
      Object.assign(pencil.style,{left:left+'px',top:top+'px',right:'auto'});
    });
    function endPencilDrag(e){
      if(!pencilDrag||e.pointerId!==pencilDrag.id)return;
      pencil.classList.remove('dragging');
      if(hasMoved){
        // Save position so it survives page refresh.
        try{const r=pencil.getBoundingClientRect();localStorage.setItem(STORAGE_KEY,JSON.stringify({left:r.left,top:r.top}))}catch{}
      }
      pencilDrag=null;
    }
    pencil.addEventListener('pointerup',e=>{
      endPencilDrag(e);
      // If the pointer didn't move, treat it as a click to open the bar.
      if(!hasMoved)openBar();
    });
    pencil.addEventListener('pointercancel',endPencilDrag);
    pencil.addEventListener('lostpointercapture',endPencilDrag);

    // Keep the pencil on-screen if the window resizes.
    window.addEventListener('resize',()=>{
      const r=pencil.getBoundingClientRect();
      const left=Math.max(4,Math.min(window.innerWidth-56,r.left));
      const top=Math.max(4,Math.min(window.innerHeight-56,r.top));
      if(left!==r.left||top!==r.top)Object.assign(pencil.style,{left:left+'px',top:top+'px',right:'auto'});
    });
  })();

  // ---------- Painting ----------
  function scheduleRender(){if(!frame)frame=requestAnimationFrame(render)}
  function render(){
    frame=0;if(root.hidden)return;
    const w=window.innerWidth,h=window.innerHeight,dpr=Math.min(window.devicePixelRatio||1,2);
    if(ink.width!==Math.round(w*dpr)||ink.height!==Math.round(h*dpr)){ink.width=Math.round(w*dpr);ink.height=Math.round(h*dpr)}
    const ctx=ink.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const s=surface(),r=s.rect?.();if(!r||isDelegate(s))return;
    layoutCapture();
    const at=p=>[r.left+p.x*r.width,r.top+p.y*r.height];
    ctx.save();ctx.beginPath();ctx.rect(r.left,r.top,r.width,r.height);ctx.clip();
    let items=s.renders?[]:itemsOf(s);
    if(drag?.moved&&drag.item){
      const moved={...drag.item,points:drag.item.points.map(p=>({x:p.x+drag.dx,y:p.y+drag.dy}))};
      if(s.renders)items=[moved];else items=items.map(i=>i.id===drag.item.id?moved:i);
    }
    for(const it of items)drawItem(ctx,it,at,r.width);
    if(draft&&!s.renders)drawItem(ctx,draft,at,r.width);
    // Selection box.
    const sel=selected&&itemsOf(s).find(i=>i.id===selected);
    if(sel&&mode==='open'){
      const shown=drag?.moved&&drag.item.id===sel.id?{...sel,points:sel.points.map(p=>({x:p.x+drag.dx,y:p.y+drag.dy}))}:sel;
      const b=boxOf(shown,r.width,r.height);
      ctx.setLineDash([6,4]);ctx.strokeStyle='#2563eb';ctx.lineWidth=1.5;ctx.strokeRect(r.left+b.x1-4,r.top+b.y1-4,b.x2-b.x1+8,b.y2-b.y1+8);ctx.setLineDash([]);
    }
    if(laser&&!s.drawsPoint&&mode==='open'&&st.tool==='pointer'){
      const [x,y]=at(laser);
      ctx.fillStyle='rgba(239,68,68,.35)';ctx.strokeStyle='#ef4444';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#ef4444';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  window.addEventListener('resize',()=>{placeShapeMenu();sync()});
  // Pushed surfaces (a board or a video) can move or resize without telling us.
  setInterval(()=>{
    if(root.hidden)return;const s=surface();
    if(s!==lastSurface){sync();return}
    if(s!==viewport){const r=s.rect?.();const key=r?[r.left,r.top,r.width,r.height].map(Math.round).join():'';if(key!==(render.key||'')){render.key=key;layoutCapture();scheduleRender()}}
  },250);

  // ---------- Public API ----------
  window.FTTAnnotate={
    PALETTE,SIZE_SETS,KINDS,cleanItem,drawItem,
    // role: 'teacher' shows the pencil everywhere. Anything else: only while a reason is on.
    setRole(next){
      const was=role;role=next==='teacher'?'teacher':next==='student'?'student':null;
      if(was===role)return;
      if(visible()&&mode==='hidden')mode='mini';
      if(!visible())return hideAll();
      sync();
    },
    // name: 'sharing' | 'whiteboard'. Turning a reason on opens the toolbar.
    setReason(name,on){
      on=!!on;if(reasons.has(name)===on)return;
      if(on){
        // Start with the surface's own tool: Hand on a page (the student keeps working), Pen on a whiteboard.
        reasons.add(name);mount();const s=stack[stack.length-1]||surface();st.tool=s.defaultTool&&supports(s,s.defaultTool)?s.defaultTool:'hand';lastSurface=null;openBar(true);return}
      reasons.delete(name);
      if(!visible())return hideAll();
      if(!reasons.size&&autoOpened&&role==='teacher')mode='mini';
      sync();
    },
    // A surface: {id, label, rect(), getItems(), setItems(list), live?(draft,point), idPrefix, renders?, drawsPoint?,
    //   defaultTool?, tools?, colors?, sizes?(tool), maxItems?, maxPoints?, autoOpen?, delegate?}
    push(s){
      if(!s||stack.includes(s))return;stack.push(s);mount();
      if(s.autoOpen&&visible()){mode='open';autoOpened=true;st.tool=s.defaultTool&&supports(s,s.defaultTool)?s.defaultTool:st.tool;lastSurface=null}
      sync();
    },
    release(s){
      const i=stack.indexOf(s);if(i<0)return;
      try{s.live?.(null,null)}catch{}
      stack.splice(i,1);seen.delete(s);if(lastSurface===s){selected=null;draft=null;laser=null;finishEditor(false)}
      if(s.autoOpen&&autoOpened&&role==='teacher'&&!reasons.size)mode='mini';
      sync();
    },
    refresh(){sync()},
    // 'left' (default) or 'right': where the toolbar and pencil sit, for pages with their own tools on the left.
    setSide(side){root.dataset.side=side==='right'?'right':'left';bar.style.left='';bar.style.top='';bar.style.right='';sync()},
    // Pick a tool from code (for example: a whiteboard starts with a black pen).
    select(tool,opts={}){if(opts.shape)st.shape=opts.shape;if(opts.color&&toolColors[tool])toolColors[tool]=opts.color;if(opts.color)st.color=opts.color;chooseTool(tool)},
    open(){openBar(false)},
    minimize,
    state:()=>({role,mode,tool:st.tool,reasons:[...reasons],surface:surface().id}),
    // True for the toolbar, the pencil and the drawing layer (pages with an activity lock let these through).
    owns(node){return !root.hidden&&!!node&&root.contains(node)}
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
