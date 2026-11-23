'use strict';
// Class Pointer whiteboards: Hebrew word tiles and word boxes.
//
// The teacher types or pastes Hebrew (nikud kept) and the words become tiles. Every student gets their own board with
// the same tiles and boxes; a student drags a tile and it snaps into a word box. Nothing here talks to the network:
// student-boards.js sends the small "board-tile" messages and saves the positions with the rest of the board.
//
// Shapes (positions are 0..1 across and down the 16:9 board, and are the CENTER of a tile):
//   activity = {kind:'tiles', tiles:[{id:'t1',text:'וַיֹּאמֶר'}], boxes:[{id:'b1',label:'שורש'}], instruction:''}
//   state    = [{id:'t1', x, y, box:'b1' | ''}]   (drawing order: the last one is on top)
// The text of a tile is never part of the state, so a student can only move tiles, never change the words.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ClassPointerTiles=api;
})(typeof window!=='undefined'?window:null,function(){
  const LIMITS={tiles:40,boxes:40,tileText:24,label:20,instruction:120,source:1500};
  const FONT='"David Libre","Frank Ruehl CLM","Times New Roman",serif';
  // Character classes are built from code numbers so no invisible character ever sits in this file.
  const cls=(flags,...r)=>new RegExp('['+r.map(([a,b])=>String.fromCharCode(a)+'-'+String.fromCharCode(b)).join('')+']',flags);
  const NIKUD=cls('',[0x591,0x5c7]);
  const HEBREW=cls('',[0x590,0x5ff]);
  // Control and direction-changing characters never belong in a tile (they could hide or flip the words).
  const UNSAFE=cls('g',[0,0x1f],[0x7f,0x9f],[0x200b,0x200f],[0x2028,0x202e],[0x2066,0x2069],[0xfeff,0xfeff]);
  const ID=/^[tb][0-9]{1,3}$/;
  const clean=(text,max)=>String(text==null?'':text).replace(UNSAFE,'').replace(/\s+/g,' ').trim().slice(0,max);
  const round=n=>Math.round(n*1e4)/1e4;
  const unit=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;

  // ---------- Teacher input: pasted Hebrew -> tiles ----------
  // Words are split on spaces. In "pre-split" mode a | inside a word cuts it into parts (ו|אמר|ו = three tiles).
  // In whole-word mode the | marks are ignored so the words stay whole. Never silently shortens a word.
  function parse(source,options={}){
    const text=String(source==null?'':source).replace(/[\t\n\r]/g,' ').replace(UNSAFE,'');
    if(!text.trim())return{error:'Type or paste the Hebrew words first.'};
    if(text.length>LIMITS.source)return{error:'That is too long. Please use up to '+LIMITS.source+' letters at a time.'};
    const presplit=options.presplit===true,tiles=[];
    for(const word of text.split(/\s+/).filter(Boolean)){
      const parts=presplit?word.split('|'):[word.replace(/\|/g,'')];
      for(const part of parts){
        const value=clean(part,LIMITS.tileText+1);
        if(!value)continue;
        if(value.length>LIMITS.tileText)return{error:'The word "'+value.slice(0,12)+'…" is too long for one tile (up to '+LIMITS.tileText+' characters).'};
        tiles.push({id:'t'+(tiles.length+1),text:value});
      }
    }
    if(!tiles.length)return{error:'Type or paste the Hebrew words first.'};
    if(tiles.length>LIMITS.tiles)return{error:'That makes '+tiles.length+' tiles. Please use up to '+LIMITS.tiles+' at a time.'};
    const labels=String(options.labels||'').split(/[,;]/).map(l=>clean(l,LIMITS.label)).filter(Boolean);
    const wanted=options.boxes==null||options.boxes===''?tiles.length:Math.floor(Number(options.boxes));
    if(!Number.isFinite(wanted)||wanted<0||wanted>LIMITS.boxes)return{error:'Choose between 0 and '+LIMITS.boxes+' boxes.'};
    const boxes=[];
    for(let i=0;i<wanted;i++)boxes.push({id:'b'+(i+1),label:labels.length?labels[i%labels.length]:''});
    return{activity:{kind:'tiles',tiles,boxes,instruction:clean(options.instruction,LIMITS.instruction)}};
  }

  // Anything that comes from the network or a saved file is checked here before it is used.
  function cleanActivity(raw){
    if(!raw||raw.kind!=='tiles'||!Array.isArray(raw.tiles)||!raw.tiles.length||raw.tiles.length>LIMITS.tiles)return null;
    const tiles=[],seen=new Set();
    for(const item of raw.tiles){
      if(!item||typeof item.id!=='string'||!ID.test(item.id)||item.id[0]!=='t'||seen.has(item.id))return null;
      const text=clean(item.text,LIMITS.tileText);
      if(!text)return null;
      seen.add(item.id);tiles.push({id:item.id,text});
    }
    const rawBoxes=Array.isArray(raw.boxes)?raw.boxes:[];
    if(rawBoxes.length>LIMITS.boxes)return null;
    const boxes=[],seenBox=new Set();
    for(const item of rawBoxes){
      if(!item||typeof item.id!=='string'||!ID.test(item.id)||item.id[0]!=='b'||seenBox.has(item.id))return null;
      seenBox.add(item.id);boxes.push({id:item.id,label:clean(item.label,LIMITS.label)});
    }
    return{kind:'tiles',tiles,boxes,instruction:clean(raw.instruction,LIMITS.instruction)};
  }

  // ---------- Layout: where the boxes are and where the tiles start ----------
  // Tiles wait in a tray in the top half, boxes fill the bottom half. Rows run right to left, like Hebrew.
  const TRAY={top:.15,bottom:.5},AREA={top:.54,bottom:.97};
  const sizeScale=count=>count<=12?1:count<=24?.8:.62;
  // The height of a tile and its font, as a fraction of the board width.
  const fontFraction=count=>.04*sizeScale(count);
  function letterCount(text){let n=0;for(const c of text)if(!NIKUD.test(c))n++;return n}
  // Used before anything can be measured (and in tests): about how wide a tile is, as a fraction of the board width.
  const estimateWidth=(text,count)=>fontFraction(count)*(Math.max(1,letterCount(text))*.62+1.1);

  function boxLayout(activity){
    const list=activity.boxes,n=list.length;
    if(!n)return[];
    const cols=Math.min(n,5),rows=Math.ceil(n/cols),gap=.012;
    const w=Math.min(.19,(.92-(cols-1)*gap)/cols),rowH=Math.min(.15,(AREA.bottom-AREA.top)/rows),h=Math.min(.12,rowH-.02);
    return list.map((box,i)=>{
      const row=Math.floor(i/cols),inRow=Math.min(cols,n-row*cols),col=i%cols;
      const rowWidth=inRow*w+(inRow-1)*gap,right=.5+rowWidth/2;
      return{id:box.id,label:box.label,w,h,x:right-w/2-col*(w+gap),y:AREA.top+rowH*row+rowH/2};
    });
  }
  function homeState(activity){
    const count=activity.tiles.length,th=fontFraction(count)*1.9*(16/9),gap=.012;
    const state=[];let right=.96,y=TRAY.top+th/2;
    for(const tile of activity.tiles){
      const w=estimateWidth(tile.text,count);
      if(right-w<.04&&right<.96){right=.96;y+=th+gap}
      state.push({id:tile.id,x:round(right-w/2),y:round(Math.min(TRAY.bottom,y)),box:''});
      right-=w+gap;
    }
    return state;
  }
  const defaultState=activity=>activity?homeState(activity):null;

  // ---------- State checks ----------
  function cleanTile(activity,raw){
    if(!raw||typeof raw.id!=='string'||!activity.tiles.some(t=>t.id===raw.id)||!unit(raw.x)||!unit(raw.y))return null;
    const box=raw.box==null||raw.box===''?'':String(raw.box);
    if(box&&!activity.boxes.some(b=>b.id===box))return null;
    // A tile that is in a box always sits in the middle of that box, whatever place was sent.
    if(box){const at=boxLayout(activity).find(b=>b.id===box);if(at)return{id:raw.id,x:round(at.x),y:round(at.y),box}}
    return{id:raw.id,x:round(raw.x),y:round(raw.y),box};
  }
  // A saved or received list of tile places: only real tiles, each once, one tile per box; anything missing starts at home.
  function cleanState(activity,raw){
    if(!activity)return null;
    const home=homeState(activity),out=[],seen=new Set(),used=new Set();
    if(Array.isArray(raw))for(const item of raw.slice(0,LIMITS.tiles)){
      const tile=cleanTile(activity,item);
      if(!tile||seen.has(tile.id))continue;
      if(tile.box){if(used.has(tile.box))tile.box='';else used.add(tile.box)}
      seen.add(tile.id);out.push(tile);
    }
    for(const tile of home)if(!seen.has(tile.id))out.push(tile);
    return out;
  }
  // One tile moved. Returns the new list (the tile is now on top), or null when it is not allowed:
  // a box can hold only one tile.
  function move(activity,state,raw){
    if(!activity||!Array.isArray(state))return null;
    const tile=cleanTile(activity,raw);if(!tile)return null;
    if(tile.box&&state.some(t=>t.box===tile.box&&t.id!==tile.id))return null;
    return state.filter(t=>t.id!==tile.id).concat(tile);
  }

  // ---------- Size, hit test, snapping ----------
  let measurer=null;
  function measure(text,fontPx,ctx){
    let c=ctx;
    if(!c&&typeof document!=='undefined'){measurer=measurer||document.createElement('canvas').getContext('2d');c=measurer}
    if(!c||typeof c.measureText!=='function')return null;
    c.font='400 '+fontPx+'px '+FONT;return c.measureText(text).width;
  }
  // The size of one tile in pixels on a board w wide.
  function tileSize(activity,text,w,ctx){
    const count=activity.tiles.length,font=fontFraction(count)*w,width=measure(text,font,ctx);
    const textWidth=width==null?estimateWidth(text,count)*w-font*1.1:width;
    return{w:Math.max(font*1.7,textWidth+font*1.1),h:font*1.9,font};
  }
  // The tile under a point (0..1) on a board of w by h pixels, topmost first.
  function tileAt(activity,state,p,w,h,ctx){
    if(!activity||!state)return null;
    const lookup=new Map(activity.tiles.map(t=>[t.id,t]));
    for(let i=state.length-1;i>=0;i--){
      const t=state[i],info=lookup.get(t.id);if(!info)continue;
      const s=tileSize(activity,info.text,w,ctx);
      if(Math.abs(p.x*w-t.x*w)<=s.w/2&&Math.abs(p.y*h-t.y*h)<=s.h/2)return t;
    }
    return null;
  }
  // Which free box a dropped tile snaps into (its middle is inside the box), or ''.
  function boxFor(activity,state,id,x,y){
    for(const box of boxLayout(activity)){
      if(Math.abs(x-box.x)<=box.w/2&&Math.abs(y-box.y)<=box.h/2+.02&&!state.some(t=>t.box===box.id&&t.id!==id))return box;
    }
    return null;
  }
  // Where a dropped tile ends up: in the box when it snaps (centered), else where it was let go. If it was dropped on a
  // box that already holds a tile it goes back where it came from.
  function drop(activity,state,id,x,y,from){
    const box=boxFor(activity,state,id,x,y);
    if(box)return{id,x:round(box.x),y:round(box.y),box:box.id};
    const full=boxLayout(activity).some(b=>Math.abs(x-b.x)<=b.w/2&&Math.abs(y-b.y)<=b.h/2+.02);
    if(full&&from)return{id,x:from.x,y:from.y,box:from.box&&!state.some(t=>t.box===from.box&&t.id!==id)?from.box:''};
    return{id,x:round(Math.min(1,Math.max(0,x))),y:round(Math.min(1,Math.max(0,y))),box:''};
  }

  // ---------- Drawing ----------
  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  }
  function paint(ctx,w,h,activity,state){
    if(!activity)return;
    ctx.save();
    ctx.direction='rtl';ctx.textAlign='center';ctx.textBaseline='middle';
    if(activity.instruction){
      ctx.fillStyle='#59667c';ctx.font='600 '+Math.max(9,h*.05)+'px Arial, sans-serif';
      ctx.fillText(activity.instruction,w/2,h*.07,w*.92);
    }
    const occupied=new Set((state||[]).map(t=>t.box).filter(Boolean));
    for(const box of boxLayout(activity)){
      const x=(box.x-box.w/2)*w,y=(box.y-box.h/2)*h,bw=box.w*w,bh=box.h*h;
      roundRect(ctx,x,y,bw,bh,Math.min(bw,bh)*.14);
      ctx.fillStyle=occupied.has(box.id)?'#ecfdf5':'#eff6ff';ctx.fill();
      ctx.setLineDash(occupied.has(box.id)?[]:[7,5]);ctx.lineWidth=2;ctx.strokeStyle=occupied.has(box.id)?'#10b981':'#60a5fa';ctx.stroke();ctx.setLineDash([]);
      if(box.label&&!occupied.has(box.id)){
        ctx.fillStyle='#64748b';ctx.font='600 '+Math.max(9,bh*.26)+'px '+FONT;ctx.fillText(box.label,box.x*w,box.y*h,bw*.9);
      }
    }
    const lookup=new Map(activity.tiles.map(t=>[t.id,t]));
    for(const tile of state||[]){
      const info=lookup.get(tile.id);if(!info)continue;
      const s=tileSize(activity,info.text,w,ctx),x=tile.x*w-s.w/2,y=tile.y*h-s.h/2;
      ctx.save();ctx.shadowColor='rgba(15,23,42,.28)';ctx.shadowBlur=s.font*.22;ctx.shadowOffsetY=s.font*.07;
      roundRect(ctx,x,y,s.w,s.h,s.font*.28);ctx.fillStyle='#ffffff';ctx.fill();ctx.restore();
      roundRect(ctx,x,y,s.w,s.h,s.font*.28);ctx.lineWidth=2;ctx.strokeStyle=tile.box?'#10b981':'#2563eb';ctx.stroke();
      ctx.fillStyle='#1f2937';ctx.font='400 '+s.font+'px '+FONT;
      ctx.direction=HEBREW.test(info.text)?'rtl':'ltr';ctx.fillText(info.text,tile.x*w,tile.y*h+s.font*.04,s.w);
    }
    ctx.restore();
  }

  // Loads the bundled Hebrew font (David Libre, SIL Open Font License) once; calls done() when it is ready so the
  // board can paint again. The board works with a fallback font until then.
  let fontState=null;
  function loadFont(done){
    if(typeof document==='undefined'||typeof FontFace==='undefined'||!document.fonts)return;
    if(fontState==='ready'){return}
    if(fontState==='loading')return;
    fontState='loading';
    let base='';
    try{
      const own=document.currentScript?.src||Array.from(document.scripts).map(s=>s.src).find(src=>/board-tiles-core\.js/.test(src))||'';
      base=own?new URL('fonts/DavidLibre-Regular.ttf',own).href:'';
    }catch(_){base=''}
    if(!base){fontState=null;return}
    const face=new FontFace('David Libre','url('+base+')',{weight:'400'});
    face.load().then(loaded=>{document.fonts.add(loaded);fontState='ready';if(typeof done==='function')done()},()=>{fontState=null});
  }

  // ---------- Dragging one tile with the mouse, a pen or a finger ----------
  // io: activity() -> activity|null, state() -> list|null, size() -> {w,h} in pixels, apply(op) applies the change
  // and sends it, redraw(). Points p are 0..1. Returns {down, move, up, active}. Works the same for a student's own
  // board and for the teacher's large view of one student's board.
  function dragger(io){
    let grab=null,last=0;
    const clamp=v=>Math.min(1,Math.max(0,v));
    function put(tile){io.apply({type:'board-tile',tile})}
    return{
      active:()=>!!grab,
      // Is there a tile under this point? (Nothing is moved.)
      hit(p){const activity=io.activity(),state=io.state();if(!activity||!state)return false;const {w,h}=io.size();return !!tileAt(activity,state,p,w,h)},
      down(p){
        const activity=io.activity(),state=io.state();if(!activity||!state)return false;
        const {w,h}=io.size(),tile=tileAt(activity,state,p,w,h);if(!tile)return false;
        grab={id:tile.id,dx:tile.x-p.x,dy:tile.y-p.y,from:{x:tile.x,y:tile.y,box:tile.box}};
        // Picking a tile up frees its box straight away and puts it on top.
        put({id:tile.id,x:tile.x,y:tile.y,box:''});io.redraw();return true;
      },
      move(p,final){
        if(!grab)return;
        if(!final&&Date.now()-last<70)return;
        last=Date.now();
        put({id:grab.id,x:clamp(p.x+grab.dx),y:clamp(p.y+grab.dy),box:''});
      },
      up(p){
        if(!grab)return;
        const g=grab;grab=null;
        const activity=io.activity(),state=io.state();if(!activity||!state)return;
        const at=state.find(t=>t.id===g.id)||{x:g.from.x,y:g.from.y};
        const x=p?clamp(p.x+g.dx):at.x,y=p?clamp(p.y+g.dy):at.y;
        put(drop(activity,state,g.id,x,y,g.from));io.redraw();
      },
      cancel(){
        if(!grab)return;const g=grab;grab=null;
        put({id:g.id,x:g.from.x,y:g.from.y,box:g.from.box});io.redraw();
      }
    };
  }

  return{LIMITS,FONT,parse,cleanActivity,defaultState,cleanState,cleanTile,move,boxLayout,tileSize,tileAt,boxFor,drop,paint,loadFont,dragger,estimateWidth,letterCount};
});
