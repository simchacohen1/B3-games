'use strict';
// Class Pointer whiteboard: student zones.
//
// The teacher cuts the shared whiteboard into zones (boxes) and gives each zone to one student or to a few. A student can
// only draw, type, move or erase inside a zone that is theirs; the rest of the board is locked for them, but they still see
// all of it. The teacher can write everywhere. This file only holds the rules (no network, no page), so the teacher's page,
// the student's page and the tests all use the same ones.
//
//   zone = {id:'z1', x, y, w, h, owners:[{k:<student key>, n:<name>}]}   (x, y, w, h are fractions of the board, 0..1)
//   A student key is the dashboard student id, or 'name:' + the lower-case name for a student that has no id.
//   A board with no zones on the page being shown is free for everyone, as it always was. "Locked" turns every zone off
//   for students at once (they can look, nobody but the teacher can write).
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ClassPointerZones=api;
})(typeof window!=='undefined'?window:null,function(){
  const LIMITS={zones:30,owners:12,name:30,key:80,minSize:.03};
  // Control and direction-changing characters never belong in a name (built from code numbers, so none sits in this file).
  const range=(a,b)=>String.fromCharCode(a)+'-'+String.fromCharCode(b);
  const CONTROL=new RegExp('['+[range(0,0x1f),range(0x7f,0x7f),range(0x200b,0x200f),range(0x2028,0x202e),range(0x2066,0x2069),range(0xfeff,0xfeff)].join('')+']','g');
  const cleanName=value=>String(value==null?'':value).replace(CONTROL,' ').replace(/\s+/g,' ').trim().slice(0,LIMITS.name);
  const cleanKey=value=>String(value==null?'':value).replace(CONTROL,'').trim().slice(0,LIMITS.key);
  const round=value=>Math.round(value*1e4)/1e4;
  const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
  const validId=id=>typeof id==='string'&&/^z[0-9]{1,6}$/.test(id);
  // How far a point may be outside a zone and still count as inside (fingers and mice are not exact).
  const SLACK=.004;

  // The student a connection belongs to, from what the teacher's page knows about them (never from the student's message).
  const keyOf=member=>{
    if(!member)return '';
    const id=cleanKey(member.studentId);
    return id||('name:'+cleanName(member.name).toLowerCase());
  };

  function cleanOwners(raw){
    const out=[],seen=new Set();
    for(const item of Array.isArray(raw)?raw:[]){
      const k=cleanKey(item&&typeof item==='object'?item.k:item);
      if(!k||seen.has(k))continue;
      seen.add(k);out.push({k,n:cleanName(item&&typeof item==='object'?item.n:'')});
      if(out.length>=LIMITS.owners)break;
    }
    return out;
  }
  // One zone, always inside the board and never tiny. null when it is not a zone.
  function cleanZone(raw){
    if(!raw||typeof raw!=='object'||!validId(raw.id))return null;
    const nums=[raw.x,raw.y,raw.w,raw.h].map(Number);
    if(!nums.every(Number.isFinite))return null;
    let [x,y,w,h]=nums;
    x=clamp(x,0,1);y=clamp(y,0,1);w=clamp(w,0,1-x);h=clamp(h,0,1-y);
    if(w<LIMITS.minSize||h<LIMITS.minSize)return null;
    return{id:raw.id,x:round(x),y:round(y),w:round(w),h:round(h),owners:cleanOwners(raw.owners)};
  }
  function cleanList(raw){
    const out=[],seen=new Set();
    for(const item of Array.isArray(raw)?raw:[]){
      const zone=cleanZone(item);
      if(!zone||seen.has(zone.id))continue;
      seen.add(zone.id);out.push(zone);
      if(out.length>=LIMITS.zones)break;
    }
    return out;
  }
  const nextId=list=>{let top=0;for(const z of list)top=Math.max(top,Number(z.id.slice(1))||0);return 'z'+(top+1)};
  // A new zone from two corners (in any order). null when it is too small or the board has the most zones it can hold.
  function make(list,a,b){
    if(list.length>=LIMITS.zones||!a||!b)return null;
    const x1=clamp(Math.min(a.x,b.x),0,1),x2=clamp(Math.max(a.x,b.x),0,1),y1=clamp(Math.min(a.y,b.y),0,1),y2=clamp(Math.max(a.y,b.y),0,1);
    return cleanZone({id:nextId(list),x:x1,y:y1,w:x2-x1,h:y2-y1,owners:[]});
  }
  // Split the whole board into rows x columns equal boxes with a small gap between them. Each box is a zone (nobody has them yet).
  function grid(rows,cols){
    rows=Math.floor(Number(rows));cols=Math.floor(Number(cols));
    if(!(rows>=1&&cols>=1)||rows*cols>LIMITS.zones)return null;
    const gap=.008,out=[];
    const w=(1-gap*(cols+1))/cols,h=(1-gap*(rows+1))/rows;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const zone=cleanZone({id:'z'+(out.length+1),x:gap+c*(w+gap),y:gap+r*(h+gap),w,h,owners:[]});
      if(!zone)return null;
      out.push(zone);
    }
    return out;
  }
  // The most even rows x columns for `count` boxes (a wide board: more columns than rows), with exactly `count` or a few more.
  function shapeFor(count){
    count=Math.floor(Number(count));
    if(!(count>=1)||count>LIMITS.zones)return null;
    const cols=Math.ceil(Math.sqrt(count*1.6)),rows=Math.ceil(count/cols);
    return{rows,cols};
  }
  // `count` boxes with no empty leftover: the last row is shared out wider if it is short.
  function gridFor(count){
    const shape=shapeFor(count);if(!shape)return null;
    const{rows,cols}=shape,gap=.008,out=[];
    const h=(1-gap*(rows+1))/rows;
    let left=count;
    for(let r=0;r<rows;r++){
      const inRow=r<rows-1?cols:left,w=(1-gap*(inRow+1))/inRow;
      for(let c=0;c<inRow;c++){
        const zone=cleanZone({id:'z'+(out.length+1),x:gap+c*(w+gap),y:gap+r*(h+gap),w,h,owners:[]});
        if(!zone)return null;
        out.push(zone);
      }
      left-=inRow;
    }
    return out;
  }

  const owns=(zone,key)=>!!key&&zone.owners.some(o=>o.k===key);
  const holds=(zone,p,slack=SLACK)=>!!p&&p.x>=zone.x-slack&&p.x<=zone.x+zone.w+slack&&p.y>=zone.y-slack&&p.y<=zone.y+zone.h+slack;
  const mine=(list,key)=>list.filter(z=>owns(z,key));
  // Does this page have zones that restrict students? (No zones: the board is free, as it always was.)
  const active=list=>Array.isArray(list)&&list.length>0;
  // The zone of this student that holds point p, or null.
  const zoneAt=(list,key,p,locked)=>locked?null:(mine(list,key).find(z=>holds(z,p))||null);
  // The points of a mark that must be inside the zone: every point; for words only where they start (the box that follows
  // the first point is a guess at their width and may stick out; longer words are cut by the student's own page).
  function pointsOf(stroke){
    const points=Array.isArray(stroke?.points)?stroke.points:[];
    return stroke?.tool==='text'?points.slice(0,1):points;
  }
  // May this student put or move this mark here? Everything must be in ONE zone that is theirs.
  function allows(list,locked,key,stroke){
    if(!active(list))return true;
    if(locked)return false;
    const points=pointsOf(stroke);
    if(!points.length)return false;
    return mine(list,key).some(z=>points.every(p=>holds(z,p)));
  }
  // May this student change or take away a mark that is already on the board? Same rule, applied to where it is now.
  const allowsExisting=allows;
  // Keep a point inside a zone (a line dragged out of the box stops at its edge).
  const clampTo=(zone,p)=>({x:clamp(p.x,zone.x,zone.x+zone.w),y:clamp(p.y,zone.y,zone.y+zone.h)});
  // The most a mark may be moved so that it stays whole inside the zone: dx, dy changed to fit.
  function fitMove(zone,points,dx,dy){
    if(!points.length)return{dx:0,dy:0};
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    return{dx:clamp(dx,zone.x-Math.min(...xs),zone.x+zone.w-Math.max(...xs)),dy:clamp(dy,zone.y-Math.min(...ys),zone.y+zone.h-Math.max(...ys))};
  }

  // What one student is told: every zone with who has it, and which are theirs. Nothing about other students but their names.
  function forStudent(list,locked,key){
    const names=zone=>zone.owners.map(o=>o.n).filter(Boolean).join(', ');
    return{locked:locked===true,zones:list.map(z=>({id:z.id,x:z.x,y:z.y,w:z.w,h:z.h,mine:owns(z,key),label:names(z)}))};
  }
  // What a student's page keeps of that message (checked again: it came over the network).
  function cleanForStudent(raw){
    const out={locked:false,zones:[]};
    if(!raw||typeof raw!=='object')return out;
    out.locked=raw.locked===true;
    const seen=new Set();
    for(const item of Array.isArray(raw.zones)?raw.zones.slice(0,LIMITS.zones):[]){
      const zone=cleanZone({...item,owners:[]});
      if(!zone||seen.has(zone.id))continue;
      seen.add(zone.id);
      out.zones.push({id:zone.id,x:zone.x,y:zone.y,w:zone.w,h:zone.h,mine:item.mine===true,label:cleanName(item.label)});
    }
    return out;
  }
  // The same rules from the student's point of view (their own page uses these to stop a mark before it is sent).
  const studentActive=state=>!!state&&state.zones.length>0;
  const studentZoneAt=(state,p)=>!state||!state.zones.length||state.locked?null:(state.zones.find(z=>z.mine&&holds(z,p))||null);
  const studentAllows=(state,stroke)=>{
    if(!studentActive(state))return true;
    if(state.locked)return false;
    const points=pointsOf(stroke);
    return points.length>0&&state.zones.some(z=>z.mine&&points.every(p=>holds(z,p)));
  };

  // A saved board keeps its zones (a template too), so owners come back by their key.
  const cleanSaved=cleanList;

  return{LIMITS,SLACK,keyOf,cleanName,cleanKey,cleanZone,cleanList,cleanSaved,nextId,make,grid,gridFor,shapeFor,owns,holds,mine,active,zoneAt,pointsOf,allows,allowsExisting,clampTo,fitMove,
    forStudent,cleanForStudent,studentActive,studentZoneAt,studentAllows};
});
