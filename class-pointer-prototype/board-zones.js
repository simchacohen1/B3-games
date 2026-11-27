'use strict';
// Class Pointer whiteboard: the teacher's tools for student zones (rules in board-zones-core.js, boxes and saving in pdf-mode.js).
//
// On the teacher's whiteboard, the toolbar's Zones button lets the teacher
//   • draw a zone (drag a box on the board),
//   • split the board into boxes (rows x columns, or one box for each student who is here),
//   • give each zone to one student, several students or a group,
//   • lock or unlock every zone at once, and take the zones away.
// A student can then write, type and move things only inside their own box; they still see the whole board. The teacher's
// page checks every mark a student sends (classroom.js), so this only chooses the zones. Zones belong to the page of the
// whiteboard on show, are saved with the whiteboard (and templates) and are sent to every student that joins.
(function(){
  const B=window.ClassPointerBridge,Z=window.ClassPointerZones;
  if(!B||!B.isTeacher||!Z)return;
  const zonesApi=()=>window.ClassPointerPdf?.zones||null;
  const available=()=>!!zonesApi()?.available();
  const listNow=()=>zonesApi()?.list()||[];
  const lockedNow=()=>!!zonesApi()?.locked();
  function el(tag,css,text){const node=document.createElement(tag);if(css)node.style.cssText=css;if(text!=null)node.textContent=text;return node}
  function button(text,title,onClick,css){
    const node=el('button',css||'padding:7px 12px;border:2px solid #94a3b8;border-radius:9px;background:#f8fafc;font:700 14px system-ui;cursor:pointer',text);
    node.type='button';if(title)node.title=title;node.addEventListener('click',onClick);return node;
  }
  const students=()=>B.zoneStudents?.()||[];
  const groups=()=>window.ClassPointerBoards?.groups?.list?.()||[];
  function commit(list,locked){
    const api=zonesApi();
    if(!api||!api.set(list,locked)){B.status('Open a whiteboard first, then add zones.');return false}
    return true;
  }

  // ---------- Drawing a zone on the board ----------
  let drawLayer=null,drawing=null;
  function stopDrawing(){
    if(drawLayer){drawLayer.remove();drawLayer=null}
    drawing=null;document.removeEventListener('keydown',onKey,true);
  }
  function onKey(event){if(event.key==='Escape'){event.preventDefault();stopDrawing();render()}}
  function startDrawing(){
    const api=zonesApi();
    if(!api?.available()){B.status('Open a whiteboard first, then draw a zone on it.');return}
    closePanel();stopDrawing();
    const bounds=()=>{
      const r=api.rect(),v=api.bounds();
      return{left:Math.max(r.left,v.left),top:Math.max(r.top,v.top),right:Math.min(r.right,v.right),bottom:Math.min(r.bottom,v.bottom)};
    };
    drawLayer=el('div','position:fixed;inset:0;z-index:2147483646;cursor:crosshair;touch-action:none');
    drawLayer.dataset.stageUi='true';drawLayer.setAttribute('role','application');drawLayer.setAttribute('aria-label','Draw a zone on the whiteboard');
    const hint=el('div','position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;padding:8px 14px;border-radius:999px;background:#0f172a;color:#fff;font:700 14px system-ui;box-shadow:0 6px 22px #0006',
      'Drag on the board to draw a zone.');
    const done=button('Done','Stop drawing zones (Esc)',()=>{stopDrawing();render()},'padding:5px 12px;border:0;border-radius:999px;background:#fff;color:#0f172a;font:800 13px system-ui;cursor:pointer');
    const give=button('Give zones to students…','Choose who gets each zone',()=>{stopDrawing();openPanel()},'padding:5px 12px;border:0;border-radius:999px;background:#fde68a;color:#0f172a;font:800 13px system-ui;cursor:pointer');
    hint.append(done,give);
    const preview=el('div','position:fixed;border:3px dashed #2563eb;background:#2563eb2e;pointer-events:none;display:none');
    drawLayer.append(hint,preview);document.body.append(drawLayer);document.addEventListener('keydown',onKey,true);
    const pointAt=event=>{
      const r=api.rect(),b=bounds(),x=Math.max(b.left,Math.min(b.right,event.clientX)),y=Math.max(b.top,Math.min(b.bottom,event.clientY));
      return{x:(x-r.left)/r.width,y:(y-r.top)/r.height,sx:x,sy:y};
    };
    drawLayer.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target!==drawLayer)return;
      const b=bounds();
      if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)return;
      event.preventDefault();drawing={pid:event.pointerId,start:pointAt(event)};
      try{drawLayer.setPointerCapture(event.pointerId)}catch(_){}
    });
    const show=event=>{
      const here=pointAt(event),s=drawing.start;
      Object.assign(preview.style,{display:'block',left:Math.min(s.sx,here.sx)+'px',top:Math.min(s.sy,here.sy)+'px',width:Math.abs(here.sx-s.sx)+'px',height:Math.abs(here.sy-s.sy)+'px'});
    };
    drawLayer.addEventListener('pointermove',event=>{if(drawing&&event.pointerId===drawing.pid)show(event)});
    const finish=(event,keep)=>{
      if(!drawing||event.pointerId!==drawing.pid)return;
      const start=drawing.start,end=pointAt(event);drawing=null;preview.style.display='none';
      if(!keep)return;
      const list=listNow(),zone=Z.make(list,start,end);
      if(!zone){B.status(list.length>=Z.LIMITS.zones?'A page can have up to '+Z.LIMITS.zones+' zones.':'That box is too small. Drag a bigger one.');return}
      commit([...list,zone]);
      B.status('Zone '+(list.length+1)+' added. Draw another, or choose Give zones to students.');
    };
    drawLayer.addEventListener('pointerup',event=>finish(event,true));
    drawLayer.addEventListener('pointercancel',event=>finish(event,false));
    B.status('Drag on the board to draw a zone. Press Esc or Done when you have enough.');
  }

  // ---------- The zones window ----------
  let dialog=null,unwatch=null;
  function closePanel(){
    if(unwatch){unwatch();unwatch=null}
    if(dialog){dialog.remove();dialog=null}
  }
  function openPanel(){
    if(!available()){B.status('Open a whiteboard first, then add zones.');return}
    stopDrawing();closePanel();
    // The class bar and tabs sit above ordinary windows, so the window starts below them and scrolls inside.
    dialog=el('div','position:fixed;inset:0;z-index:2147483500;background:#0b1837a8;display:flex;align-items:flex-start;justify-content:center;padding:128px 18px 18px');
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Student zones');dialog.dataset.stageUi='true';
    ['pointerdown','pointerup','click','dblclick','wheel','keydown','keyup'].forEach(type=>dialog.addEventListener(type,event=>event.stopPropagation()));
    document.body.append(dialog);
    unwatch=zonesApi().onChange(render);
    render();
  }
  function render(){
    if(!dialog)return;
    if(!available()){closePanel();return}
    const list=listNow(),locked=lockedNow(),here=students(),box='padding:6px;border:2px solid #94a3b8;border-radius:9px;font:600 15px system-ui';
    const panel=el('div','background:white;color:#142642;border-radius:15px;padding:18px;width:min(760px,95vw);max-height:calc(100vh - 150px);overflow:auto;box-shadow:0 16px 55px #0005;display:grid;gap:12px;font:15px system-ui');
    const note=el('p','margin:0;min-height:1.3em;font-weight:700;color:#475569');note.setAttribute('role','status');
    const say=(text,bad)=>{note.style.color=bad?'#b91c1c':'#475569';note.textContent=text||''};
    const replaceOk=()=>!list.length||confirm('This page already has '+list.length+' zone'+(list.length===1?'':'s')+'. Replace them?');

    // 1. Draw one, lock, remove
    const top=el('div','display:flex;gap:10px;flex-wrap:wrap;align-items:center');
    top.append(
      button('✏️ Draw a zone on the board','Drag a box on the whiteboard',startDrawing),
      button(locked?'🔓 Unlock all zones':'🔒 Lock all zones',locked?'Let students write in their own zones again':'Nobody but you can write until you unlock',()=>{commit(list,!locked)}),
      button('🗑 Remove all zones','Take the zones off this page (the board is free again)',()=>{
        if(!list.length){say('There are no zones on this page.');return}
        if(confirm('Remove all '+list.length+' zones from this page? Marks on the board stay.'))commit([],false);
      },'padding:7px 12px;border:2px solid #fca5a5;border-radius:9px;background:#fef2f2;color:#991b1b;font:700 14px system-ui;cursor:pointer'));

    // 2. Split the board
    const split=el('div','display:flex;gap:8px;flex-wrap:wrap;align-items:center');
    const rows=el('input',box+';width:64px'),cols=el('input',box+';width:64px');
    for(const [input,value,label] of [[rows,'2','Rows'],[cols,'3','Columns']]){input.type='number';input.min='1';input.max='10';input.value=value;input.setAttribute('aria-label',label)}
    split.append(el('strong',null,'Split into boxes:'),rows,el('span',null,'rows ×'),cols,el('span',null,'columns'),
      button('Make boxes','Cut the whole board into equal boxes',()=>{
        const made=Z.grid(Number(rows.value),Number(cols.value));
        if(!made){say('Choose 1 to 10 rows and columns (up to '+Z.LIMITS.zones+' boxes).',true);return}
        if(replaceOk()&&commit(made,locked))say(made.length+' boxes made. Now choose who gets each one.');
      }),
      button('👤 One box for each student here ('+here.length+')','Cut the board so every student here has their own box',()=>{
        if(!here.length){say('No students are here yet.',true);return}
        const made=Z.gridFor(Math.min(here.length,Z.LIMITS.zones));
        if(!made){say('That is too many boxes.',true);return}
        if(here.length>Z.LIMITS.zones)say('Only the first '+Z.LIMITS.zones+' students got a box.',true);
        if(!replaceOk())return;
        here.slice(0,made.length).forEach((student,i)=>{made[i].owners=[{k:student.key,n:student.name}]});
        if(commit(made,locked))say('Each student has a box. They can only write inside their own.');
      }));

    // 3. Each zone: who has it
    const rowsBox=el('div','display:grid;gap:8px');
    list.forEach((zone,index)=>{
      const row=el('div','display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px;border:2px solid '+(zone.owners.length?'#86efac':'#cbd5e1')+';border-radius:10px');
      row.append(el('strong','min-width:62px','Zone '+(index+1)));
      const chips=el('span','display:flex;gap:6px;flex-wrap:wrap;flex:1');
      if(!zone.owners.length)chips.append(el('span','color:#64748b','Nobody yet'));
      for(const owner of zone.owners){
        const chip=el('span','display:inline-flex;gap:4px;align-items:center;padding:3px 4px 3px 10px;border-radius:999px;background:#dcfce7;font-weight:700');
        chip.append(el('span',null,owner.n||'Student'),button('×','Take '+(owner.n||'this student')+' out of this zone',()=>{
          commit(list.map(z=>z.id===zone.id?{...z,owners:z.owners.filter(o=>o.k!==owner.k)}:z));
        },'border:0;background:transparent;font:800 15px system-ui;cursor:pointer;padding:0 6px'));
        chips.append(chip);
      }
      const add=el('select',box);
      add.setAttribute('aria-label','Give zone '+(index+1)+' to');
      const first=el('option',null,'＋ Give to…');first.value='';add.append(first);
      const free=here.filter(s=>!zone.owners.some(o=>o.k===s.key));
      if(free.length){const og=el('optgroup');og.label='Students here';for(const s of free){const o=el('option',null,s.name);o.value='s:'+s.key;og.append(o)}add.append(og)}
      const groupList=groups();
      if(groupList.length){const og=el('optgroup');og.label='A whole group';for(const g of groupList){const o=el('option',null,g.name);o.value='g:'+g.id;og.append(o)}add.append(og)}
      add.addEventListener('change',()=>{
        const value=add.value;if(!value)return;
        let picked=[];
        if(value.startsWith('s:')){const s=here.find(x=>'s:'+x.key===value);if(s)picked=[s]}
        else{
          const g=groupList.find(x=>'g:'+x.id===value),names=new Set((g?.names||[]).map(n=>String(n).toLowerCase()));
          picked=here.filter(s=>names.has(String(s.name).toLowerCase()));
          if(g&&!picked.length){say('Nobody from '+g.name+' is here right now.',true);render();return}
        }
        const owners=[...zone.owners];
        for(const s of picked)if(!owners.some(o=>o.k===s.key)&&owners.length<Z.LIMITS.owners)owners.push({k:s.key,n:s.name});
        commit(list.map(z=>z.id===zone.id?{...z,owners}:z));
      });
      row.append(chips,add,button('🗑','Remove this zone',()=>commit(list.filter(z=>z.id!==zone.id)),'border:2px solid #fca5a5;border-radius:9px;background:#fef2f2;padding:5px 9px;cursor:pointer'));
      rowsBox.append(row);
    });
    if(!list.length)rowsBox.append(el('p','margin:0;color:#475569','No zones on this page yet. The whole board is open to every student who is allowed to write.'));

    const close=button('Done','Close',closePanel,'padding:8px 18px;border:0;border-radius:10px;background:#2563eb;color:#fff;font:800 15px system-ui;cursor:pointer');
    const head=el('div','display:flex;justify-content:space-between;align-items:center;gap:10px');
    head.append(el('h3','margin:0','▦ Student zones'+(locked?' · 🔒 locked':'')),close);
    panel.append(head,
      el('p','margin:0','Give each student their own part of this page. A student can only draw, type or move things inside their own zone. The rest is locked for them, but they still see the whole board. You can write anywhere. Each slide has its own zones; zones are saved with the whiteboard and with templates.'),
      top,split,note,el('strong',null,'Zones on this page ('+list.length+')'),rowsBox);
    dialog.replaceChildren(panel);
  }

  // ---------- The toolbar's Zones button ----------
  function items(){
    const list=listNow(),locked=lockedNow();
    return[
      {icon:'▭',label:'Draw a zone',title:'Drag a box on the whiteboard',onClick:startDrawing},
      {icon:'▦',label:'Zones…',title:'Split the board into boxes and give each one to a student',onClick:openPanel},
      {icon:locked?'🔓':'🔒',label:locked?'Unlock all zones':'Lock all zones',title:locked?'Let students write in their own zones again':'Nobody but you can write until you unlock',disabled:!list.length,onClick:()=>commit(list,!locked)},
      {icon:'🗑',label:'Remove all zones',disabled:!list.length,onClick:()=>{if(confirm('Remove all '+list.length+' zones from this page? Marks on the board stay.'))commit([],false)}}
    ];
  }
  window.ClassPointerZoneTools={
    available,items,
    active:()=>listNow().length>0,locked:lockedNow,
    // Changes whenever the buttons would look different (the toolbar redraws only when this changes).
    signature:()=>[available(),listNow().length,lockedNow()].join(':'),
    open:openPanel,draw:startDrawing
  };
  // Leaving the whiteboard (or closing it) ends drawing and closes the window.
  setInterval(()=>{if(!available()){if(drawLayer)stopDrawing();if(dialog)closePanel()}},800);
})();
