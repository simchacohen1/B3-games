'use strict';
// Class Pointer PDF mode.
// The teacher opens a PDF from their own computer. It is sent straight to each student's browser over the
// existing Class Pointer connection (nothing is uploaded or stored anywhere). Everyone draws the PDF themselves,
// so text stays sharp and right-to-left Hebrew pages show exactly as in the file. The teacher's zoom and
// scroll are copied to the students. Pointers and drawings use one shared "document position" (0..1 across
// the whole PDF) so they stay on the words when anyone zooms or scrolls.
(function(){
  const B=window.ClassPointerBridge,P=window.ClassPointerPdfCore,C=window.ClassPointerCore;
  if(!B||!P||!C)return;
  const $=id=>document.getElementById(id),stage=$('stage'),isTeacher=B.isTeacher,ns='http://www.w3.org/2000/svg';
  const pdfjs=window.pdfjsLib;
  const Web=window.ClassPointerWebpageCore;
  let webMode=false,opening=0,docLabel='webpage';
  // How the teacher's current PDF / webpage / tab picture was opened, and what was set aside when the teacher left My screen (suspend / resumeHeld).
  let lastOpen=null,held=null;
  // A whiteboard is shown whole: at 100% all of it fits in the lesson area, with nothing to scroll. A PDF or a
  // webpage fits the width, as before. Students are told which with every view the teacher sends (whole).
  let fitWhole=false,navWatched=false;
  // While a whiteboard is shown whole, the bar of buttons sits below the board (slim), not on top of it: the
  // lesson area is told how much room the bar needs.
  function syncFit(){
    stage.classList.toggle('board-whole',fitWhole);
    stage.style.setProperty('--pdf-nav-h',(fitWhole&&nav&&!nav.hidden?nav.offsetHeight+8:0)+'px');
    if(nav&&!navWatched&&typeof ResizeObserver==='function'){navWatched=true;new ResizeObserver(syncFit).observe(nav)}
  }
  // The shape (height / width) a new whiteboard should have to fill the lesson area: the room that is left in the
  // window under the tabs, less the bar below the board. Kept between a wide strip and a 4:3 page.
  function boardRatio(){
    const area=stage.getBoundingClientRect(),line=$('connectionStatus'),row=document.querySelector?.('.cp-tabs-row');
    // The lesson starts where the message line is now (the line moves up into the tabs row once a lesson is open).
    const top=line&&line.parentNode===stage.parentNode&&line.getBoundingClientRect().height?line.getBoundingClientRect().top:row?row.getBoundingClientRect().bottom+4:area.top;
    const full=stage.classList.contains('lesson-fullscreen')||document.fullscreenElement===stage;
    const height=(full?window.innerHeight:window.innerHeight-top-14)-46,width=area.width-6;
    return width>200&&height>120?Math.max(.36,Math.min(.75,height/width)):9/16;
  }
  function navWord(){return webMode?(docLabel==='whiteboard'?'Whiteboard':'Webpage'):'PDF'}

  let doc=null,docId=null,docName='',bytes=null,lay=null,pageEls=[],rendered=new Map();
  // Page-by-page mode (big files): the teacher sends page pictures; students keep them in pageUrls.
  let paged=false,ratiosList=[],pageUrls=new Map(),pageTransfers=new Map(),pageCache=new Map(),pageJobs=new Map(),renderChain=Promise.resolve();
  // Select (teacher): the picked mark, a drag or resize in progress, an eraser stroke, the last click.
  const PEN_TOOLS=['pen','line','pen-arrow','rectangle','ellipse','triangle','text'];
  // Words on the lesson are drawn 2.4 times their mark size; line spacing has to count that too.
  const TEXT_SCALE=2.4;
  let selectedId=null,edit=null,erasePid=null,inlineEdit=null;
  let layoutOpts={spread:false,rtl:true,shift:false},zoom=1,W=0,H=0,loadToken=0,strokes=[],draft=null,dragId=null,transfer=null,pendingView=null;
  let renderTimer=0,viewTimer=0,lastViewSent=0,frame=0,quietUntil=0;

  function el(tag,id,cls,text){const node=document.createElement(tag);if(id)node.id=id;if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
  function svg(tag,attrs){const node=document.createElementNS(ns,tag);for(const key in attrs)node.setAttribute(key,String(attrs[key]));return node}
  // ---------- Pictures on the whiteboard are marks (tool 'picture'): two corners and the picture itself ----------
  // They sit in the same pile as words and shapes, so the order of the pile is the layer order (Bring to front, Send to back...).
  const pictureImages=new Map();
  // The decoded picture of a picture mark, or null while it is still loading (the board is drawn again when it has loaded).
  function pictureImage(stroke){
    if(!stroke||!stroke.image)return null;
    let entry=pictureImages.get(stroke.ref);
    if(!entry){
      const image=new Image();entry={image,done:null};
      entry.done=new Promise(resolve=>{image.onload=()=>{resolve(true);if(typeof drawInk==='function'){drawInk();pagesSig=''}};image.onerror=()=>resolve(false)});
      image.src=stroke.image;pictureImages.set(stroke.ref,entry);
      while(pictureImages.size>60)pictureImages.delete(pictureImages.keys().next().value);
    }
    return entry.image.complete&&entry.image.naturalWidth?entry.image:null;
  }
  // Wait until every picture in a list of marks is decoded (before a picture of the board is made).
  function whenPictures(list){
    const waits=[];
    for(const stroke of list||[])if(stroke.tool==='picture'&&stroke.image){pictureImage(stroke);const entry=pictureImages.get(stroke.ref);if(entry)waits.push(entry.done)}
    return Promise.all(waits);
  }
  const pictureBox=stroke=>{const [a,b]=stroke.points;return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)}};

  // ---------- Screen ----------
  const scroller=el('div','pdfView',isTeacher?'':'follow');scroller.hidden=true;scroller.setAttribute('aria-label','Lesson PDF');
  const content=el('div','pdfContent');const ink=svg('svg',{id:'pdfInk'});content.appendChild(ink);scroller.appendChild(content);
  stage.insertBefore(scroller,$('highlightLayer'));
  const note=el('div','pdfNote');note.hidden=true;note.setAttribute('role','status');stage.appendChild(note);
  function showNote(text){note.textContent=text||'';note.hidden=!text}
  // ---------- Words on the lesson: one block that is laid out again when it changes ----------
  // A block is one text mark per line (that is what every student page draws). The lines share a block id; a
  // line that only wrapped is marked soft, so a smaller size or a wider box lets the lines join up again.
  const TEXT_MIN=C.TEXT_MIN||.003,TEXT_MAX=C.TEXT_MAX||.08;
  // Letter sizes the teacher picks from, named like sizes in a word processor: the number is the height of the
  // letters in pixels on a board 1280 wide. New words start at 24.
  const TEXT_LABELS=[12,14,16,18,20,24,28,32,40,48,64,80,96,120,144,200],TEXT_REF=1280,TEXT_FLOOR=16,MIN_LABEL=10,MAX_LABEL=200;
  // Pasted words always come in the board's black, whatever color is chosen for drawing.
  const PASTE_INK='#1f2937';
  const sizeOfLabel=label=>Math.round(label/(TEXT_SCALE*TEXT_REF)*1e4)/1e4,labelOfSize=size=>Math.round(size*TEXT_SCALE*TEXT_REF);
  let textSize=sizeOfLabel(24),textSizeBox=null,textSizeValue=null,textBold=false,boldBtn=null,textFont='sans',fontSelect=null,shapeFill=false,textAlign='',alignBtns=[],arrangeBox=null;
  const LAYER_CHOICES=[['front','To front','Bring to front: above everything else'],['forward','Forward','Bring forward: one layer up'],['backward','Backward','Send backward: one layer down'],['back','To back','Send to back: below everything else']];
  // What the size control works on: the words being typed, the picked words, or the next new words (Text tool).
  function textTarget(){
    if(!isTeacher)return null;
    if(inlineEdit)return{kind:'typing',size:inlineEdit.size,bold:inlineEdit.bold===true,font:inlineEdit.font||'sans',align:inlineEdit.align||'',rtl:inlineEdit.rtl===true};
    const picked=selecting()?selectedStroke():null;
    if(picked?.tool==='text')return{kind:'picked',size:picked.size,bold:picked.bold===true,font:picked.font||'sans',align:picked.align||'',rtl:picked.points[0].x>picked.points[1].x};
    return $('teacherTool')?.value==='text'?{kind:'new',size:textSize,bold:textBold,font:textFont,align:textAlign,rtl:false}:null;
  }
  function setTextSize(size){
    const target=textTarget();if(!target)return;
    size=Math.max(TEXT_MIN,Math.min(TEXT_MAX,size));textSize=size;
    if(target.kind==='typing'){inlineEdit.size=size;if(inlineEdit.create)inlineEdit.create.size=size;sizeInline()}
    else if(target.kind==='picked')resizeSelected(size);
    syncTextSize();
  }
  // Bold for the whole text mark (every line of it): the words being typed, the picked words, or the next new words.
  function setTextBold(next){
    const target=textTarget();if(!target)return;
    textBold=next;
    if(target.kind==='typing'){inlineEdit.bold=next;sizeInline()}
    else if(target.kind==='picked')boldSelected(next);
    syncTextSize();
  }
  // Left, Center or Right for a text box (every line of it): the words being typed, the picked words, or the next new words.
  function setTextAlign(next){
    const target=textTarget();if(!target||!C.TEXT_ALIGNS.includes(next))return;
    textAlign=next;
    if(target.kind==='typing'){inlineEdit.align=next;inlineEdit.box.style.textAlign=next}
    else if(target.kind==='picked')alignSelected(next);
    syncTextSize();
  }
  // The picked words laid out again with the lines lined up left, centered or right inside the box.
  function alignSelected(next){
    const stroke=selectedStroke();if(!stroke||stroke.tool!=='text')return false;
    const block=textBlock(stroke);if(block[0].align===next)return true;
    const made=reflow(block,{align:next}),ids=made.strokes.length?B.swapMarks?.(block.map(item=>item.id),made.strokes):null;
    if(ids){selectedId=ids[0];drawInk()}else B.status('That text could not be changed.');
    return true;
  }
  function toggleTextBold(){const target=textTarget();if(target)setTextBold(!target.bold)}
  // The font for the whole text mark, like bold: the words being typed, the picked words, or the next new words.
  function setTextFont(next){
    const target=textTarget();if(!target||!Object.prototype.hasOwnProperty.call(C.FONTS,next))return;
    textFont=next;
    if(target.kind==='typing'){inlineEdit.font=next;sizeInline()}
    else if(target.kind==='picked')fontSelected(next);
    syncTextSize();
  }
  // The picked words laid out again in another font (the letters have other widths): the whole block changes together.
  function fontSelected(next){
    const stroke=selectedStroke();if(!stroke||stroke.tool!=='text')return false;
    const block=textBlock(stroke);if((block[0].font||'sans')===next)return true;
    const made=reflow(block,{font:next}),ids=made.strokes.length?B.swapMarks?.(block.map(item=>item.id),made.strokes):null;
    if(ids){selectedId=ids[0];drawInk()}else B.status('That font could not be used for these words.');
    return true;
  }
  // The picked words laid out again, bold or not. Every line of the block changes together, and the class gets the new lines at once.
  function boldSelected(next){
    const stroke=selectedStroke();if(!stroke||stroke.tool!=='text')return false;
    const block=textBlock(stroke);if((block[0].bold===true)===next)return true;
    const made=reflow(block,{bold:next}),ids=made.strokes.length?B.swapMarks?.(block.map(item=>item.id),made.strokes):null;
    if(ids){selectedId=ids[0];drawInk()}else B.status('That text could not be changed.');
    return true;
  }
  // One step up or down the list of sizes, from whatever size the words have now.
  function stepTextSize(direction){
    const target=textTarget();if(!target)return;
    const now=labelOfSize(target.size),next=direction>0?TEXT_LABELS.find(label=>label>now):[...TEXT_LABELS].reverse().find(label=>label<now);
    if(next)setTextSize(sizeOfLabel(next));
  }
  // The control shows only while there are words to size, with their size.
  function syncTextSize(){
    syncArrange();
    if(!textSizeBox)return;const target=textTarget();
    textSizeBox.hidden=!target;if(target){if(document.activeElement!==textSizeValue)textSizeValue.value=String(labelOfSize(target.size));boldBtn?.setAttribute('aria-pressed',String(target.bold===true));if(fontSelect)fontSelect.value=target.font||'sans';const effective=target.align||(target.rtl?'right':'left');for(const b of alignBtns)b.setAttribute('aria-pressed',String(b.dataset.align===effective))}
  }
  let measurer=null;
  function width100(line){
    if(!measurer){measurer=document.createElement('canvas').getContext('2d');measurer.font='100px sans-serif'}
    return measurer.measureText(line).width*TEXT_SCALE;
  }
  let measurerBold=null;
  function width100Bold(line){
    if(!measurerBold){measurerBold=document.createElement('canvas').getContext('2d');measurerBold.font='bold 100px sans-serif'}
    return measurerBold.measureText(line).width*TEXT_SCALE;
  }
  // Width of a line in a font (and bold or not), measured the way it is drawn, so lines wrap where they will really end.
  const measurers=new Map();
  function widthFor(font,bold){
    const key=(bold?'b':'n')+(font||'sans');
    if(!measurers.has(key)){const ctx=document.createElement('canvas').getContext('2d');ctx.font=(bold?'bold ':'')+'100px '+C.fontStack(font);measurers.set(key,line=>ctx.measureText(line).width*TEXT_SCALE)}
    return measurers.get(key);
  }
  const newBlockId=()=>'b'+Date.now().toString(36)+Math.floor(Math.random()*46656).toString(36);
  // Lay words out. opts: size, color, and center (new words) or left|right + top|bottom (placed words), boxW.
  function flow(text,opts){
    const clip=window.ClassPointerClipboard;if(!clip?.flowText)return{strokes:[],cut:false};
    const made=clip.flowText(text,widthFor(opts&&opts.font,opts&&opts.bold),{aspect:W/Math.max(1,H),scale:TEXT_SCALE,block:newBlockId(),...opts});
    return{...made,strokes:made.strokes.map(value=>C.cleanStroke(value)).filter(Boolean)};
  }
  // Where a block is: its box (fractions of the board), its size, the width the teacher chose (0 = as wide as
  // the words need), and the words as they were written.
  function blockFrame(block){
    const first=block[0],rtl=first.points[0].x>first.points[1].x,xs=block.flatMap(item=>item.points.map(q=>q.x)),boxW=first.boxW||0;
    const farLeft=Math.min(...xs),farRight=Math.max(...xs);
    const left=boxW&&rtl?Math.max(0,farRight-boxW):farLeft,right=boxW&&!rtl?Math.min(1,farLeft+boxW):farRight;
    const top=first.points[0].y,bottom=Math.min(1,block[block.length-1].points[0].y+lineStep(first.size));
    return{left,right,top,bottom,rtl,size:first.size,bold:first.bold===true,font:first.font||'sans',align:first.align||'',boxW,text:window.ClassPointerClipboard?.blockText?.(block)||block.map(item=>item.text).join('\n')};
  }
  // The block laid out again with something changed: size, boxW (0 = no chosen width), text. One corner stays
  // where it is: fixX 'left'|'right' (default: where the lines start), fixY 'top'|'bottom'.
  function reflow(block,patch={}){
    const f=blockFrame(block),size=Math.max(TEXT_MIN,Math.min(TEXT_MAX,patch.size||f.size)),boxW=patch.boxW!==undefined?patch.boxW:f.boxW;
    const fixX=patch.fixX||(f.rtl?'right':'left'),fixY=patch.fixY||'top';
    return flow(patch.text!=null?patch.text:f.text,{size,color:block[0].color,boxW:boxW||undefined,bold:patch.bold!==undefined?patch.bold===true:f.bold,font:patch.font!==undefined?patch.font:f.font,align:patch.align!==undefined?(patch.align||undefined):(f.align||undefined),[fixX]:f[fixX],[fixY]:f[fixY]});
  }
  // ---------- Typing right on the board ----------
  // All typing happens in a plain text box laid on the board; there is no popup.
  //  • words that are already there (target = their text mark): the box sits on the block, same place, color,
  //    size and width, and the block's own lines are not drawn under it;
  //  • new words (target = {point,color,size}): the box is centered on the spot that was clicked.
  // Clicking anywhere else (or Ctrl+Enter) keeps what was typed; Escape drops it.
  function editInline(target){
    finishInline(true);
    const fresh=!target.id,margin=.04;let left,right,top,color,size,value='',rtl=false,block=null,bold=false,font='sans',align='';
    if(fresh){
      const half=Math.max(.1,Math.min(target.point.x-margin,1-margin-target.point.x));
      size=target.size;bold=textBold;font=textFont;align=textAlign;color=target.color;left=Math.max(0,target.point.x-half);right=Math.min(1,target.point.x+half);
      top=Math.max(0,Math.min(1-lineStep(size),target.point.y-lineStep(size)/2));
    }else{
      block=textBlock(target,B.highlights?.()||strokes);const f=blockFrame(block);
      size=f.size;bold=f.bold;font=f.font;align=f.align;color=block[0].color;value=f.text;rtl=f.rtl;top=f.top;
      // A width the teacher chose is kept. Otherwise the box runs from where the lines start to the far edge of
      // the board, so a longer sentence has room; the words are laid out properly when the box closes.
      left=f.boxW?f.left:f.rtl?Math.min(margin,f.left):f.left;right=f.boxW?f.right:f.rtl?f.right:Math.max(1-margin,f.right);
    }
    const box=el('textarea','pdfTextEditInput','board-text-inline'+(fresh?' fresh':''));
    box.dataset.stageUi='true';box.value=value;box.maxLength=2000;box.dir=fresh?'auto':rtl?'rtl':'ltr';box.spellcheck=false;box.rows=1;
    box.setAttribute('aria-label',fresh?'Type the words for the board':'Change the words on the board');
    if(fresh)box.placeholder='Type here';
    Object.assign(box.style,{left:left*100+'%',top:top*100+'%',width:(right-left)*100+'%',color,textAlign:align||''});
    inlineEdit={stroke:fresh?null:{...target,block},create:fresh?{point:target.point,top,color,size}:null,ids:new Set((block||[]).map(item=>item.id)),box,size,sizeBefore:size,bold,boldBefore:bold,font,fontBefore:font,align,alignBefore:align,rtl,before:value};
    content.appendChild(box);sizeInline();drawInk();
    box.focus();box.setSelectionRange(box.value.length,box.value.length);
    // Nothing typed or clicked in the box may reach the lesson (shortcuts, the Delete key, drawing, panning).
    for(const type of ['pointerdown','pointermove','pointerup','click','dblclick','keyup','paste'])box.addEventListener(type,event=>event.stopPropagation());
    box.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();finishInline(false)}
      else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();finishInline(true)}
      // Ctrl+B while typing: the whole text mark becomes bold, or plain again.
      else if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&String(event.key).toLowerCase()==='b'){event.preventDefault();toggleTextBold()}
    });
    box.addEventListener('input',sizeInline);
    // Going to the size or bold control keeps the words open; anywhere else keeps what was typed.
    box.addEventListener('blur',event=>{if(event.relatedTarget&&textSizeBox?.contains(event.relatedTarget))return;finishInline(true)});
    B.status(fresh?'Type the words. Click anywhere else when you are done. Esc cancels.':'Type to change the words. Click anywhere else when you are done. Esc cancels.');
  }
  // The letters in the box are the size they are on the board; the box is as tall as its lines.
  function sizeInline(){
    const open=inlineEdit;if(!open)return;const width=content.getBoundingClientRect().width;if(!width)return;
    open.box.style.fontSize=Math.max(4*width/Math.max(1,W),open.size*TEXT_SCALE*width)+'px';open.box.style.fontWeight=open.bold?'700':'400';open.box.style.fontFamily=C.fontStack(open.font);
    open.box.style.height='auto';open.box.style.height=open.box.scrollHeight+'px';
  }
  function finishInline(save){
    const open=inlineEdit;if(!open)return;inlineEdit=null;
    const text=open.box.value;open.box.remove();
    if(open.create){if(save&&text.trim())addTextStroke({...open.create,bold:open.bold,font:open.font,align:open.align},text)}
    else if(save&&!text.trim())B.status('The words were kept. To remove them, pick them and press Delete.');
    else if(save&&(text!==open.before||open.size!==open.sizeBefore||open.bold!==open.boldBefore||open.font!==open.fontBefore||open.align!==open.alignBefore))replaceTextStroke(open.stroke,text,open.size,open.bold,open.font,open.align);
    drawInk();
  }
  window.addEventListener('resize',sizeInline);
  // New words where the typing box was: centered on the clicked spot, first line where the box's line was.
  function addTextStroke(spot,text){
    const made=flow(text,{size:spot.size,color:spot.color,bold:spot.bold===true,font:spot.font,align:spot.align||undefined,center:spot.point,top:spot.top});
    if(!made.strokes.length){B.status('Enter some text to add it to the whiteboard.');return false}
    made.strokes.forEach(stroke=>B.submitStroke(stroke));
    B.status(made.cut?'The words were too long. Only the first part was added.':'Whiteboard text added.');return true;
  }
  function replaceTextStroke(stroke,text,size,bold,font,align){
    // The new words go where the whole block was, in the same color and width (and size, unless it was changed).
    const block=stroke.block?.length?stroke.block:[stroke],made=reflow(block,{text,size,bold,font,align});
    if(!made.strokes.length){B.status('Enter some text to keep this text box.');return false}
    const ids=B.swapMarks?.(block.map(item=>item.id),made.strokes);
    if(!ids){selectedId=null;B.status('That whiteboard text is no longer available to edit.');return false}
    selectedId=selecting()?ids[0]:null;
    B.status(made.cut?'The words were too long. Only the first part was kept.':'Whiteboard text updated.');return true;
  }

  // ---------- Teacher controls (inside the lesson so they also work in full screen) ----------
  let nav=null,pageInput=null,pageTotal=null,zoomLabel=null,twoBtn=null,flipBtn=null,shiftBtn=null,movePicturesBtn=null;
  let boardSize=null,boardPictures=[],pictureEdits=[],pictureBar=null,boardUpdate=Promise.resolve();
  // Whiteboard pages (slides). wbPages lists the pages of the open whiteboard; the page being shown (wbPages[wbAt]) lives
  // in boardPictures and the lesson marks, and is copied back into the list when the teacher changes page or saves.
  const Pages=window.ClassPointerPages||null;
  let wbPages=null,wbAt=0,wbSwitching=false,pagesBar=null,pagesPanel=null,pagesPanelOpen=false,pagesSig='',pagesTimer=0;
  // A read-only video of the teacher board lets activity pages watch without
  // navigating away or participating in the document editing protocol.
  let boardPresentation=null,boardPresentationTimer=null,boardBackground=null;
  function stopBoardPresentation(){
    if(boardPresentationTimer!==null)clearInterval(boardPresentationTimer);
    boardPresentationTimer=null;
    const old=boardPresentation;boardPresentation=null;boardBackground=null;
    old?.getTracks().forEach(track=>track.stop());
    if(old)document.dispatchEvent(new CustomEvent('class-pointer-document-presentation',{detail:{stream:null}}));
  }
  function paintBoardPresentation(canvas){
    if(!isBoardOpen()||!W||!H)return;
    const width=Math.max(1,Math.round(scroller.clientWidth)),height=Math.max(1,Math.round(scroller.clientHeight));
    const scale=Math.min(1,1920/width,1080/height);
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.scale(scale,scale);ctx.translate(-scroller.scrollLeft,-scroller.scrollTop);
    const left=(lay?.lefts[0]||0)*W,top=(lay?.tops[0]||0)*W,pw=(lay?.widths[0]||1)*W,ph=(lay?.heights[0]||H/W)*W;
    if(boardBackground?.complete&&boardBackground.naturalWidth)ctx.drawImage(boardBackground,left,top,pw,ph);
    for(const picture of boardPictures)ctx.drawImage(picture.image,picture.x*W,picture.y*H,picture.w*W,picture.h*H);
    paintInk(ctx,canvas,draft?[...strokes,{...draft,owner:B.owner()}]:strokes,W,H);
  }
  // Paint marks on a canvas, matching the document ink's coordinate system, widths and opacity.
  // W and H are the size of the whole document in the canvas's current drawing units.
  function paintInk(ctx,canvas,all,W,H){
    // Pictures are separate layers: the marks before a picture are painted, then the picture, then the marks after it.
    let run=[];
    const flush=()=>{if(run.length)paintInkRun(ctx,canvas,run,W,H);run=[]};
    for(const stroke of all){
      if(stroke.tool==='picture'){
        flush();const image=pictureImage(stroke),box=stroke.points?.length===2?pictureBox(stroke):null;
        if(image&&box){ctx.save();ctx.imageSmoothingQuality='high';ctx.drawImage(image,box.x*W,box.y*H,box.w*W,box.h*H);ctx.restore()}
        continue;
      }
      run.push(stroke);
    }
    flush();
  }
  function paintInkRun(ctx,canvas,all,W,H){
    // Same as the live SVG ink: transparency is applied once per owner and tool group,
    // so a person's overlapping highlights stay one flat layer in the video students see.
    const penTools=['pen','line','pen-arrow','rectangle','ellipse','triangle','text'];
    const groups=new Map();
    for(const stroke of all){
      if(!stroke.points?.length)continue;
      const kind=C.isHighlightShape(stroke.tool)?'highlight-shape':penTools.includes(stroke.tool)?'pen':(['pencil','crayon'].includes(stroke.tool)?stroke.tool:'highlight');
      const key=(stroke.owner||'')+'|'+kind;
      if(!groups.has(key))groups.set(key,{kind,list:[]});
      groups.get(key).list.push(stroke);
    }
    const layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;
    const lc=layer.getContext('2d');
    for(const {kind,list} of groups.values()){
      lc.setTransform(1,0,0,1,0,0);lc.clearRect(0,0,layer.width,layer.height);lc.setTransform(ctx.getTransform());
      for(const stroke of list){
        const first=stroke.points[0],last=stroke.points[stroke.points.length-1];
        const shapePen=['pen','line','pen-arrow','rectangle','ellipse','triangle'].includes(stroke.tool);
        lc.strokeStyle=lc.fillStyle=stroke.color;lc.lineWidth=stroke.size*W*(shapePen?0.45:1);lc.lineCap=lc.lineJoin='round';
        if(stroke.tool==='box'){lc.fillRect(Math.min(first.x,last.x)*W,Math.min(first.y,last.y)*H,Math.abs(last.x-first.x)*W,Math.abs(last.y-first.y)*H);continue}
        if(stroke.tool==='text'){
          lc.font=`${stroke.bold?'bold ':''}${Math.max(4,stroke.size*W*2.4)}px ${C.fontStack(stroke.font)}`;lc.textBaseline='top';lc.direction=/[\u0590-\u08ff]/.test(stroke.text||'')?'rtl':'ltr';
          (stroke.text||'').split('\n').forEach((line,index)=>lc.fillText(line,first.x*W,(first.y*H)+index*Math.max(4,stroke.size*W*2.4)*1.25));continue;
        }
        const x1=first.x*W,y1=first.y*H,x2=last.x*W,y2=last.y*H,x=Math.min(x1,x2),y=Math.min(y1,y2),sw=Math.abs(x2-x1),sh=Math.abs(y2-y1);
        const shape=C.shapeTool(stroke.tool),highlightShape=C.isHighlightShape(stroke.tool);
        if(shape==='rectangle'){if(highlightShape){lc.fillRect(x,y,sw,sh);continue}if(stroke.fill)lc.fillRect(x,y,sw,sh);lc.strokeRect(x,y,sw,sh);continue}
        if(shape==='ellipse'){lc.beginPath();lc.ellipse(x+sw/2,y+sh/2,sw/2,sh/2,0,0,Math.PI*2);if(stroke.fill||highlightShape)lc.fill();if(!highlightShape)lc.stroke();continue}
        if(stroke.tool==='triangle'){lc.beginPath();lc.moveTo(x+sw/2,y);lc.lineTo(x+sw,y+sh);lc.lineTo(x,y+sh);lc.closePath();if(stroke.fill)lc.fill();lc.stroke();continue}
        if(stroke.tool==='pen-arrow'){
          lc.beginPath();lc.moveTo(x1,y1);lc.lineTo(x2,y2);lc.stroke();const angle=Math.atan2(y2-y1,x2-x1),radius=Math.max(lc.lineWidth*4,10);
          lc.beginPath();lc.moveTo(x2-radius*Math.cos(angle-.5),y2-radius*Math.sin(angle-.5));lc.lineTo(x2,y2);lc.lineTo(x2-radius*Math.cos(angle+.5),y2-radius*Math.sin(angle+.5));lc.stroke();continue;
        }
        const pts=stroke.tool==='underline'?[first,{x:last.x,y:first.y}]:stroke.points;
        lc.beginPath();pts.forEach((point,index)=>{lc[index?'lineTo':'moveTo'](point.x*W,point.y*H)});lc.stroke();
      }
      ctx.save();ctx.setTransform(1,0,0,1,0,0);
      ctx.globalAlpha=kind==='highlight-shape'?.35:kind==='pen'?1:kind==='pencil'?0.94:kind==='crayon'?0.78:0.32;
      ctx.drawImage(layer,0,0);ctx.restore();
    }
    ctx.globalAlpha=1;
  }
  // The normal Fun Torah Tools student pages watch a teacher-owned lesson video.
  // PDF mode must publish that video too, not only the separate Pointer join-page PDF protocol.
  function paintPdfPresentation(canvas){
    if(!isTeacher||!doc||webMode||scroller.hidden||!lay||!W||!H)return;
    const vw=Math.max(1,Math.round(scroller.clientWidth)),vh=Math.max(1,Math.round(scroller.clientHeight));
    const scale=Math.min(1,1920/vw,1080/vh);
    const cw=Math.max(1,Math.round(vw*scale)),ch=Math.max(1,Math.round(vh*scale));
    if(canvas.width!==cw)canvas.width=cw;
    if(canvas.height!==ch)canvas.height=ch;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,cw,ch);
    ctx.save();ctx.scale(scale,scale);ctx.translate(-scroller.scrollLeft,-scroller.scrollTop);
    for(let i=0;i<pageEls.length;i++){
      const page=pageEls[i],picture=page?.querySelector('canvas,img');
      if(!picture||!(picture.width||picture.naturalWidth))continue;
      const left=lay.lefts[i]*W,top=lay.tops[i]*W,width=lay.widths[i]*W,height=lay.heights[i]*W;
      if(top+height<scroller.scrollTop||top>scroller.scrollTop+vh)continue;
      try{ctx.drawImage(picture,left,top,width,height)}catch{}
    }
    ctx.restore();
  }
  function startPdfPresentation(){
    stopBoardPresentation();
    if(!isTeacher||!doc||webMode)return;
    const canvas=document.createElement('canvas');
    if(typeof canvas.captureStream!=='function')return;
    paintPdfPresentation(canvas);
    try{boardPresentation=canvas.captureStream(8)}catch{return}
    boardPresentationTimer=setInterval(()=>paintPdfPresentation(canvas),125);
    document.dispatchEvent(new CustomEvent('class-pointer-document-presentation',{detail:{stream:boardPresentation}}));
  }
  function startBoardPresentation(dataUrl){
    stopBoardPresentation();
    if(!isTeacher||!isBoardOpen())return;
    const canvas=document.createElement('canvas');if(typeof canvas.captureStream!=='function')return;
    boardBackground=new Image();boardBackground.src=dataUrl;
    paintBoardPresentation(canvas);
    try{boardPresentation=canvas.captureStream(8)}catch{return}
    boardPresentationTimer=setInterval(()=>paintBoardPresentation(canvas),125);
    document.dispatchEvent(new CustomEvent('class-pointer-document-presentation',{detail:{stream:boardPresentation}}));
  }
  if(isTeacher)window.addEventListener('pagehide',stopBoardPresentation);
  if(isTeacher){
    nav=el('div','pdfNav');nav.hidden=true;nav.dataset.stageUi='true';nav.setAttribute('role','toolbar');nav.setAttribute('aria-label','PDF controls');
    const button=(label,title,onClick,cls)=>{const b=el('button',null,cls||'pdf-btn',label);b.type='button';b.title=title;b.addEventListener('click',onClick);nav.appendChild(b);return b};
    // One click saves the open PDF in the teacher's private library (pdf-library.js does the saving).
    const saveBtn=button('💾 Save to my library','Save this PDF in your private library so you can open it again next time',()=>{void window.PointerPdfLibrary?.saveCurrent?.()},'pdf-btn pdf-save-btn');saveBtn.hidden=true;
    document.addEventListener('pointer-pdf-library-state',event=>{
      const state=event.detail||{};
      saveBtn.hidden=!state.open;saveBtn.disabled=!!state.saving||!!state.saved;
      saveBtn.textContent=state.saving?'Saving…':state.saved?'✓ In my library':'💾 Save to my library';
    });
    button('◀ Previous','Previous page',()=>goToPage(currentPage()-1));
    pageInput=el('input',null,'pdf-page-input');pageInput.type='number';pageInput.min='1';pageInput.step='1';pageInput.inputMode='numeric';pageInput.setAttribute('aria-label','Page number');
    pageInput.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){goToPage(Number(pageInput.value)-1);pageInput.blur()}});
    pageTotal=el('span',null,'pdf-page-total',' of 0');
    const jump=el('span',null,'pdf-jump');jump.append(el('span',null,'pdf-label','Page'),pageInput,pageTotal);nav.appendChild(jump);
    button('Go','Jump to this page',()=>goToPage(Number(pageInput.value)-1));
    button('Next ▶','Next page',()=>goToPage(currentPage()+1));
    nav.appendChild(el('span',null,'pdf-sep'));
    button('－','Zoom out',()=>setZoom(P.nextZoom(zoom,-1)),'pdf-btn pdf-zoom');
    zoomLabel=el('span',null,'pdf-zoom-label','100%');nav.appendChild(zoomLabel);
    button('＋','Zoom in',()=>setZoom(P.nextZoom(zoom,1)),'pdf-btn pdf-zoom');
    button('↔ Fit width','Fit the page to the width of the lesson. A whiteboard is shown whole.',()=>setZoom(1,true));
    nav.appendChild(el('span',null,'pdf-sep'));
    twoBtn=button('⧉ Two pages','Show two pages side by side (drawings are cleared when you switch)',()=>changeLayout({spread:!layoutOpts.spread,shift:!layoutOpts.spread}),'pdf-btn pdf-two');
    flipBtn=button('⇄ Flip sides','Swap which side the first page of each pair is on',()=>changeLayout({rtl:!layoutOpts.rtl}),'pdf-btn pdf-spread-only');
    shiftBtn=button('◧ Page 1 alone','Show page 1 by itself and start the pairs at page 2',()=>changeLayout({shift:!layoutOpts.shift}),'pdf-btn pdf-spread-only');
    nav.appendChild(el('span',null,'pdf-sep'));
    // Text size: A− 24 A+. It shows while the Text tool is chosen, words are picked, or words are being typed.
    textSizeBox=el('span',null,'pdf-textsize');textSizeBox.hidden=true;textSizeBox.setAttribute('role','group');textSizeBox.setAttribute('aria-label','Text size');
    // The size is a number box: step with A- and A+, or type any size from 10 to 200.
    textSizeValue=el('input',null,'pdf-textsize-value');textSizeValue.type='number';textSizeValue.min=String(MIN_LABEL);textSizeValue.max=String(MAX_LABEL);textSizeValue.step='1';textSizeValue.inputMode='numeric';textSizeValue.value='24';
    textSizeValue.setAttribute('aria-label','Text size in pixels, 10 to 200');textSizeValue.title='Type any size from 10 to 200';
    const applyTypedSize=()=>{
      const typed=Number(textSizeValue.value);
      if(textSizeValue.value===''||!Number.isFinite(typed)){syncTextSize();return}
      setTextSize(sizeOfLabel(Math.max(MIN_LABEL,Math.min(MAX_LABEL,Math.round(typed)))));
    };
    textSizeValue.addEventListener('change',applyTypedSize);
    textSizeValue.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Enter'){event.preventDefault();applyTypedSize();inlineEdit?.box.focus()}
      else if(event.key==='Escape'){event.preventDefault();syncTextSize();inlineEdit?.box.focus()}
    });
    for(const type of ['keyup','pointerdown','click'])textSizeValue.addEventListener(type,event=>event.stopPropagation());
    const smaller=button('A−','Smaller letters',()=>stepTextSize(-1),'pdf-btn pdf-textsize-btn'),bigger=button('A+','Bigger letters',()=>stepTextSize(1),'pdf-btn pdf-textsize-btn');
    // Pressing these must not take the typing cursor out of the words.
    boldBtn=button('B','Bold (Ctrl+B)',()=>toggleTextBold(),'pdf-btn pdf-textsize-btn pdf-bold-btn');boldBtn.setAttribute('aria-label','Bold');boldBtn.setAttribute('aria-pressed','false');boldBtn.style.fontWeight='900';
    for(const b of [smaller,bigger,boldBtn])for(const type of ['pointerdown','mousedown'])b.addEventListener(type,event=>event.preventDefault());
    // Font (David and Frank Ruehl for Hebrew, and others). Like bold, it applies to the whole text mark.
    fontSelect=el('select',null,'pdf-font-select');fontSelect.setAttribute('aria-label','Font');fontSelect.title='Font for the words';
    for(const [key,[label]] of Object.entries(C.FONTS)){const option=document.createElement('option');option.value=key;option.textContent=label;option.style.fontFamily=C.fontStack(key);fontSelect.append(option)}
    fontSelect.addEventListener('change',()=>{setTextFont(fontSelect.value);inlineEdit?.box.focus()});
    for(const type of ['pointerdown','mousedown','keydown','keyup','click'])fontSelect.addEventListener(type,event=>{if(type==='keydown'||type==='keyup'||type==='click')event.stopPropagation()});
    // Left / Center / Right for the text box.
    for(const [value,label,title] of [['left','Left','Align the words to the left of their box'],['center','Center','Center the words in their box'],['right','Right','Align the words to the right of their box']]){
      const b=el('button',null,'pdf-btn pdf-textsize-btn pdf-align-btn',label);b.type='button';b.title=title;b.dataset.align=value;b.setAttribute('aria-label',title);b.setAttribute('aria-pressed','false');
      b.addEventListener('click',()=>setTextAlign(value));
      for(const type of ['pointerdown','mousedown'])b.addEventListener(type,event=>event.preventDefault());
      alignBtns.push(b);
    }
    textSizeBox.append(el('span',null,'pdf-label','Text size'),smaller,textSizeValue,bigger,boldBtn,fontSelect,...alignBtns);nav.appendChild(textSizeBox);
    // Layers: shows while a picture, shape or words are picked.
    arrangeBox=el('span',null,'pdf-arrange');arrangeBox.hidden=true;arrangeBox.setAttribute('role','group');arrangeBox.setAttribute('aria-label','Layers');
    arrangeBox.append(el('span',null,'pdf-label','Layer'));
    for(const [how,label,title] of LAYER_CHOICES){
      const b=el('button',null,'pdf-btn pdf-textsize-btn pdf-layer-btn',label);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.dataset.layer=how;
      b.addEventListener('click',()=>arrange(how));
      for(const type of ['pointerdown','mousedown'])b.addEventListener(type,event=>event.preventDefault());
      arrangeBox.append(b);
    }
    nav.appendChild(arrangeBox);
    button('⬆ Upload','Put pictures (jpg, png, gif, webp) or a PDF on the whiteboard',()=>openUpload(),'pdf-btn pdf-board-only pdf-upload-btn').hidden=true;
    button('📋 Paste','Put the picture or words you copied on the whiteboard. You can also press Ctrl+V.',()=>{const clip=window.ClassPointerClipboard;if(clip)void clip.pasteInto(clipTarget)},'pdf-btn pdf-board-only').hidden=true;
    button('✏ Edit latest text','Change the words you added last (all of their lines).',()=>editLatestText(),'pdf-btn pdf-board-only').hidden=true;
    button('📄 Copy board','Copy a picture of the whole whiteboard, so you can paste it somewhere else',()=>{const clip=window.ClassPointerClipboard;if(clip)void clip.copyFrom({...clipTarget,copy:()=>clipTarget.copyWhole()})},'pdf-btn pdf-board-only').hidden=true;
    movePicturesBtn=button('🖼 Move pictures','Move, resize or remove pictures pasted on the whiteboard',()=>editBoardPictures(),'pdf-btn pdf-board-pictures');movePicturesBtn.hidden=true;
    button('✕ Close PDF','Close the PDF for everyone',()=>closePdf(),'pdf-btn pdf-close');
    const toggle=button('▾ Hide','Hide these buttons (for example while sharing this tab on Zoom)',()=>{const min=nav.classList.toggle('min');toggle.textContent=min?'▴ '+navWord()+' controls':'▾ Hide'},'pdf-btn pdf-toggle');
    ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick','wheel'].forEach(type=>nav.addEventListener(type,event=>event.stopPropagation()));
    stage.appendChild(nav);
    // Ctrl + mouse wheel (or trackpad pinch) zooms the PDF instead of the whole page.
    scroller.addEventListener('wheel',event=>{
      if(!doc)return;
      if(event.ctrlKey){event.preventDefault();setZoom(P.nextZoom(zoom,event.deltaY<0?1:-1))}
      else if(event.shiftKey){event.preventDefault();const unit=event.deltaMode===1?16:event.deltaMode===2?scroller.clientHeight:1;scroller.scrollTop+=event.deltaY*unit;scroller.scrollLeft+=event.deltaX*unit}
    },{passive:false});
  }

  // ---------- Layout ----------
  function notReady(){return !lay}
  function currentView(){
    if(notReady()||!H)return{zoom,top:0,left:0,...layoutOpts,whole:fitWhole};
    return{zoom,top:P.clamp(scroller.scrollTop/H,0,1),left:W>scroller.clientWidth?P.clamp(scroller.scrollLeft/W,0,1):0,...layoutOpts,whole:fitWhole};
  }
  function relayout(){
    if(notReady())return;
    const cw=Math.max(80,scroller.clientWidth),ch=Math.max(80,scroller.clientHeight);
    // 100% is the full width of the lesson area, or, for a whiteboard, the biggest size at which all of it shows.
    const base=fitWhole&&lay.total>0?Math.min(cw,Math.floor(ch/lay.total)):cw;
    W=base*zoom;H=W*lay.total;
    content.style.width=W+'px';content.style.height=H+'px';
    pageEls.forEach((node,i)=>{node.style.top=(lay.tops[i]*W)+'px';node.style.height=(lay.heights[i]*W)+'px';node.style.left=(lay.lefts[i]*W)+'px';node.style.width=(lay.widths[i]*W)+'px'});
    if(webMode){const iframe=pageEls[0]?.querySelector('iframe');if(iframe)iframe.style.transform='scale('+(W/Web.WIDTH)+')'}
    ink.setAttribute('width',W);ink.setAttribute('height',H);ink.setAttribute('viewBox','0 0 '+W+' '+H);
    drawInk();
  }
  function applyView(view){
    if(notReady())return;
    quietUntil=Date.now()+150;zoom=view.zoom;
    if(!isTeacher&&'whole' in view){fitWhole=view.whole===true;syncFit()}
    if(!isTeacher&&'spread' in view&&(view.spread!==layoutOpts.spread||view.rtl!==layoutOpts.rtl||view.shift!==layoutOpts.shift)){layoutOpts={spread:view.spread,rtl:view.rtl,shift:view.shift};lay=P.layout(ratiosList,layoutOpts)}
    relayout();
    scroller.scrollTop=view.top*H;scroller.scrollLeft=view.left*W;
    // scroll events caused by this move must not be sent back out (quietUntil)
    afterMove();
  }
  function setZoom(next,reset){
    if(notReady())return;next=P.clamp(next,P.MIN_ZOOM,P.MAX_ZOOM);
    const cw=Math.max(80,scroller.clientWidth),ch=scroller.clientHeight;
    const midY=(scroller.scrollTop+ch/2)/H,midX=W>cw?(scroller.scrollLeft+cw/2)/W:0.5;
    const topKeep=scroller.scrollTop/H;
    quietUntil=Date.now()+150;zoom=next;relayout();
    scroller.scrollTop=reset?topKeep*H:midY*H-ch/2;
    scroller.scrollLeft=reset||W<=cw?0:midX*W-cw/2;
    afterMove(true);
  }
  function currentPage(){return notReady()||!H?0:P.pageAt(lay,(scroller.scrollTop+scroller.clientHeight*0.25)/H)}
  function goToPage(index){
    if(notReady())return;
    if(!Number.isFinite(index)){updateControls();return}
    index=P.clamp(Math.round(index),0,lay.count-1);
    scroller.scrollTop=lay.tops[index]*W;afterMove();updateControls();
    if(isTeacher)window.PointerPdfLibrary?.onPageChanged(index+1);
  }
  function updateControls(){
    if(!isTeacher||!nav)return;
    nav.hidden=!doc;if(!doc){syncPagesBar();return}
    nav.setAttribute('aria-label',navWord()+' controls');
    if(nav.classList.contains('min'))nav.querySelector('.pdf-toggle').textContent='▴ '+navWord()+' controls';
    nav.querySelectorAll('.pdf-jump,.pdf-two,.pdf-spread-only').forEach(node=>node.hidden=webMode);
    if(movePicturesBtn)movePicturesBtn.hidden=!(isBoardOpen()&&boardPictures.length&&!pictureEdits.length);
    syncPagesBar();
    nav.querySelectorAll('.pdf-board-only').forEach(node=>node.hidden=!isBoardOpen()||!window.ClassPointerClipboard);
    nav.querySelectorAll('button').forEach(node=>{if(node.title==='Previous page'||node.title==='Next page'||node.title==='Jump to this page')node.hidden=webMode;if(node.classList.contains('pdf-close')){node.textContent='✕ Close '+navWord().toLowerCase().replace('pdf','PDF');node.title='Close the '+navWord().toLowerCase().replace('pdf','PDF')+' for everyone'}});
    pageTotal.textContent=' of '+lay.count;pageInput.max=String(lay.count);
    if(document.activeElement!==pageInput)pageInput.value=String(currentPage()+1);
    zoomLabel.textContent=Math.round(zoom*100)+'%';
    twoBtn.textContent=layoutOpts.spread?'⧉ Two pages: on':'⧉ Two pages';twoBtn.classList.toggle('on',layoutOpts.spread);
    flipBtn.hidden=shiftBtn.hidden=webMode||!layoutOpts.spread;
    flipBtn.textContent=layoutOpts.rtl?'⇄ Page 1 on right':'⇄ Page 1 on left';
    shiftBtn.textContent=layoutOpts.shift?'◧ Page 1 alone: on':'◧ Page 1 alone';shiftBtn.classList.toggle('on',layoutOpts.shift);
  }
  // Teacher: switch between one page and two pages. Old drawings sit on the old layout, so they are cleared.
  function changeLayout(patch){
    if(!isTeacher||notReady())return;
    const anchor=currentPage();
    layoutOpts={...layoutOpts,...patch};if(!layoutOpts.spread)layoutOpts.shift=false; // turning Two pages on starts with page 1 alone, like the printed book
    lay=P.layout(ratiosList,layoutOpts);
    quietUntil=Date.now()+150;relayout();
    scroller.scrollTop=lay.tops[anchor]*W;scroller.scrollLeft=0;
    B.resetMarks();afterMove(true);
    window.PointerPdfLibrary?.onLayoutChanged?.();
  }
  let lastRememberedPage=0;
  function afterMove(forceSend){
    scheduleRender();updateControls();B.redraw();
    if(isTeacher)B.refreshActivityMarks?.();
    if(isTeacher&&!webMode&&!notReady()){const page=currentPage()+1;if(page!==lastRememberedPage){lastRememberedPage=page;window.PointerPdfLibrary?.onPageChanged(page)}}
    if(isTeacher&&(forceSend||Date.now()>quietUntil))scheduleViewSend(forceSend);
  }
  scroller.addEventListener('scroll',()=>{if(Date.now()<quietUntil)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>afterMove())});
  new ResizeObserver(()=>{
    if(notReady())return;
    // keep the same place in the PDF when the lesson area changes size
    const keep=isTeacher?currentView():pendingView||currentView();
    applyView({zoom,top:keep.top,left:keep.left});
  }).observe(scroller);

  // ---------- Drawing the pages ----------
  function scheduleRender(){clearTimeout(renderTimer);renderTimer=setTimeout(renderVisible,90)}
  function renderVisible(){
    if(notReady()||!doc||webMode)return;
    const top=scroller.scrollTop,height=scroller.clientHeight,dpr=window.devicePixelRatio||1;
    for(let i=0;i<lay.count;i++){
      const y0=lay.tops[i]*W,y1=y0+lay.heights[i]*W;
      if(y1>top-height*0.6&&y0<top+height*1.6)renderPage(i,dpr);
      else if(y1<top-height*3||y0>top+height*4){const old=rendered.get(i);if(old){old.task?.cancel();rendered.delete(i);pageEls[i].replaceChildren()}}
    }
  }
  function renderPage(i,dpr){
    const pageW=W*lay.widths[i],key=Math.round(pageW)+'@'+dpr,old=rendered.get(i);if(old&&old.key===key)return;
    old?.task?.cancel();const token=loadToken,entry={key,task:null};rendered.set(i,entry);
    doc.getPage(i+1).then(page=>{
      if(token!==loadToken||rendered.get(i)!==entry)return;
      const base=page.getViewport({scale:1});let scale=(pageW*Math.min(dpr,2))/base.width;
      const pixels=base.width*scale*base.height*scale;if(pixels>14e6)scale*=Math.sqrt(14e6/pixels);
      const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      entry.task=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport});
      entry.task.promise.then(()=>{if(token===loadToken&&rendered.get(i)===entry)pageEls[i].replaceChildren(canvas)}).catch(()=>{});
    }).catch(()=>{});
  }

  // ---------- Marks ----------
  function inkPath(stroke,color){
    const first=stroke.points[0],last=stroke.points[stroke.points.length-1];
    if(stroke.tool==='box')return svg('rect',{x:Math.min(first.x,last.x)*W,y:Math.min(first.y,last.y)*H,width:Math.abs(last.x-first.x)*W,height:Math.abs(last.y-first.y)*H,fill:color});
    if(stroke.tool==='text'){
      const text=svg('text',{x:first.x*W,y:first.y*H,'font-family':C.fontStack(stroke.font),'font-size':Math.max(4,stroke.size*W*2.4),...(stroke.bold?{'font-weight':'700'}:{}),fill:color,'dominant-baseline':'hanging',direction:/[\u0590-\u08ff]/.test(stroke.text||'')?'rtl':'ltr','pointer-events':'visiblePainted','data-text-mark':'true'});
      (stroke.text||'').split('\n').forEach((line,index)=>{const span=svg('tspan',{x:first.x*W,dy:index?'1.25em':'0'});span.textContent=line;text.appendChild(span)});
      return text;
    }
    const x1=first.x*W,y1=first.y*H,x2=last.x*W,y2=last.y*H,x=Math.min(x1,x2),y=Math.min(y1,y2),sw=Math.abs(x2-x1),sh=Math.abs(y2-y1);
    const lineWidth=stroke.size*W*(['pen','line','pen-arrow','rectangle','ellipse','triangle'].includes(stroke.tool)?0.45:1);
    const lineAttrs={fill:stroke.fill===true&&C.FILLABLE.includes(stroke.tool)?color:'none',stroke:color,'stroke-width':lineWidth,'stroke-linecap':'round','stroke-linejoin':'round'};
    if(stroke.tool==='line')return svg('line',{x1,y1,x2,y2,...lineAttrs});
    if(C.isHighlightShape(stroke.tool))Object.assign(lineAttrs,{fill:color,stroke:'none'});
    const shape=C.shapeTool(stroke.tool);
    if(shape==='rectangle')return svg('rect',{x,y,width:sw,height:sh,...lineAttrs});
    if(shape==='ellipse')return svg('ellipse',{cx:x+sw/2,cy:y+sh/2,rx:sw/2,ry:sh/2,...lineAttrs});
    if(stroke.tool==='triangle')return svg('polygon',{points:`${x+sw/2},${y} ${x+sw},${y+sh} ${x},${y+sh}`,...lineAttrs});
    if(stroke.tool==='pen-arrow'){
      const group=svg('g'),angle=Math.atan2(y2-y1,x2-x1),radius=Math.max(lineWidth*4,10);
      group.appendChild(svg('line',{x1,y1,x2,y2,...lineAttrs}));
      group.appendChild(svg('path',{d:`M${x2-radius*Math.cos(angle-.5)} ${y2-radius*Math.sin(angle-.5)} L${x2} ${y2} L${x2-radius*Math.cos(angle+.5)} ${y2-radius*Math.sin(angle+.5)}`,...lineAttrs}));
      return group;
    }
    const pts=stroke.tool==='underline'?[first,{x:last.x,y:first.y}]:stroke.points;
    return svg('path',{d:pts.map((p,i)=>(i?'L':'M')+(p.x*W).toFixed(1)+' '+(p.y*H).toFixed(1)).join(' '),...lineAttrs});
  }
  function drawInk(){
    ink.replaceChildren();if(notReady())return;
    // A mark that is being dragged or resized is shown where it will land.
    let shown=inlineEdit?strokes.filter(stroke=>!inlineEdit.ids.has(stroke.id)):strokes;
    if(edit?.moved&&edit.swap){const gone=new Set(edit.swap.ids);shown=strokes.filter(stroke=>!gone.has(stroke.id)).concat(edit.swap.strokes.map((stroke,index)=>({...stroke,owner:'teacher',id:'preview'+index})))}
    else if(edit?.moved)shown=strokes.map(stroke=>edit.preview.has(stroke.id)?{...stroke,points:edit.preview.get(stroke.id)}:stroke);
    const all=draft?[...shown,{...draft,owner:B.owner()}]:shown;let groups=new Map();
    for(const stroke of all){
      // A picture is a layer of its own: marks after it are drawn in new groups, on top of it.
      if(stroke.tool==='picture'){
        if(stroke.points?.length!==2)continue;
        const box=pictureBox(stroke),node=pictureImage(stroke)?svg('image',{x:box.x*W,y:box.y*H,width:box.w*W,height:box.h*H,href:stroke.image,preserveAspectRatio:'none'}):svg('rect',{x:box.x*W,y:box.y*H,width:box.w*W,height:box.h*H,fill:'#e5e7eb',stroke:'#9ca3af','stroke-dasharray':'8 6'});
        node.dataset.strokeTool='picture';if(stroke.id)node.dataset.strokeId=stroke.id;node.dataset.owner=stroke.owner||'';ink.appendChild(node);groups=new Map();continue;
      }
      const kind=C.isHighlightShape(stroke.tool)?'highlight-shape':PEN_TOOLS.includes(stroke.tool)?'pen':(['pencil','crayon'].includes(stroke.tool)?stroke.tool:'highlight'),key=stroke.owner+'|'+kind;
      let group=groups.get(key);
      if(!group){group=svg('g',{'data-owner':stroke.owner,'data-tool':kind,opacity:kind==='highlight-shape'?'0.35':kind==='pen'?'1':kind==='pencil'?'0.94':kind==='crayon'?'0.78':'0.32'});groups.set(key,group);ink.appendChild(group)}
      const mark=inkPath(stroke,stroke.color);mark.dataset.strokeTool=stroke.tool;if(stroke.id)mark.dataset.strokeId=stroke.id;group.appendChild(mark);
    }
    drawSelection(shown);syncTextSize();
  }
  function setStrokes(next){strokes=Array.isArray(next)?next:[];drawInk()}

  // ---------- Select (teacher): pick one of my marks, then move, resize, recolor or delete it ----------
  const geometry=()=>window.FTTAnnotate?.geometry||null;
  const selecting=()=>$(isTeacher?'teacherTool':'studentTool')?.value==='select'&&B.writingAllowed('select');
  function selectedStroke(){
    const stroke=selectedId?strokes.find(item=>item.id===selectedId):null;
    if(!stroke||(!isTeacher&&(stroke.owner!==B.owner()||!C.isHighlightShape(stroke.tool)))){selectedId=null;return null}return stroke;
  }
  // The dashed box and the handles around the picked mark. Drawn in the ink layer, never sent to the class.
  function drawSelection(list){
    if(!selecting()||inlineEdit)return;const picked=selectedStroke(),G=geometry();if(!picked||!G)return;
    const width=content.getBoundingClientRect().width;if(!width)return;
    const unit=W/width,pad=6*unit,group=svg('g',{'data-selection':'true','pointer-events':'none'}); // unit: one screen pixel in the ink layer's own units
    const frameRect=(x1,y1,x2,y2)=>group.appendChild(svg('rect',{x:x1-pad,y:y1-pad,width:x2-x1+pad*2,height:y2-y1+pad*2,fill:'none',stroke:'#2563eb','stroke-width':1.5*unit,'stroke-dasharray':(6*unit)+' '+(4*unit)}));
    const knob=(id,x,y)=>group.appendChild(svg('rect',{'data-handle':id,x:x-5*unit,y:y-5*unit,width:10*unit,height:10*unit,fill:'#fff',stroke:'#2563eb','stroke-width':1.5*unit}));
    if(picked.tool==='text'){
      // Words: a box around the whole block. Corners make the letters bigger or smaller; the sides choose
      // how wide the box is, and so where the lines wrap.
      const preview=edit?.moved&&edit.swap?list.filter(item=>String(item.id).startsWith('preview')):null;
      const block=preview?.length?preview:textBlock(list.find(item=>item.id===picked.id)||picked,list),f=blockFrame(block);
      frameRect(f.left*W,f.top*H,f.right*W,f.bottom*H);
      for(const handle of textHandles(f))knob(handle.id,handle.x*W,handle.y*H);
    }else{
      const stroke=list.find(item=>item.id===picked.id)||picked,xs=stroke.points.map(q=>q.x*W),ys=stroke.points.map(q=>q.y*H);
      frameRect(Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys));
      for(const handle of G.handlesOf(stroke))knob(handle.id,handle.x*W,handle.y*H);
    }
    ink.appendChild(group);
  }
  // Handles of a block of words: four corners and the middle of each side.
  function textHandles(f){
    const mid=(f.top+f.bottom)/2;
    return [{id:'nw',x:f.left,y:f.top},{id:'ne',x:f.right,y:f.top},{id:'sw',x:f.left,y:f.bottom},{id:'se',x:f.right,y:f.bottom},{id:'w',x:f.left,y:mid},{id:'e',x:f.right,y:mid}];
  }
  // Pasted or typed words are one mark per line. The lines that belong together: my text marks next to each
  // other in the pile, same color and size, each one line-height below the one before.
  const lineStep=size=>size*1.25*TEXT_SCALE*W/Math.max(1,H);
  function textBlock(stroke,list=strokes){
    if(stroke.tool!=='text')return [stroke];
    if(stroke.block){const same=list.filter(item=>item.tool==='text'&&item.owner===stroke.owner&&item.block===stroke.block);if(same.length)return same}
    const at=list.findIndex(item=>item.id===stroke.id);if(at<0)return [stroke];
    const follows=(upper,lower)=>!!upper&&!!lower&&upper.tool==='text'&&lower.tool==='text'&&upper.owner===lower.owner&&upper.color===lower.color&&upper.size===lower.size&&Math.abs(lower.points[0].y-upper.points[0].y-lineStep(upper.size))<.004;
    let first=at,last=at;
    while(follows(list[first-1],list[first]))first--;
    while(follows(list[last],list[last+1]))last++;
    return list.slice(first,last+1);
  }
  // Send changed marks to the class in one go. changes: [[id,stroke],...]
  function changeMarks(changes){return changes.length===1?!!B.replaceMark?.(changes[0][0],changes[0][1]):!!B.replaceMarks?.(changes)}
  // Is point p on the line through pts (0..1 points)? t is the reach, as a share of the width.
  function nearLine(p,pts,t){
    const ty=t*W/Math.max(1,H);
    for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[i+1]||a;const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;let k=len?((p.x-a.x)*dx+(p.y-a.y)*dy)/len:0;k=Math.max(0,Math.min(1,k));
      const ex=(a.x+k*dx-p.x)/t,ey=(a.y+k*dy-p.y)/ty;if(ex*ex+ey*ey<=1)return true}
    return false;
  }
  // Is p on this mark? inside: anywhere inside a closed shape counts (Select); otherwise only its outline (Eraser).
  function markHits(stroke,p,inside){
    if(!stroke.points?.length)return false;
    // A picture is picked anywhere inside it (Select); the eraser never reaches it.
    if(stroke.tool==='picture'){if(!inside||stroke.points.length!==2)return false;const b=pictureBox(stroke);return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h}
    const shape=C.shapeTool(stroke.tool);
    if(!['rectangle','ellipse','triangle','box'].includes(shape))return inkHits(stroke,p);
    const first=stroke.points[0],last=stroke.points[stroke.points.length-1],t=Math.max(0.008,(stroke.size||0.016)*0.6),ty=t*W/Math.max(1,H);
    const x1=Math.min(first.x,last.x),x2=Math.max(first.x,last.x),y1=Math.min(first.y,last.y),y2=Math.max(first.y,last.y);
    if(p.x<x1-t||p.x>x2+t||p.y<y1-ty||p.y>y2+ty)return false;
    if(inside||stroke.tool==='box'||C.isHighlightShape(stroke.tool))return true;
    if(stroke.tool==='rectangle')return nearLine(p,[{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2},{x:x1,y:y1}],t);
    if(stroke.tool==='triangle')return nearLine(p,[{x:(x1+x2)/2,y:y1},{x:x2,y:y2},{x:x1,y:y2},{x:(x1+x2)/2,y:y1}],t);
    const rx=Math.max(t,(x2-x1)/2),ry=Math.max(ty,(y2-y1)/2),d=Math.hypot((p.x-(x1+x2)/2)/rx,(p.y-(y1+y2)/2)/ry);
    return Math.abs(d-1)<=Math.max(t/rx,ty/ry);
  }
  // The mark under the pointer: words first (by their real size on screen), then the newest mark. Select picks anyone's mark
  // (anyOwner); the eraser and the Text tool only reach the teacher's own.
  function teacherMarkAt(event,p,inside,anyOwner){
    const textNode=[...ink.querySelectorAll('[data-text-mark]')].reverse().find(node=>{const rect=node.getBoundingClientRect();return event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom});
    const text=textNode&&strokes.find(item=>item.id===textNode.dataset.strokeId&&(anyOwner||item.owner==='teacher'));
    if(text)return text;
    return p?[...strokes].reverse().find(item=>(anyOwner||item.owner==='teacher')&&markHits(item,p,inside))||null:null;
  }
  // Like normalized(), but a pointer dragged off the edge counts as the edge.
  function clampedPoint(event){
    if(notReady())return null;const r=content.getBoundingClientRect();if(!r.width||!r.height)return null;
    return{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height)),px:event.clientX-r.left,py:event.clientY-r.top,w:r.width,h:r.height};
  }
  // Is the pointer on something the arrow can grab: a handle of the picked mark, or one of my marks?
  function grabAt(event){
    if(!selecting()||notReady())return false;
    const G=geometry(),picked=selectedStroke(),at=clampedPoint(event);
    if(picked&&at){
      if(picked.tool==='text'){if(textHandles(blockFrame(textBlock(picked))).some(item=>Math.hypot(item.x*at.w-at.px,item.y*at.h-at.py)<=12))return true}
      else if(G?.handleAt(picked,at.px,at.py,at.w,at.h,12))return true;
    }
    const point=normalized(event);
    return !!teacherMarkAt(event,point,true,true)||!!pictureAt(point);
  }
  // The pasted picture under a point of the whiteboard (the one on top), or null. Marks lie over pictures, so a
  // mark at the same spot is picked first.
  function pictureAt(point){
    if(!point||!isBoardOpen())return null;
    return [...boardPictures].reverse().find(q=>point.x>=q.x&&point.x<=q.x+q.w&&point.y>=q.y&&point.y<=q.y+q.h)||null;
  }
  // The arrow on a pasted picture: the picture is lifted off the board into its movable frame (corners resize,
  // Delete or ✕ removes) and the drag that picked it carries on moving it. It goes back on the board for everyone
  // when the drag ends, or with the next click anywhere else.
  function pickPicture(picture,event){
    boardPictures=boardPictures.filter(other=>other!==picture);
    const item=startPictureEdit(picture.image,{x:picture.x,y:picture.y,w:picture.w,h:picture.h,after:picture.after});
    publishBoard();item.grab(event);
    B.status('Drag the picture to move it, drag a corner to resize it, press Delete to remove it.');
  }
  // Starts picking, dragging or resizing. False when nothing was under the pointer (then the click is the mouse's).
  function startSelect(event,p){
    const G=geometry(),picked=selectedStroke(),at=clampedPoint(event);
    if(picked?.tool==='text'&&at){
      const group=textBlock(picked),frame=blockFrame(group),grip=textHandles(frame).find(item=>Math.hypot(item.x*at.w-at.px,item.y*at.h-at.py)<=12);
      if(grip){edit={kind:'text',handle:grip.id,stroke:picked,group,frame,preview:new Map(),swap:null,start:at,moved:false,pid:event.pointerId};content.setPointerCapture(edit.pid);return true}
    }
    const handle=G&&picked&&at?G.handleAt(picked,at.px,at.py,at.w,at.h,12):null;
    if(handle){edit={kind:'resize',handle:handle.id,stroke:picked,group:[picked],preview:new Map(),start:at,moved:false,pid:event.pointerId};content.setPointerCapture(edit.pid);return true}
    const hit=isTeacher?teacherMarkAt(event,p,true,true):[...strokes].reverse().find(mark=>mark.owner===B.owner()&&C.isHighlightShape(mark.tool)&&markHits(mark,p,true));
    // Words that were already picked: a click that does not drag opens them for typing (see endSelect).
    const again=!!hit&&hit.tool==='text'&&!!picked&&textBlock(picked).some(item=>item.id===hit.id);
    selectedId=hit?hit.id:null;
    // Words move as a whole block, every line together.
    if(hit&&G&&at){edit={kind:'move',stroke:hit,group:textBlock(hit),preview:new Map(),start:at,moved:false,again,pid:event.pointerId};content.setPointerCapture(edit.pid)}
    drawInk();return !!hit;
  }
  // A picture keeps its shape while a corner is dragged: the opposite corner stays, the picture grows or shrinks, and none of it leaves the board.
  function resizePicture(stroke,handle,x,y){
    const b=pictureBox(stroke),west=handle[1]==='w',north=handle[0]==='n',ax=west?b.x+b.w:b.x,ay=north?b.y+b.h:b.y;
    const aspect=(b.w*W)/Math.max(1e-6,b.h*H);
    let w=Math.abs(x-ax),h=Math.abs(y-ay)*1;
    const fromY=(h*H*aspect)/W;if(fromY>w)w=fromY;
    w=Math.max(.02,w);h=(w*W/aspect)/H;
    const k=Math.min(1,(west?ax:1-ax)/w,(north?ay:1-ay)/h);w*=k;h*=k;
    const nx=west?ax-w:ax,ny=north?ay-h:ay;
    return[{x:nx,y:ny},{x:nx+w,y:ny+h}];
  }
  function moveSelect(event){
    const G=geometry(),at=clampedPoint(event);if(!G||!at)return;
    if(!edit.moved&&Math.hypot(at.px-edit.start.px,at.py-edit.start.py)<3)return;
    edit.moved=true;
    if(edit.kind==='text'){
      const f=edit.frame,h=edit.handle;let made;
      if(h==='e'||h==='w'){
        // A side: the box gets wider or narrower and the lines wrap to it. The other side stays put.
        made=reflow(edit.group,{boxW:Math.max(.08,h==='e'?at.x-f.left:f.right-at.x),fixX:h==='e'?'left':'right'});
      }else{
        // A corner: bigger or smaller letters. The opposite corner stays put. A chosen width grows with them.
        const ax=h[1]==='w'?f.right:f.left,ay=h[0]==='n'?f.bottom:f.top;
        const k=Math.max(Math.abs(at.x-ax)/Math.max(f.right-f.left,1e-6),Math.abs(at.y-ay)/Math.max(f.bottom-f.top,1e-6));
        const size=Math.max(TEXT_MIN,Math.min(TEXT_MAX,f.size*k));
        made=reflow(edit.group,{size,boxW:f.boxW?Math.min(1,f.boxW*size/f.size):0,fixX:h[1]==='w'?'right':'left',fixY:h[0]==='n'?'bottom':'top'});
      }
      if(made.strokes.length)edit.swap={ids:edit.group.map(item=>item.id),strokes:made.strokes};
      drawInk();return;
    }
    if(edit.kind==='resize')edit.preview=new Map([[edit.stroke.id,edit.stroke.tool==='picture'?resizePicture(edit.stroke,edit.handle,at.x,at.y):G.resizePoints(edit.stroke,edit.handle,at.x,at.y)]]);
    else{
      // One shift for the whole group, held back so that no part of it leaves the board.
      const all={points:edit.group.flatMap(item=>item.points)},moved=G.movePoints(all,at.x-edit.start.x,at.y-edit.start.y);
      const dx=moved[0].x-all.points[0].x,dy=moved[0].y-all.points[0].y;
      edit.preview=new Map(edit.group.map(item=>[item.id,item.points.map(q=>({x:q.x+dx,y:q.y+dy}))]));
    }
    drawInk();
  }
  function endSelect(commit){
    const done=edit;edit=null;if(!done)return;
    if(content.hasPointerCapture?.(done.pid))content.releasePointerCapture(done.pid);
    if(done.kind==='text'){
      if(commit&&done.moved&&done.swap){const ids=B.swapMarks?.(done.swap.ids,done.swap.strokes);if(ids)selectedId=ids[0];else B.status('Those words could not be changed.')}
      drawInk();return;
    }
    // A second click on picked words, without dragging: type right in them.
    if(commit&&!done.moved&&done.again){editInline(done.stroke);return}
    if(commit&&done.moved&&!changeMarks(done.group.filter(item=>done.preview.has(item.id)).map(item=>[item.id,{...item,points:done.preview.get(item.id)}])))B.status('That mark could not be changed.');
    drawInk();
  }
  // Words go as a whole block, every line together.
  function eraseBlock(stroke){const ids=textBlock(stroke).map(item=>item.id);return ids.length>1?B.eraseMarks?.(ids):B.eraseMark?.(ids[0])}
  function eraseUnder(event){const p=normalized(event),hit=p&&teacherMarkAt(event,p,false);if(hit)eraseBlock(hit)}
  // A color click on the toolbar while Select is chosen: recolor the picked mark. True = handled.
  function recolorSelected(color){
    if(!selecting()||typeof color!=='string')return false;const stroke=selectedStroke();if(!stroke)return false;
    // Every line of a block of words gets the color.
    if(stroke.color!==color.toLowerCase()&&!changeMarks(textBlock(stroke).map(item=>[item.id,{...item,color:color.toLowerCase()}])))B.status('That color cannot be used for this mark.');
    return true;
  }
  // New shapes are drawn filled when the filled kind of shape is chosen on the toolbar; a picked shape can be switched between
  // outline and filled (filled with its own color).
  function setFill(on){shapeFill=!!on}
  function fillSelected(on){
    if(!selecting())return false;const stroke=selectedStroke();
    if(!stroke||!C.FILLABLE.includes(stroke.tool))return false;
    if((stroke.fill===true)!==!!on&&!changeMarks([[stroke.id,{...stroke,fill:!!on}]]))B.status('That shape could not be changed.');
    return true;
  }
  // The picked shape, or null: {tool:'rectangle'|'ellipse'|'triangle', filled:boolean}.
  const pickedShape=()=>{const stroke=selecting()?selectedStroke():null;return !!stroke&&C.FILLABLE.includes(stroke.tool)?{tool:stroke.tool,filled:stroke.fill===true}:null};
  // A size click on the toolbar while Select is chosen: a thicker or thinner line, or bigger or smaller words.
  // True = handled. Words keep their top line and their starting edge; the lines are spaced again for the new size.
  function resizeSelected(size){
    if(!selecting()||!Number.isFinite(size))return false;const stroke=selectedStroke();if(!stroke)return false;
    if(stroke.size===size)return true;
    if(stroke.tool==='text'){
      const block=textBlock(stroke),made=reflow(block,{size}),ids=made.strokes.length?B.swapMarks?.(block.map(item=>item.id),made.strokes):null;
      // The new lines are picked again, with their box and handles.
      if(ids){selectedId=ids[0];drawInk()}else B.status('That size cannot be used for these words.');
      return true;
    }
    if(!changeMarks([[stroke.id,{...stroke,size}]]))B.status('That size cannot be used for this mark.');
    return true;
  }
  // Arrow keys with a picked mark or picture: one step of `px` screen pixels, as a fraction of the board.
  const NUDGE={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  let pictureNudgeTimer=0;
  function nudgeFractions(direction,px){
    const r=content.getBoundingClientRect();
    return r.width&&r.height?{x:direction[0]*px/r.width,y:direction[1]*px/r.height}:null;
  }
  // Moves the picked mark (every line of picked words together), held back so none of it leaves the board.
  // Sent to the class straight away, like any other change.
  function nudgeSelected(direction,px){
    const picked=selectedStroke(),G=geometry(),step=nudgeFractions(direction,px);if(!picked||!G||!step)return false;
    const group=textBlock(picked),all={points:group.flatMap(item=>item.points)},moved=G.movePoints(all,step.x,step.y);
    const dx=moved[0].x-all.points[0].x,dy=moved[0].y-all.points[0].y;
    if(!dx&&!dy)return true;
    return changeMarks(group.map(item=>[item.id,{...item,points:item.points.map(q=>({x:q.x+dx,y:q.y+dy}))}]));
  }
  if(isTeacher||$('studentTool')){
    $(isTeacher?'teacherTool':'studentTool')?.addEventListener('change',()=>{erasePid=null;finishInline(true);if(!selecting())selectedId=null;endSelect(false);syncTextSize()});
    // Delete removes the picked mark; Escape lets go of it. The arrow keys move it 1 pixel (Shift: 10 pixels) and
    // the class sees each step. Nothing happens while typing in a box, and the page does not scroll while a mark is picked.
    document.addEventListener('keydown',event=>{
      if(!selecting()||!selectedId||event.target?.closest?.('input,textarea,select,dialog,[contenteditable="true"]'))return;
      if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();const picked=selectedStroke();selectedId=null;endSelect(false);if(picked)eraseBlock(picked)}
      else if(event.key==='Escape'){selectedId=null;endSelect(false)}
      else if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&String(event.key).toLowerCase()==='b'&&selectedStroke()?.tool==='text'){event.preventDefault();event.stopPropagation();toggleTextBold()}
      else if(NUDGE[event.key]&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&selectedStroke()){event.preventDefault();event.stopPropagation();if(!edit&&!inlineEdit)nudgeSelected(NUDGE[event.key],event.shiftKey?10:1)}
    },true);
  }
  if(isTeacher){
    // Ctrl+B with the Text tool chosen (nothing typed or picked yet) sets bold for the next new words.
    document.addEventListener('keydown',event=>{
      if(!((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&String(event.key).toLowerCase()==='b'))return;
      if(event.target?.closest?.('input,textarea,select,dialog,[contenteditable="true"]')||textTarget()?.kind!=='new')return;
      event.preventDefault();toggleTextBold();
    });
  }
  // Hover or tap a mark on a whiteboard or document to see who made it.
  const inkOwnerLabel=document.createElement('div');inkOwnerLabel.className='drawing-owner-label';inkOwnerLabel.hidden=true;inkOwnerLabel.setAttribute('aria-live','polite');stage.appendChild(inkOwnerLabel);
  let inkLabelTimer=null;
  function inkHits(stroke,p){
    if(!stroke.points?.length)return false;const first=stroke.points[0],last=stroke.points[stroke.points.length-1];
    if(stroke.tool==='picture'){if(stroke.points.length!==2)return false;const b=pictureBox(stroke);return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h}
    const t=Math.max(0.006,(stroke.size||0.016)*0.6);
    if(stroke.tool==='box')return p.x>=Math.min(first.x,last.x)-t&&p.x<=Math.max(first.x,last.x)+t&&p.y>=Math.min(first.y,last.y)-t&&p.y<=Math.max(first.y,last.y)+t;
    const pts=stroke.tool==='underline'?[first,{x:last.x,y:first.y}]:stroke.points;
    const ty=t*W/Math.max(1,H);
    for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[i+1]||a;const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;let k=len?((p.x-a.x)*dx+(p.y-a.y)*dy)/len:0;k=Math.max(0,Math.min(1,k));
      const ex=(a.x+k*dx-p.x)/t,ey=(a.y+k*dy-p.y)/ty;if(ex*ex+ey*ey<=1)return true}
    return false;
  }
  function hideInkOwner(){clearTimeout(inkLabelTimer);inkOwnerLabel.hidden=true}
  function showInkOwner(event,linger){
    if(draft){hideInkOwner();return}const p=normalized(event);if(!p){hideInkOwner();return}
    const stroke=[...strokes].reverse().find(s=>inkHits(s,p));if(!stroke){hideInkOwner();return}
    inkOwnerLabel.textContent=B.ownerName?.(stroke.owner)||(stroke.owner==='teacher'?'Teacher':'Student');
    const r=stage.getBoundingClientRect();inkOwnerLabel.style.left=(event.clientX-r.left+12)+'px';inkOwnerLabel.style.top=(event.clientY-r.top+12)+'px';
    inkOwnerLabel.hidden=false;clearTimeout(inkLabelTimer);if(linger)inkLabelTimer=setTimeout(hideInkOwner,1800);
  }
  if(isTeacher){
    content.addEventListener('pointermove',event=>{if(event.pointerType!=='touch')showInkOwner(event,false)});
    content.addEventListener('pointerleave',hideInkOwner);
    content.addEventListener('click',event=>showInkOwner(event,true));
  }

  // Embedded students see a video of the scrolled viewport, while PDF ink
  // uses fractions of the entire document. Translate only at that boundary.
  function activityPoint(point,toDocument=true){
    if(!point||!W||!H)return point;
    const vw=scroller.clientWidth,vh=scroller.clientHeight;
    if(!vw||!vh)return point;
    return {...point,x:toDocument?(scroller.scrollLeft+point.x*vw)/W:(point.x*W-scroller.scrollLeft)/vw,
      y:toDocument?(scroller.scrollTop+point.y*vh)/H:(point.y*H-scroller.scrollTop)/vh};
  }
  // A student draws on a picture of the teacher's view (width vw); the teacher keeps sizes as fractions of the board (width W).
  function activityTextScale(){const vw=scroller.clientWidth;return vw&&W?vw/W:1}
  // The part of the student's picture the board covers, as fractions of the picture: a student's words stay inside it.
  function activityBoardBox(){
    const vw=scroller.clientWidth,vh=scroller.clientHeight;
    return vw&&vh&&W&&H?{w:Math.max(0,Math.min(1,(W-scroller.scrollLeft)/vw)),h:Math.max(0,Math.min(1,(H-scroller.scrollTop)/vh))}:null;
  }
  function activityMarks(message){
    return {...message,points:Object.fromEntries(Object.entries(message.points||{}).map(([id,p])=>[id,activityPoint(p,false)])),
      // Words are sized as a fraction of the board's width; the student's picture is the whole view, which can be wider.
      strokes:(message.strokes||[]).map(stroke=>({...stroke,...(stroke.tool==='text'?{size:stroke.size/activityTextScale()}:{}),points:stroke.points.map(p=>activityPoint(p,false))}))};
  }

  // ---------- Pointing and drawing (positions are fractions of the whole PDF) ----------
  function normalized(event){
    if(notReady())return null;
    const r=content.getBoundingClientRect();if(!r.width||!r.height)return null;
    const p={x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};return C.validPoint(p)?p:null;
  }
  function box(){
    const s=stage.getBoundingClientRect(),r=content.getBoundingClientRect();
    return{left:r.left-s.left-stage.clientLeft,top:r.top-s.top-stage.clientTop,w:r.width,h:r.height};
  }
  const toolId=isTeacher?'teacherTool':'studentTool',colorId=isTeacher?'teacherColor':'studentColor',sizeId=isTeacher?'teacherSize':'studentSize';
  function cancelDraft(){if(dragId!==null&&content.hasPointerCapture?.(dragId))content.releasePointerCapture(dragId);draft=null;dragId=null;drawInk()}
  function editLatestText(){
    const stroke=[...(B.highlights?.()||[])].reverse().find(item=>item.tool==='text'&&item.owner==='teacher');
    if(!stroke){B.status('There is no teacher text to edit yet.');return}
    editInline(stroke);
  }
  content.addEventListener('pointerdown',event=>{
    // A click on the board while words are being typed keeps what was typed and closes the box. That click does
    // nothing else (with the Text tool it would otherwise open a new box right away).
    if(inlineEdit){finishInline(true);event.preventDefault();event.stopPropagation();return}
    if(event.button===0&&(isTeacher||selecting())){
      const tool=$(toolId).value,p=normalized(event),usable=!notReady()&&B.live()&&B.writingAllowed(tool),ready=usable&&!B.navigating();
      // Select: pick, drag, resize. Eraser: rub out my marks. Text: click my words to change them, or an empty
      // spot for new words. Every other tool draws, also on top of words.
      // The arrow: a click on one of my marks picks it; a click on nothing is a plain mouse click (the page is
      // dragged, a link is opened), so it is not swallowed here.
      if(tool==='select'){
        if(!usable||!p)return;
        if(startSelect(event,p)){event.preventDefault();event.stopPropagation();return}
        const picture=pictureAt(p);
        if(picture){event.preventDefault();event.stopPropagation();pickPicture(picture,event)}
        return;
      }
      if(tool==='eraser'){if(!ready||!p)return;event.preventDefault();event.stopPropagation();erasePid=event.pointerId;content.setPointerCapture(erasePid);eraseUnder(event);return}
      if(tool==='text'&&ready){
        if(!p)return;event.preventDefault();event.stopPropagation();
        const words=teacherMarkAt(event,p,true);
        if(words?.tool==='text'){editInline(words);return}
        editInline({point:p,color:$(colorId).value||B.ownColor(),size:textSize});return;
      }
    }
    const tool=$(toolId).value;
    if(B.navigating()||notReady()||event.button!==0||!C.highlightTools.includes(tool)||!B.live()||!B.writingAllowed(tool))return;
    const p=normalized(event);if(!p)return;
    event.preventDefault();dragId=event.pointerId;
    draft={tool,color:$(colorId).value||(C.isHighlightShape(tool)?'#ffcc00':B.ownColor()),size:Number($(sizeId).value),points:[p,p],...(shapeFill&&C.FILLABLE.includes(tool)?{fill:true}:{})};
    content.setPointerCapture(dragId);drawInk();
  });
  function extend(event){
    if(!draft||event.pointerId!==dragId)return;const p=normalized(event);if(!p)return;
    if(!['highlight','pen'].includes(draft.tool)){draft.points=[draft.points[0],p];return}
    const last=draft.points[draft.points.length-1];
    if(Math.hypot((p.x-last.x)*W,(p.y-last.y)*H)>4&&draft.points.length<256)draft.points.push(p);
  }
  content.addEventListener('pointermove',event=>{
    if(edit&&event.pointerId===edit.pid){moveSelect(event);return}
    if(erasePid===event.pointerId){eraseUnder(event);return}
    if(!draft)return;if(!B.writingAllowed(draft.tool)){cancelDraft();return}extend(event);drawInk()});
  content.addEventListener('pointerup',event=>{
    if(edit&&event.pointerId===edit.pid){endSelect(true);return}
    if(erasePid===event.pointerId){erasePid=null;if(content.hasPointerCapture?.(event.pointerId))content.releasePointerCapture(event.pointerId);return}
    if(!draft||event.pointerId!==dragId)return;extend(event);
    const stroke=draft,may=B.writingAllowed(stroke.tool)&&B.live();cancelDraft();
    if(may&&C.cleanStroke(stroke))B.submitStroke(stroke);
  });
  content.addEventListener('pointercancel',()=>{erasePid=null;endSelect(false);cancelDraft()});content.addEventListener('lostpointercapture',()=>{erasePid=null;if(edit)endSelect(false);if(draft)cancelDraft()});
  [toolId,colorId,sizeId].forEach(id=>$(id).addEventListener('change',cancelDraft));

  // ---------- Opening and closing ----------
  async function loadDoc(data,noCopy){
    if(isTeacher){fitWhole=false;syncFit()} // a PDF fits the width
    if(!pdfjs)throw new Error('The PDF reader could not load. Refresh the page and try again.');
    pdfjs.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js?v=3.11.174';
    const token=++loadToken;unload(false);loadToken=token;
    // pdf.js takes ownership of the bytes it is given, so give it a copy.
    const task=pdfjs.getDocument({data:noCopy?data:data.slice(),isEvalSupported:false,enableXfa:false});
    const loaded=await task.promise;if(token!==loadToken){loaded.destroy();return false}
    const ratios=[];
    for(let i=1;i<=loaded.numPages;i++){
      const page=await loaded.getPage(i),v=page.getViewport({scale:1});
      ratios.push(Math.round((v.height/v.width)*10000)/10000);
      if(token!==loadToken){loaded.destroy();return false}
    }
    doc=loaded;ratiosList=ratios;lay=P.layout(ratios,layoutOpts);zoom=1;
    scroller.setAttribute('aria-label','Lesson PDF');
    pageEls=ratios.map(()=>{const node=el('div',null,'pdf-page');content.insertBefore(node,ink);return node});
    scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;
    relayout();scroller.scrollTop=0;scroller.scrollLeft=0;scheduleRender();updateControls();
    return true;
  }
  function makeWebFrame(html,height){
    const iframe=el('iframe',null,'lesson-webpage');iframe.title='Static lesson webpage';
    iframe.setAttribute('sandbox','allow-same-origin');iframe.referrerPolicy='no-referrer';
    iframe.style.width=Web.WIDTH+'px';iframe.style.height=height+'px';
    iframe.srcdoc=html;return iframe;
  }
  async function measureWeb(html){
    const iframe=makeWebFrame(html,1000);iframe.classList.add('webpage-measure');
    const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Page took too long to load.')),15000);iframe.onload=()=>{clearTimeout(timer);resolve()}});
    document.body.appendChild(iframe);
    try{
      await loaded;const inner=iframe.contentDocument;if(!inner)throw Error('Could not read this page.');
      await Promise.race([Promise.all([inner.fonts?.ready,...Array.from(inner.images).map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=image.onerror=resolve}))]),new Promise(resolve=>setTimeout(resolve,5000))]);
      const height=Math.max(1000,inner.documentElement.scrollHeight,inner.body?.scrollHeight||0);
      if(height>Web.MAX_HEIGHT)throw Error('This page is too long. Save the section you need as HTML or PDF.');
      return height;
    }finally{iframe.remove()}
  }
  async function loadWebDoc(data){
    const raw=Web.cleanPayload(JSON.parse(new TextDecoder().decode(data)));if(!raw)throw Error('Invalid lesson webpage.');
    const token=++loadToken;unload(false);loadToken=token;
    // Sanitize on receipt as well as on opening. The teacher and every student use
    // the same fixed document width/height, independent of their screen dimensions.
    const html=Web.prepare(raw.html,new DOMParser().parseFromString(raw.html,'text/html').querySelector('base')?.href);
    webMode=true;layoutOpts={spread:false,rtl:true,shift:false};
    scroller.setAttribute('aria-label','Lesson webpage');
    doc={destroy(){}};ratiosList=[raw.height/Web.WIDTH];lay=P.layout(ratiosList);zoom=1;
    const node=el('div',null,'pdf-page webpage-page');node.appendChild(makeWebFrame(html,raw.height));pageEls=[node];content.insertBefore(node,ink);
    scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;
    relayout();scroller.scrollTop=0;scroller.scrollLeft=0;updateControls();return true;
  }
  async function openWebpage(source,file){
    if(!isTeacher||!Web)return;
    const token=++opening;B.clearError();showNote('Opening webpage…');
    $('openWebpage').disabled=true;
    try{
      let html,base,name;
      if(file){
        if(!/\.html?$/i.test(file.name))throw Error('Please choose an HTML file (.html or .htm).');
        if(file.size>Web.MAX_BYTES)throw Error('Please choose an HTML file smaller than 8 MB.');
        html=await file.text();base='https://invalid.invalid/';name=file.name.replace(/\.html?$/i,'');
      }else{
        base=Web.cleanUrl(source);if(!base)throw Error('Enter a full http:// or https:// webpage URL.');
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{
          const response=await fetch(base,{credentials:'omit',signal:controller.signal});
          if(!response.ok)throw Error('The webpage could not be loaded.');
          if(!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')||''))throw Error('This address must point to an HTML webpage.');
          if(Number(response.headers.get('content-length'))>Web.MAX_BYTES)throw Error('This webpage is too large.');
          html=await response.text();base=response.url;
        }catch(error){if(error.name==='TypeError'||error.name==='AbortError')throw Error('This website blocks direct loading or did not respond. Save a complete HTML copy and use Open HTML file, or use Share teaching screen.');throw error}
        finally{clearTimeout(timer)}
        name=new URL(base).hostname;
      }
      if(new TextEncoder().encode(html).length>Web.MAX_BYTES)throw Error('This webpage is larger than 8 MB.');
      const prepared=Web.prepare(html,base),height=await measureWeb(prepared);
      const data=new TextEncoder().encode(JSON.stringify({html:prepared,width:Web.WIDTH,height}));
      if(data.length>Web.MAX_BYTES)throw Error('This webpage is larger than 8 MB.');
      if(token!==opening)return;
      closePdf(true);const committed=opening;if(B.sharing())B.stopSharing();
      docLabel='webpage';fitWhole=false;syncFit();await loadWebDoc(data);if(opening!==committed)return;bytes=data;docName=P.cleanName(name);docId=crypto.randomUUID();
      showNote('');B.resetMarks();B.setPdf(true,'webpage');lastOpen={kind:'web',source,file};
      B.status('Webpage open. The ↖ arrow is your mouse: scroll, drag the page, click a link to open it for the class. Students follow you. Pick another tool on the left to point or draw.');
      for(const member of B.members().values())if(member.admitted)deliver(member);
    }catch(error){showNote('');B.fail(error.message||'Could not open this webpage.')}
    finally{$('openWebpage').disabled=false}
  }
  // opts (optional): {name, label:'whiteboard', kind:'whiteboard', status} — used by the blank whiteboard in student-boards.js.
  async function openSnapshot(dataUrl,width,height,opts={}){
    const board=opts.label==='whiteboard';
    if(!isTeacher||!Web||typeof dataUrl!=='string'||!/^data:image\/jpeg;base64,/.test(dataUrl))throw Error('Invalid captured tab image.');
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<100||height<100)throw Error('Invalid snapshot size.');
    const token=++opening;B.clearError();showNote(board?'Opening whiteboard…':'Preparing captured tab…');
    try{
      const h=Math.max(100,Math.round(Web.WIDTH*height/width));
      const html='<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}img{display:block;width:1000px;height:'+h+'px}</style></head><body><img alt="Captured browser tab" src="'+dataUrl+'"></body></html>';
      const prepared=Web.prepare(html,null);
      const data=new TextEncoder().encode(JSON.stringify({html:prepared,width:Web.WIDTH,height:h}));
      if(data.length>Web.MAX_BYTES)throw Error('Snapshot is too large. Try a smaller browser window.');
      if(token!==opening)return;
      closePdf(true);const committed=opening;if(B.sharing())B.stopSharing();
      await loadWebDoc(data);if(opening!==committed)return;
      bytes=data;docName=board?P.cleanName(opts.name||'Whiteboard'):'Browser tab snapshot';docLabel=board?'whiteboard':'webpage';docId=crypto.randomUUID();
      boardSize=board?{w:width,h:height}:null;
      if(board&&Pages){wbPages=[newWbPage()];wbAt=0}
      // The whole board at a glance; a captured tab keeps fitting the width.
      fitWhole=!!board;updateControls();syncFit();relayout();scroller.scrollTop=0;scroller.scrollLeft=0;
      showNote('');B.resetMarks();B.setPdf(true,board?'whiteboard':'webpage');updateControls();
      if(board){startBoardPresentation(dataUrl);const opened=docId;setTimeout(()=>settleBoardShape(opened),900)}
      if(!board)lastOpen={kind:'snap',args:[dataUrl,width,height,opts]};
      B.status(board?'Whiteboard open.':'Static tab snapshot open.');
      for(const member of B.members().values())if(member.admitted)deliver(member);
      return true;
    }catch(error){showNote('');B.fail(error.message||'Could not open the captured tab.');return false}
  }
  function unload(hide){
    finishInline(false);
    if(hide)stopBoardPresentation();
    loadToken++;rendered.forEach(item=>item.task?.cancel());rendered.clear();
    pageEls.forEach(node=>node.remove());pageEls=[];
    try{doc?.destroy()}catch(_){}doc=null;lay=null;draft=null;dragId=null;W=H=0;webMode=false;
    paged=false;ratiosList=[];pageUrls.forEach(url=>URL.revokeObjectURL(url));pageUrls.clear();pageTransfers.clear();pageCache.clear();pageJobs.clear();renderChain=Promise.resolve();
    if(hide){scroller.hidden=true;stage.classList.remove('pdf-open');showNote('');if(nav)nav.hidden=true;drawInk();B.redraw()}
  }

  // Teacher: choose a PDF from this computer.
  async function openFile(file){
    if(!isTeacher||!file)return;
    opening++;
    if(!/pdf$/i.test(file.type)&&!/\.pdf$/i.test(file.name)){B.fail('Please choose a PDF file.');return}
    if(file.size>P.PAGED_MAX_BYTES){B.fail('That PDF is bigger than 500 MB. Save just the pages you need as a smaller PDF.');return}
    const big=file.size>P.SMALL_BYTES;
    B.clearError();showNote(big?'Opening a large PDF… this can take a little while.':'Opening '+file.name+'…');
    try{
      if(B.sharing())B.stopSharing();
      dropBoardPictures();
      const data=new Uint8Array(await file.arrayBuffer());
      const ok=await loadDoc(data,big);if(!ok)return false;
      paged=big;bytes=big?null:data;docName=P.cleanName(file.name.replace(/\.pdf$/i,''));docId=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());
      showNote('');B.resetMarks();B.setPdf(true);
      B.status(big?'Large PDF open. Students receive the pages you teach on, so the first page may take a moment.':'PDF open. Students receive it automatically. Use the buttons at the bottom of the lesson to zoom and turn pages.');
      for(const member of B.members().values())if(member.admitted)deliver(member);
      startPdfPresentation();
      if(big)scheduleViewSend(true);
      lastOpen={kind:'pdf',file};
      window.PointerPdfLibrary?.onOpened(file);
      return true;
    }catch(error){
      unload(true);bytes=null;docId=null;showNote('');
      B.fail(error&&error.name==='PasswordException'?'That PDF needs a password. Save an unprotected copy and try again.':'Could not open that PDF. Try another copy of the file.');
      return false;
    }
  }
  function closePdf(quiet){
    fitWhole=false;syncFit();
    if(!isTeacher){return}
    opening++;
    const had=!!doc;
    if(had)for(const member of B.members().values())B.send(member.connection,{type:'pdf-close'});
    stopBoardPresentation();dropBoardPictures();docId=null;bytes=null;unload(true);strokes=[];
    window.PointerPdfLibrary?.onClosed();
    if(had||!quiet)B.setPdf(false);
    if(had)$('placeholder').hidden=B.sharing();
  }

  // Teacher: send the file to a student (in small pieces, so a slow connection never freezes the page).
  function buffered(connection){return(connection.dataChannel?.bufferedAmount||0)+(connection.bufferSize||0)*P.CHUNK}
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function sendFile(member){
    const connection=member.connection,token=docId,data=bytes;
    if(!data||!connection?.open)return;
    const chunks=P.chunkCount(data.length);
    B.send(connection,{type:'pdf-offer',id:token,name:docName,size:data.length,chunks,kind:webMode?'webpage':'pdf'});
    for(let i=0;i<chunks;i++){
      if(docId!==token||!connection.open)return;
      while(buffered(connection)>1500000){await sleep(40);if(docId!==token||!connection.open)return}
      B.send(connection,{type:'pdf-chunk',id:token,i,data:data.slice(i*P.CHUNK,(i+1)*P.CHUNK)});
      if(i%16===15)await sleep(0);
    }
    if(docId===token&&connection.open){B.send(connection,{type:'pdf-view',id:token,...currentView()});B.send(connection,{type:'highlights',strokes:B.highlights()})}
  }
  function deliver(member){if(paged){sendInfo(member);B.send(member.connection,{type:'pdf-view',id:docId,...currentView()});B.send(member.connection,{type:'highlights',strokes:B.highlights()});pumpPages(member)}else sendFile(member)}
  function sendInfo(member){B.send(member.connection,{type:'pdf-info',id:docId,name:docName,ratios:ratiosList})}
  function wantedPages(){
    if(notReady()||!H)return[];
    const view=currentView();
    const last=P.pageAt(lay,view.top+scroller.clientHeight/H);
    return P.pagesNear(lay.count,P.pageAt(lay,view.top),lay.spread?Math.min(lay.count-1,last+1):last);
  }
  // Teacher: turn one page into a picture (JPEG) once, and reuse it for every student.
  async function renderJpeg(i,token){
    if(!doc||token!==docId)throw new Error('closed');
    const page=await doc.getPage(i+1),base=page.getViewport({scale:1});
    let scale=P.PAGE_IMAGE_WIDTH/base.width;const pixels=base.width*scale*base.height*scale;if(pixels>14e6)scale*=Math.sqrt(14e6/pixels);
    const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    // 'print' intent renders without waiting for screen refreshes, so it keeps working even if this tab is covered or hidden.
    await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,intent:'print'}).promise;
    for(const quality of [0.85,0.65,0.45]){
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob&&blob.size<=P.PAGE_MAX){canvas.width=0;return new Uint8Array(await blob.arrayBuffer())}
    }
    canvas.width=0;throw new Error('page too large');
  }
  function pageImage(i){
    if(pageCache.has(i)){const data=pageCache.get(i);pageCache.delete(i);pageCache.set(i,data);return Promise.resolve(data)}
    if(pageJobs.has(i))return pageJobs.get(i);
    const token=docId;
    const job=renderChain.then(()=>renderJpeg(i,token)).then(data=>{
      pageJobs.delete(i);
      if(token===docId){pageCache.set(i,data);while(pageCache.size>40)pageCache.delete(pageCache.keys().next().value)}
      return data;
    },error=>{pageJobs.delete(i);throw error});
    renderChain=job.catch(()=>{});pageJobs.set(i,job);return job;
  }
  async function sendPage(connection,token,i,data){
    const chunks=P.chunkCount(data.length);
    B.send(connection,{type:'pdf-page-offer',id:token,i,size:data.length,chunks});
    for(let c=0;c<chunks;c++){
      if(docId!==token||!connection.open)return false;
      while(buffered(connection)>1500000){await sleep(40);if(docId!==token||!connection.open)return false}
      B.send(connection,{type:'pdf-page-chunk',id:token,i,c,data:data.slice(c*P.CHUNK,(c+1)*P.CHUNK)});
      if(c%16===15)await sleep(0);
    }
    return true;
  }
  // One sender per student; it keeps going until that student has every page near the teacher's view.
  async function pumpPages(member){
    if(!paged||member.pdfPump||!member.connection?.open)return;
    member.pdfPump=true;const token=docId;
    if(member.pdfHaveId!==token){member.pdfHave=new Set();member.pdfHaveId=token}
    try{
      for(;;){
        if(docId!==token||!member.connection.open)return;
        const want=wantedPages().find(i=>!member.pdfHave.has(i));if(want==null)return;
        const data=await pageImage(want);if(docId!==token||!member.connection.open)return;
        if(await sendPage(member.connection,token,want,data))member.pdfHave.add(want);else return;
      }
    }catch(_){/* page could not be made; the next view change tries again */}
    finally{member.pdfPump=false}
  }
  function scheduleViewSend(immediate){
    if(!isTeacher||!docId)return;
    const wait=immediate?0:Math.max(0,90-(Date.now()-lastViewSent));
    clearTimeout(viewTimer);
    viewTimer=setTimeout(()=>{
      lastViewSent=Date.now();const view=currentView();
      for(const member of B.members().values())if(member.admitted){B.send(member.connection,{type:'pdf-view',id:docId,...view});if(paged)pumpPages(member)}
    },wait);
  }

  // Student: receive messages from the teacher.
  function studentFinish(){
    const data=P.assemble(transfer),id=transfer.id,name=transfer.name,transferKind=transfer.kind;transfer=null;
    if(!data){showNote('The lesson file did not arrive completely. Leave and rejoin the class.');return}
    showNote('Opening '+name+'…');
    (transferKind==='webpage'?loadWebDoc(data):loadDoc(data)).then(ok=>{
      if(!ok)return;docId=id;docName=name;showNote('');
      if(pendingView&&pendingView.id===id)applyView(pendingView);
      B.status('Following your teacher in '+name+'.');
    }).catch(()=>showNote('Could not open the lesson file. Leave and rejoin the class.'));
  }
  function handleMessage(message){
    if(!message||typeof message.type!=='string'||!message.type.startsWith('pdf-'))return false;
    if(isTeacher)return true;
    if(message.type==='pdf-offer'){
      const offer=P.cleanOffer(message);if(!offer)return true;
      if(message.kind==='webpage'&&offer.size>Web.MAX_BYTES)return true;
      studentReset();transfer={...offer,kind:message.kind==='webpage'?'webpage':'pdf',parts:new Array(offer.chunks),received:0};
      scroller.setAttribute('aria-label',transfer.kind==='webpage'?'Lesson webpage':'Lesson PDF');
      scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;showNote('Receiving '+offer.name+'… 0%');
    }else if(message.type==='pdf-chunk'){
      if(P.acceptChunk(transfer,message)){
        if(transfer.received>=transfer.size)studentFinish();
        else if(message.i%8===0)showNote('Receiving '+transfer.name+'… '+Math.floor(100*transfer.received/transfer.size)+'%');
      }
    }else if(message.type==='pdf-info'){
      const info=P.cleanInfo(message);if(!info)return true;
      studentReset();paged=true;docId=info.id;docName=info.name;ratiosList=info.ratios;layoutOpts={spread:false,rtl:true,shift:false};lay=P.layout(info.ratios,layoutOpts);zoom=1;
      pageEls=info.ratios.map((_,i)=>{const node=el('div',null,'pdf-page');node.dataset.label='Loading page '+(i+1)+'…';content.insertBefore(node,ink);return node});
      scroller.hidden=false;stage.classList.add('pdf-open');$('placeholder').hidden=true;showNote('');
      relayout();if(pendingView&&pendingView.id===docId)applyView(pendingView);
      B.status('Following your teacher in '+info.name+'. Pages appear as your teacher turns to them.');
    }else if(message.type==='pdf-page-offer'){
      if(!paged||!lay)return true;
      const offer=P.cleanPageOffer(message,{id:docId,count:lay.count});if(!offer)return true;
      if(pageTransfers.size>=8)pageTransfers.clear();
      pageTransfers.set(offer.i,{...offer,parts:new Array(offer.chunks),received:0});
    }else if(message.type==='pdf-page-chunk'){
      const transfer=Number.isInteger(message.i)?pageTransfers.get(message.i):null;
      if(paged&&P.acceptPageChunk(transfer,message)&&transfer.received>=transfer.size){pageTransfers.delete(transfer.i);const data=P.assemble(transfer);if(data)showPageImage(transfer.i,data)}
    }else if(message.type==='pdf-view'){
      const view=P.cleanView(message);if(!view||typeof message.id!=='string')return true;
      pendingView={...view,id:message.id};
      if(lay&&docId===message.id)applyView(view);
    }else if(message.type==='pdf-close'){studentReset()}
    return true;
  }
  function showPageImage(i,data){
    if(!pageEls[i])return;
    const url=URL.createObjectURL(new Blob([data],{type:'image/jpeg'})),image=document.createElement('img'),old=pageUrls.get(i);
    image.alt='';image.draggable=false;image.src=url;pageUrls.set(i,url);
    pageEls[i].dataset.label='';pageEls[i].replaceChildren(image);if(old)setTimeout(()=>URL.revokeObjectURL(old),2000);
  }
  function studentReset(){fitWhole=false;syncFit();layoutOpts={spread:false,rtl:true,shift:false};transfer=null;pendingView=null;docId=null;unload(true);strokes=[];drawInk();$('placeholder').hidden=B.sharing()}

  // Static snapshots may be inside a sandboxed frame. Capture panning at the
  // lesson surface before the frame or annotation layers can swallow a drag.
  let snapshotPan=null;
  stage.addEventListener('pointerdown',event=>{
    if(!webMode||!isTeacher||!B.navigating()||notReady()||event.button!==0||scroller.hidden||!stage.contains(event.target))return;
    if(event.target.closest?.('[data-stage-ui],button,input,select,textarea'))return;
    // With the arrow, a picture that was lifted to move it goes back on the board with the next click elsewhere.
    if(pictureEdits.length&&selecting())finishPictureEdit();
    // The arrow on one of my marks, a handle or a picture: that is picked instead, by the lesson's own click handler.
    if(grabAt(event))return;
    if(inlineEdit)finishInline(true);
    if(selectedId){selectedId=null;drawInk()}
    event.preventDefault();event.stopPropagation();cancelDraft();
    snapshotPan={id:event.pointerId,x:event.clientX,y:event.clientY,left:scroller.scrollLeft,top:scroller.scrollTop};
    stage.setPointerCapture(event.pointerId);
  },true);
  stage.addEventListener('pointermove',event=>{
    if(!snapshotPan||event.pointerId!==snapshotPan.id)return;
    event.preventDefault();event.stopPropagation();
    scroller.scrollLeft=snapshotPan.left+snapshotPan.x-event.clientX;
    scroller.scrollTop=snapshotPan.top+snapshotPan.y-event.clientY;
  },true);
  function stopSnapshotPan(){
    if(snapshotPan&&stage.hasPointerCapture(snapshotPan.id))stage.releasePointerCapture(snapshotPan.id);
    snapshotPan=null;
  }
  // The webpage is a still copy (nothing in it runs), so a click cannot reach it. In Mouse mode a click that did
  // not drag is looked up in the copy instead: a link opens that page as the lesson, so the class follows.
  function linkAt(event){
    const frame=content.querySelector('iframe.lesson-webpage'),inner=frame?.contentDocument;if(!inner||!frame.offsetWidth)return null;
    const r=frame.getBoundingClientRect(),k=r.width/frame.offsetWidth;if(!k)return null;
    const link=inner.elementFromPoint((event.clientX-r.left)/k,(event.clientY-r.top)/k)?.closest?.('a[data-lesson-link]');
    const url=link&&Web?.cleanUrl?.(link.getAttribute('data-lesson-link'));
    return url||null;
  }
  // In Mouse mode the cursor turns into a hand over a link.
  stage.addEventListener('pointermove',event=>{
    if(!isTeacher||!webMode||docLabel!=='webpage'||snapshotPan||scroller.hidden)return;
    content.style.cursor=B.navigating()&&linkAt(event)?'pointer':'';
  },true);
  stage.addEventListener('pointerup',event=>{
    const p=snapshotPan;if(!p||event.pointerId!==p.id||docLabel!=='webpage'||Math.hypot(event.clientX-p.x,event.clientY-p.y)>=5)return;
    const url=linkAt(event);if(!url)return;
    B.status('Opening that link for the class…');void openWebpage(url);
  },true);
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>stage.addEventListener(type,stopSnapshotPan,true));
  document.addEventListener('class-pointer-navigation',stopSnapshotPan);
  // Navigation mode keeps the selected tool intact. Dragging moves the document;
  // students still follow the teacher's view and cannot change it for the class.
  let pan=null;
  scroller.addEventListener('pointerdown',event=>{
    if(!isTeacher||!B.navigating()||notReady()||event.button!==0)return;
    cancelDraft();event.preventDefault();pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:scroller.scrollLeft,top:scroller.scrollTop};scroller.setPointerCapture(event.pointerId);
  });
  scroller.addEventListener('pointermove',event=>{if(pan&&event.pointerId===pan.id){scroller.scrollLeft=pan.left+pan.x-event.clientX;scroller.scrollTop=pan.top+pan.y-event.clientY}});
  function stopPan(){if(pan&&scroller.hasPointerCapture(pan.id))scroller.releasePointerCapture(pan.id);pan=null}
  scroller.addEventListener('pointerup',stopPan);scroller.addEventListener('pointercancel',stopPan);scroller.addEventListener('lostpointercapture',()=>{pan=null});
  document.addEventListener('class-pointer-navigation',()=>{cancelDraft();stopPan()});
  document.addEventListener('keydown',event=>{
    if(!isTeacher||!B.navigating()||notReady()||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,select,textarea,[contenteditable],dialog[open]'))return;
    const moves={ArrowDown:80,ArrowUp:-80,PageDown:scroller.clientHeight*0.8,PageUp:-scroller.clientHeight*0.8};
    if(event.key in moves){event.preventDefault();scroller.scrollTop+=moves[event.key]}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();scroller.scrollLeft+=event.key==='ArrowLeft'?-80:80}
    else if(event.key==='Home'||event.key==='End'){event.preventDefault();scroller.scrollTop=event.key==='Home'?0:H}
  });


  // ---------- Whiteboard pictures: the teacher pastes a screenshot or copied image ----------
  // Pictures become part of the shared whiteboard background, so every student receives them
  // through the normal lesson transfer. Pen marks stay on top (same 0..1 board positions).
  // Before a picture is shown to the class the teacher can move and resize it here; the
  // 🖼 Move pictures button brings placed pictures back for moving, resizing or removing.
  const MAX_PICTURE_BYTES=15*1024*1024,MAX_PICTURES=12;
  function isBoardOpen(){return isTeacher&&webMode&&docLabel==='whiteboard'&&!!docId&&!!boardSize&&!scroller.hidden}
  function dropBoardPictures(){
    stopBoardPresentation();
    for(const item of pictureEdits)item.el.remove();
    pictureEdits=[];boardPictures=[];boardSize=null;if(pictureBar)pictureBar.hidden=true;
    wbPages=null;wbAt=0;pagesPanelOpen=false;syncPagesBar();
  }
  // source: a picture file, or a data: URL from a saved whiteboard.
  function loadPicture(source){
    return new Promise((resolve,reject)=>{
      const saved=typeof source==='string',url=saved?source:URL.createObjectURL(source),image=new Image(),done=()=>{if(!saved)URL.revokeObjectURL(url)};
      image.onload=()=>{done();image.naturalWidth&&image.naturalHeight?resolve(image):reject(Error('empty'))};
      image.onerror=()=>{done();reject(Error('This picture could not be read.'))};
      image.src=url;
    });
  }
  // The blank board with its placed pictures, at full size.
  function boardCanvas(){
    const c=document.createElement('canvas');c.width=boardSize.w;c.height=boardSize.h;
    const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingQuality='high';
    for(const p of boardPictures)ctx.drawImage(p.image,p.x*c.width,p.y*c.height,p.w*c.width,p.h*c.height);
    return c;
  }
  // The shape of a new board is worked out before the lesson area has its final size (the top of the page gets
  // slimmer once a lesson is open). When the area has settled and nothing is on the board yet, the empty board is
  // made again in exactly the area's shape, so it fills it from side to side and top to bottom.
  function settleBoardShape(opened){
    if(!isBoardOpen()||docId!==opened||boardPictures.length||pictureEdits.length||(B.highlights?.()||[]).length||inlineEdit)return;
    const w=scroller.clientWidth,h=scroller.clientHeight;if(w<200||h<120)return;
    const want=Math.max(.36,Math.min(.75,h/w)),have=boardSize.h/boardSize.w;
    if(Math.abs(want-have)/have<.012)return;
    boardSize={w:boardSize.w,h:Math.round(boardSize.w*want)};publishBoard();
  }
  function composeBoard(){
    const c=boardCanvas();
    for(const quality of [0.9,0.8,0.65,0.5]){
      const url=c.toDataURL('image/jpeg',quality);
      if(url.length*0.75<Web.MAX_BYTES*0.9){c.width=0;return url}
    }
    c.width=0;throw Error('These pictures are too large for the whiteboard. Remove one and try again.');
  }
  function snapshotPayload(dataUrl,width,height){
    const h=Math.max(100,Math.round(Web.WIDTH*height/width));
    const html='<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}img{display:block;width:1000px;height:'+h+'px}</style></head><body><img alt="Whiteboard" src="'+dataUrl+'"></body></html>';
    const data=new TextEncoder().encode(JSON.stringify({html:Web.prepare(html,null),width:Web.WIDTH,height:h}));
    if(data.length>Web.MAX_BYTES)throw Error('These pictures are too large for the whiteboard. Remove one and try again.');
    return data;
  }
  // Replace the whiteboard background for everyone while keeping marks, zoom and scroll.
  function publishBoard(){
    boardUpdate=boardUpdate.catch(()=>{}).then(async()=>{
      if(!isBoardOpen())return;
      const token=opening,data=snapshotPayload(composeBoard(),boardSize.w,boardSize.h),view=currentView();
      await loadWebDoc(data);
      if(token!==opening)return;
      zoom=view.zoom;relayout();scroller.scrollTop=view.top*H;scroller.scrollLeft=view.left*W;
      bytes=data;docId=crypto.randomUUID();updateControls();
      for(const member of B.members().values())if(member.admitted)deliver(member);
      scheduleViewSend(true);
    }).catch(error=>B.fail(error?.message||'Could not update the whiteboard.'));
    return boardUpdate;
  }
  function placeEditElement(item){
    item.el.style.left=(item.x*100)+'%';item.el.style.top=(item.y*100)+'%';
    item.el.style.width=(item.w*100)+'%';item.el.style.height=(item.h*100)+'%';
  }
  function showPictureBar(){
    if(!pictureBar){
      pictureBar=el('div',null,'board-picture-bar');pictureBar.dataset.stageUi='true';pictureBar.setAttribute('role','toolbar');pictureBar.setAttribute('aria-label','Picture placement');
      const text=el('span',null,'board-picture-help','Drag the picture to move it. Drag a corner to resize it.');
      const done=el('button',null,'board-picture-done','✓ Show to class');done.type='button';done.title='Place the pictures on the whiteboard for everyone (Enter)';
      done.addEventListener('click',()=>finishPictureEdit());
      pictureBar.append(text,done);
      ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick','wheel'].forEach(type=>pictureBar.addEventListener(type,event=>event.stopPropagation()));
      stage.appendChild(pictureBar);
    }
    pictureBar.hidden=false;pictureBar.querySelector('.board-picture-done').focus({preventScroll:true});
  }
  function startPictureEdit(image,frame){
    const item={image,...frame,el:el('div',null,'board-picture-edit')};
    item.el.dataset.stageUi='true';item.el.setAttribute('role','group');item.el.setAttribute('aria-label','Pasted picture. Drag to move; drag a corner to resize.');
    // The decoded picture itself is shown (its temporary file link is already released).
    image.alt='';image.draggable=false;item.el.appendChild(image);
    for(const corner of ['nw','ne','sw','se']){const handle=el('span',null,'board-picture-handle '+corner);handle.dataset.corner=corner;item.el.appendChild(handle)}
    const remove=el('button',null,'board-picture-remove','✕');remove.type='button';remove.title='Remove this picture';remove.setAttribute('aria-label','Remove this picture');
    remove.addEventListener('click',event=>{event.stopPropagation();item.el.remove();pictureEdits=pictureEdits.filter(other=>other!==item);if(!pictureEdits.length)finishPictureEdit()});
    item.el.appendChild(remove);
    let drag=null,moved=false;
    const begin=(event,corner)=>{
      const r=content.getBoundingClientRect();
      drag={id:event.pointerId,corner,x:event.clientX,y:event.clientY,start:{x:item.x,y:item.y,w:item.w,h:item.h},rw:r.width,rh:r.height};moved=false;
      try{item.el.setPointerCapture(event.pointerId)}catch{}
      item.el.classList.add('dragging');
      for(const other of pictureEdits)other.el.classList.toggle('selected',other===item);
    };
    // The arrow starts a move with the same press that picked the picture.
    item.grab=event=>begin(event,null);
    item.el.addEventListener('pointerdown',event=>{
      event.stopPropagation();
      if(event.button!==0||event.target===remove)return;
      event.preventDefault();
      begin(event,event.target.dataset?.corner||null);
    });
    item.el.addEventListener('pointermove',event=>{
      event.stopPropagation();
      if(!drag||drag.id!==event.pointerId)return;
      const dx=(event.clientX-drag.x)/drag.rw,dy=(event.clientY-drag.y)/drag.rh,s=drag.start,clamp=P.clamp;
      if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>=3)moved=true;
      if(!drag.corner){item.x=clamp(s.x+dx,-s.w*0.8,1-s.w*0.2);item.y=clamp(s.y+dy,-s.h*0.8,1-s.h*0.2)}
      else{
        // Corners resize and keep the picture's shape (worked out in screen pixels).
        const sw=s.w*drag.rw,sh=s.h*drag.rh,aspect=sh/sw;
        const growX=(drag.corner.includes('w')?-1:1)*(event.clientX-drag.x),growY=(drag.corner.includes('n')?-1:1)*(event.clientY-drag.y)/aspect;
        const wpx=clamp(sw+Math.max(growX,growY),24,drag.rw*3),w=wpx/drag.rw,h=wpx*aspect/drag.rh;
        item.w=w;item.h=h;item.x=drag.corner.includes('w')?s.x+s.w-w:s.x;item.y=drag.corner.includes('n')?s.y+s.h-h:s.y;
      }
      placeEditElement(item);
    });
    const end=event=>{
      if(!drag||(event&&drag.id!==event.pointerId))return;
      drag=null;item.el.classList.remove('dragging');
      // With the arrow, a picture that was moved or resized goes straight back on the board for everyone.
      if(moved&&selecting()&&pictureEdits.includes(item)){moved=false;finishPictureEdit()}
    };
    item.el.addEventListener('pointerup',event=>{event.stopPropagation();end(event)});
    item.el.addEventListener('pointercancel',end);item.el.addEventListener('lostpointercapture',()=>end());
    ['click','dblclick','wheel'].forEach(type=>item.el.addEventListener(type,event=>event.stopPropagation()));
    placeEditElement(item);content.appendChild(item.el);pictureEdits.push(item);
    for(const other of pictureEdits)other.el.classList.toggle('selected',other===item);
    showPictureBar();updateControls();
    B.status('Picture added. Move or resize it, then press ✓ Show to class. Students see it after that.');
    return item;
  }
  function finishPictureEdit(){
    if(!pictureEdits.length){if(pictureBar)pictureBar.hidden=true;updateControls();return}
    for(const item of pictureEdits){item.el.remove();boardPictures.push({image:item.image,x:item.x,y:item.y,w:item.w,h:item.h,after:item.after})}
    pictureEdits=[];if(pictureBar)pictureBar.hidden=true;
    publishBoard().then(()=>{updateControls();if(isBoardOpen())B.status('Picture is on the whiteboard for everyone. Use ✒️ Pen to write on it, or 🖼 Move pictures to change it.')});
  }
  function editBoardPictures(){
    if(!isBoardOpen()||!boardPictures.length)return;
    const items=boardPictures;boardPictures=[];
    for(const p of items)startPictureEdit(p.image,{x:p.x,y:p.y,w:p.w,h:p.h,after:p.after});
    publishBoard();
    B.status('Move, resize or remove the pictures, then press ✓ Show to class.');
  }
  // ---------- Adding pictures: paste, Upload (pictures and PDFs) ----------
  const pictureCount=()=>(B.highlights?.()||strokes).filter(item=>item.tool==='picture').length;
  // Put a picture (a small data: URL, iw by ih pixels) on the board as a mark. opts: fill (a whole slide), center (a point of the board), nudge.
  function placePictureData(data,iw,ih,opts={}){
    if(!isBoardOpen())return false;
    const ratio=(ih/iw)*(boardSize.w/boardSize.h);let w,h,x,y;
    if(opts.fill){w=Math.min(.96,.96/ratio);h=w*ratio;x=(1-w)/2;y=(1-h)/2}
    else{
      // Fit inside 60% of the visible part of the board, centered where the teacher is looking.
      const r=content.getBoundingClientRect(),v=scroller.getBoundingClientRect();
      const visible={x:Math.max(0,(v.left-r.left)/r.width),y:Math.max(0,(v.top-r.top)/r.height),w:Math.min(1,v.width/r.width),h:Math.min(1,v.height/r.height)};
      w=Math.min(visible.w*0.6,iw/boardSize.w);h=w*ratio;
      if(h>visible.h*0.6){h=visible.h*0.6;w=h/ratio}
      const c=opts.center||{x:visible.x+visible.w/2,y:visible.y+visible.h/2},n=opts.nudge||0;
      x=P.clamp(c.x-w/2+n,0,Math.max(0,1-w));y=P.clamp(c.y-h/2+n,0,Math.max(0,1-h));
    }
    B.submitStroke({tool:'picture',color:'#1f2937',size:.016,points:[{x,y},{x:x+w,y:y+h}],image:data});
    const made=[...(B.highlights?.()||[])].reverse().find(item=>item.tool==='picture'&&item.image===data);
    if(made&&selecting()){selectedId=made.id;drawInk()}
    return !!made;
  }
  async function pastePicture(blob,opts={}){
    if(!isBoardOpen())return false;
    if(!B.live()||!B.writingAllowed('pen')){B.status('You cannot add pictures right now.');return false}
    if(pictureCount()>=C.PICTURES_MAX){B.fail('This page already has '+C.PICTURES_MAX+' pictures. Remove one first.');return false}
    if(blob.size>MAX_PICTURE_BYTES){B.fail('That picture is too large. Copy a smaller screenshot.');return false}
    const clip=window.ClassPointerClipboard;let made;
    try{made=await clip.encodeImage(blob,{maxChars:C.PICTURE_MAX_CHARS-2000,maxSide:1100})}catch(error){B.fail(error&&error.friendly?error.message:'This picture could not be read.');return false}
    if(!isBoardOpen())return false;
    const ok=placePictureData(made.data,made.width,made.height,opts);
    if(ok&&!opts.quiet)B.status('Picture added. Drag it to move it, drag a corner to resize it. Right-click it for layers (front or back of words), copy and cut.');
    return ok;
  }
  // A PDF page as a picture small enough for a board mark (JPEG, shrunk until it fits).
  async function pdfPagePicture(page){
    const base=page.getViewport({scale:1});
    for(const width of [1200,1000,860,720,600,480]){
      const viewport=page.getViewport({scale:width/base.width}),canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      await page.render({canvasContext:ctx,viewport}).promise;
      for(const quality of [.82,.68,.52]){
        const data=canvas.toDataURL('image/jpeg',quality);
        if(data.length<=C.PICTURE_MAX_CHARS-2000){const out={data,width:canvas.width,height:canvas.height};canvas.width=0;return out}
      }
      canvas.width=0;
    }
    return null;
  }
  const UPLOAD_PDF_BYTES=25*1024*1024;
  // One PDF page per slide: the first page goes on the page that is open when it is still empty, every other page on a new page.
  async function uploadPdf(file){
    if(!pdfjs){B.fail('The PDF reader could not load. Refresh the page and try again.');return false}
    if(file.size>UPLOAD_PDF_BYTES){B.fail('That PDF is too big. The biggest PDF you can add is 25 MB.');return false}
    pdfjs.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js?v=3.11.174';
    let loaded;
    try{loaded=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,enableXfa:false}).promise}
    catch(error){B.fail('That PDF could not be opened.');return false}
    const token=opening;
    try{
      const canSlides=!!(Pages&&wbPages),room=canSlides?Pages.MAX_PAGES-wbPages.length+((B.highlights?.()||[]).length===0?1:0):1;
      const count=Math.max(0,Math.min(loaded.numPages,room));
      if(!count){B.status('This whiteboard has no room for more pages.');return false}
      if(count<loaded.numPages)B.status('Only the first '+count+' of '+loaded.numPages+' PDF pages fit on this whiteboard.');
      let firstIndex=null;
      for(let i=1;i<=count;i++){
        if(!isBoardOpen()||opening!==token)return false;
        B.status('Adding PDF page '+i+' of '+count+'…');
        const shot=await pdfPagePicture(await loaded.getPage(i));
        if(!shot){B.fail('PDF page '+i+' is too detailed to put on the whiteboard.');continue}
        const empty=(B.highlights?.()||[]).length===0;
        if(!(i===1&&empty)){
          if(!canSlides){B.status('Only the first page of the PDF was added (this whiteboard has no extra pages).');break}
          if(!await addPage(false))break;
        }
        if(firstIndex===null)firstIndex=wbPages?wbAt:0;
        placePictureData(shot.data,shot.width,shot.height,{fill:true});
      }
      if(canSlides&&firstIndex!==null&&wbAt!==firstIndex)await showPage(firstIndex);
      B.status('PDF added to the whiteboard'+(canSlides&&count>1?' ('+count+' pages, one on each page).':'.'));
      return true;
    }finally{loaded.destroy()}
  }
  let uploadInput=null,uploadBusy=false;
  async function uploadFiles(files){
    if(uploadBusy||!isBoardOpen())return;
    uploadBusy=true;let nudge=0,skipped=0;
    try{
      for(const file of files){
        if(!isBoardOpen())return;
        const name=String(file.name||'');
        if(file.type==='application/pdf'||/\.pdf$/i.test(name))await uploadPdf(file);
        else if(/^image\/(jpeg|png|gif|webp)$/.test(file.type)||/\.(jpe?g|png|gif|webp)$/i.test(name)){await pastePicture(file,{nudge,quiet:files.length>1});nudge+=.03}
        else skipped++;
      }
      if(skipped)B.status('Only jpg, png, gif, webp pictures and PDF files can be uploaded.');
    }finally{uploadBusy=false}
  }
  function openUpload(){
    if(!isBoardOpen()){B.status('Open a whiteboard first, then use Upload.');return}
    if(!uploadInput){
      uploadInput=el('input',null,'board-upload-input');uploadInput.type='file';uploadInput.multiple=true;uploadInput.hidden=true;uploadInput.dataset.stageUi='true';
      uploadInput.accept='image/jpeg,image/png,image/gif,image/webp,application/pdf,.jpg,.jpeg,.png,.gif,.webp,.pdf';
      uploadInput.addEventListener('change',()=>{const chosen=Array.from(uploadInput.files||[]);uploadInput.value='';if(chosen.length)void uploadFiles(chosen)});
      stage.appendChild(uploadInput);
    }
    uploadInput.click();
  }

  // ---------- Copy, Cut and Paste of the picked item (not the whole board) ----------
  // What is picked (a picture, a shape, a pen line, or every line of a block of words) is kept inside the page as well as put on the
  // computer's clipboard, so Paste puts back exactly the same item (pictures with their picture, words with their size and font).
  let itemClip=null,cursorAt=null,pasteHint=null,pastedCount=0;
  const selectedGroup=()=>{const stroke=isBoardOpen()&&selecting()?selectedStroke():null;return stroke?textBlock(stroke):null};
  function pictureBlob(stroke){
    const image=pictureImage(stroke);if(!image)return null;
    const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);
    return new Promise(resolve=>c.toBlob(blob=>{c.width=0;resolve(blob)},'image/png'));
  }
  async function copyItems(cut){
    const group=selectedGroup(),clip=window.ClassPointerClipboard;
    if(!group){B.status('Click an item first (Select tool), then copy or cut it. "Copy board" copies a picture of the whole whiteboard.');return false}
    const id='c'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36);
    itemClip={id,strokes:group.map(item=>({...item})),pasted:0};pastedCount=0;
    // Also on the computer's clipboard, so Ctrl+V and the Paste button know it is the same item: a marker, the words, or the picture.
    const parts={'text/html':new Blob(['<meta charset="utf-8"><span data-ftt-board-clip="'+id+'"></span>'],{type:'text/html'})};
    const words=group[0].tool==='text'?(clip.blockText?.(group)||''):'';
    parts['text/plain']=new Blob([words||' '],{type:'text/plain'});
    if(group.length===1&&group[0].tool==='picture'){const png=await pictureBlob(group[0]);if(png)parts['image/png']=png}
    let wrote=true;
    try{await clip.writeParts(parts)}catch{wrote=false}
    const picked=group[0];
    if(cut){selectedId=null;endSelect(false);eraseBlock(picked)}
    B.status((cut?'Cut. ':'Copied. ')+'Press '+clip.KEY+'+V to paste it'+(wrote?'.':' (inside this whiteboard only: the browser did not let us use the computer clipboard).'));
    return true;
  }
  // The board point to paste at: the right-click spot, else where the mouse is over the board, else slightly down and right of the original.
  function pasteSpot(){
    if(pasteHint&&Date.now()-pasteHint.at<4000){const p=pasteHint.p;pasteHint=null;return p}
    return cursorAt;
  }
  function pasteItems(){
    const c=itemClip;if(!c||!isBoardOpen())return false;
    if(!B.live()||!B.writingAllowed('pen')){B.status('You cannot add to the whiteboard right now.');return false}
    const pts=c.strokes.flatMap(item=>item.points),xs=pts.map(q=>q.x),ys=pts.map(q=>q.y);
    const x1=Math.min(...xs),x2=Math.max(...xs),y1=Math.min(...ys),y2=Math.max(...ys),spot=pasteSpot();
    pastedCount++;let dx,dy;
    if(spot){dx=spot.x-(x1+x2)/2;dy=spot.y-(y1+y2)/2}else{dx=.03*pastedCount;dy=.03*pastedCount*(W/Math.max(1,H))}
    dx=Math.max(-x1,Math.min(1-x2,dx));dy=Math.max(-y1,Math.min(1-y2,dy));
    const block=c.strokes[0].tool==='text'?newBlockId():null,before=new Set((B.highlights?.()||[]).map(item=>item.id));
    for(const item of c.strokes){
      const {id,owner,ref,...rest}=item;
      B.submitStroke({...rest,points:item.points.map(q=>({x:Math.max(0,Math.min(1,q.x+dx)),y:Math.max(0,Math.min(1,q.y+dy))})),...(block&&item.tool==='text'?{block}:{})});
    }
    const added=(B.highlights?.()||[]).filter(item=>!before.has(item.id));
    if(!added.length)return false;
    if(selecting()){selectedId=added[0].id;drawInk()}
    B.status('Pasted. Drag it where you want it.');
    return true;
  }
  // ---------- Layers ----------
  const LAYER_WORDS={front:'Brought to the front.',forward:'Brought forward one layer.',backward:'Sent back one layer.',back:'Sent to the back.'};
  function arrange(how){
    const group=selectedGroup();if(!group){B.status('Pick a picture, shape or words first (Select tool).');return false}
    const moved=B.reorderMarks?.(group.map(item=>item.id),how);
    B.status(moved?LAYER_WORDS[how]:(how==='front'||how==='forward'?'It is already on top.':'It is already at the bottom.'));
    drawInk();return !!moved;
  }
  function syncArrange(){
    if(!arrangeBox)return;
    arrangeBox.hidden=!(isBoardOpen()&&selecting()&&selectedStroke());
  }
  // ---------- Right-click menu (on the whiteboard only) ----------
  let boardMenu=null;
  function closeBoardMenu(){if(boardMenu){boardMenu.remove();boardMenu=null}}
  function showBoardMenu(event){
    closeBoardMenu();
    const group=selectedGroup(),has=!!group,menu=el('div',null,'board-ctx-menu');menu.dataset.stageUi='true';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Whiteboard');
    const add=(label,run,disabled)=>{const b=el('button',null,'board-ctx-item',label);b.type='button';b.setAttribute('role','menuitem');b.disabled=!!disabled;b.addEventListener('click',()=>{closeBoardMenu();run()});menu.appendChild(b)};
    const sep=()=>menu.appendChild(el('div',null,'board-ctx-sep'));
    const clip=window.ClassPointerClipboard,spot=normalized(event);
    add('Cut',()=>void copyItems(true),!has);
    add('Copy',()=>void copyItems(false),!has);
    add('Paste',()=>{pasteHint=spot?{p:spot,at:Date.now()}:null;if(clip)void clip.pasteInto(clipTarget)},!clip);
    if(has){sep();for(const [how,,title] of [['front',0,'Bring to Front'],['forward',0,'Bring Forward'],['backward',0,'Send Backward'],['back',0,'Send to Back']])add(title,()=>arrange(how))}
    for(const type of ['pointerdown','pointerup','click','dblclick','wheel','contextmenu'])menu.addEventListener(type,e=>{e.stopPropagation();if(type==='contextmenu')e.preventDefault()});
    stage.appendChild(menu);boardMenu=menu;
    const r=stage.getBoundingClientRect(),mw=menu.offsetWidth,mh=menu.offsetHeight;
    menu.style.left=Math.max(4,Math.min(event.clientX-r.left,r.width-mw-4))+'px';menu.style.top=Math.max(4,Math.min(event.clientY-r.top,r.height-mh-4))+'px';
    menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  if(isTeacher){
    scroller.addEventListener('contextmenu',event=>{
      if(!isBoardOpen())return;
      // Typing boxes keep the browser's own menu (spelling, paste of words). Everywhere else on the board gets ours.
      if(event.target?.closest?.('textarea,input'))return;
      event.preventDefault();event.stopPropagation();
      const p=normalized(event),hit=p?teacherMarkAt(event,p,true,true):null;
      if(hit){window.FTTAnnotate?.select?.('select');selectedId=hit.id}else selectedId=null;
      drawInk();showBoardMenu(event);
    });
    document.addEventListener('pointerdown',event=>{if(boardMenu&&!boardMenu.contains(event.target))closeBoardMenu()},true);
    document.addEventListener('keydown',event=>{if(boardMenu&&event.key==='Escape'){event.preventDefault();closeBoardMenu()}},true);
    for(const type of ['blur','resize'])window.addEventListener(type,closeBoardMenu);
    scroller.addEventListener('scroll',closeBoardMenu);
    // Where the mouse is over the board (Paste with Ctrl+V drops the item there).
    content.addEventListener('pointermove',event=>{cursorAt=normalized(event)});
    content.addEventListener('pointerleave',()=>{cursorAt=null});
  }
  // Undo takes back the newest thing the teacher did. A pasted picture counts: it is removed when no pen mark
  // was made after it. (Otherwise Undo removes that newer mark, as always.)
  function lastTeacherMark(){const mine=B.highlights().filter(s=>s.owner==='teacher');return mine.length?mine[mine.length-1].id:null}
  function undoPicture(){
    const editing=pictureEdits.length>0,last=editing?pictureEdits[pictureEdits.length-1]:boardPictures[boardPictures.length-1];
    if(!isBoardOpen()||!last||last.after!==lastTeacherMark())return false;
    if(editing){last.el.remove();pictureEdits.pop();if(!pictureEdits.length)finishPictureEdit()}
    else{boardPictures.pop();publishBoard().then(updateControls)}
    B.status('Picture removed.');
    return true;
  }
  // ---------- Paste and Copy on the teacher whiteboard (board-clipboard.js) ----------
  // Pictures stay movable board images. Words remain text marks, so they can be edited and rendered accessibly.
  const clipTarget={priority:0,say:text=>B.status(text),
    active:()=>isBoardOpen()&&!window.ClassPointerBoards?.workspace?.(),
    async paste(payload){
      const clip=window.ClassPointerClipboard;
      if(payload.kind==='item'){
        if(itemClip&&itemClip.id===payload.id){pasteItems();return}
        B.status('That item was copied in another window. Copy it again here.');return;
      }
      if(payload.kind==='image'){await pastePicture(payload.blob);return}
      if(!B.live()||!B.writingAllowed()){B.status('You cannot add whiteboard text right now.');return}
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='100px sans-serif';
      // The biggest size at which the words fit the board without wrapping. Only words that do not fit even
      // at the smallest size are wrapped (at the middle size, so they stay readable).
      let made=null;
      const chosen=labelOfSize(textSize),steps=[chosen,...[...TEXT_LABELS].reverse().filter(label=>label<chosen&&label>=TEXT_FLOOR)];
      for(const label of steps){const tried=flow(payload.text,{size:label===chosen?textSize:sizeOfLabel(label),color:PASTE_INK,bold:textBold,font:textFont,align:textAlign||undefined,center:{x:.5,y:.5}});if(tried.strokes.length&&!tried.cut&&!tried.strokes.some(line=>line.soft)){made=tried;break}}
      if(!made)made=flow(payload.text,{size:sizeOfLabel(Math.min(chosen,Math.max(TEXT_FLOOR,steps[steps.length-1]))),color:PASTE_INK,bold:textBold,font:textFont,align:textAlign||undefined,center:{x:.5,y:.5}});
      let added=0;for(const stroke of made.strokes){B.submitStroke(stroke);added++}
      if(!added){B.status('No whiteboard text could be added.');return}
      B.status((payload.cut||made.cut)?clip.MSG.textCut:'Words pasted. To change them, choose 🖱️ Select on the toolbar and click the words: pick a color or a size, drag a corner or a side, or click them again to type in them.');
    },
    // Copy and Cut act on the picked item only. (Copy board, the button, copies a picture of the whole board.)
    async copy(){await copyItems(false)},
    async cut(){await copyItems(true)},
    // Nothing on the computer's clipboard that we know, but an item was copied inside the page (the browser blocked the clipboard): paste it.
    pasteEmpty(){if(!itemClip)return false;pasteItems();return true},
    async copyWhole(){
      const clip=window.ClassPointerClipboard;
      await clip.copyImage(exportPng());
      B.status('Copied a picture of the whole whiteboard. Press '+clip.KEY+'+V to paste it somewhere.');
    }};
  // A PNG picture of the whole whiteboard: pictures and everyone's marks.
  function exportPng(){
    if(!isBoardOpen())return Promise.reject(Error('The whiteboard is not open.'));
    const c=boardCanvas();
    return whenPictures(strokes).then(()=>{paintInk(c.getContext('2d'),c,strokes,c.width,c.height);return new Promise((resolve,reject)=>c.toBlob(blob=>{c.width=0;blob?resolve(blob):reject(Error('Could not make a picture of the whiteboard.'))},'image/png'))});
  }
  // ---------- Whiteboard pages (slides) ----------
  // The teacher can add, copy, delete and reorder pages, jump between them, and see a small picture of each. Only the
  // teacher's whiteboard has pages here; students see the page the teacher shows, exactly as they see pictures and marks.
  function newWbPage(){return{id:Pages.newId(),pictures:[],strokes:[],thumb:''}}
  const cloneStrokes=list=>JSON.parse(JSON.stringify(list||[]));
  // Copy what is on the lesson screen into the list entry of the page being shown.
  function capturePage(){
    if(!Pages||!wbPages||!wbPages[wbAt])return;
    const page=wbPages[wbAt];
    page.pictures=[...boardPictures,...pictureEdits.map(item=>({image:item.image,x:item.x,y:item.y,w:item.w,h:item.h,after:item.after}))];
    page.strokes=cloneStrokes(B.highlights?.());
  }
  // Put a page of the list on the lesson screen for everyone: its pictures first, then its marks.
  async function loadPage(index){
    const page=wbPages[index];
    selectedId=null;finishInline(true);
    boardPictures=page.pictures.slice();
    await publishBoard();
    if(!isBoardOpen())return;
    B.restoreMarks(page.strokes);
    if(boardPresentation){try{boardBackground=new Image();boardBackground.src=composeBoard()}catch(_){}}
    updateControls();
  }
  async function guardedPageChange(change){
    if(!Pages||!wbPages||wbSwitching||!isBoardOpen())return false;
    wbSwitching=true;
    try{
      if(pictureEdits.length)finishPictureEdit();
      capturePage();
      await change();
      return true;
    }catch(error){B.fail(error?.message||'Could not change the page.');return false}
    finally{wbSwitching=false;renderPages(true)}
  }
  const showPage=index=>!wbPages||index===wbAt||index<0||index>=wbPages.length?Promise.resolve(false):guardedPageChange(async()=>{wbAt=index;await loadPage(index)});
  function addPage(copy){
    if(!Pages||!wbPages)return Promise.resolve(false);
    if(wbPages.length>=Pages.MAX_PAGES){B.status('A whiteboard can have up to '+Pages.MAX_PAGES+' pages.');return Promise.resolve(false)}
    return guardedPageChange(async()=>{
      const from=wbPages[wbAt],page=newWbPage();
      if(copy){page.pictures=from.pictures.slice();page.strokes=cloneStrokes(from.strokes)}
      wbPages=Pages.insert(wbPages,wbAt+1,page);wbAt=wbPages.indexOf(page);
      await loadPage(wbAt);
      B.status((copy?'Page copied. ':'New blank page. ')+'This is page '+(wbAt+1)+' of '+wbPages.length+'.');
    });
  }
  function deletePage(id){
    if(!Pages||!wbPages)return Promise.resolve(false);
    if(wbPages.length<=1){B.status('A whiteboard needs at least one page. Use Clear to empty it.');return Promise.resolve(false)}
    const at=wbPages.findIndex(page=>page.id===id);
    if(at<0)return Promise.resolve(false);
    if(!confirm('Delete page '+(at+1)+'? You cannot get it back.'))return Promise.resolve(false);
    return guardedPageChange(async()=>{
      const shownId=wbPages[wbAt].id,place=Pages.after(wbPages,id),next=Pages.remove(wbPages,id);
      if(shownId!==id){wbPages=next;wbAt=wbPages.findIndex(page=>page.id===shownId);return}
      wbPages=next;wbAt=place;
      await loadPage(wbAt);
    });
  }
  // Move a page to a new place (the page being shown stays on screen).
  function movePage(id,to){
    if(!Pages||!wbPages)return Promise.resolve(false);
    return guardedPageChange(async()=>{
      const shownId=wbPages[wbAt].id;
      wbPages=Pages.move(wbPages,id,to);wbAt=wbPages.findIndex(page=>page.id===shownId);
    });
  }
  // A page painted at any width: its pictures, then its marks. `list` is the page's own marks.
  function paintPage(canvas,pictures,list){
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingQuality='high';
    for(const p of pictures)ctx.drawImage(p.image,p.x*canvas.width,p.y*canvas.height,p.w*canvas.width,p.h*canvas.height);
    paintInk(ctx,canvas,list||[],canvas.width,canvas.height);
  }
  function pageCanvas(page,width,live){
    const c=document.createElement('canvas');c.width=width;c.height=Math.max(1,Math.round(width*boardSize.h/boardSize.w));
    paintPage(c,live?boardPictures:page.pictures,live?strokes:page.strokes);
    return c;
  }
  // One PNG per page, full size, in page order (for Send to class). `only` = just that page number (1 up).
  async function exportPagePngs(only){
    if(!isBoardOpen())throw Error('The whiteboard is not open.');
    if(!Pages||!wbPages)return[await exportPng()];
    capturePage();
    const blobs=[];
    for(let i=0;i<wbPages.length;i++){
      if(only&&only-1!==i)continue;
      await whenPictures(i===wbAt?strokes:wbPages[i].strokes);
      const c=pageCanvas(wbPages[i],boardSize.w,i===wbAt);
      blobs.push(await new Promise((resolve,reject)=>c.toBlob(blob=>{c.width=0;blob?resolve(blob):reject(Error('Could not make a picture of page '+(i+1)+'.'))},'image/png')));
    }
    return blobs;
  }
  function pagesInfo(){return isBoardOpen()&&Pages&&wbPages?{count:wbPages.length,current:wbAt}:null}
  // The strip: previous / next, "Page 2 of 4", New page, and a panel of small pictures to jump to, copy, delete or move a page.
  function pageSignature(){
    const last=strokes[strokes.length-1];
    return[wbAt,wbPages?.map(p=>p.id).join(','),boardPictures.length,strokes.length,last?.id,last?.points?.length,boardSize?.h].join('|');
  }
  function buildPagesBar(){
    pagesBar=el('div',null,'board-pages-bar');pagesBar.dataset.stageUi='true';pagesBar.setAttribute('role','toolbar');pagesBar.setAttribute('aria-label','Whiteboard pages');
    pagesPanel=el('div',null,'board-pages-panel');pagesPanel.hidden=true;
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','click','dblclick','wheel','keydown','keyup'])pagesBar.addEventListener(type,event=>event.stopPropagation());
    stage.appendChild(pagesBar);
  }
  function renderPages(force){
    if(!isTeacher)return;
    if(!pagesInfo()){if(pagesBar)pagesBar.hidden=true;clearInterval(pagesTimer);pagesTimer=0;return}
    if(!pagesBar)buildPagesBar();
    pagesBar.hidden=false;
    if(!pagesTimer)pagesTimer=setInterval(()=>renderPages(false),1500);
    const sig=pageSignature()+'|'+pagesPanelOpen+'|'+wbSwitching;
    if(!force&&sig===pagesSig)return;
    pagesSig=sig;
    const n=wbPages.length,busy=wbSwitching;
    const btn=(text,title,onClick,cls,disabled)=>{const b=el('button',null,cls||'pdf-btn',text);b.type='button';b.title=title;b.disabled=!!disabled;b.addEventListener('click',onClick);return b};
    const row=el('div',null,'board-pages-row');
    row.append(
      btn('◀','Previous page',()=>void showPage(wbAt-1),'pdf-btn board-pages-step',busy||wbAt===0),
      el('span',null,'board-pages-label','Page '+(wbAt+1)+' of '+n),
      btn('▶','Next page',()=>void showPage(wbAt+1),'pdf-btn board-pages-step',busy||wbAt>=n-1),
      btn('＋ New page','Add a blank page after this one',()=>void addPage(false),'pdf-btn',busy||n>=Pages.MAX_PAGES),
      btn(pagesPanelOpen?'▾ Pages':'▴ Pages','Show small pictures of every page, to jump to, copy, delete or move a page',()=>{pagesPanelOpen=!pagesPanelOpen;renderPages(true)},'pdf-btn'));
    pagesBar.replaceChildren(row,pagesPanel);
    pagesPanel.hidden=!pagesPanelOpen;
    if(!pagesPanelOpen)return;
    pagesPanel.replaceChildren();
    wbPages.forEach((page,i)=>{
      const card=el('div',null,'board-page-card'+(i===wbAt?' current':''));card.draggable=!busy;
      const img=el('img');img.alt='Page '+(i+1);img.draggable=false;
      try{img.src=pageCanvas(page,160,i===wbAt).toDataURL('image/jpeg',0.7)}catch(_){}
      const open=el('button',null,'board-page-open');open.type='button';open.title='Go to page '+(i+1);open.disabled=busy;open.append(img,el('span',null,'board-page-num',String(i+1)));
      open.addEventListener('click',()=>void showPage(i));
      const tools=el('div',null,'board-page-tools');
      const small=(text,title,onClick,disabled)=>{const b=el('button',null,'board-page-tool',text);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.disabled=!!disabled||busy;b.addEventListener('click',onClick);return b};
      tools.append(
        small('◀','Move this page earlier',()=>void movePage(page.id,i-1),i===0),
        small('▶','Move this page later',()=>void movePage(page.id,i+1),i===n-1),
        small('⧉','Copy this page',()=>{void showPage(i).then(()=>addPage(true))},n>=Pages.MAX_PAGES),
        small('🗑','Delete this page',()=>void deletePage(page.id),n<=1));
      card.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',page.id);event.dataTransfer.effectAllowed='move'});
      card.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='move'});
      card.addEventListener('drop',event=>{event.preventDefault();const id=event.dataTransfer.getData('text/plain');if(id&&id!==page.id)void movePage(id,i)});
      card.append(open,tools);pagesPanel.append(card);
    });
  }
  function syncPagesBar(){renderPages(false)}

  // ---------- Save and restore (used by "Save whiteboard") ----------
  const SAVED_PICTURE=700000;
  // A loaded picture as a data: URL of at most maxChars (shrunk until it fits), or null.
  function imageToData(image,maxChars){
    let side=1100;
    for(let attempt=0;attempt<6;attempt++,side=Math.round(side*.75)){
      const scale=Math.min(1,side/Math.max(image.naturalWidth,image.naturalHeight)),c=document.createElement('canvas');
      c.width=Math.max(1,Math.round(image.naturalWidth*scale));c.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
      for(const quality of [.82,.66,.5]){const data=c.toDataURL('image/jpeg',quality);if(data.length<=maxChars){c.width=0;return data}}
      c.width=0;
    }
    return null;
  }
  function savedPicture(image){
    const scale=Math.min(1,1400/Math.max(image.naturalWidth,image.naturalHeight)),c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(image.naturalWidth*scale));c.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
    let data='';
    for(const quality of [0.85,0.7,0.5,0.3]){data=c.toDataURL('image/jpeg',quality);if(data.length<=SAVED_PICTURE)break}
    c.width=0;return data.length<=SAVED_PICTURE?data:null;
  }
  // Everything needed to rebuild the teacher whiteboard: its pictures (also ones still being placed) and all marks.
  // Marks keep only "teacher" or "student" as their maker; no connection ids are saved.
  // Marks keep only "teacher" or "student" as their maker; no connection ids are saved.
  function savedStrokes(list){
    return(list||[]).map(s=>({owner:s.owner==='teacher'?'teacher':'student',tool:s.tool,color:s.color,size:s.size,points:s.points.map(p=>({x:p.x,y:p.y})),...(s.tool==='text'?{text:s.text,...(s.bold===true?{bold:true}:{}),...(s.font&&s.font!=='sans'?{font:s.font}:{}),...(C.TEXT_ALIGNS.includes(s.align)?{align:s.align}:{})}:{}),...(s.tool==='picture'&&s.image?{image:s.image}:{}),...(s.fill===true?{fill:true}:{})}));
  }
  function savedPictures(list){
    const out=[];
    for(const p of list||[]){const data=savedPicture(p.image);if(data)out.push({data,x:p.x,y:p.y,w:p.w,h:p.h})}
    return out;
  }
  async function exportWhiteboard(){
    if(!isBoardOpen())return null;
    const size={w:boardSize.w,h:boardSize.h};
    if(!Pages||!wbPages||wbPages.length===1){
      return{version:1,kind:'lesson-whiteboard',size,pictures:savedPictures([...boardPictures,...pictureEdits]),strokes:savedStrokes(B.highlights())};
    }
    capturePage();
    const pages=wbPages.map(page=>({pictures:savedPictures(page.pictures),strokes:savedStrokes(page.strokes)}));
    return{...Pages.wrap('lesson-whiteboard',pages,wbAt),size};
  }
  // Opens the whiteboard exactly as the Whiteboard button does, then puts the saved pictures and marks back for
  // everyone. Saved data is checked as strictly as anything from the network. A one-page (version 1) file opens as one page.
  async function importWhiteboard(saved){
    const data=isTeacher?window.ClassPointerClipboard?.cleanLessonBoard(saved,C.cleanStroke):null,open=$('openWhiteboard');
    if(!data||!open||open.disabled||!B.restoreMarks)return false;
    const before=docId;open.click();
    for(let i=0;i<150&&!(isBoardOpen()&&docId!==before);i++)await sleep(100);
    if(!isBoardOpen()||docId===before)return false;
    const board=docId,pages=[];
    for(const saved of data.pages){
      // Pictures saved before pictures became marks come back as picture marks at the very back (below every word and shape).
      const legacy=[];
      for(const p of saved.pictures){
        let image=null;try{image=await loadPicture(p.data)}catch{}
        if(!isBoardOpen()||docId!==board)return false;
        const data=image&&imageToData(image,C.PICTURE_MAX_CHARS-2000);
        if(data){const k=Math.min(1,1/p.w,1/p.h),w=p.w*k,h=p.h*k,x=P.clamp(p.x,0,1-w),y=P.clamp(p.y,0,1-h);legacy.push({owner:'teacher',tool:'picture',color:'#1f2937',size:.016,points:[{x,y},{x:x+w,y:y+h}],image:data})}
      }
      pages.push({id:Pages?Pages.newId():'pg',pictures:[],strokes:[...legacy,...saved.strokes],thumb:''});
    }
    if(Pages){wbPages=pages;wbAt=data.current}
    boardPictures=pages[data.current].pictures.slice();
    if(boardPictures.length)await publishBoard();
    if(!isBoardOpen())return false;
    B.restoreMarks(pages[data.current].strokes);updateControls();
    return true;
  }
  if(isTeacher){
    const hookClipboard=()=>{window.ClassPointerClipboard?.register(clipTarget);updateControls()};
    if(window.ClassPointerClipboard)hookClipboard();else document.addEventListener('class-pointer-clipboard-ready',hookClipboard,{once:true});
    // Undo (the lesson's button, the drawing toolbar and its Ctrl+Z all click this button) also takes back a pasted picture.
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('#undoTeacherHighlight')&&undoPicture()){event.preventDefault();event.stopImmediatePropagation()}
    },true);
    document.addEventListener('keydown',event=>{
      if(!pictureEdits.length||event.target?.closest?.('input,textarea,select,[contenteditable]'))return;
      if(event.key==='Enter'){event.preventDefault();finishPictureEdit()}
      else if((event.key==='Delete'||event.key==='Backspace')){
        const item=pictureEdits.find(other=>other.el.classList.contains('selected'));
        if(item){event.preventDefault();item.el.remove();pictureEdits=pictureEdits.filter(other=>other!==item);if(!pictureEdits.length)finishPictureEdit()}
      }
      // Arrow keys move the picked picture 1 pixel (Shift: 10). With the arrow tool the picture goes back on the board
      // for the class a moment after the last key, like a finished drag; with Move pictures it waits for ✓ Show to class.
      else if(NUDGE[event.key]&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        const item=pictureEdits.find(other=>other.el.classList.contains('selected')),step=item&&nudgeFractions(NUDGE[event.key],event.shiftKey?10:1);
        if(!item||!step)return;
        event.preventDefault();event.stopPropagation();
        item.x=P.clamp(item.x+step.x,-item.w*0.8,1-item.w*0.2);item.y=P.clamp(item.y+step.y,-item.h*0.8,1-item.h*0.2);placeEditElement(item);
        clearTimeout(pictureNudgeTimer);
        if(selecting())pictureNudgeTimer=setTimeout(()=>{if(selecting()&&pictureEdits.includes(item))finishPictureEdit()},400);
      }
    });
  }

  // ---------- Wiring ----------
  if(isTeacher){
    const file=$('pdfFile'),open=$('openPdf');
    if(open&&file){open.addEventListener('click',()=>file.click());file.addEventListener('change',()=>{const chosen=file.files&&file.files[0];file.value='';if(chosen)openFile(chosen)})}
    const dialog=$('webpageDialog'),webFile=$('webpageFile');
    $('openWebpage')?.addEventListener('click',()=>dialog.showModal());
    $('cancelWebpage')?.addEventListener('click',()=>dialog.close());
    $('webpageForm')?.addEventListener('submit',event=>{event.preventDefault();const url=$('webpageUrl').value;dialog.close();openWebpage(url)});
    $('chooseWebpageFile')?.addEventListener('click',()=>webFile.click());
    webFile?.addEventListener('change',()=>{const chosen=webFile.files?.[0];webFile.value='';if(chosen){dialog.close();openWebpage(null,chosen)}});
  }
  // Teacher leaves My screen (Student screens): stop showing the document to the class but remember exactly what it was,
  // so Resume presenting can bring back the same whiteboard (pictures and marks), PDF page or webpage.
  async function suspendDoc(){
    if(!isTeacher||!lay||scroller.hidden)return false;
    let snap=null;
    if(isBoardOpen()){const saved=await exportWhiteboard();if(saved)snap={kind:'board',saved}}
    else if(lastOpen)snap={...lastOpen,page:webMode?0:currentPage(),top:scroller.scrollTop,left:scroller.scrollLeft};
    if(!snap)return false;
    held=snap;closePdf(true);return true;
  }
  async function resumeHeld(){
    const s=held;held=null;
    if(!s||!isTeacher)return false;
    if(s.kind==='board')return importWhiteboard(s.saved);
    if(s.kind==='pdf'){const ok=await openFile(s.file);if(ok===false||!lay)return false;if(s.page)goToPage(s.page);return true}
    if(s.kind==='web'){await openWebpage(s.source,s.file);if(!lay)return false;scroller.scrollTop=s.top;scroller.scrollLeft=s.left;return true}
    if(s.kind==='snap')return !!(await openSnapshot(...s.args));
    return false;
  }
  window.ClassPointerPdf={
    suspend:suspendDoc,resumeHeld,hasHeld:()=>!!held,discardHeld:()=>{held=null},
    active:()=>!!lay&&!scroller.hidden,box,normalized,handleMessage,setStrokes,activityPoint,activityTextScale,activityBoardBox,activityMarks,recolorSelected,resizeSelected,setFill,fillSelected,pickedShape,
    openFile,currentPage,goToPage,
    getLayout:()=>({spread:layoutOpts.spread,rtl:layoutOpts.rtl,shift:layoutOpts.shift}),
    setLayout:opts=>changeLayout(opts),
    studentJoined:member=>{if(isTeacher&&docId&&(bytes||paged))deliver(member)},
    close:closePdf,openSnapshot,reset:studentReset,isOpen:()=>!!lay,
    pastePicture,openUpload,uploadFiles,arrange,boardPictureCount:()=>boardPictures.length+pictureEdits.length+pictureCount(),
    pagesInfo,exportPagePngs,showPage,addPage,
    exportWhiteboard,importWhiteboard,exportPng,boardRatio,
    presentationStream:()=>boardPresentation
  };
})();
