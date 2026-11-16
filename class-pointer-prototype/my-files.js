'use strict';
// My files (student page): everything a student has saved, in a grid of picture tiles or a list.
//   • Grouped by date (Today, Yesterday, Earlier this week, Last week, Older), or sorted by name, type or subject.
//   • The student's own folders (drag a file onto a folder, or use Move to folder), All files, and Starred.
//   • One Open button for every kind of file. A worksheet is ONE item: the teacher's PDF, the student's copy and their
//     filled-in pictures are merged, and Open continues where they left off.
//   • "From my teacher" marks what the teacher sent; a subject marks what came from a subject folder.
// The rules (items, groups, sorting, folders, stars) are in my-files-core.js. Storage, sign-in checks and the saved
// files come from saved-work.js. PDFs open in a small reader that remembers the page and zoom for each PDF.
(function(){
  const Core=window.FTTSavedWorkCore,Saved=window.FTTSavedWork,M=window.FTTMyFilesCore;
  if(!Core||!Saved||!M)return;
  const {store,ui}=Saved,$=id=>document.getElementById(id);
  const FA=window.FTTAnnotate;
  // A worksheet being filled in: this student's own PDF copy and their marks per page ({1:[mark,...],2:[...]}).
  let fill=null,allFiles=[],allSheets=[];
  const page={say(text){$('filesStatus').textContent=text||''},fail(error){$('filesStatus').textContent=Core.errorText(error)}};
  let state={folders:{},saveTarget:null};   // the teacher's class folders
  let prefs=M.emptyPrefs(),items=[],view={type:'all'};

  // The view (grid or list) and the sort are remembered in this browser, for the student who is signed in.
  const who=()=>{try{return sessionStorage.getItem('b3Games_studentId')||'device'}catch(_){return 'device'}};
  const remembered=(name,fallback,allowed)=>{try{const value=localStorage.getItem('fttMyFiles:'+who()+':'+name);return allowed.includes(value)?value:fallback}catch(_){return fallback}};
  const remember=(name,value)=>{try{localStorage.setItem('fttMyFiles:'+who()+':'+name,value)}catch(_){}};
  let mode=remembered('view','grid',['grid','list']),sort=remembered('sort','date',['date','name','type','subject']);

  async function refresh(){
    page.say('Loading…');
    try{
      const [files,folders,sheets,raw]=await Promise.all([store.list(),store.folders().catch(()=>state),Saved.worksheets.list().catch(()=>[]),store.prefs().catch(()=>null)]);
      state=folders;allFiles=files;allSheets=sheets;prefs=M.cleanPrefs(raw);
      $('addPdf').hidden=false;$('newFolder').hidden=false;page.say('');
      render();
    }catch(error){$('filesList').replaceChildren();page.fail(error)}
  }

  // ---------- Settings (folders and stars): shown at once, saved a moment later ----------
  let saveChain=Promise.resolve();
  function changePrefs(result){
    if(result.error){page.say(result.error);return false}
    prefs=result.prefs;render();
    const snapshot=M.prune(prefs,items);
    saveChain=saveChain.then(()=>store.savePrefs(snapshot)).catch(error=>page.fail(error));
    return true;
  }
  const moveItem=(item,folderId)=>changePrefs(M.moveItem(prefs,item.key,folderId));
  const toggleStar=item=>changePrefs(M.setStar(prefs,item.key,!item.starred));

  // ---------- Drawing the page ----------
  function render(){
    items=M.buildItems(allFiles,allSheets,prefs);
    if(view.type==='folder'&&!prefs.folders.some(folder=>folder.id===view.id))view={type:'all'};
    if(view.type==='class'&&!state.folders[view.id])view={type:'all'};
    for(const [id,value] of [['viewGrid','grid'],['viewList','list']])$(id).setAttribute('aria-pressed',String(mode===value));
    $('sortBy').value=sort;
    renderNav();renderList();
  }
  const dateText=time=>{try{return new Date(time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}catch(_){return ''}};
  const countIn=filter=>M.filterItems(items,filter).length;
  const same=(a,b)=>a.type===b.type&&(a.id||'')===(b.id||'');

  function navButton(label,count,target){
    const active=same(view,target),button=ui.h('button','mf-nav-item'+(active?' active':''));
    button.type='button';button.setAttribute('aria-current',String(active));
    button.append(ui.h('span','mf-nav-name',label),ui.h('span','mf-nav-count',String(count)));
    button.addEventListener('click',()=>{view=target;render()});
    return button;
  }
  // A folder button is also a place to drop a file.
  function dropTarget(node,folderId,hint){
    node.title=hint;
    node.addEventListener('dragover',event=>{event.preventDefault();node.classList.add('over')});
    node.addEventListener('dragleave',()=>node.classList.remove('over'));
    node.addEventListener('drop',event=>{
      event.preventDefault();node.classList.remove('over');
      const item=items.find(entry=>entry.key===event.dataTransfer.getData('text/plain'));
      if(item)moveItem(item,folderId);
    });
  }
  function renderNav(){
    const nav=$('mfNav');nav.replaceChildren();
    const all=navButton('All files',items.length,{type:'all'});
    dropTarget(all,'','Drop a file here to take it out of its folder');
    nav.append(all,navButton('⭐ Starred',countIn({type:'starred'}),{type:'starred'}));
    if(prefs.folders.length)nav.append(ui.h('h3','mf-nav-title','My folders'));
    for(const folder of prefs.folders){
      const row=ui.h('div','mf-folder'),open=navButton('📁 '+folder.name,countIn({type:'folder',id:folder.id}),{type:'folder',id:folder.id});
      dropTarget(open,folder.id,'Drop a file here to put it in "'+folder.name+'"');
      const rename=ui.button('✎',()=>renameFolder(folder),'mf-mini');rename.title='Rename this folder';rename.setAttribute('aria-label','Rename folder '+folder.name);
      const remove=ui.button('🗑',()=>deleteFolder(folder),'mf-mini');remove.title='Delete this folder (its files are kept)';remove.setAttribute('aria-label','Delete folder '+folder.name);
      row.append(open,rename,remove);nav.append(row);
    }
    const classFolders=Core.folderOptions(state);
    if(classFolders.length){
      nav.append(ui.h('h3','mf-nav-title','Class folders'));
      for(const option of classFolders)nav.append(navButton('📁 '+option.label,countIn({type:'class',id:option.id}),{type:'class',id:option.id}));
    }
  }
  function viewTitle(){
    if(view.type==='starred')return '⭐ Starred';
    if(view.type==='folder')return '📁 '+(prefs.folders.find(folder=>folder.id===view.id)?.name||'');
    if(view.type==='class')return '📁 '+Core.folderLabel(state,view.id);
    return 'All files';
  }
  function emptyText(){
    if(view.type==='starred')return 'Nothing is starred yet. Press ☆ on a file to star it.';
    if(view.type==='folder')return 'This folder is empty. Drag a file here, or press ⋯ then Move to folder.';
    if(view.type==='class')return 'Nothing is in this class folder.';
    return 'Nothing saved yet.';
  }
  function renderList(){
    const box=$('filesList');box.replaceChildren();
    $('viewTitle').textContent=viewTitle();
    const groups=M.arrange(M.filterItems(items,view),{sort,pin:view.type!=='starred'});
    if(!groups.length){box.append(ui.h('p','ftt-saved-note',emptyText()));return}
    for(const group of groups){
      if(group.label)box.append(ui.h('h3','mf-group',group.label));
      const wrap=ui.h('div','mf-items mf-'+mode);
      for(const item of group.items)wrap.append(itemNode(item));
      box.append(wrap);
    }
  }
  const thumbs=new Map();let thumbChain=Promise.resolve();
  // Small pictures load one at a time after the page is shown; a missing picture just leaves the icon.
  function loadThumb(file,box){
    const put=blob=>{const image=document.createElement('img');image.alt='';image.src=URL.createObjectURL(blob);image.addEventListener('load',()=>URL.revokeObjectURL(image.src));box.replaceChildren(image)};
    if(thumbs.has(file.id)){put(thumbs.get(file.id));return}
    thumbChain=thumbChain.then(async()=>{
      const blob=await store.picture(file);
      if(!blob)return;
      thumbs.set(file.id,blob);
      if(box.isConnected)put(blob);
    }).catch(()=>{});
  }
  function itemNode(item){
    const node=ui.h('article','mf-item mf-'+item.kind);node.draggable=true;node.dataset.key=item.key;
    node.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',item.key);event.dataTransfer.effectAllowed='move';node.classList.add('dragging')});
    node.addEventListener('dragend',()=>node.classList.remove('dragging'));
    const thumb=ui.h('div','mf-thumb',item.kind==='worksheet'?'📋':item.kind==='pdf'?'📄':'📝');thumb.setAttribute('aria-hidden','true');
    if(item.picture)loadThumb(item.picture,thumb);
    const meta=ui.h('div','mf-meta'),tags=ui.h('div','mf-tags');
    if(item.fromTeacher)tags.append(ui.h('span','mf-badge','From my teacher'));
    if(item.subject)tags.append(ui.h('span','mf-subject',item.subject));
    tags.append(ui.h('span','mf-type',M.typeLabel(item.kind)));
    if(item.status)tags.append(ui.h('span','mf-status'+(item.status==='New'?' new':''),item.status));
    meta.append(ui.h('strong','mf-name',item.name),tags,ui.h('small','mf-date',item.time?dateText(item.time):''));
    const actions=ui.h('div','mf-actions');
    const star=ui.button(item.starred?'★':'☆',()=>toggleStar(item),'mf-star'+(item.starred?' on':''));
    star.setAttribute('aria-pressed',String(item.starred));star.title=item.starred?'Starred. Press to unstar.':'Press to star';star.setAttribute('aria-label',(item.starred?'Unstar ':'Star ')+item.name);
    const more=document.createElement('details');more.className='mf-more';
    const summary=document.createElement('summary');summary.textContent='⋯';summary.title='More';summary.setAttribute('aria-label','More for '+item.name);
    const menu=ui.h('div','mf-menu');
    const entry=(label,run,cls)=>{const button=ui.button(label,()=>{more.open=false;run()},cls);menu.append(button)};
    entry('📂 Move to folder',()=>chooseFolder(item));
    if(item.kind!=='worksheet')entry('✎ Rename',()=>renameItem(item));
    if(item.files.length)entry('🗑 Delete',()=>deleteItem(item),'danger');
    more.append(summary,menu);
    actions.append(ui.button('Open',()=>openItem(item),'main'),star,more);
    node.append(thumb,meta,actions);
    return node;
  }

  // ---------- One Open button for every kind of file ----------
  function openItem(item){
    if(item.kind==='worksheet'){
      if(item.filled)return openFilled(item.filled);
      if(item.copy)return openPdf(item.copy,{sheetName:item.name});
      if(item.sheet)return startWorksheet(item.sheet);
      return undefined;
    }
    if(item.kind==='pdf')return openPdf(item.files[0]);
    return showPicture(item.files[0]);
  }

  // ---------- Folders, rename, delete ----------
  function askName(title,initial,buttonText){
    return new Promise(resolve=>{
      const box=ui.openDialog(title);let done=false;
      const finish=value=>{if(done)return;done=true;box.dialog.close();resolve(value)};
      const label=ui.h('label',null,'Name'),input=ui.h('input');
      input.type='text';input.id='mfName';input.maxLength=Core.LIMITS.folderName;input.value=initial||'';input.placeholder='For example: Chumash';label.htmlFor='mfName';
      const go=ui.button(buttonText||'Save',()=>{const value=Core.cleanName(input.value,Core.LIMITS.folderName);if(!value){box.say('Type a name first.');input.focus();return}finish(value)},'main');
      input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();go.click()}});
      const actions=ui.h('div','ftt-saved-actions');actions.append(go,ui.button('Cancel',()=>finish(null)));
      box.body.append(label,input,actions);box.dialog.addEventListener('close',()=>finish(null));input.focus();
    });
  }
  async function createFolder(){
    const name=await askName('New folder','','Create folder');
    if(name==null)return null;
    const result=M.addFolder(prefs,name);
    if(result.error){page.say(result.error);return null}
    changePrefs(result);return result.id;
  }
  async function renameFolder(folder){
    const name=await askName('Rename folder',folder.name,'Rename');
    if(name!=null)changePrefs(M.renameFolder(prefs,folder.id,name));
  }
  function deleteFolder(folder){
    if(!confirm('Delete the folder "'+folder.name+'"? Your files are not deleted: they go back to All files.'))return;
    changePrefs(M.removeFolder(prefs,folder.id));
  }
  function chooseFolder(item){
    const box=ui.openDialog('Move "'+item.name+'" to…');
    const choice=(label,folderId)=>{
      const button=ui.button(label,()=>{box.dialog.close();moveItem(item,folderId)},item.folder===folderId?'main':'');
      button.style.cssText='display:block;margin:6px 0;width:100%;text-align:left';box.body.append(button);
    };
    choice('📂 No folder',''); for(const folder of prefs.folders)choice('📁 '+folder.name,folder.id);
    const add=ui.button('＋ New folder…',async()=>{box.dialog.close();const id=await createFolder();if(id)moveItem(item,id)});
    add.style.cssText='display:block;margin:10px 0 0';box.body.append(add);
  }
  async function renameItem(item){
    const name=await askName('Rename',item.name,'Rename');
    if(name==null||name===item.name)return;
    try{await store.rename(item.files[0],name);await refresh()}catch(error){page.fail(error)}
  }
  async function deleteItem(item){
    const text=item.kind==='worksheet'
      ?'Delete your copy and your work on "'+item.name+'"? You cannot get them back. The worksheet stays in My files as new, so you can start again.'
      :'Delete "'+item.name+'"? You cannot get it back.';
    if(!confirm(text))return;
    try{for(const file of item.files)await store.remove(file);await refresh()}catch(error){page.fail(error)}
  }

  $('viewGrid').addEventListener('click',()=>{mode='grid';remember('view',mode);render()});
  $('viewList').addEventListener('click',()=>{mode='list';remember('view',mode);render()});
  $('sortBy').addEventListener('change',()=>{sort=$('sortBy').value;remember('sort',sort);render()});
  $('newFolder').addEventListener('click',async()=>{const id=await createFolder();if(id){view={type:'folder',id};render()}});

  // ---------- A saved whiteboard, as a picture ----------
  async function showPicture(file){
    const box=ui.openDialog(file.name);
    box.say('Opening…');
    const pages=file.worksheet?file.pages:1;let shown=0;
    for(let number=1;number<=pages;number+=1){
      const picture=await store.picture(file,number);
      if(!picture)continue;
      const image=ui.h('img','ftt-picture'),url=URL.createObjectURL(picture);
      image.alt=(file.worksheet?'Page '+number+' of the worksheet ':'Picture of the whiteboard ')+file.name;image.src=url;
      box.dialog.addEventListener('close',()=>URL.revokeObjectURL(url));
      box.body.append(image);shown+=1;
    }
    if(!shown)box.body.append(ui.h('p','ftt-saved-note','There is no picture of this file.'));
    box.body.append(ui.h('p','ftt-saved-note',file.worksheet?'To keep writing on it, press Continue.':'To draw on it again, open your whiteboard and press 📂 My files.'));
    box.say('');
  }

  // ---------- Add a PDF from this computer ----------
  $('addPdf').addEventListener('click',()=>$('pdfFile').click());
  $('pdfFile').addEventListener('change',()=>{
    const file=$('pdfFile').files[0];$('pdfFile').value='';
    if(!file)return;
    const box=ui.openDialog('Add a PDF'),name=ui.h('input'),label=ui.h('label',null,'Name');
    name.type='text';name.id='fttPdfName';name.maxLength=Core.LIMITS.fileName;name.value=Core.cleanName(file.name.replace(/\.pdf$/i,''));label.htmlFor=name.id;
    box.body.append(label,name);
    const picker=ui.folderPicker(state,state.saveTarget);
    if(picker.node){
      const folderLabel=ui.h('label',null,'Folder');picker.node.id='fttPdfFolder';folderLabel.htmlFor=picker.node.id;
      if(state.saveTarget)box.body.append(ui.h('p','ftt-saved-hint','Your teacher asked you to save in: '+Core.folderLabel(state,state.saveTarget)));
      box.body.append(folderLabel,picker.node);
    }
    const meter=ui.h('progress');meter.max=100;meter.value=0;meter.hidden=true;meter.setAttribute('aria-label','Saving');
    const save=ui.button('Save',async()=>{
      const clean=Core.cleanName(name.value);
      if(!clean){box.say('Type a name first.');return}
      save.disabled=true;meter.hidden=false;box.say('Saving…');
      try{
        await store.savePdf(file,{name:clean,folderId:picker.value()},percent=>{meter.value=percent;box.say('Saving… '+percent+'%')});
        box.dialog.close();await refresh();
      }catch(error){box.fail(error);save.disabled=false;meter.hidden=true}
    },'main');
    const actions=ui.h('div','ftt-saved-actions');actions.append(save,ui.button('Cancel',()=>box.dialog.close()));
    box.body.append(actions,meter);
  });

  // ---------- Worksheets from the teacher: fill in (write, type, highlight on every page) and save ----------
  const validTarget=()=>state.saveTarget&&state.folders[state.saveTarget]?state.saveTarget:'';
  // First time: this student's own copy of the PDF is saved in My files, then opened. Later: their saved work, or the copy.
  async function startWorksheet(sheet){
    page.say('Opening the worksheet…');
    try{
      const filled=allFiles.find(file=>file.worksheet&&file.sheetId===sheet.id);
      if(filled)return openFilled(filled);
      let copy=allFiles.find(file=>file.kind==='pdf'&&file.sheetId===sheet.id);
      if(!copy){
        const blob=await Saved.worksheets.read(sheet.id);
        const id=await store.savePdf(new File([blob],sheet.name+'.pdf',{type:'application/pdf'}),{name:sheet.name,folderId:validTarget(),sheetId:sheet.id,subject:sheet.subject||'',fromTeacher:true,important:sheet.important===true});
        await refresh();copy=allFiles.find(file=>file.id===id);
        if(!copy)throw Core.plain('Your copy was saved, but it could not be opened. Press Open again.');
      }
      await openPdf(copy,{sheetName:sheet.name});
    }catch(error){page.fail(error)}
  }
  async function openFilled(file){
    page.say('Opening…');
    try{
      const data=await store.readBoard(file,'worksheet');
      const copy=allFiles.find(item=>item.kind==='pdf'&&item.id===data.pdfId);
      if(!copy)throw Core.plain('The worksheet copy this was made from is not in My files any more. Fill in the worksheet again from the top of this page.');
      const marks={};
      for(const [key,list] of Object.entries(data.marks&&typeof data.marks==='object'?data.marks:{})){
        const number=Number(key);
        if(!Number.isInteger(number)||number<1||number>60||!Array.isArray(list))continue;
        marks[number]=list.slice(0,300).map(raw=>FA?.cleanItem(raw,{idPrefix:'s',maxPoints:400})).filter(Boolean);
      }
      await openPdf(copy,{marks,filled:{id:file.id,name:file.name},sheetName:Core.cleanName(data.sheetName)||copy.name});
    }catch(error){page.fail(error)}
  }
  // The marks go on a layer over the page that is on the screen: the same drawing toolbar as a whiteboard.
  // The same toolbar as the whiteboards: Select (the mouse icon), Highlight, Text, Shapes, Eraser, Pen. No Hand and no Pointer,
  // and only the tools that work are shown, so the buttons are the normal size.
  const sheetSurface=FA&&{id:'worksheet',label:'Worksheet',idPrefix:'s',defaultTool:'pen',autoOpen:true,
    tools:['select','highlight','text','shape','eraser','pen'],hideUnused:true,
    toolLabels:{select:['🖱️','Select','Click any of your marks to pick it: drag to move it, drag a corner to resize it, click a color or a size. Click words again to type in them.',-1]},
    rect:()=>{const canvas=fill&&$('viewerPage').querySelector('canvas');if(!canvas)return null;const r=canvas.getBoundingClientRect();return r.width&&r.height?r:null},
    getItems:()=>fill?.marks[pageNumber]||[],
    setItems(list){if(!fill)return;fill.marks[pageNumber]=list;fill.dirty=true;$('viewerSave').textContent='💾 Save my worksheet'}};
  function startFiller(copy,options){
    fill={copy,marks:options.marks||{},filled:options.filled||null,sheetName:options.sheetName||copy.name,dirty:false};
    if(!FA||!sheetSurface){page.say('The drawing tools could not load. Refresh the page and try again.');return}
    $('viewerSave').hidden=false;$('viewerSave').disabled=false;$('viewerSave').textContent='💾 Save my worksheet';
    FA.setRole('student');FA.push(sheetSurface);FA.setReason('whiteboard',true);
  }
  function stopFiller(){
    if(!fill)return;
    fill=null;$('viewerSave').hidden=true;
    if(FA&&sheetSurface){FA.release(sheetSurface);FA.setReason('whiteboard',false)}
  }
  // A picture of one page with the student's marks on it (this is what the teacher sees).
  async function pagePicture(number){
    const sheet=await pdf.getPage(number),base=sheet.getViewport({scale:1}),viewport=sheet.getViewport({scale:1100/base.width});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d',{alpha:false});
    await sheet.render({canvasContext:ctx,viewport}).promise;
    const W=canvas.width,H=canvas.height;
    for(const item of fill.marks[number]||[])FA.drawItem(ctx,item,p=>[p.x*W,p.y*H],W);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Core.plain('Could not make a picture of a page.')),'image/png'));
  }
  // One click: the first save makes a new file named from the worksheet and the Hebrew date; later saves replace it.
  async function saveFilled(){
    if(!fill||!pdf)return;
    const button=$('viewerSave');button.disabled=true;page.say('Saving…');
    try{
      const pictures=[];
      for(let number=1;number<=pdf.numPages;number+=1)pictures.push(await pagePicture(number));
      const name=fill.filled?.name||Core.autoName({date:new Date(),lesson:fill.sheetName,existing:(await store.list()).map(file=>file.name)});
      const marks={};
      for(const [number,list] of Object.entries(fill.marks))if(list.length)marks[number]=list;
      const data={version:1,kind:'worksheet',pdfId:fill.copy.id,sheetId:fill.copy.sheetId||'',sheetName:fill.sheetName,marks};
      const id=await store.saveWorksheet({id:fill.filled?.id,name,folderId:validTarget(),data,pictures,sheetId:fill.copy.sheetId,subject:fill.copy.subject||''});
      fill.filled={id,name};fill.dirty=false;
      page.say('Saved as "'+name+'" in My files.');button.textContent='✓ Saved';
    }catch(error){page.fail(error)}finally{button.disabled=false}
  }
  $('viewerSave').addEventListener('click',saveFilled);
  // A drawing tool covers the page, so the mouse wheel over it scrolls the page (when it is zoomed in).
  document.addEventListener('wheel',event=>{
    if(!fill||!event.target.closest)return;
    if(!event.target.closest('#fttAnnotate')||event.target.closest('.fa-bar,.fa-fly'))return;
    const holder=$('viewerPage');holder.scrollTop+=event.deltaY;holder.scrollLeft+=event.deltaX;
  },{passive:true});

  // ---------- PDF reader ----------
  let pdf=null,current=null,pageNumber=1,zoom=1,drawing=null,drawToken=0,saveTimer=0,unsaved=false;
  const placeKey=file=>'saved:'+file.id;
  async function openPdf(file,fillOptions){
    page.say('Opening…');
    try{
      const reader=window.pdfjsLib;
      if(!reader)throw Core.plain('The PDF reader could not load. Refresh the page and try again.');
      reader.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js?v=3.11.174';
      const data=new Uint8Array(await (await store.readPdf(file)).arrayBuffer());
      const loaded=await reader.getDocument({data,isEvalSupported:false,enableXfa:false}).promise.catch(()=>{throw Core.plain('This PDF could not be opened.')});
      closePdf();pdf=loaded;current=file;
      if(fillOptions)startFiller(file,fillOptions);
      // Use whichever is newer: the place kept in this browser, or the place saved with the file.
      let local=null;try{local=Core.readPosition(localStorage,placeKey(file))}catch(_){}
      const resume=local&&local.at>=file.placeAt?local:{page:file.lastPage,zoom:file.zoom};
      pageNumber=Math.min(pdf.numPages,Math.max(1,resume.page));zoom=Math.min(4,Math.max(0.5,resume.zoom));
      $('viewerName').textContent=file.name;$('viewer').hidden=false;page.say('');
      draw();
    }catch(error){page.fail(error)}
  }
  async function draw(){
    if(!pdf)return;
    const token=++drawToken;drawing?.cancel();
    const sheet=await pdf.getPage(pageNumber);
    if(token!==drawToken)return;
    const holder=$('viewerPage'),base=sheet.getViewport({scale:1}),sharp=Math.min(window.devicePixelRatio||1,2);
    // While filling in a worksheet, the whole page fits the screen at first (a drawing tool is on, so the page is not scrolled by dragging).
    const roomWidth=Math.max(200,holder.clientWidth-24);
    const fitted=fill?Math.min(roomWidth,Math.max(200,holder.clientHeight-24)*base.width/base.height):roomWidth;
    const shown=fitted*zoom;
    let scale=shown*sharp/base.width;
    const pixels=base.width*scale*base.height*scale;if(pixels>14e6)scale*=Math.sqrt(14e6/pixels);
    const viewport=sheet.getViewport({scale}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=shown+'px';
    drawing=sheet.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport});
    try{await drawing.promise}catch(_){return}
    if(token!==drawToken)return;
    holder.replaceChildren(canvas);
    FA?.refresh();
    $('viewerCount').textContent='Page '+pageNumber+' of '+pdf.numPages;$('viewerZoom').textContent=Math.round(zoom*100)+'%';
    $('viewerPrevious').disabled=pageNumber<=1;$('viewerNext').disabled=pageNumber>=pdf.numPages;
  }
  const place=()=>({page:pageNumber,zoom,at:Date.now()});
  // The place is kept in this browser at once (so closing the tab keeps it) and with the file a moment later.
  function move(nextPage,nextZoom){
    if(!pdf)return;
    const before=pageNumber;
    pageNumber=Math.min(pdf.numPages,Math.max(1,nextPage));zoom=Math.min(4,Math.max(0.5,nextZoom));
    if(pageNumber!==before)$('viewerPage').scrollTop=0;
    try{Core.savePosition(localStorage,placeKey(current),place())}catch(_){}
    unsaved=true;clearTimeout(saveTimer);saveTimer=setTimeout(savePlace,2500);
    draw();
  }
  function savePlace(){
    clearTimeout(saveTimer);
    if(!unsaved||!current)return;
    unsaved=false;store.remember(current,place()).catch(()=>{});
  }
  function closePdf(){
    savePlace();drawToken++;drawing?.cancel();drawing=null;
    try{pdf?.destroy()}catch(_){}
    stopFiller();
    pdf=null;current=null;$('viewer').hidden=true;$('viewerPage').replaceChildren();
  }
  $('viewerBack').addEventListener('click',()=>{
    if(fill?.dirty&&!confirm('You have not saved your worksheet yet. Leave without saving?'))return;
    closePdf();refresh();
  });
  $('viewerPrevious').addEventListener('click',()=>move(pageNumber-1,zoom));
  $('viewerNext').addEventListener('click',()=>move(pageNumber+1,zoom));
  $('viewerZoomOut').addEventListener('click',()=>move(pageNumber,zoom/1.25));
  $('viewerZoomIn').addEventListener('click',()=>move(pageNumber,zoom*1.25));
  document.addEventListener('keydown',event=>{
    if(!pdf||event.target.closest('input,select,dialog[open]'))return;
    if(event.key==='ArrowRight'||event.key==='PageDown'){event.preventDefault();move(pageNumber+1,zoom)}
    else if(event.key==='ArrowLeft'||event.key==='PageUp'){event.preventDefault();move(pageNumber-1,zoom)}
  });
  let resizeTimer=0;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(draw,150)});
  window.addEventListener('pagehide',savePlace);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')savePlace()});

  refresh();
})();
