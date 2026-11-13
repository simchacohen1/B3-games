'use strict';
// Saved work for Class Pointer: Save and My files for whiteboards, and the class folders a teacher makes.
//  • Teacher (classroom.html?dashboard=teacher): saves the lesson whiteboard in a private folder of their own,
//    and makes the class folders students save into. The toolbar calls FTTSavedWork.saveCurrent() and .open().
//  • Student (own whiteboard, in the classroom or on an activity page): 💾 Save and 📂 My files are added to
//    the whiteboard bar. Files are private to that student. Other students and the teacher cannot list them.
// Files live in Firebase Storage and folders in the Realtime Database. Firebase rules decide who may read and
// write (see SAVED-WORK-RULES.md); until those rules are published every save shows a plain "not turned on" line.
// Needs saved-work-core.js first.
(function(){
  const Core=window.FTTSavedWorkCore;
  if(!Core||window.FTTSavedWork)return;
  const scriptUrl=document.currentScript?.src||location.href;
  const params=new URL(location.href).searchParams;
  const teacherPage=params.get('dashboard')==='teacher'&&!!window.ClassPointerDashboard;
  const SDK='https://www.gstatic.com/firebasejs/12.15.0/firebase-';
  const OFFLINE='Could not reach Fun Torah. Check the internet and try again.';
  const SIGN_IN='To save your work, sign in on the Fun Torah home page first. Then come back and try again.';
  const NO_FOLDERS={folders:{},saveTarget:null};

  // ---------- Who is saving ----------
  const load=url=>new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=()=>reject(Core.plain(OFFLINE));
    document.head.appendChild(script);
  });
  let firebaseReady=null;
  // Activity pages only load the parts of Firebase they need, so fetch the rest the first time someone saves.
  function ensureFirebase(){
    return firebaseReady||(firebaseReady=(async()=>{
      if(window.B3GameGateAuthReady)await window.B3GameGateAuthReady;
      if(!window.firebase)await load(SDK+'app-compat.js');
      for(const part of ['auth','database','storage'])if(!firebase[part])await load(SDK+part+'-compat.js');
      if(!window.B3_FIREBASE_CONFIG)await load(new URL('../firebase-config.js',scriptUrl).href);
      if(!firebase.apps.length)firebase.initializeApp(window.B3_FIREBASE_CONFIG);
    })().catch(error=>{firebaseReady=null;throw error}));
  }
  // Never trust the address bar: a teacher is the signed-in teacher the classroom already checked, and a
  // student is whoever the sign-in token says. The Firebase rules check the same things again.
  async function who(){
    await ensureFirebase();
    if(teacherPage){
      const context=await window.ClassPointerDashboard.ready.catch(()=>null),user=firebase.auth().currentUser;
      if(!context||!user||user.uid!==context.user?.uid)throw Core.plain('Sign in as the teacher to use saved files.');
      return{teacher:true,user,classId:params.get('class'),prefix:Core.teacherPrefix(user.uid)};
    }
    const user=await new Promise(resolve=>{const stop=firebase.auth().onAuthStateChanged(found=>{resolve(found);queueMicrotask(()=>stop())})});
    const claims=user?(await user.getIdTokenResult()).claims:null;
    let tabStudent='';try{tabStudent=sessionStorage.getItem('b3Games_studentId')||''}catch(_){}
    // A shared computer may still hold someone else's sign-in: only save for the student using this tab.
    if(claims?.b3StudentRole!=='student'||!claims.b3StudentId||!claims.b3ClassId||(tabStudent&&tabStudent!==claims.b3StudentId))throw Core.plain(SIGN_IN);
    return{teacher:false,user,classId:claims.b3ClassId,prefix:Core.studentPrefix(claims.b3ClassId,claims.b3StudentId)};
  }

  // ---------- Reading and writing files ----------
  const coded=code=>Object.assign(Error(code),{code});
  // Signed-in download straight from Firebase Storage (never a public link that could be passed around).
  async function download(name,maxBytes){
    const me=await who(),ref=firebase.storage().ref(me.prefix+name),token=await me.user.getIdToken();
    const url='https://firebasestorage.googleapis.com/v0/b/'+encodeURIComponent(ref.bucket)+'/o/'+encodeURIComponent(ref.fullPath)+'?alt=media';
    let response;
    try{response=await fetch(url,{headers:{Authorization:'Firebase '+token},cache:'no-store'})}catch(_){throw Core.plain(OFFLINE)}
    if(response.status===401||response.status===403)throw coded('storage/unauthorized');
    if(response.status===404)throw coded('storage/object-not-found');
    if(!response.ok)throw Core.plain(OFFLINE);
    const blob=await response.blob();
    if(blob.size>maxBytes)throw Core.plain('This file is too big to open.');
    return blob;
  }
  // Firebase rules cannot count files, so the limit on how many files one person keeps is checked here.
  async function checkRoom(me){
    const limit=me.teacher?Core.LIMITS.teacherBoards:Core.LIMITS.studentFiles;
    const items=(await firebase.storage().ref(me.prefix).listAll()).items.filter(ref=>!ref.name.endsWith('.png'));
    if(items.length>=limit)throw Core.plain('You already have '+limit+' saved files. Delete one, then save again.');
  }
  async function patch(file,changes){
    const me=await who(),ref=firebase.storage().ref(me.prefix+Core.objectName(file.id,file.ext));
    const old=(await ref.getMetadata()).customMetadata||{};
    await ref.updateMetadata({customMetadata:{...old,...changes}});
  }
  const store={
    async list(){
      const me=await who(),found=await firebase.storage().ref(me.prefix).listAll();
      const metas=await Promise.all(found.items.filter(ref=>!ref.name.endsWith('.png')).map(ref=>ref.getMetadata()));
      return metas.map(Core.fileFromMetadata).filter(Boolean);
    },
    async folders(){
      const me=await who();
      return Core.cleanFolders((await firebase.database().ref(Core.foldersPath(me.classId)).once('value')).val());
    },
    async changeFolders(changes){
      const me=await who();
      if(!me.teacher)throw Core.plain('Only a teacher can change class folders.');
      await firebase.database().ref(Core.foldersPath(me.classId)).update(changes);
    },
    // Saves a whiteboard. With an id it replaces that saved file; without one it makes a new file.
    async saveBoard({id,name,folderId,data,picture}){
      const me=await who(),blob=new Blob([JSON.stringify(data)],{type:'application/json'});
      const problem=Core.sizeProblem('whiteboard',blob.size,me.teacher);
      if(problem)throw Core.plain(problem);
      if(!id){await checkRoom(me);id=Core.newId()}
      const folder=firebase.storage().ref(me.prefix);
      await folder.child(Core.objectName(id,'json')).put(blob,{contentType:'application/json',customMetadata:Core.fileMetadata({name,kind:'whiteboard',folderId,savedAt:Date.now()})});
      // The small picture is only for looking at the file later. The save counts without it.
      if(picture&&!Core.sizeProblem('png',picture.size))await folder.child(Core.objectName(id,'png')).put(picture,{contentType:'image/png'}).then(null,()=>{});
      return id;
    },
    async savePdf(file,{name,folderId},onProgress){
      const me=await who();
      if(file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))throw Core.plain('Please choose a PDF file.');
      const problem=Core.sizeProblem('pdf',file.size);
      if(problem)throw Core.plain(problem);
      await checkRoom(me);
      const id=Core.newId();
      const task=firebase.storage().ref(me.prefix+Core.objectName(id,'pdf')).put(file,{contentType:'application/pdf',customMetadata:Core.fileMetadata({name,kind:'pdf',folderId,savedAt:Date.now()})});
      await new Promise((resolve,reject)=>task.on('state_changed',step=>onProgress?.(step.totalBytes?Math.floor(step.bytesTransferred*100/step.totalBytes):0),reject,resolve));
      return id;
    },
    // A saved whiteboard, checked before anything is drawn from it. kind: 'student-board' or 'lesson-whiteboard'.
    async readBoard(file,kind){
      const limit=kind==='lesson-whiteboard'?Core.LIMITS.teacherBoardBytes:Core.LIMITS.boardBytes;
      const data=Core.parseBoard(await (await download(Core.objectName(file.id,'json'),limit)).text(),kind,limit);
      if(!data)throw Core.plain('This file could not be opened.');
      return data;
    },
    async readPdf(file){return download(Core.objectName(file.id,'pdf'),Core.LIMITS.pdfBytes)},
    // The picture of a saved whiteboard, or null when there is none.
    async picture(file){try{return await download(Core.objectName(file.id,'png'),Core.LIMITS.pngBytes)}catch(_){return null}},
    async rename(file,name){return patch(file,{displayName:Core.cleanName(name)||file.name})},
    async remember(file,place){return patch(file,{lastPage:String(place.page),zoom:String(place.zoom),placeAt:String(place.at)})},
    async remove(file){
      const me=await who(),folder=firebase.storage().ref(me.prefix);
      await folder.child(Core.objectName(file.id,file.ext)).delete();
      if(file.kind==='whiteboard')await folder.child(Core.objectName(file.id,'png')).delete().catch(()=>{});
    }
  };

  // ---------- Small building blocks for the windows ----------
  function h(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
  function button(text,onClick,cls){const node=h('button',cls,text);node.type='button';node.addEventListener('click',onClick);return node}
  const style=h('style',null,'.ftt-saved-dialog{width:min(640px,94vw);max-height:86vh;overflow:auto;border:1px solid #c9d4e4;border-radius:16px;padding:18px;box-shadow:0 15px 60px #10223a66;color:#172d49;background:#fff;font:16px system-ui,sans-serif}.ftt-saved-dialog::backdrop{background:#101d3888}.ftt-saved-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.ftt-saved-head h2{margin:0;font-size:22px}.ftt-saved button{cursor:pointer;min-height:40px;padding:6px 12px;border-radius:10px;border:1px solid #b8c6dc;background:#f4f7fc;color:#172d49;font:600 15px system-ui,sans-serif}.ftt-saved button.main{background:#1d5cb2;border-color:#1d5cb2;color:#fff}.ftt-saved button.danger{color:#b4232f}.ftt-saved button:disabled{opacity:.55;cursor:default}.ftt-saved input[type=text],.ftt-saved select{min-height:40px;padding:6px 10px;border:1px solid #9fb0c9;border-radius:10px;font:16px system-ui,sans-serif;max-width:100%;box-sizing:border-box}.ftt-saved label{display:block;margin:12px 0 4px;font-weight:700}.ftt-saved-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0;border-top:1px solid #e4e9f1}.ftt-saved-row.sub{padding-left:26px}.ftt-saved-name{flex:1;min-width:150px;overflow-wrap:anywhere;font-weight:700}.ftt-saved-name small{display:block;font-weight:400;color:#51627a}.ftt-saved-actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.ftt-saved-group{margin:16px 0 0;font-size:17px;color:#234ea8}.ftt-saved-note{margin:10px 0;color:#3d4f68}.ftt-saved-hint{margin:10px 0;padding:8px 12px;border-radius:10px;background:#fff7dc;border:1px solid #f1d27a}.ftt-saved-status{min-height:22px;margin:12px 0 0;font-weight:700;color:#234ea8}.ftt-saved-tabs{display:flex;gap:8px;margin:14px 0 4px}.ftt-saved-tabs button[aria-selected=true]{background:#234ea8;border-color:#234ea8;color:#fff}');
  document.head.append(style);

  function openDialog(title){
    const dialog=h('dialog','ftt-saved ftt-saved-dialog'),head=h('div','ftt-saved-head'),body=h('div'),status=h('p','ftt-saved-status');
    status.setAttribute('role','status');
    const close=button('✕',()=>dialog.close());close.setAttribute('aria-label','Close');
    head.append(h('h2',null,title),close);dialog.append(head,body,status);
    dialog.addEventListener('close',()=>dialog.remove());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
    // Typing a file name must not trigger the lesson's keyboard shortcuts underneath.
    ['keydown','keyup','paste'].forEach(type=>dialog.addEventListener(type,event=>event.stopPropagation()));
    document.body.append(dialog);dialog.showModal();
    return{dialog,body,say(text){status.textContent=text||''},fail(error){status.textContent=Core.errorText(error,teacherPage)}};
  }
  // Drop-down of the class folders. Returns {node,value()}; node is null when the class has no folders.
  function folderPicker(state,chosen){
    const options=Core.folderOptions(state);
    if(!options.length)return{node:null,value:()=>''};
    const select=h('select');select.append(new Option('No folder',''));
    for(const option of options)select.append(new Option(option.label,option.id));
    select.value=chosen&&state.folders[chosen]?chosen:'';
    return{node:select,value:()=>select.value};
  }
  // Fills "container" with files grouped by folder. actions(file) returns the buttons for one file.
  function fileList(container,files,state,actions){
    container.replaceChildren();
    const groups=Core.groupFiles(files,state);
    if(!groups.length){container.append(h('p','ftt-saved-note','Nothing saved yet.'));return}
    for(const group of groups){
      if(groups.length>1||group.folderId)container.append(h('h3','ftt-saved-group','📁 '+group.label));
      for(const file of group.files){
        const row=h('div','ftt-saved-row'),name=h('span','ftt-saved-name',(file.kind==='pdf'?'📄 ':'📝 ')+file.name);
        if(file.savedAt)name.append(h('small',null,'Saved '+new Date(file.savedAt).toLocaleDateString()));
        row.append(name,...actions(file));container.append(row);
      }
    }
  }
  // Rename and Delete buttons, the same wherever a file is listed. refresh() runs after a change.
  function manageButtons(file,ui,refresh){
    return[
      button('Rename',async()=>{
        const next=Core.cleanName(prompt('New name:',file.name)||'');if(!next||next===file.name)return;
        try{await store.rename(file,next);await refresh()}catch(error){ui.fail(error)}
      }),
      button('Delete',async()=>{
        if(!confirm('Delete "'+file.name+'"? You cannot get it back.'))return;
        try{await store.remove(file);if(current?.id===file.id)current=null;await refresh()}catch(error){ui.fail(error)}
      },'danger')
    ];
  }

  // ---------- The whiteboard on this page ----------
  // The whiteboard code offers these when it is ready; until then Save and Open say so plainly.
  function board(){
    const owner=teacherPage?window.ClassPointerPdf:window.ClassPointerBoards,read=teacherPage?'exportWhiteboard':'exportBoard',write=teacherPage?'importWhiteboard':'importBoard';
    return{
      kind:teacherPage?'lesson-whiteboard':'student-board',
      canSave:typeof owner?.[read]==='function',canOpen:typeof owner?.[write]==='function',
      read:()=>owner[read](),write:data=>owner[write](data),
      picture:async()=>{try{return typeof owner.exportPng==='function'?await owner.exportPng():null}catch(_){return null}}
    };
  }
  // The saved file this whiteboard came from or was last saved as, so Save can offer to save over it.
  let current=null;

  async function saveCurrent(){
    const ui=openDialog(teacherPage?'Save whiteboard':'Save my whiteboard');
    ui.say('Getting ready…');
    try{
      const me=await who(),api=board();
      const data=api.canSave?await api.read():null;
      if(!data)throw Core.plain(api.canSave?'Open your whiteboard first, then press Save.':'Saving is not ready on this page yet.');
      const state=me.teacher?NO_FOLDERS:await store.folders().catch(()=>NO_FOLDERS);
      const name=h('input');name.type='text';name.maxLength=Core.LIMITS.fileName;name.id='fttSavedName';name.value=current?.name||'';name.placeholder='For example: Chumash notes';
      const label=h('label',null,'Name');label.htmlFor=name.id;
      ui.body.append(label,name);
      const picker=folderPicker(state,current?.folderId||state.saveTarget);
      if(picker.node){
        const folderLabel=h('label',null,'Folder');picker.node.id='fttSavedFolder';folderLabel.htmlFor=picker.node.id;
        if(state.saveTarget)ui.body.append(h('p','ftt-saved-hint','Your teacher asked you to save in: '+Core.folderLabel(state,state.saveTarget)));
        ui.body.append(folderLabel,picker.node);
      }
      if(!me.teacher)ui.body.append(h('p','ftt-saved-note','Only you can see your saved files.'));
      const actions=h('div','ftt-saved-actions');ui.body.append(actions);
      const run=async id=>{
        const clean=Core.cleanName(name.value);
        if(!clean){ui.say('Type a name first.');name.focus();return}
        actions.querySelectorAll('button').forEach(node=>{node.disabled=true});ui.say('Saving…');
        try{
          const saved=await store.saveBoard({id,name:clean,folderId:picker.value(),data,picture:await api.picture()});
          current={id:saved,name:clean,folderId:picker.value()};
          ui.say('Saved.');setTimeout(()=>ui.dialog.close(),900);
        }catch(error){ui.fail(error);actions.querySelectorAll('button').forEach(node=>{node.disabled=false})}
      };
      if(current)actions.append(button('Save over "'+current.name+'"',()=>run(current.id),'main'),button('Save as new',()=>run(null)));
      else actions.append(button('Save',()=>run(null),'main'));
      actions.append(button('Cancel',()=>ui.dialog.close()));
      ui.say('');name.focus();
    }catch(error){ui.fail(error)}
  }

  async function openBoard(file,ui){
    const api=board();
    if(!api.canOpen){ui.say('Open your whiteboard first, then open this file.');return}
    if(!confirm('Open "'+file.name+'"? It will replace what is on the whiteboard now.'))return;
    ui.say('Opening…');
    try{
      if(!await api.write(await store.readBoard(file,api.kind)))throw Core.plain('This file could not be opened. Make sure your whiteboard is open.');
      current={id:file.id,name:file.name,folderId:file.folderId};ui.dialog.close();
    }catch(error){ui.fail(error)}
  }

  async function open(){
    const ui=openDialog('My files'),list=h('div');
    const showFiles=async()=>{
      ui.say('Loading…');
      try{
        const [files,state]=await Promise.all([store.list(),teacherPage?NO_FOLDERS:store.folders().catch(()=>NO_FOLDERS)]);
        fileList(list,files.filter(file=>file.kind==='whiteboard'),state,file=>[button('Open',()=>openBoard(file,ui),'main'),...manageButtons(file,ui,showFiles)]);
        ui.say('');
      }catch(error){list.replaceChildren();ui.fail(error)}
    };
    if(!teacherPage){
      ui.body.append(h('p','ftt-saved-note','Your saved whiteboards. Only you can see them.'),list,
        button('📂 See all my files and PDFs',()=>window.open(new URL('my-files.html',scriptUrl).href,'_blank')));
      return showFiles();
    }
    const folders=h('div');folders.hidden=true;
    const tabs=h('div','ftt-saved-tabs');tabs.setAttribute('role','tablist');
    const tab=(text,panel,show)=>{
      const node=button(text,()=>{for(const other of tabs.children)other.setAttribute('aria-selected',String(other===node));list.hidden=panel!==list;folders.hidden=panel!==folders;ui.say('');show()});
      node.setAttribute('role','tab');node.setAttribute('aria-selected',String(panel===list));tabs.append(node);
    };
    tab('My whiteboards',list,showFiles);tab('Class folders',folders,()=>showFolders(folders,ui));
    ui.body.append(tabs,list,folders);
    return showFiles();
  }

  // Teacher: make the folders students save into, and choose where they should save right now.
  async function showFolders(panel,ui){
    let state;
    ui.say('Loading…');
    try{state=await store.folders();ui.say('')}catch(error){panel.replaceChildren();ui.fail(error);return}
    // Each change is checked first, then written, then shown.
    const apply=async result=>{
      if(result.error){ui.say(result.error);return}
      try{await store.changeFolders(result.changes);state=result.state;ui.say('');draw()}catch(error){ui.fail(error)}
    };
    const add=parentId=>{
      const name=prompt(parentId?'Name of the new folder inside "'+state.folders[parentId].name+'":':'Name of the new folder (for example Chumash):');
      if(name!=null)apply(Core.addFolder(state,{id:Core.newId(),name,parentId}));
    };
    const row=(folder,parent)=>{
      const line=h('div','ftt-saved-row'+(parent?' sub':'')),chosen=state.saveTarget===folder.id;
      line.append(h('span','ftt-saved-name','📁 '+folder.name),
        button(chosen?'✓ Students save here now':'Students save here',()=>apply(Core.setSaveTarget(state,chosen?null:folder.id)),chosen?'main':''));
      if(!parent)line.append(button('＋ Folder inside',()=>add(folder.id)));
      line.append(
        button('Rename',()=>{const name=prompt('New folder name:',folder.name);if(name!=null)apply(Core.renameFolder(state,folder.id,name))}),
        button('Delete',()=>{
          if(confirm('Delete the folder "'+folder.name+'"'+(folder.children?.length?' and the folders inside it':'')+'?\n\nStudents\' files are not deleted. Files saved here will show in each student\'s "Other" list.'))apply(Core.removeFolder(state,folder.id));
        },'danger'));
      return line;
    };
    function draw(){
      panel.replaceChildren(
        h('p','ftt-saved-note','Make folders for this class, like Chumash. Students choose a folder when they save.'),
        h('p','ftt-saved-note',state.saveTarget?'Students are asked to save in: '+Core.folderLabel(state,state.saveTarget):'Students choose their own folder. Press "Students save here" on a folder to point them to it.'),
        button('＋ New folder',()=>add(null),'main'));
      for(const folder of Core.folderTree(state)){
        panel.append(row(folder,null));
        for(const child of folder.children)panel.append(row(child,folder));
      }
      panel.append(h('p','ftt-saved-note','Each student\'s saved files are private to that student. They are not listed here.'));
    }
    draw();
  }

  // ---------- Student: Save and My files on the whiteboard bar ----------
  // student-boards.js builds the bar; this script loads after it, so the bar is already there.
  const bar=teacherPage?null:document.querySelector('#myBoard .boards-bar');
  if(bar){
    const save=button('💾 Save',saveCurrent),files=button('📂 My files',open);
    save.title='Save this whiteboard in Fun Torah';files.title='Open a whiteboard you saved';
    const spacer=bar.querySelector('.boards-spacer');
    if(spacer)spacer.before(save,files);else bar.append(save,files);
  }

  window.FTTSavedWork={saveCurrent,open,store,ui:{h,button,openDialog,folderPicker,fileList,manageButtons}};
})();
