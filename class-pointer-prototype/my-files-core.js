'use strict';
// My files (student page): the rules that need no browser. Turns the saved files and the teacher's worksheets into items
// (one item per worksheet), applies the student's own settings (folders, stars), and arranges them by date, name, type or
// subject. Needs saved-work-core.js first in a page (it is required by tests).
(function(root){
  const Core=typeof module!=='undefined'&&module.exports?require('./saved-work-core.js'):root.FTTSavedWorkCore;
  const DAY_GROUPS=['Today','Yesterday','Earlier this week','Last week','Older'];
  const TYPE_GROUPS=[['worksheet','Worksheets'],['pdf','PDFs'],['whiteboard','Whiteboards']];
  const MAX_FOLDERS=30,MAX_NAME=40,MAX_KEYS=600;
  const KEY=/^[-A-Za-z0-9_]{1,80}$/;

  // ---------- Dates (the week starts on Sunday) ----------
  function startOfDay(time){const d=new Date(time);d.setHours(0,0,0,0);return d.getTime()}
  function shiftDays(time,days){const d=new Date(time);d.setDate(d.getDate()+days);return d.getTime()}
  function dateGroup(time,now=Date.now()){
    const t=Number(time)||0,today=startOfDay(now);
    if(t>=today)return 'Today';
    if(t>=shiftDays(today,-1))return 'Yesterday';
    const week=shiftDays(today,-new Date(today).getDay());
    if(t>=week)return 'Earlier this week';
    if(t>=shiftDays(week,-7))return 'Last week';
    return 'Older';
  }

  // ---------- The student's own settings, kept in one small saved file ----------
  const emptyPrefs=()=>({version:1,folders:[],place:{},starred:{}});
  function cleanPrefs(raw){
    const out=emptyPrefs();
    if(!raw||typeof raw!=='object'||raw.version!==1)return out;
    const seen=new Set();
    for(const row of Array.isArray(raw.folders)?raw.folders:[]){
      const name=Core.cleanName(row?.name,MAX_NAME);
      if(!row||!Core.validId(row.id)||!name||seen.has(row.id)||out.folders.length>=MAX_FOLDERS)continue;
      if(out.folders.some(folder=>folder.name.toLowerCase()===name.toLowerCase()))continue;
      seen.add(row.id);out.folders.push({id:row.id,name});
    }
    let count=0;
    for(const [key,folderId] of Object.entries(raw.place&&typeof raw.place==='object'?raw.place:{})){
      if(count>=MAX_KEYS)break;
      if(KEY.test(key)&&seen.has(folderId)){out.place[key]=folderId;count+=1}
    }
    for(const [key,value] of Object.entries(raw.starred&&typeof raw.starred==='object'?raw.starred:{})){
      if(count>=MAX_KEYS)break;
      if(KEY.test(key)&&typeof value==='boolean'){out.starred[key]=value;count+=1}
    }
    return out;
  }
  function addFolder(prefs,name,id=Core.newId()){
    const clean=Core.cleanName(name,MAX_NAME);
    if(!clean)return{error:'Type a name for the folder.'};
    if(prefs.folders.length>=MAX_FOLDERS)return{error:'You already have '+MAX_FOLDERS+' folders. Delete one first.'};
    if(prefs.folders.some(folder=>folder.name.toLowerCase()===clean.toLowerCase()))return{error:'You already have a folder with that name.'};
    return{prefs:{...prefs,folders:[...prefs.folders,{id,name:clean}]},id};
  }
  function renameFolder(prefs,id,name){
    const clean=Core.cleanName(name,MAX_NAME);
    if(!prefs.folders.some(folder=>folder.id===id))return{error:'That folder is not there any more.'};
    if(!clean)return{error:'Type a name for the folder.'};
    if(prefs.folders.some(folder=>folder.id!==id&&folder.name.toLowerCase()===clean.toLowerCase()))return{error:'You already have a folder with that name.'};
    return{prefs:{...prefs,folders:prefs.folders.map(folder=>folder.id===id?{id,name:clean}:folder)}};
  }
  // Deleting a folder never deletes files: they go back to where they were (no folder).
  function removeFolder(prefs,id){
    if(!prefs.folders.some(folder=>folder.id===id))return{error:'That folder is not there any more.'};
    const place=Object.fromEntries(Object.entries(prefs.place).filter(([,folderId])=>folderId!==id));
    return{prefs:{...prefs,folders:prefs.folders.filter(folder=>folder.id!==id),place}};
  }
  function moveItem(prefs,key,folderId){
    if(!KEY.test(key))return{error:'That file cannot be moved.'};
    if(folderId&&!prefs.folders.some(folder=>folder.id===folderId))return{error:'That folder is not there any more.'};
    const place={...prefs.place};
    if(folderId)place[key]=folderId;else delete place[key];
    return{prefs:{...prefs,place}};
  }
  function setStar(prefs,key,value){
    if(!KEY.test(key))return{error:'That file cannot be starred.'};
    return{prefs:{...prefs,starred:{...prefs.starred,[key]:!!value}}};
  }
  // Settings for files that are gone are dropped, so the saved file stays small.
  function prune(prefs,items){
    const keys=new Set(items.map(item=>item.key));
    return{...prefs,
      place:Object.fromEntries(Object.entries(prefs.place).filter(([key])=>keys.has(key))),
      starred:Object.fromEntries(Object.entries(prefs.starred).filter(([key])=>keys.has(key)))};
  }

  // ---------- Items ----------
  // files: the student's saved files (whiteboards, PDFs, filled-in worksheets). sheets: worksheets the teacher sent.
  // Each worksheet is ONE item: the teacher's PDF, the student's own copy and the filled-in pictures are merged.
  function buildItems(files,sheets,prefs){
    const settings=prefs||emptyPrefs(),folderIds=new Set(settings.folders.map(folder=>folder.id));
    const newest=(a,b)=>b.savedAt-a.savedAt;
    const copies=new Map(),filled=new Map(),used=new Set(),items=[];
    for(const file of files){
      if(file.sheetId&&file.kind==='pdf'){if(!copies.has(file.sheetId)||newest(copies.get(file.sheetId),file)>0)copies.set(file.sheetId,file)}
      else if(file.sheetId&&file.worksheet){if(!filled.has(file.sheetId)||newest(filled.get(file.sheetId),file)>0)filled.set(file.sheetId,file)}
    }
    const sheetRows=new Map((sheets||[]).map(sheet=>[sheet.id,sheet]));
    const sheetIds=new Set([...sheetRows.keys(),...copies.keys(),...filled.keys()]);
    for(const id of sheetIds){
      const sheet=sheetRows.get(id)||null,copy=copies.get(id)||null,done=filled.get(id)||null;
      for(const file of [copy,done])if(file)used.add(file);
      const mine=[copy,done].filter(Boolean);
      items.push({
        key:'sheet-'+id,kind:'worksheet',name:sheet?.name||copy?.name||done?.name||'Worksheet',
        time:Math.max(sheet?.sentAt||0,...mine.map(file=>file.savedAt||0)),
        subject:sheet?.subject||done?.subject||copy?.subject||'',fromTeacher:true,important:!!(sheet?.important),
        sheet,copy,filled:done,files:mine,picture:done,
        status:done?'Your work is saved':copy?'Started':'New',
        classFolderId:mine.find(file=>file.folderId)?.folderId||null
      });
    }
    for(const file of files){
      if(used.has(file))continue;
      items.push({
        key:file.id,kind:file.worksheet?'worksheet':file.kind==='pdf'?'pdf':'whiteboard',name:file.name,time:file.savedAt||0,
        subject:file.subject||'',fromTeacher:!!file.fromTeacher,important:!!file.important,
        sheet:null,copy:null,filled:file.worksheet?file:null,files:[file],picture:file.kind==='pdf'?null:file,status:'',
        classFolderId:file.folderId||null
      });
    }
    for(const item of items){
      item.folder=folderIds.has(settings.place[item.key])?settings.place[item.key]:'';
      item.starred=Object.prototype.hasOwnProperty.call(settings.starred,item.key)?settings.starred[item.key]:item.important;
    }
    return items;
  }

  // view: {type:'all'} | {type:'starred'} | {type:'folder',id} | {type:'class',id}
  function filterItems(items,view){
    const type=view?.type||'all';
    if(type==='starred')return items.filter(item=>item.starred);
    if(type==='folder')return items.filter(item=>item.folder===view.id);
    if(type==='class')return items.filter(item=>!item.folder&&item.classFolderId===view.id);
    return items;
  }
  const byTime=(a,b)=>b.time-a.time||a.name.localeCompare(b.name);
  const byName=(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})||b.time-a.time;
  // Groups, newest first. sort: 'date' (Today, Yesterday... with starred files pinned on top of Today unless pin is false), 'name', 'type', 'subject'.
  function arrange(items,{sort='date',now=Date.now(),pin=true}={}){
    const list=[...items];
    if(sort==='name')return list.length?[{label:'',items:list.sort(byName)}]:[];
    if(sort==='type'){
      return TYPE_GROUPS.map(([kind,label])=>({label,items:list.filter(item=>item.kind===kind).sort(byTime)})).filter(group=>group.items.length);
    }
    if(sort==='subject'){
      const subjects=[...new Set(list.map(item=>item.subject).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
      const groups=subjects.map(subject=>({label:subject,items:list.filter(item=>item.subject===subject).sort(byTime)}));
      const none=list.filter(item=>!item.subject).sort(byTime);
      if(none.length)groups.push({label:subjects.length?'No subject':'',items:none});
      return groups;
    }
    const starred=pin?list.filter(item=>item.starred).sort(byTime):[];
    const buckets=new Map(DAY_GROUPS.map(label=>[label,[]]));
    for(const item of list)if(!pin||!item.starred)buckets.get(dateGroup(item.time,now)).push(item);
    const groups=[];
    for(const label of DAY_GROUPS){
      const rows=buckets.get(label).sort(byTime);
      // Starred files are pinned on top of Today, whatever their date.
      const all=label==='Today'?[...starred,...rows]:rows;
      if(all.length)groups.push({label,items:all,pinned:label==='Today'?starred.length:0});
    }
    return groups;
  }
  const typeLabel=kind=>kind==='worksheet'?'Worksheet':kind==='pdf'?'PDF':'Whiteboard';

  const api={DAY_GROUPS,dateGroup,emptyPrefs,cleanPrefs,addFolder,renameFolder,removeFolder,moveItem,setStar,prune,buildItems,filterItems,arrange,typeLabel,MAX_FOLDERS};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FTTMyFilesCore=api;
})(typeof window==='undefined'?globalThis:window);
