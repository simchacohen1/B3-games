(function(root){
  'use strict';
  const colors=['#57b8ff','#ff7979','#75df9a','#dca0ff','#ffa65c','#7ce4dc'];
  const tools=['target','arrow','star','heart','paw','sparkle'];
  const highlightShapes=['highlight-rectangle','highlight-ellipse'];
  const HISTORY_MAX=100;   // Undo steps kept for each person
  const isHighlightShape=tool=>highlightShapes.includes(tool);
  const shapeTool=tool=>isHighlightShape(tool)?tool.slice('highlight-'.length):tool;
  const highlightTools=['highlight','pencil','crayon','underline','box','pen','line','pen-arrow','rectangle','ellipse','triangle','text',...highlightShapes];
  // Dark ink colors read well on the whiteboard. They are allowed for pointers and marks, but are not class colors.
  const inkColors=['#1f2937','#1d4ed8','#777777','#ffffff','#29b6f6','#4dd0e1','#009688','#c62828','#ff7043','#ef6c00','#ffc107','#fff176','#cddc39','#8bc34a','#2e7d32','#a5d6a7','#7b1fa2','#ab47bc','#b39ddb','#ec407a','#f48fb1','#795548','#bcaaa4','#ffd1a9'];
  const TEXT_MIN=.003,TEXT_MAX=.08;
  // Fonts for the words on the whiteboard. 'sans' is the plain sans-serif the whiteboard has always used. The others fall back
  // to a similar font on a device that does not have them; the Hebrew ones cover Hebrew letters. [name shown, CSS font stack]
  const FONTS={
    sans:['Standard','sans-serif'],
    david:['David (Hebrew)','"David", "David CLM", "Times New Roman", serif'],
    frank:['Frank Ruehl (Hebrew)','"FrankRuehl", "Frank Ruehl CLM", "David", "Times New Roman", serif'],
    miriam:['Miriam (Hebrew)','"Miriam", "Miriam Libre", "Arial Hebrew", Arial, sans-serif'],
    serif:['Times','"Times New Roman", Times, serif'],
    mono:['Typewriter','"Courier New", "Miriam Fixed", monospace'],
    comic:['Handwriting','"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive']
  };
  const fontStack=key=>(Object.prototype.hasOwnProperty.call(FONTS,key)?FONTS[key]:FONTS.sans)[1];
  const FILLABLE=['rectangle','ellipse','triangle'];
  // Marks may be any #rrggbb (the custom color picker); pointers keep their own short list.
  const strokeColor=value=>/^#[0-9a-f]{6}$/i.test(value?.color)?value.color.toLowerCase():(pointStyle(value).color||'#ffcc00');
  function cleanStroke(value){
    if(!value||!highlightTools.includes(value.tool)||!Array.isArray(value.points)||value.points.length<2||value.points.length>256||!value.points.every(validPoint))return null;
    const text=value.tool==='text'?String(value.text||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,240):'';if(value.tool==='text'&&!text.trim())return null;
    // Lines keep the three sizes. Words can be any size between TEXT_MIN and TEXT_MAX (the teacher drags a corner).
    const size=value.tool==='text'&&Number.isFinite(value.size)&&value.size>=TEXT_MIN&&value.size<=TEXT_MAX?Math.round(value.size*1e4)/1e4:[0.008,0.016,0.028].includes(value.size)?value.size:0.016;
    // The lines of one block of words share a block id; a wrapped line is marked soft; boxW is a width the teacher chose.
    const extra=value.tool!=='text'?{}:{text,...(typeof value.block==='string'&&/^[a-z0-9]{2,16}$/.test(value.block)?{block:value.block}:{}),...(value.soft===true?{soft:true}:{}),...(value.bold===true?{bold:true}:{}),...(Object.prototype.hasOwnProperty.call(FONTS,value.font)&&value.font!=='sans'?{font:value.font}:{}),...(Number.isFinite(value.boxW)&&value.boxW>=.05&&value.boxW<=1?{boxW:value.boxW}:{})};
    // A shape can be filled with its own color (rectangle, circle, triangle).
    const fill=value.fill===true&&FILLABLE.includes(value.tool)?{fill:true}:{};
    return{tool:value.tool,color:strokeColor(value),size,points:value.points.map(({x,y})=>({x,y})),...extra,...fill};
  }
  class HighlightStore{
    constructor(){this.strokes=[];this.sequence=0;this.history=new Map();this.pending=null;this.actor=null}
    // ---------- Undo ----------
    // Undo takes back the last thing a person did, exactly: a new mark, a delete, a move, a resize, a recolor, a block of
    // words laid out again, a clear. Each person has their own list of steps (the teacher's Undo never touches a student's
    // work, and the other way round). A step done to several marks at once (a group moved, a block of words deleted) is one step.
    note(owner,entry){if(this.pending){this.pending.push(entry);return}const who=this.actor||owner,list=this.history.get(who)||[];list.push(entry);if(list.length>HISTORY_MAX)list.shift();this.history.set(who,list)}
    // Everything done inside fn is ONE step for Undo, filed under actor (who pressed the button, even when the mark is someone else's).
    group(actor,fn){
      if(this.pending)return fn();
      this.pending=[];this.actor=actor;
      try{return fn()}finally{
        const steps=this.pending;this.pending=null;this.actor=null;
        if(steps.length){const list=this.history.get(actor)||[];list.push(steps.length===1?steps[0]:{op:'group',entries:steps});if(list.length>HISTORY_MAX)list.shift();this.history.set(actor,list)}
      }
    }
    // Put one step back the way it was. False when nothing changed (the mark is gone), so Undo goes on to the step before.
    revert(entry){
      if(entry.op==='group'){let any=false;for(let k=entry.entries.length-1;k>=0;k--)any=this.revert(entry.entries[k])||any;return any}
      if(entry.op==='add'){
        const i=this.strokes.findIndex(s=>s.id===entry.id);if(i<0)return false;const mark=this.strokes[i];
        if(mark.tool==='text'&&mark.block)this.strokes=this.strokes.filter(s=>!(s.owner===mark.owner&&s.tool==='text'&&s.block===mark.block));else this.strokes.splice(i,1);
        return true;
      }
      if(entry.op==='remove'||entry.op==='swap'){
        if(entry.op==='swap'){const ids=new Set(entry.newIds);if(!this.strokes.some(s=>ids.has(s.id)))return false;this.strokes=this.strokes.filter(s=>!ids.has(s.id))}
        let any=entry.op==='swap';
        for(const item of [...(entry.items||entry.before)].sort((a,b)=>a.index-b.index)){
          if(this.strokes.some(s=>s.id===item.stroke.id))continue;
          this.strokes.splice(Math.min(item.index,this.strokes.length),0,{...item.stroke});any=true;
        }
        return any;
      }
      if(entry.op==='replace'){const i=this.strokes.findIndex(s=>s.id===entry.id);if(i<0)return false;this.strokes[i]={...entry.before};return true}
      return false;
    }
    undo(owner){
      const list=this.history.get(owner)||[];
      while(list.length){if(this.revert(list.pop()))return true}
      // Nothing recorded (marks that came back from a saved whiteboard): the newest mark of this person goes, as it always did.
      const i=this.strokes.findLastIndex(s=>s.owner===owner);
      if(i>=0){const last=this.strokes[i];if(last.tool==='text'&&last.block)this.strokes=this.strokes.filter(s=>!(s.owner===owner&&s.tool==='text'&&s.block===last.block));else this.strokes.splice(i,1);return true}
      return false;
    }
    // Everything on the board goes (the Clear button), and Undo brings it all back.
    clearAll(actor){
      if(!this.strokes.length)return false;
      this.group(actor,()=>this.note(actor,{op:'remove',items:this.strokes.map((stroke,index)=>({index,stroke:{...stroke}}))}));
      this.strokes=[];return true;
    }
    add(owner,value){const stroke=cleanStroke(value);if(!stroke)return false;
      // Highlights keep the original limits (40 per person, 240 per class). Pen writing needs more lines: 150 per person, 400 marks in total.
      const mine=this.strokes.filter(s=>s.owner===owner),pen=['pen','line','pen-arrow','rectangle','ellipse','triangle','text'].includes(stroke.tool);
      if(this.strokes.length>=400||(pen?mine.filter(s=>['pen','line','pen-arrow','rectangle','ellipse','triangle','text'].includes(s.tool)).length>=150:(mine.filter(s=>s.tool!=='pen').length>=40||this.strokes.filter(s=>s.tool!=='pen').length>=240)))return false;const id='h'+(++this.sequence);this.strokes.push({...stroke,owner,id});this.note(owner,{op:'add',id});return true}
    edit(owner,action,id){if(action==='erase'){const i=this.strokes.findIndex(s=>s.owner===owner&&s.id===id);if(i>=0){this.note(owner,{op:'remove',items:[{index:i,stroke:{...this.strokes[i]}}]});this.strokes.splice(i,1)}return}if(action==='clear'){const items=this.strokes.map((stroke,index)=>({index,stroke:{...stroke}})).filter(x=>x.stroke.owner===owner);if(items.length)this.note(owner,{op:'remove',items});this.strokes=this.strokes.filter(s=>s.owner!==owner);return}if(action==='undo'){this.undo(owner);return}}
    // Change one of my own marks where it is (move, resize, recolor). It keeps its id, its owner, its place in
    // the pile, its kind and its words; only the points, color and size can change. False when nothing changed.
    replace(owner,id,value){
      const i=this.strokes.findIndex(s=>s.owner===owner&&s.id===id);if(i<0)return false;
      const old=this.strokes[i],next=cleanStroke({...value,tool:old.tool,text:old.text});
      if(!next||next.points.length!==old.points.length)return false;
      this.note(owner,{op:'replace',id:old.id,before:{...old}});
      this.strokes[i]={...next,owner:old.owner,id:old.id};return true}
    // Put new marks in the place of some of my own marks (a block of words laid out again can have more or fewer
    // lines). All or nothing. Returns the new ids, or null when nothing was changed.
    swap(owner,ids,values){
      const gone=new Set(ids),mine=s=>s.owner===owner&&gone.has(s.id),at=this.strokes.findIndex(mine);if(at<0)return null;
      const next=(Array.isArray(values)?values:[]).map(cleanStroke);if(!next.length||next.some(s=>!s))return null;
      const kept=this.strokes.filter(s=>!mine(s));if(kept.length+next.length>400)return null;
      const made=next.map(s=>({...s,owner,id:'h'+(++this.sequence)}));
      this.note(owner,{op:'swap',newIds:made.map(s=>s.id),before:this.strokes.map((stroke,index)=>({index,stroke:{...stroke}})).filter(x=>mine(x.stroke))});
      kept.splice(at,0,...made);this.strokes=kept;return made.map(s=>s.id)}
    reset(){this.strokes=[];this.history.clear()}
    // Put saved marks back (a saved whiteboard). Every mark is checked again. The teacher's marks are the
    // teacher's again; all others become "saved" marks that no student owns. At most 400 marks, as always.
    restore(list){this.strokes=[];this.history.clear();
      for(const value of Array.isArray(list)?list:[]){if(this.strokes.length>=400)break;const stroke=cleanStroke(value);if(stroke)this.strokes.push({...stroke,owner:value.owner==='teacher'?'teacher':'saved',id:'h'+(++this.sequence)})}
      return this.strokes.length}
  }
  function pointStyle(point){return{tool:tools.includes(point?.tool)?point.tool:'target',color:[...colors,...inkColors,'#ffcc00'].includes(point?.color)?point.color:null}}
  function cleanName(value){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,32):''}
  function validPoint(value){return !!value&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&value.x>=0&&value.x<=1&&value.y>=0&&value.y<=1}
  function canPoint(mode,student){return !!student?.admitted&&(mode==='everyone'||(mode==='selected'&&student.allowed===true))}
  function canWrite(mode,student){return canPoint(mode,student)&&student?.writeAllowed===true}
  function pictureBox(width,height,videoWidth,videoHeight){
    if(!width||!height||!videoWidth||!videoHeight)return null;
    const scale=Math.min(width/videoWidth,height/videoHeight),w=videoWidth*scale,h=videoHeight*scale;
    return{w,h,left:(width-w)/2,top:(height-h)/2};
  }
  const api={isHighlightShape,shapeTool,FONTS,fontStack,FILLABLE,TEXT_MIN,TEXT_MAX,cleanName,validPoint,canPoint,canWrite,pictureBox,colors,inkColors,tools,pointStyle,highlightTools,cleanStroke,HighlightStore};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ClassPointerCore=api;
})(typeof window==='undefined'?{}:window);
