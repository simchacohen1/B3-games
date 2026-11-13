'use strict';
// Saved work: the rules that do not need a browser (names, paths, limits, class folders, file lists,
// "where was I" memory for a student's saved PDFs). Used by saved-work.js and my-files.js, and tested in
// tests/class-pointer-saved-work.test.cjs.
(function(root){
  const MB=1024*1024;
  const LIMITS={
    boardBytes:3*MB,        // a student's saved whiteboard
    teacherBoardBytes:10*MB, // a teacher's lesson whiteboard (up to 12 pasted pictures of 0.7 MB each, plus the drawing)
    pngBytes:2*MB,          // the small picture of a saved whiteboard
    pdfBytes:25*MB,         // a PDF a student uploads
    studentFiles:50,teacherBoards:200,folders:60, // how many files one person may keep (checked on the page; rules cannot count)
    folderName:40,fileName:60,positions:60
  };
  const WORKSPACE='b3-2026';
  const EXTENSIONS={whiteboard:'json',pdf:'pdf'};
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
  const validScopeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
  const validUid=value=>typeof value==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(value);

  function newId(cryptoApi){
    const source=cryptoApi||root.crypto;
    if(source?.randomUUID)return source.randomUUID();
    const bytes=source.getRandomValues(new Uint8Array(16));
    return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  // Names are shown to children and teachers: no hidden control characters, one line, a sensible length.
  function cleanName(value,max){
    return String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max||LIMITS.fileName).trim();
  }

  // ---------- Where things are kept ----------
  function studentPrefix(classId,studentId){
    if(!validScopeId(classId)||!validScopeId(studentId))throw Error('Invalid student or class.');
    return 'studentFiles/'+classId+'/'+studentId+'/';
  }
  function teacherPrefix(uid){
    if(!validUid(uid))throw Error('Invalid teacher.');
    return 'pointerWhiteboards/'+uid+'/';
  }
  function foldersPath(classId){
    if(!validScopeId(classId))throw Error('Invalid class.');
    return 'b3Games/workspaces/'+WORKSPACE+'/classes/'+classId+'/pointerFileFolders';
  }
  function objectName(id,ext){
    if(!validId(id)||!['json','pdf','png'].includes(ext))throw Error('Invalid file name.');
    return id+'.'+ext;
  }
  function parseObjectName(name){
    const match=/^([A-Za-z0-9_-]{1,64})\.(json|pdf|png)$/.exec(String(name||''));
    return match?{id:match[1],ext:match[2]}:null;
  }
  // Returns '' when the size is fine, or a short sentence to show.
  function sizeProblem(kind,bytes,teacher){
    const limit=kind==='pdf'?LIMITS.pdfBytes:kind==='png'?LIMITS.pngBytes:teacher?LIMITS.teacherBoardBytes:LIMITS.boardBytes;
    if(!Number.isFinite(bytes)||bytes<=0)return 'This file is empty.';
    if(bytes<=limit)return '';
    return kind==='pdf'?'This PDF is too big. The biggest PDF you can save is '+Math.round(limit/MB)+' MB.':'This whiteboard is too big to save. Remove a picture and try again.';
  }

  // ---------- What is written beside each file ----------
  function fileMetadata(file){
    return{
      displayName:cleanName(file.name)||'My work',
      kind:file.kind==='pdf'?'pdf':'whiteboard',
      folderId:validId(file.folderId)?file.folderId:'',
      lastPage:String(Math.max(1,Math.floor(Number(file.lastPage))||1)),
      zoom:String(cleanZoom(file.zoom)),
      savedAt:String(Math.floor(Number(file.savedAt))||0)
    };
  }
  // Turns what Firebase Storage lists into one file row. Preview pictures and strange names are skipped.
  function fileFromMetadata(meta){
    const parsed=parseObjectName(meta?.name);
    if(!parsed||parsed.ext==='png')return null;
    const custom=meta.customMetadata||{},kind=parsed.ext==='pdf'?'pdf':'whiteboard';
    return{
      id:parsed.id,ext:parsed.ext,kind,
      name:cleanName(custom.displayName)||(kind==='pdf'?'PDF':'Whiteboard'),
      folderId:validId(custom.folderId)?custom.folderId:null,
      lastPage:Math.max(1,Math.floor(Number(custom.lastPage))||1),
      zoom:cleanZoom(custom.zoom),
      savedAt:Math.floor(Number(custom.savedAt))||Date.parse(meta.updated||'')||0,
      placeAt:Math.floor(Number(custom.placeAt))||0, // when lastPage and zoom were last remembered
      size:Number(meta.size)||0
    };
  }
  function cleanZoom(value){const zoom=Number(value);return Number.isFinite(zoom)?Math.min(5,Math.max(0.25,zoom)):1}

  // Never trust a saved file: it must be the right kind of whiteboard and a sensible size before it is opened.
  function parseBoard(text,kind,maxBytes){
    if(typeof text!=='string'||!text||text.length>maxBytes)return null;
    let data;try{data=JSON.parse(text)}catch(_){return null}
    return data&&typeof data==='object'&&!Array.isArray(data)&&data.version===1&&data.kind===kind?data:null;
  }

  // ---------- Class folders (the teacher makes them; students choose one when saving) ----------
  // state = {folders:{id:{name,parentId,order,createdAt}},saveTarget:id|null}. Two levels at most.
  function cleanFolders(raw){
    const source=raw&&typeof raw==='object'&&raw.folders&&typeof raw.folders==='object'?raw.folders:{};
    const rows=[];
    for(const id of Object.keys(source)){
      const row=source[id],name=cleanName(row?.name,LIMITS.folderName);
      if(!validId(id)||!name)continue;
      rows.push([id,{name,parentId:validId(row.parentId)?row.parentId:null,order:Number.isFinite(row.order)?row.order:0,createdAt:Number.isFinite(row.createdAt)?row.createdAt:0}]);
    }
    const top=new Set(rows.filter(([,row])=>!row.parentId).map(([id])=>id));
    // A subfolder must sit inside a real top folder; anything else is ignored.
    const kept=rows.filter(([,row])=>!row.parentId||top.has(row.parentId)).slice(0,LIMITS.folders);
    const folders=Object.fromEntries(kept);
    return{folders,saveTarget:validId(raw?.saveTarget)&&folders[raw.saveTarget]?raw.saveTarget:null};
  }
  const byOrder=(a,b)=>a.order-b.order||a.name.localeCompare(b.name);
  function folderTree(state){
    const list=Object.entries(state.folders).map(([id,row])=>({id,...row}));
    return list.filter(row=>!row.parentId).sort(byOrder).map(row=>({id:row.id,name:row.name,children:list.filter(child=>child.parentId===row.id).sort(byOrder).map(child=>({id:child.id,name:child.name}))}));
  }
  // "Chumash › Perek 1", or '' when the folder is gone.
  function folderLabel(state,id){
    const row=state.folders[id];if(!row)return '';
    return row.parentId&&state.folders[row.parentId]?state.folders[row.parentId].name+' › '+row.name:row.name;
  }
  // Flat list for a drop-down, in tree order.
  function folderOptions(state){
    const options=[];
    for(const folder of folderTree(state)){
      options.push({id:folder.id,label:folder.name,depth:0});
      for(const child of folder.children)options.push({id:child.id,label:folder.name+' › '+child.name,depth:1});
    }
    return options;
  }
  function nameTaken(state,name,parentId,exceptId){
    const wanted=name.toLowerCase();
    return Object.entries(state.folders).some(([id,row])=>id!==exceptId&&(row.parentId||null)===(parentId||null)&&row.name.toLowerCase()===wanted);
  }
  // Each change returns {error} or {state,changes}. "changes" is exactly what is written to the database
  // (paths inside pointerFileFolders; null removes).
  function addFolder(state,{id,name,parentId=null,now=Date.now()}){
    const clean=cleanName(name,LIMITS.folderName);
    if(!clean)return{error:'Type a name for the folder.'};
    if(!validId(id))return{error:'Could not make the folder. Try again.'};
    if(Object.keys(state.folders).length>=LIMITS.folders)return{error:'This class already has '+LIMITS.folders+' folders. Delete one first.'};
    if(parentId&&(!state.folders[parentId]||state.folders[parentId].parentId))return{error:'A folder can only go inside a main folder.'};
    if(nameTaken(state,clean,parentId))return{error:'There is already a folder with that name.'};
    const row={name:clean,order:now,createdAt:now,...(parentId?{parentId}:{})};
    return{state:{...state,folders:{...state.folders,[id]:{...row,parentId:parentId||null}}},changes:{['folders/'+id]:row}};
  }
  function renameFolder(state,id,name){
    const row=state.folders[id],clean=cleanName(name,LIMITS.folderName);
    if(!row)return{error:'That folder is not there any more.'};
    if(!clean)return{error:'Type a name for the folder.'};
    if(nameTaken(state,clean,row.parentId,id))return{error:'There is already a folder with that name.'};
    return{state:{...state,folders:{...state.folders,[id]:{...row,name:clean}}},changes:{['folders/'+id+'/name']:clean}};
  }
  // Removes a folder and its subfolders. Student files are never touched: they show under "Other".
  function removeFolder(state,id){
    if(!state.folders[id])return{error:'That folder is not there any more.'};
    const gone=[id,...Object.keys(state.folders).filter(other=>state.folders[other].parentId===id)];
    const folders=Object.fromEntries(Object.entries(state.folders).filter(([other])=>!gone.includes(other)));
    const changes=Object.fromEntries(gone.map(other=>['folders/'+other,null]));
    const lostTarget=gone.includes(state.saveTarget);
    if(lostTarget)changes.saveTarget=null;
    return{state:{folders,saveTarget:lostTarget?null:state.saveTarget},changes,removed:gone};
  }
  function setSaveTarget(state,id){
    if(id&&!state.folders[id])return{error:'That folder is not there any more.'};
    return{state:{...state,saveTarget:id||null},changes:{saveTarget:id||null}};
  }
  // Files by folder, in tree order, newest first. Files whose folder is gone (or that have none) go in "Other".
  function groupFiles(files,state){
    const newest=(a,b)=>b.savedAt-a.savedAt;
    const groups=folderOptions(state).map(option=>({folderId:option.id,label:option.label,files:files.filter(file=>file.folderId===option.id).sort(newest)})).filter(group=>group.files.length);
    const other=files.filter(file=>!file.folderId||!state.folders[file.folderId]).sort(newest);
    if(other.length)groups.push({folderId:null,label:groups.length?'Other':'My files',files:other});
    return groups;
  }

  // ---------- "Where was I" memory for PDFs, kept in this browser ----------
  // A cheap way to know a PDF opened from the computer again: its name, size and date.
  function fingerprint(file){
    if(!file||typeof file.name!=='string'||!Number.isFinite(file.size))return null;
    return('file:'+file.name+'|'+file.size+'|'+(Number.isFinite(file.lastModified)?file.lastModified:0)).slice(0,240);
  }
  function cleanPosition(pos){
    if(!pos||typeof pos!=='object')return null;
    const page=Math.floor(Number(pos.page)),clean={page:Number.isFinite(page)&&page>=1?Math.min(page,100000):1,zoom:cleanZoom(pos.zoom),at:Number.isFinite(pos.at)?pos.at:0};
    for(const side of ['top','left']){const value=Number(pos[side]);if(pos[side]!=null&&Number.isFinite(value))clean[side]=Math.min(1,Math.max(0,value))}
    if(pos.layout&&typeof pos.layout==='object')clean.layout={spread:pos.layout.spread===true,rtl:pos.layout.rtl!==false,shift:pos.layout.shift===true};
    return clean;
  }
  const POSITIONS_KEY='fttPdfPositions';
  function readPositions(storage){
    try{const all=JSON.parse(storage.getItem(POSITIONS_KEY)||'{}');return all&&typeof all==='object'&&!Array.isArray(all)?all:{}}catch(_){return{}}
  }
  function readPosition(storage,key){return key?cleanPosition(readPositions(storage)[key]):null}
  // Keeps only the most recently used PDFs so the list never grows without end.
  function savePosition(storage,key,pos){
    const clean=cleanPosition(pos);if(!key||!clean)return false;
    const all=readPositions(storage);all[key]=clean;
    const keep=Object.entries(all).sort((a,b)=>(b[1]?.at||0)-(a[1]?.at||0)).slice(0,LIMITS.positions);
    try{storage.setItem(POSITIONS_KEY,JSON.stringify(Object.fromEntries(keep)));return true}catch(_){return false}
  }

  // ---------- Plain words for things that go wrong ----------
  const NOT_ON='Saving is not turned on yet. Ask your teacher.';
  function errorText(error,teacher){
    const code=String(error?.code||''),message=String(error?.message||'');
    if(error?.plain)return message;
    if(code==='storage/unauthorized'||/permission.denied/i.test(code+' '+message))return teacher?'Saving is not turned on yet. Ask the Fun Torah owner to turn it on.':NOT_ON;
    if(code==='storage/unauthenticated')return 'You are not signed in. Sign in again, then try.';
    if(code==='storage/object-not-found')return 'That file is not there any more.';
    if(code==='storage/retry-limit-exceeded'||code==='storage/canceled'||/network|failed to fetch/i.test(message))return 'Could not reach Fun Torah. Check the internet and try again.';
    return 'Something went wrong. Please try again.';
  }
  // An error whose words are already safe and plain enough to show.
  function plain(message){const error=Error(message);error.plain=true;return error}

  const api={LIMITS,EXTENSIONS,NOT_ON,validId,newId,cleanName,studentPrefix,teacherPrefix,foldersPath,objectName,parseObjectName,sizeProblem,
    fileMetadata,fileFromMetadata,parseBoard,cleanFolders,folderTree,folderLabel,folderOptions,addFolder,renameFolder,removeFolder,setSaveTarget,groupFiles,
    fingerprint,cleanPosition,readPosition,savePosition,errorText,plain};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FTTSavedWorkCore=api;
})(typeof window==='undefined'?globalThis:window);
