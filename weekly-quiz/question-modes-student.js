/* Student answer controls for schema v2. Standalone preview module; no database writes.
 * Embeddable only after authenticated server answer endpoints support typed answers.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.FTTQuizStudentModes=api;
})(typeof window!=='undefined'?window:null,function(){
'use strict';
function empty(mode){
 switch(mode){
 case 'single_select':return {choiceIndex:null};
 case 'multi_select':return {indices:[]};
 case 'true_false':return {value:null};
 case 'free_text':case 'essay':return {text:''};
 case 'sorter':return {order:[]};
 case 'categorizer':case 'multi_categorizer':return {key:{}};
 case 'highlight_text':return {spans:[]};
 case 'hot_spot':return {point:null};
 case 'fill_gaps':return {values:{}};
 default:return {};
 }
}
function render(container,question,changed,initial){
 if(!container||!container.ownerDocument)throw Error('DOM container required');
 if(typeof changed!=='function')throw Error('Callback required');
 const q=question,doc=container.ownerDocument;
 const a=initial&&typeof initial==='object'?JSON.parse(JSON.stringify(initial)):empty(q.mode);
 container.replaceChildren();
 const node=(tag,text,parent=container)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=String(text);parent.appendChild(n);return n;};
 const announce=()=>changed(JSON.parse(JSON.stringify(a)));
 function choice(label,callback,type='button'){let b=node('button',label);b.type=type;b.onclick=callback;return b;}
 function selectChoice(i,value){const input=node('label');const cb=node('input',undefined,input);cb.type=q.mode==='multi_select'?'checkbox':'radio';cb.name='answer-selection';cb.checked=!!value;input.append(doc.createTextNode(q.choices[i]));return cb;}
 switch(q.mode){
 case 'single_select':case 'multi_select':
  q.choices.forEach((label,i)=>{
    const selected=q.mode==='multi_select'?a.indices.includes(i):a.choiceIndex===i;
    const cb=selectChoice(i,selected);
    cb.onchange=()=>{if(q.mode==='multi_select'){a.indices=cb.checked?[...a.indices,i]:a.indices.filter(x=>x!==i);}else{a.choiceIndex=i;container.querySelectorAll('input[type=radio]').forEach((x,j)=>x.checked=j===i);}announce();};
  });break;
 case 'true_false':
  [true,false].forEach(v=>{const b=choice(v?'True':'False',()=>{a.value=v;announce();});b.setAttribute('aria-pressed',String(a.value===v));});break;
 case 'free_text':case 'essay':{
  const el=node(q.mode==='essay'?'textarea':'input');el.dir='auto';el.value=a.text||'';el.oninput=()=>{a.text=el.value;announce();};break;
 }
 case 'sorter':{
  a.order=a.order&&a.order.length?a.order.slice():q.items.slice();
  function rows(){
   container.replaceChildren();
   a.order.forEach((label,i)=>{
    const row=node('div');row.dir='auto';node('span',label,row);
    let up=node('button','↑',row);up.type='button';up.disabled=i===0;up.setAttribute('aria-label','Move '+label+' up');
    up.onclick=()=>{[a.order[i-1],a.order[i]]=[a.order[i],a.order[i-1]];rows();announce();};
    let down=node('button','↓',row);down.type='button';down.disabled=i===a.order.length-1;down.setAttribute('aria-label','Move '+label+' down');
    down.onclick=()=>{[a.order[i+1],a.order[i]]=[a.order[i],a.order[i+1]];rows();announce();};
   });
  } rows();break;
 }
 case 'categorizer':case 'multi_categorizer':
  q.items.forEach(item=>{
   const row=node('div');row.dir='auto';node('strong',item+' — ',row);
   if(q.mode==='categorizer'){
    const sel=node('select',undefined,row);const blank=node('option','Choose category',sel);blank.value='';
    q.categories.forEach(cat=>{const o=node('option',cat,sel);o.value=cat;});
    sel.value=a.key[item]||'';sel.onchange=()=>{a.key[item]=sel.value;announce();};
   }else q.categories.forEach(cat=>{
    const lbl=node('label',undefined,row),cb=node('input',undefined,lbl);cb.type='checkbox';cb.checked=(a.key[item]||[]).includes(cat);lbl.append(doc.createTextNode(cat));
    cb.onchange=()=>{const set=new Set(a.key[item]||[]);cb.checked?set.add(cat):set.delete(cat);a.key[item]=[...set];announce();};
   });
  });break;
 case 'highlight_text':{
  const p=node('p');p.dir='auto';p.textContent=q.passage;
  const note=node('p','Select the text to highlight, then press Add selection.');note.className='help';
  choice('Add selection',()=>{
   const s=doc.getSelection&&doc.getSelection();if(!s||!s.rangeCount)return;
   const range=s.getRangeAt(0);if(!p.contains(range.commonAncestorContainer)||range.collapsed)return;
   const before=range.cloneRange();before.selectNodeContents(p);before.setEnd(range.startContainer,range.startOffset);
   const start=before.toString().length,end=start+range.toString().length;
   if(!a.spans.some(x=>start<x.end&&x.start<end)){a.spans.push({start,end});announce();renderMarks();}
  });
  const marks=node('div');function renderMarks(){marks.textContent=a.spans.map(s=>q.passage.slice(s.start,s.end)).join(' | ');}
  choice('Clear highlights',()=>{a.spans=[];renderMarks();announce();});renderMarks();break;
 }
 case 'hot_spot':{
  const fig=node('div');fig.style.position='relative';fig.style.maxWidth='620px';
  const img=node('img',undefined,fig);img.src=q.imageUrl;img.alt=q.imageAlt||q.q;img.style.width='100%';
  img.onclick=ev=>{const rect=img.getBoundingClientRect();if(!rect.width||!rect.height)return;a.point={x:(ev.clientX-rect.left)/rect.width,y:(ev.clientY-rect.top)/rect.height};announce();};
  node('p','Click a point on the image. For keyboard access, use the coordinate fields below.');
  ['x','y'].forEach(axis=>{const label=node('label',axis.toUpperCase()+' (0–100%)');const input=node('input',undefined,label);input.type='number';input.min='0';input.max='100';input.step='1';input.value=a.point?Math.round(a.point[axis]*100):'';input.onchange=()=>{const n=Number(input.value);if(n>=0&&n<=100){a.point=a.point||{x:0,y:0};a.point[axis]=n/100;announce();}};});break;
 }
 case 'fill_gaps':{
  const area=node('div');area.dir='auto';const bits=q.template.split(/(\{\{[^{}]+\}\})/g);
  bits.forEach(part=>{
   const match=part.match(/^\{\{([^{}]+)\}\}$/);if(!match){node('span',part,area);return;}
   const gap=q.gaps.find(g=>g.id===match[1]);if(!gap)return;
   const el=node(gap.options?'select':'input',undefined,area);el.setAttribute('aria-label','Blank '+gap.id);
   if(gap.options){let blank=node('option','Choose',el);blank.value='';gap.options.forEach(opt=>{let o=node('option',opt,el);o.value=opt;});}
   el.value=a.values[gap.id]||'';el.onchange=()=>{a.values[gap.id]=el.value;announce();};if(!gap.options)el.oninput=el.onchange;
  });break;
 }
 default:node('p','Unsupported question mode');
 }
 return {getAnswer:()=>JSON.parse(JSON.stringify(a))};
}
return Object.freeze({empty,render});
});
