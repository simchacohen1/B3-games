'use strict';
// Class Pointer clipboard: one place for Paste and Copy on every whiteboard.
//  • Reads what was copied (a screenshot, a copied picture, or words) from a Ctrl+V / Cmd+V paste or from the
//    📋 Paste button, and hands it to whichever whiteboard is open right now (a "target").
//  • Shrinks pictures in the browser so each one fits a small, fixed size before it is sent to anyone.
//  • Copies a picture of a board (or one object) so it can be pasted somewhere else.
// The top part is plain logic with no page access, so it can be tested with node.
(function(root){
  const IMAGE_TYPE=/^image\/(png|jpeg|webp|gif|bmp)$/;
  const DATA_IMAGE=/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+=*$/i;
  // imageChars: the longest picture (as a data: URL) one board message may carry. Up to imagesPerBoard per board.
  const LIMITS={imageChars:150000,imageSide:900,imagesPerBoard:6,sourceBytes:15*1024*1024,textChars:2000,itemChars:200,itemLines:8};
  // A saved teacher whiteboard (exportWhiteboard / importWhiteboard in pdf-mode.js).
  const LESSON={pictures:12,pictureChars:700000,strokes:400};
  const round=value=>Math.round(value*1e4)/1e4;
  const clamp=(value,low,high)=>Math.max(low,Math.min(Math.max(low,high),value));
  const isRtl=text=>/[֐-ࣿיִ-﷿ﹰ-ﻼ]/.test(String(text==null?'':text));

  // Tidy pasted words: plain lines only, no hidden control characters, never longer than max.
  function cleanText(raw,max=LIMITS.textChars){
    let text=String(raw==null?'':raw).replace(/\r\n?/g,'\n').replace(/\t/g,'  ').replace(/ /g,' ')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f​﻿]/g,'');
    text=text.split('\n').map(line=>line.replace(/\s+$/,'')).join('\n').replace(/\n{3,}/g,'\n\n').replace(/^\n+|\n+$/g,'');
    const cut=text.length>max;
    if(cut)text=text.slice(0,max).replace(/[\ud800-\udbff]$/,'').replace(/\s+$/,'');
    return{text,cut};
  }
  // Words from copied web content. Nothing in it is ever run or loaded.
  function htmlText(html){
    html=String(html==null?'':html);
    if(typeof DOMParser==='function'){
      try{
        const doc=new DOMParser().parseFromString(html,'text/html');
        doc.querySelectorAll('script,style,noscript,template').forEach(node=>node.remove());
        doc.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));
        doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6').forEach(node=>node.append('\n'));
        return doc.body?doc.body.textContent:'';
      }catch{}
    }
    return html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi,'').replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi,'\n').replace(/<[^>]*>/g,'')
      .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  }
  // Decide what a clipboard holds. A copied picture wins unless real words came with it (Word and Excel add a
  // picture of the words). Web content that only points at a picture, with no picture file, becomes its words.
  function pick(found){
    const image=found&&found.image||null,plain=cleanText(found&&found.text);
    if(image&&(!plain.text||/<img\b/i.test(String(found.html||''))))return{kind:'image',blob:image};
    if(plain.text)return{kind:'text',text:plain.text,cut:plain.cut};
    const words=cleanText(htmlText(found&&found.html));
    return words.text?{kind:'text',text:words.text,cut:words.cut}:null;
  }
  // Break text into lines no wider than maxWidth. width(line) measures one line.
  function wrapLines(text,width,maxWidth,maxChars=LIMITS.itemChars){
    const out=[];
    for(const paragraph of String(text).split('\n')){
      if(!paragraph.trim()){out.push('');continue}
      let line='';
      for(const part of paragraph.split(/(\s+)/)){
        if(!part)continue;
        const next=line+part;
        if(next.length<=maxChars&&width(next.replace(/\s+$/,''))<=maxWidth){line=next;continue}
        if(line.trim())out.push(line.replace(/\s+$/,''));
        line='';
        if(!part.trim())continue;
        // One word wider than the board: break it between letters.
        for(const letter of Array.from(part)){
          if(line&&(line.length+letter.length>maxChars||width(line+letter)>maxWidth)){out.push(line);line=''}
          line+=letter;
        }
      }
      if(line.trim())out.push(line.replace(/\s+$/,''));
    }
    return out;
  }
  // Place words on a board as text boxes (each at most itemLines lines and itemChars letters, the size one board
  // text mark may be). width100(line) is the line's width in pixels at a 100px font. Positions and sizes are
  // fractions of the board (size: of its width). Long text gets smaller letters; what still does not fit is cut.
  function layoutText(text,width100,opts={}){
    const aspect=opts.aspect||16/9,sizes=opts.sizes||[.045,.03,.02],margin=opts.margin==null?.04:opts.margin,space=1-2*margin;
    const center=opts.center||{x:.5,y:.5};
    let size=sizes[0],lines=[];
    for(size of sizes){
      lines=wrapLines(text,line=>width100(line)/100*size,space);
      if(lines.length*size*1.25*aspect<=space)break;
    }
    const lineHeight=size*1.25*aspect,maxLines=Math.max(1,Math.floor(space/lineHeight+1e-9)),cut=lines.length>maxLines;
    if(cut)lines=lines.slice(0,maxLines);
    const widths=lines.map(line=>Math.min(space,width100(line)/100*size)),full=Math.max(0,...widths),total=lines.length*lineHeight;
    const left=clamp(center.x-full/2,margin,1-margin-full),top=clamp(center.y-total/2,margin,1-margin-total),rtl=isRtl(text),items=[];
    for(let i=0;i<lines.length;){
      let joined=lines[i],count=1;
      while(i+count<lines.length&&count<LIMITS.itemLines&&joined.length+1+lines[i+count].length<=LIMITS.itemChars){joined+='\n'+lines[i+count];count++}
      if(joined.trim()){
        const wide=Math.max(0,...widths.slice(i,i+count));
        // Hebrew boxes line up on the right edge.
        items.push({text:joined,size,x:round(clamp(rtl?left+full-wide:left,0,1)),y:round(clamp(top+i*lineHeight,0,1))});
      }
      i+=count;
    }
    return{items,cut,size};
  }
  // Convert pasted words to validated-shape text strokes. `width100` must measure text at a 100px font and
  // include any scale used by the renderer, so the stored hit box follows the visible text.
  function textStrokes(text,width100,opts={}){
    const aspect=opts.aspect||16/9,layout=layoutText(text,width100,opts);
    const strokes=[];
    for(const item of layout.items){
      const lines=item.text.split('\n'),widths=lines.map(line=>Math.min(1,width100(line)/100*item.size)),wide=Math.max(0,...widths),rtl=isRtl(item.text);
      lines.forEach((line,index)=>{
        if(!line.trim())return;
        const width=widths[index],x=rtl?item.x+wide-width:item.x,y=item.y+index*item.size*1.25*aspect,edge=Math.max(.02,width);
        strokes.push({tool:'text',color:opts.color||'#ffcc00',size:item.size,
          points:[{x:clamp(rtl?x+width:x,0,1),y:clamp(y,0,1)},{x:clamp(rtl?x:x+width,0,1),y:clamp(y+Math.max(.02,item.size*1.25*aspect),0,1)}],text:line});
      });
    }
    return{strokes,cut:layout.cut,size:layout.size};
  }
  function fitSize(width,height,maxSide){
    const scale=Math.min(1,maxSide/Math.max(width,height,1));
    return{w:Math.max(1,Math.round(width*scale)),h:Math.max(1,Math.round(height*scale))};
  }
  // Two corners (top-left, bottom-right) for a pasted picture, as fractions of the board: its natural size when
  // that fits, never more than 60% of the board, centered on `center` and kept fully on the board.
  function placeImage(width,height,opts={}){
    const aspect=opts.aspect||16/9,max=opts.max||.6,center=opts.center||{x:.5,y:.5};
    let w=Math.min(max,width/(opts.boardWidth||1600)),h=w*(height/width)*aspect;
    if(h>max){h=max;w=h/aspect*(width/height)}
    w=clamp(w,.03,1);h=clamp(h,.03,1);
    const x=clamp(center.x-w/2,0,1-w),y=clamp(center.y-h/2,0,1-h);
    return[{x:round(x),y:round(y)},{x:round(x+w),y:round(y+h)}];
  }
  function cleanImageData(data,maxChars=LIMITS.imageChars){
    return typeof data==='string'&&data.length<=maxChars&&DATA_IMAGE.test(data)?data:null;
  }
  // A saved teacher whiteboard, checked as strictly as anything from the network. cleanStroke is
  // ClassPointerCore.cleanStroke. Marks that were not the teacher's come back as "saved" marks.
  function cleanLessonBoard(raw,cleanStroke){
    if(!raw||raw.version!==1||raw.kind!=='lesson-whiteboard'||typeof cleanStroke!=='function')return null;
    const pictures=[],strokes=[];
    for(const p of Array.isArray(raw.pictures)?raw.pictures.slice(0,LESSON.pictures):[]){
      if(p&&cleanImageData(p.data,LESSON.pictureChars)&&[p.x,p.y,p.w,p.h].every(Number.isFinite)&&p.w>=.005&&p.w<=4&&p.h>=.005&&p.h<=4&&Math.abs(p.x)<=4&&Math.abs(p.y)<=4)
        pictures.push({data:p.data,x:p.x,y:p.y,w:p.w,h:p.h});
    }
    for(const s of Array.isArray(raw.strokes)?raw.strokes.slice(0,LESSON.strokes):[]){
      const stroke=cleanStroke(s);
      if(stroke)strokes.push({...stroke,owner:s.owner==='teacher'?'teacher':'saved'});
    }
    return{pictures,strokes};
  }
  const api={IMAGE_TYPE,DATA_IMAGE,LIMITS,LESSON,isRtl,cleanText,htmlText,pick,wrapLines,layoutText,textStrokes,fitSize,placeImage,cleanImageData,cleanLessonBoard};
  if(typeof module!=='undefined'&&module.exports){module.exports=api;return}
  if(root.ClassPointerClipboard)return;

  // ---------- In the browser ----------
  const KEY=/Mac|iPhone|iPad/.test(navigator.platform||'')?'Cmd':'Ctrl';
  const MSG={
    empty:'Nothing to paste. Copy a picture or some words first.',
    blocked:'The browser did not let us read what you copied. Click on the whiteboard, then press '+KEY+'+V.',
    tooBig:'That picture is too big. Try a smaller picture.',
    bad:'That picture could not be opened. Copy it again and try once more.',
    textCut:'The words were too long. Only the first part was pasted.',
    copyBlocked:'The browser did not let us copy. Try again in Chrome or Edge.',
    failed:'That did not work. Please try again.'
  };
  function friendly(message){const error=new Error(message);error.friendly=true;return error}

  // What a Ctrl+V paste carries. Must be read right away, while the paste is happening.
  function fromData(transfer){
    if(!transfer)return null;
    let image=null,text='',html='';
    for(const item of Array.from(transfer.items||[]))if(item.kind==='file'&&IMAGE_TYPE.test(item.type)){image=item.getAsFile();if(image)break}
    if(!image)image=Array.from(transfer.files||[]).find(file=>IMAGE_TYPE.test(file.type))||null;
    try{text=transfer.getData('text/plain')||'';html=transfer.getData('text/html')||''}catch{}
    return pick({image,text,html});
  }
  // What the clipboard holds now (for the 📋 Paste button). The browser may ask the person, or refuse.
  async function fromClipboard(){
    const clipboard=navigator.clipboard;
    if(!clipboard||(!clipboard.read&&!clipboard.readText))throw friendly(MSG.blocked);
    let image=null,text='',html='';
    try{
      if(clipboard.read){
        for(const entry of await clipboard.read()){
          const type=entry.types.find(name=>IMAGE_TYPE.test(name));
          if(type&&!image)image=await entry.getType(type);
          if(!text&&entry.types.includes('text/plain'))text=await(await entry.getType('text/plain')).text();
          if(!html&&entry.types.includes('text/html'))html=await(await entry.getType('text/html')).text();
        }
      }else text=await clipboard.readText();
    }catch(error){
      if(error&&(error.name==='DataError'||error.name==='NotFoundError'))return null;
      throw friendly(MSG.blocked);
    }
    return pick({image,text,html});
  }
  // source: a picture file (Blob) or a data: URL.
  function loadImage(source){
    return new Promise((resolve,reject)=>{
      const isUrl=typeof source==='string',url=isUrl?source:URL.createObjectURL(source),image=new Image();
      const done=()=>{if(!isUrl)URL.revokeObjectURL(url)};
      image.onload=()=>{done();if(image.naturalWidth&&image.naturalHeight)resolve(image);else reject(friendly(MSG.bad))};
      image.onerror=()=>{done();reject(friendly(MSG.bad))};
      image.src=url;
    });
  }
  // Shrink a pasted picture until its data: URL is at most maxChars long. A small PNG keeps its see-through
  // parts; everything else becomes a JPEG on white. An animated GIF becomes its first frame.
  async function encodeImage(blob,opts={}){
    const maxChars=opts.maxChars||LIMITS.imageChars;
    if(!blob||blob.size>LIMITS.sourceBytes)throw friendly(MSG.tooBig);
    const image=await loadImage(blob),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const result=data=>({data,width:image.naturalWidth,height:image.naturalHeight});
    try{
      let side=opts.maxSide||LIMITS.imageSide;
      for(let attempt=0;attempt<5;attempt++,side=Math.round(side*.72)){
        const size=fitSize(image.naturalWidth,image.naturalHeight,side);
        canvas.width=size.w;canvas.height=size.h;ctx.imageSmoothingQuality='high';
        if(!attempt&&blob.type!=='image/jpeg'&&blob.type!=='image/bmp'){
          ctx.drawImage(image,0,0,size.w,size.h);
          const png=canvas.toDataURL('image/png');
          if(png.length<=maxChars)return result(png);
        }
        ctx.fillStyle='#fff';ctx.fillRect(0,0,size.w,size.h);ctx.drawImage(image,0,0,size.w,size.h);
        for(const quality of [.82,.66,.5]){
          const jpeg=canvas.toDataURL('image/jpeg',quality);
          if(jpeg.length<=maxChars)return result(jpeg);
        }
      }
    }finally{canvas.width=0}
    throw friendly(MSG.tooBig);
  }
  const canvasBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(friendly(MSG.failed)),'image/png'));
  // Words as a picture (black on white, wrapped; Hebrew runs right to left), for boards that hold pictures only.
  function textImage(text,opts={}){
    const clean=cleanText(text),font=opts.fontPx||30,maxWidth=opts.maxWidth||960,pad=Math.round(font/2),maxLines=opts.maxLines||40;
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),face='600 '+font+'px Arial, "Segoe UI", sans-serif';
    ctx.font=face;
    let lines=wrapLines(clean.text,line=>ctx.measureText(line).width,maxWidth-pad*2,400),cut=clean.cut;
    if(lines.length>maxLines){lines=lines.slice(0,maxLines);cut=true}
    const lineHeight=Math.round(font*1.3),rtl=isRtl(clean.text);
    canvas.width=Math.ceil(Math.max(font*2,...lines.map(line=>ctx.measureText(line).width)))+pad*2;
    canvas.height=Math.max(1,lines.length)*lineHeight+pad*2;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.font=face;ctx.fillStyle=opts.color||'#1f2937';ctx.textBaseline='top';ctx.direction=rtl?'rtl':'ltr';ctx.textAlign=rtl?'right':'left';
    lines.forEach((line,i)=>ctx.fillText(line,rtl?canvas.width-pad:pad,pad+i*lineHeight));
    return canvasBlob(canvas).then(blob=>({blob,cut}));
  }
  // A PNG file of a data: URL picture (the clipboard takes PNG).
  async function pngOf(dataUrl){
    const image=await loadImage(dataUrl),canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
    return canvasBlob(canvas);
  }
  // source: a PNG Blob, or a promise of one (so the copy still counts as part of the person's click or key press).
  async function copyImage(source){
    if(!navigator.clipboard||!navigator.clipboard.write||typeof ClipboardItem!=='function')throw friendly(MSG.copyBlocked);
    try{
      try{await navigator.clipboard.write([new ClipboardItem({'image/png':source})])}
      catch(error){
        if(!(source instanceof Promise)||(error&&error.name==='NotAllowedError'))throw error;
        await navigator.clipboard.write([new ClipboardItem({'image/png':await source})]);
      }
    }catch{throw friendly(MSG.copyBlocked)}
  }
  async function copyText(text){
    try{await navigator.clipboard.writeText(text)}catch{throw friendly(MSG.copyBlocked)}
  }

  // ---------- Targets: the whiteboard that is open now receives the paste ----------
  // target: {priority, active() -> boolean, paste(payload) (may be async), copy?() (async), say(text)}.
  // payload: {kind:'image', blob} or {kind:'text', text, cut}. Only one paste or copy runs at a time, so a key
  // press and a button can never both add the same thing.
  const targets=[];let busy=false;
  function register(target){
    if(target&&!targets.includes(target)){targets.push(target);targets.sort((a,b)=>(b.priority||0)-(a.priority||0))}
    return target;
  }
  function current(){return targets.find(target=>{try{return !!target.active()}catch{return false}})||null}
  // Typing places keep their own paste and copy (text fields, and the drawing toolbar's text box).
  const typing=node=>!!(node&&node.closest&&node.closest('input,textarea,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],dialog[open]'));
  async function run(target,job){
    if(busy)return false;
    busy=true;
    try{await job();return true}
    catch(error){try{target.say?.(error&&error.friendly?error.message:MSG.failed)}catch{}return false}
    finally{busy=false}
  }
  async function deliver(target,payload){
    if(!payload){target.say?.(MSG.empty);return}
    await target.paste(payload);
  }
  const pasteInto=target=>run(target,async()=>deliver(target,await fromClipboard()));
  const copyFrom=target=>run(target,()=>target.copy());
  document.addEventListener('paste',event=>{
    if(typing(event.target))return;
    const target=current();if(!target)return;
    event.preventDefault();event.stopImmediatePropagation();
    const payload=fromData(event.clipboardData);
    void run(target,()=>deliver(target,payload));
  },true);
  document.addEventListener('copy',event=>{
    if(typing(event.target)||String(window.getSelection?.()||''))return;
    const target=current();if(!target||!target.copy)return;
    event.preventDefault();event.stopImmediatePropagation();
    void copyFrom(target);
  },true);

  root.ClassPointerClipboard={...api,KEY,MSG,fromData,fromClipboard,loadImage,encodeImage,textImage,canvasBlob,pngOf,copyImage,copyText,register,current,pasteInto,copyFrom};
  document.dispatchEvent(new Event('class-pointer-clipboard-ready'));
})(typeof window==='undefined'?{}:window);
