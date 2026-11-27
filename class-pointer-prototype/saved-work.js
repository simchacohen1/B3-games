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
    const items=(await firebase.storage().ref(me.prefix).listAll()).items.filter(ref=>!ref.name.endsWith('.png')&&ref.name!==Core.PREFS_ID+'.json');
    if(items.length>=limit)throw Core.plain('You already have '+limit+' saved files. Delete one, then save again.');
  }
  async function patch(file,changes){
    const me=await who(),ref=firebase.storage().ref(me.prefix+Core.objectName(file.id,file.ext));
    const old=(await ref.getMetadata()).customMetadata||{};
    await ref.updateMetadata({customMetadata:{...old,...changes}});
  }
  // Teacher only: ask the server about the students of this class (read only). The server checks that the signed-in
  // teacher is assigned to the class and the student is in it; Storage rules give teachers no access to student files.
  const STUDENT_FILES_URL='https://us-central1-b3-games.cloudfunctions.net/teacherStudentFiles';
  async function studentFilesCall(body){
    const me=await who();
    if(!me.teacher)throw Core.plain('Only a teacher can look at student files.');
    let response;
    try{response=await fetch(STUDENT_FILES_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await me.user.getIdToken()},body:JSON.stringify({...body,classId:me.classId}),cache:'no-store'})}catch(_){throw Core.plain(OFFLINE)}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Core.plain(data.error||'Student files could not be opened.');
    return data;
  }
  // A whiteboard picture small enough to store (Storage allows Core.LIMITS.pngBytes). Returns the picture as it is when it
  // already fits, a smaller PNG of it when it does not, or null when there is no picture or it cannot be made small enough.
  async function fitPicture(picture){
    if(!picture)return null;
    if(!Core.sizeProblem('png',picture.size))return picture;
    try{
      const bitmap=await createImageBitmap(picture);
      let scale=Math.min(1,1600/bitmap.width);
      for(let step=0;step<6;step++){
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        const smaller=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(smaller&&!Core.sizeProblem('png',smaller.size))return smaller;
        scale*=0.75;
      }
    }catch(_){/* not possible here: the save says so plainly */}
    return null;
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
    async saveBoard({id,name,folderId,data,picture,subject,template,fromTeacher,important}){
      const me=await who(),blob=new Blob([JSON.stringify(data)],{type:'application/json'});
      const problem=Core.sizeProblem('whiteboard',blob.size,me.teacher);
      if(problem)throw Core.plain(problem);
      // A teacher's saved whiteboard always has its picture: Send to students sends that picture, so a board saved
      // without one could never be sent. The picture is made small enough first, and it is saved before the file.
      if(me.teacher){
        picture=await fitPicture(picture);
        if(!picture)throw Core.plain('A picture of the whiteboard could not be made, so it was not saved. Open the whiteboard and try again.');
      }
      if(!id){await checkRoom(me);id=Core.newId()}
      const folder=firebase.storage().ref(me.prefix);
      if(me.teacher)await folder.child(Core.objectName(id,'png')).put(picture,{contentType:'image/png'});
      await folder.child(Core.objectName(id,'json')).put(blob,{contentType:'application/json',customMetadata:Core.fileMetadata({name,kind:'whiteboard',folderId,subject,template,fromTeacher,important,boardPages:Array.isArray(data?.pages)?data.pages.length:1,savedAt:Date.now()})});
      // A student's small picture is only for looking at the file later. The save counts without it.
      if(!me.teacher&&picture&&!Core.sizeProblem('png',picture.size))await folder.child(Core.objectName(id,'png')).put(picture,{contentType:'image/png'}).then(null,()=>{});
      return id;
    },
    async savePdf(file,{name,folderId,sheetId,subject,fromTeacher,important},onProgress){
      const me=await who();
      if(file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))throw Core.plain('Please choose a PDF file.');
      const problem=Core.sizeProblem('pdf',file.size);
      if(problem)throw Core.plain(problem);
      await checkRoom(me);
      const id=Core.newId();
      const task=firebase.storage().ref(me.prefix+Core.objectName(id,'pdf')).put(file,{contentType:'application/pdf',customMetadata:Core.fileMetadata({name,kind:'pdf',folderId,sheetId,subject,fromTeacher,important,savedAt:Date.now()})});
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
    // (page 2 and up exist only for a filled-in worksheet: id-p2.png, id-p3.png ...)
    async picture(file,page=1){try{return await download(page>1?file.id+'-p'+Math.floor(page)+'.png':Core.objectName(file.id,'png'),Core.LIMITS.pngBytes)}catch(_){return null}},
    // The student's own settings (folders, stars): one small saved file. null when they have none yet.
    async prefs(){
      try{return JSON.parse(await (await download(Core.objectName(Core.PREFS_ID,'json'),200*1024)).text())}
      catch(error){if(error?.code==='storage/object-not-found'||error instanceof SyntaxError)return null;throw error}
    },
    async savePrefs(data){
      const me=await who();
      if(me.teacher)throw Core.plain('Only a student has My files settings.');
      const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
      if(blob.size>200*1024)throw Core.plain('There are too many folders or stars to save. Delete some, then try again.');
      await firebase.storage().ref(me.prefix).child(Core.objectName(Core.PREFS_ID,'json')).put(blob,{contentType:'application/json',customMetadata:{kind:'prefs',displayName:'My files settings',savedAt:String(Date.now())}});
    },
    async rename(file,name){return patch(file,{displayName:Core.cleanName(name)||file.name})},
    async remember(file,place){return patch(file,{lastPage:String(place.page),zoom:String(place.zoom),placeAt:String(place.at)})},
    async remove(file){
      const me=await who(),folder=firebase.storage().ref(me.prefix);
      await folder.child(Core.objectName(file.id,file.ext)).delete();
      if(file.kind==='whiteboard')await folder.child(Core.objectName(file.id,'png')).delete().catch(()=>{});
      // The other page pictures of a filled-in worksheet.
      if(file.worksheet){
        const found=await folder.listAll().catch(()=>({items:[]}));
        await Promise.all(found.items.filter(ref=>ref.name.startsWith(file.id+'-p')&&ref.name.endsWith('.png')).map(ref=>ref.delete().catch(()=>{})));
      }
    },
    // A student's filled-in PDF worksheet: the marks (data), one picture per page (pictures[0] is page 1), and a name.
    // With an id it saves over that file; without one it makes a new file. Page pictures are made small enough first.
    async saveWorksheet({id,name,folderId,data,pictures,sheetId,subject}){
      const me=await who();
      if(me.teacher)throw Core.plain('Only a student fills in a worksheet.');
      const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),problem=Core.sizeProblem('whiteboard',blob.size,false);
      if(problem)throw Core.plain(problem);
      if(!pictures?.length||pictures.length>60)throw Core.plain('The worksheet pictures could not be made, so it was not saved. Try again.');
      const fitted=[];
      for(const picture of pictures){const small=await fitPicture(picture);if(!small)throw Core.plain('A page picture could not be made small enough, so the worksheet was not saved.');fitted.push(small)}
      if(!id){await checkRoom(me);id=Core.newId()}
      const folder=firebase.storage().ref(me.prefix);
      for(let index=0;index<fitted.length;index+=1)await folder.child(index?id+'-p'+(index+1)+'.png':Core.objectName(id,'png')).put(fitted[index],{contentType:'image/png'});
      await folder.child(Core.objectName(id,'json')).put(blob,{contentType:'application/json',customMetadata:Core.fileMetadata({name,kind:'whiteboard',folderId,worksheet:true,pages:fitted.length,sheetId,subject,fromTeacher:true,savedAt:Date.now()})});
      return id;
    }
  };

  // ---------- PDF worksheets (server function: the teacher sends one, the class reads it) ----------
  // Storage rules give browsers no access to classWorksheets/. The server checks the teacher or the student's class.
  const WORKSHEETS_URL='https://us-central1-b3-games.cloudfunctions.net/classWorksheets';
  async function worksheetCall(body){
    const me=await who();
    let response;
    try{response=await fetch(WORKSHEETS_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await me.user.getIdToken()},body:JSON.stringify(me.teacher?{...body,classId:me.classId}:body),cache:'no-store'})}catch(_){throw Core.plain(OFFLINE)}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Core.plain(data.error||'Worksheets could not be opened.');
    return data;
  }
  const worksheets={
    async list(){return(await worksheetCall({action:'list'})).worksheets||[]},
    // The worksheet itself, as a PDF blob (checked: a real PDF, not too big).
    async read(id){
      const{url}=await worksheetCall({action:'url',id});
      let response;try{response=await fetch(url,{cache:'no-store'})}catch(_){throw Core.plain(OFFLINE)}
      if(!response.ok)throw Core.plain('This worksheet could not be opened.');
      const blob=await response.blob();
      if(blob.size>Core.LIMITS.pdfBytes)throw Core.plain('This worksheet is too big to open.');
      return new Blob([blob],{type:'application/pdf'});
    },
    // options: {subject, important}. A subject marks each student's copy; important makes it arrive starred.
    async send(pdfId,name,options={}){return worksheetCall({action:'send',pdfId,name,subject:options.subject||'',important:options.important===true})},
    async remove(id){return worksheetCall({action:'remove',id})}
  };

  // ---------- Small building blocks for the windows ----------
  function h(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
  function button(text,onClick,cls){const node=h('button',cls,text);node.type='button';node.addEventListener('click',onClick);return node}
  const style=h('style',null,'.ftt-saved-dialog{width:min(640px,94vw);max-height:86vh;overflow:auto;border:1px solid #c9d4e4;border-radius:16px;padding:18px;box-shadow:0 15px 60px #10223a66;color:#172d49;background:#fff;font:16px system-ui,sans-serif}.ftt-saved-dialog::backdrop{background:#101d3888}.ftt-saved-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.ftt-saved-head h2{margin:0;font-size:22px}.ftt-saved button{cursor:pointer;min-height:40px;padding:6px 12px;border-radius:10px;border:1px solid #b8c6dc;background:#f4f7fc;color:#172d49;font:600 15px system-ui,sans-serif}.ftt-saved button.main{background:#1d5cb2;border-color:#1d5cb2;color:#fff}.ftt-saved button.danger{color:#b4232f}.ftt-saved button:disabled{opacity:.55;cursor:default}.ftt-saved input[type=text],.ftt-saved select{min-height:40px;padding:6px 10px;border:1px solid #9fb0c9;border-radius:10px;font:16px system-ui,sans-serif;max-width:100%;box-sizing:border-box}.ftt-saved label{display:block;margin:12px 0 4px;font-weight:700}.ftt-saved-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0;border-top:1px solid #e4e9f1}.ftt-saved-row.sub{padding-left:26px}.ftt-saved-thumb{flex:none;width:72px;height:48px;display:flex;align-items:center;justify-content:center;border:1px solid #d3dcea;border-radius:8px;background:#f4f7fc;overflow:hidden;font-size:20px}.ftt-saved-thumb.pdf{font:800 14px system-ui,sans-serif;color:#b4232f;background:#fdecee;border-color:#f0b9be}.ftt-saved-thumb img{width:100%;height:100%;object-fit:contain;background:#fff}.ftt-saved-name{flex:1;min-width:150px;overflow-wrap:anywhere;font-weight:700}.ftt-saved-name small{display:block;font-weight:400;color:#51627a}.ftt-saved-actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.ftt-saved-group{margin:16px 0 0;font-size:17px;color:#234ea8}.ftt-saved-note{margin:10px 0;color:#3d4f68}.ftt-saved-hint{margin:10px 0;padding:8px 12px;border-radius:10px;background:#fff7dc;border:1px solid #f1d27a}.ftt-saved-status{min-height:22px;margin:12px 0 0;font-weight:700;color:#234ea8}.ftt-saved-tabs{display:flex;gap:8px;margin:14px 0 4px}.ftt-saved-tabs button[aria-selected=true]{background:#234ea8;border-color:#234ea8;color:#fff}');
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
  // A yes/no question shown on the page (not the browser's grey box), above any open window. Resolves true or false.
  // Where the page cannot show a dialog it falls back to the browser's own question.
  function ask(question,yes,danger){
    const probe=h('dialog');
    if(typeof probe.showModal!=='function')return Promise.resolve(confirm(question));
    return new Promise(resolve=>{
      const dialog=h('dialog','ftt-saved ftt-saved-dialog'),actions=h('div','ftt-saved-actions');
      dialog.setAttribute('aria-label','Please confirm');dialog.style.width='min(440px,92vw)';
      let answer=false;
      actions.append(button(yes||'Yes',()=>{answer=true;dialog.close()},danger?'danger':'main'),button('Cancel',()=>dialog.close()));
      dialog.append(h('p','ftt-saved-note',question),actions);
      dialog.addEventListener('close',()=>{dialog.remove();resolve(answer)});
      ['keydown','keyup'].forEach(type=>dialog.addEventListener(type,event=>event.stopPropagation()));
      document.body.append(dialog);dialog.showModal();
    });
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
  // A teacher's own subject folder for a saved whiteboard: just a name written on the file. Suggests the folders the
  // teacher already has plus a few common subjects.
  const SUBJECT_IDEAS=['Chumash','Mishnayos','Gemara','Navi','Halacha','Dikduk','Hebrew reading','Tefillah'];
  function subjectField(existing,chosen){
    const input=h('input');input.type='text';input.id='fttSavedSubject';input.maxLength=Core.LIMITS.folderName;input.value=chosen||'';input.placeholder='For example: Chumash (or leave empty)';
    const list=h('datalist');list.id='fttSavedSubjects';
    for(const name of new Set([...existing,...SUBJECT_IDEAS])){const option=h('option');option.value=name;list.append(option)}
    input.setAttribute('list',list.id);
    const label=h('label',null,'Folder (subject)');label.htmlFor=input.id;
    return{nodes:[label,input,list],value:()=>Core.cleanName(input.value,Core.LIMITS.folderName)||''};
  }
  // Fills "container" with files grouped by folder. actions(file) returns the buttons for one file.
  function fileList(container,files,state,actions){
    container.replaceChildren();
    const groups=teacherPage?Core.groupBySubject(files):Core.groupFiles(files,state);
    if(!groups.length){container.append(h('p','ftt-saved-note',teacherPage&&files.templatesOnly?'No templates yet. Press "Make template" on a whiteboard to make one.':'Nothing saved yet.'));return}
    for(const group of groups){
      if(groups.length>1||group.folderId||group.subject)container.append(h('h3','ftt-saved-group','📁 '+group.label));
      for(const file of group.files){
        const row=h('div','ftt-saved-row'),name=h('span','ftt-saved-name',file.name);
        if(file.savedAt||file.template)name.append(h('small',null,(file.template?'⭐ Template · ':'')+(file.boardPages>1?file.boardPages+' pages · ':'')+(file.savedAt?'Saved '+savedText(file.savedAt):'')));
        row.append(thumb(file),name,...actions(file));container.append(row);
      }
    }
  }
  // "11/16/2026, 2:23 AM" in the viewer's own language and time zone.
  function savedText(time){
    const date=new Date(time);
    try{return date.toLocaleString(undefined,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})}catch(_){return date.toLocaleDateString()}
  }
  // The small picture on the left of a row: the board's saved picture, or a PDF icon. Pictures load one at a time
  // after the list is shown; a missing picture just leaves the icon.
  const thumbQueue=[];let thumbBusy=false;
  function thumb(file){
    const box=h('span','ftt-saved-thumb',file.kind==='pdf'?'PDF':'📝');
    box.setAttribute('aria-hidden','true');
    if(file.kind==='pdf')box.classList.add('pdf');
    else{thumbQueue.push({file,box});setTimeout(pumpThumbs,0)}
    return box;
  }
  async function pumpThumbs(){
    if(thumbBusy)return;thumbBusy=true;
    while(thumbQueue.length){
      const{file,box}=thumbQueue.shift();
      if(!box.isConnected)continue;
      const blob=await store.picture(file);
      if(!blob||!box.isConnected)continue;
      const img=document.createElement('img');img.alt='';img.src=URL.createObjectURL(blob);
      img.addEventListener('load',()=>URL.revokeObjectURL(img.src));
      box.replaceChildren(img);
    }
    thumbBusy=false;
  }
  // Rename and Delete buttons, the same wherever a file is listed. refresh() runs after a change.
  function manageButtons(file,ui,refresh){
    return[
      button('Rename',async()=>{
        const next=Core.cleanName(prompt('New name:',file.name)||'');if(!next||next===file.name)return;
        try{await store.rename(file,next);await refresh()}catch(error){ui.fail(error)}
      }),
      button('Delete',async()=>{
        if(!await ask('Delete "'+file.name+'"? You cannot get it back.','Delete',true))return;
        try{await store.remove(file);if(current?.id===file.id)current=null;try{window.dispatchEvent(new CustomEvent('ftt-myfiles-changed',{detail:{from:'delete'}}))}catch(_){}await refresh()}catch(error){ui.fail(error)}
      },'danger')
    ];
  }

  // ---------- The whiteboard on this page ----------
  // The whiteboard code offers these when it is ready; until then Save and Open say so plainly.
  function board(){
    const owner=teacherPage?window.ClassPointerPdf:window.ClassPointerBoards,read=teacherPage?'exportWhiteboard':'exportBoard',write=teacherPage?'importWhiteboard':'importBoard';
    return{
      kind:teacherPage?'lesson-whiteboard':'student-board',
      // Which whiteboard is open (a new one is a new id): the automatic save keeps one file for one board.
      id:()=>{try{return owner?.boardId?.()??null}catch(_){return null}},
      canSave:typeof owner?.[read]==='function',canOpen:typeof owner?.[write]==='function',
      read:()=>owner[read](),write:data=>owner[write](data),
      picture:async()=>{try{return typeof owner.exportPng==='function'?await owner.exportPng():null}catch(_){return null}}
    };
  }
  // The saved file this whiteboard came from or was last saved as, so Save can offer to save over it.
  let current=null;
  // Set when a template was just opened: the next Save starts from the template's name and folder, as a new file.
  let fromTemplate=null;

  // The lesson's name, taken from the activity page's title ("Chumash | Fun Torah Tools" gives "Chumash").
  // The site's own names and the home page are not lesson names, so they give ''.
  function lessonName(){
    const first=Core.cleanName(String(document.title||'').split(/\s[|·–—-]\s/)[0],30);
    return /^(class pointer|fun torah tools|shluchim online school|sols tools|home|student home|my files)/i.test(first)?'':first;
  }

  async function saveCurrent(){
    // Teacher with a student group's board open large: Save keeps that board (the same file Save group boards makes).
    if(teacherPage&&window.ClassPointerBoards?.groupBoardOpen?.()){
      let item=null;
      try{item=await window.ClassPointerBoards.openGroupBoardItem()}catch(error){const ui=openDialog('Save group board');ui.fail(error);return false}
      if(!item){openDialog('Save group board').say('This group board is empty. Draw something on it first, then press Save.');return false}
      return saveGroupBoards([item]);
    }
    const ui=openDialog(teacherPage?'Save whiteboard':'Save my whiteboard');
    ui.say('Getting ready…');
    try{
      const me=await who(),api=board();
      const data=api.canSave?await api.read():null;
      if(!data)throw Core.plain(api.canSave?'Open your whiteboard first, then press Save.':'Saving is not ready on this page yet.');
      const state=me.teacher?NO_FOLDERS:await store.folders().catch(()=>NO_FOLDERS);
      // A student saves with one click: no typing. The name is the lesson (when the page has one) and the Hebrew day;
      // it can be changed later in My files.
      if(!me.teacher){
        ui.say('Saving…');
        const existing=(await store.list()).map(file=>file.name);
        const title=Core.autoName({date:new Date(),lesson:lessonName(),existing});
        const savedId=await store.saveBoard({name:title,folderId:state.saveTarget&&state.folders[state.saveTarget]?state.saveTarget:'',data,picture:await api.picture()});
        // From here the automatic save keeps this file up to date as the student keeps working.
        current={id:savedId,name:title,folderId:state.saveTarget&&state.folders[state.saveTarget]?state.saveTarget:'',subject:'',template:false};fromTemplate=null;auto.noteSaved(data);
        ui.say('Saved as "'+title+'".');setTimeout(()=>ui.dialog.close(),1800);
        return;
      }
      const name=h('input');name.type='text';name.maxLength=Core.LIMITS.fileName;name.id='fttSavedName';name.value=current?.name||fromTemplate?.name||'';name.placeholder='For example: Chumash notes';
      const label=h('label',null,'Name');label.htmlFor=name.id;
      ui.body.append(label,name);
      const subject=subjectField(await store.list().then(Core.subjectsOf,()=>[]),current?current.subject:fromTemplate?.subject);
      ui.body.append(...subject.nodes);
      const asTemplate=h('input');asTemplate.type='checkbox';asTemplate.id='fttSavedTemplate';
      const templateLabel=h('label');templateLabel.append(asTemplate,' Keep as a template (opening it always gives a fresh copy; the template never changes)');
      ui.body.append(templateLabel);
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
          const saved=await store.saveBoard({id,name:clean,folderId:picker.value(),subject:subject.value(),template:asTemplate.checked,data,picture:await api.picture()});
          current=asTemplate.checked?null:{id:saved,name:clean,folderId:picker.value(),subject:subject.value(),template:false};fromTemplate=null;auto.noteSaved(data);
          ui.say('Saved as "'+clean+'". Find it in My files.');setTimeout(()=>ui.dialog.close(),2200);
        }catch(error){ui.fail(error);actions.querySelectorAll('button').forEach(node=>{node.disabled=false})}
      };
      if(current&&!current.template)actions.append(button('Save over "'+current.name+'"',()=>run(current.id),'main'),button('Save as new',()=>run(null)));
      else actions.append(button('Save',()=>run(null),'main'));
      actions.append(button('Cancel',()=>ui.dialog.close()));
      ui.say('');name.focus();
    }catch(error){ui.fail(error)}
  }

  // A template is never changed: opening it gives a fresh copy on the whiteboard that is not tied to the file, so Save
  // can only make a new file. An ordinary file opens as itself and Save can save over it.
  async function openBoard(file,ui){
    const api=board();
    if(!api.canOpen){ui.say('Open your whiteboard first, then open this file.');return}
    if(!await ask(file.template?'Open a fresh copy of the template "'+file.name+'"? It will replace what is on the whiteboard now. The template itself never changes.':'Open "'+file.name+'"? It will replace what is on the whiteboard now.','Open'))return;
    ui.say('Opening…');
    // The automatic save waits while the file is put on the board, so it never saves the half-opened board.
    auto.pause();
    try{
      if(!await api.write(await store.readBoard(file,api.kind)))throw Core.plain('This file could not be opened. Make sure your whiteboard is open.');
      current=file.template?null:{id:file.id,name:file.name,folderId:file.folderId,subject:file.subject,template:false};
      fromTemplate=file.template?{name:file.name+' – '+new Date().toLocaleDateString(),subject:file.subject}:null;
      // The opened file is this board's file now (a template is not: its copy gets a new file at the first change).
      await auto.adopt();
      ui.dialog.close();
    }catch(error){ui.fail(error)}
    finally{auto.resume()}
  }

  // ---------- Teacher: send a whiteboard to every student ----------
  // The picture goes through student-boards.js: its "Send to every whiteboard?" preview asks first, and each
  // student then has the picture on their own board with a private drawing layer of their own.
  const NOT_READY='Open the classroom first, then try again.';
  function boardsApi(){const api=window.ClassPointerBoards;return typeof api?.sendPictureToAll==='function'?api:null}
  // The current whiteboard on the lesson screen. With pages, `options` says which: {page: 2} for one page, {all:true} for
  // every page. One page (and an ordinary one-page whiteboard) goes exactly as it always did: one picture on every board.
  async function sendCurrent(options){
    if(!teacherPage)return false;
    const boards=boardsApi(),pdf=window.ClassPointerPdf,opts=options&&typeof options==='object'?options:{};
    if(!boards||typeof pdf?.exportPng!=='function'){const ui=openDialog('Send to students');ui.body.append(h('p','ftt-saved-note',NOT_READY));return false}
    const info=pdf.pagesInfo?.(),all=opts.all===true&&info&&info.count>1&&typeof pdf.exportPagePngs==='function'&&typeof boards.sendPagesToAll==='function';
    let pictures=null;
    try{
      if(all)pictures=await pdf.exportPagePngs();
      else if(info&&info.count>1&&typeof pdf.exportPagePngs==='function')pictures=await pdf.exportPagePngs(Number(opts.page)||info.current+1);
      else pictures=[await pdf.exportPng()];
    }catch(_){pictures=null}
    if(!pictures||!pictures.length||!pictures[0]){const ui=openDialog('Send to students');ui.body.append(h('p','ftt-saved-note','Open the whiteboard on the lesson first, then press Send whiteboard to students.'));return false}
    // The words, pictures, shapes and lines also go along as separate pieces, so a student can select, move and resize them.
    let pieces=null;
    try{
      if(typeof pdf.exportPieces==='function'&&typeof boards.sendPieces==='function'){
        const list=await pdf.exportPieces(all?0:info&&info.count>1?Number(opts.page)||info.current+1:0);
        if(list&&list.length&&list.some(piece=>piece.strokes.length||piece.hasBackground))pieces=list;
      }
    }catch(_){pieces=null}
    if(all)return boards.sendPagesToAll(pictures,'These are the '+pictures.length+' pages of the whiteboard as they are now. Every student gets their own copy of every page: the words, pictures and shapes can be selected, moved and resized. What they do stays on their own board.',{subject:current?.subject||'',pieces});
    return boards.sendPictureToAll(pictures[0],'This is the whiteboard as it is now. Every student gets their own copy: the words, pictures and shapes can be selected, moved and resized. What they do stays on their own board.',{subject:current?.subject||'',pieces});
  }
  // A whiteboard saved earlier. Its small picture was saved with it.
  async function sendFile(file,ui){
    const boards=boardsApi();
    if(!boards){ui.say(NOT_READY);return}
    if(file.boardPages>1){ui.say('This whiteboard has '+file.boardPages+' pages. Open it first, then press Send and choose one page or all pages.');return}
    ui.say('Getting the picture…');
    try{
      const picture=await store.picture(file);
      if(!picture)throw Core.plain('This saved whiteboard has no picture to send. Open it first, then use More, then Send whiteboard to students.');
      ui.dialog.close();
      await boards.sendPictureToAll(picture,'Saved whiteboard: '+file.name+'. Every student gets their own copy to draw on. What they draw stays on their own board.',{subject:file.subject||''});
    }catch(error){ui.fail(error)}
  }

  // The teacher's buttons for one whiteboard: open (a template opens fresh), send, folder and template.
  function teacherButtons(file,ui,refresh){
    return[
      button(file.template?'Use template':'Open',()=>openBoard(file,ui),'main'),
      button('📤 Send to students',()=>sendFile(file,ui)),
      button('Move to folder',async()=>{
        const next=prompt('Folder for "'+file.name+'" (for example Chumash). Leave empty for no folder:',file.subject||'');
        if(next==null)return;
        try{await patch(file,{subject:Core.cleanName(next,Core.LIMITS.folderName)||''});await refresh()}catch(error){ui.fail(error)}
      }),
      button(file.template?'Not a template':'Make template',async()=>{
        try{await patch(file,{template:file.template?'':'1'});await refresh()}catch(error){ui.fail(error)}
      }),
      ...manageButtons(file,ui,refresh)
    ];
  }

  async function open(){
    const ui=openDialog('My files'),list=h('div');
    let onlyTemplates=false;
    // Student pop-up: it follows what the teacher sends while it is open (see watch above).
    let seenIds=null,popSig=null;const sheetBox=h('div');
    const showFiles=async(quiet)=>{
      if(quiet!==true)ui.say('Loading…');
      try{
        const [files,state,sheets]=await Promise.all([store.list(),teacherPage?NO_FOLDERS:store.folders().catch(()=>NO_FOLDERS),teacherPage?[]:worksheets.list().catch(()=>[])]);
        if(!teacherPage){
          const sheetIds=new Set(files.map(file=>file.sheetId).filter(Boolean)),waiting=sheets.filter(sheet=>!sheetIds.has(sheet.id));
          const fresh=[...files.filter(file=>file.fromTeacher&&seenIds&&!seenIds.has(file.id)),...waiting.filter(sheet=>seenIds&&!seenIds.has('sheet-'+sheet.id))];
          seenIds=new Set([...files.map(file=>file.id),...waiting.map(sheet=>'sheet-'+sheet.id)]);
          sheetBox.replaceChildren();
          for(const sheet of waiting){
            const row=h('div','ftt-saved-row'),icon=h('span','ftt-saved-thumb','📋');icon.setAttribute('aria-hidden','true');
            const name=h('span','ftt-saved-name',sheet.name);name.append(h('small',null,'Worksheet from your teacher · New'));
            row.append(icon,name,button('Open in My files',()=>window.open(new URL('my-files.html',scriptUrl).href,'_blank'),'main'));sheetBox.append(row);
          }
          if(fresh.length)setTimeout(()=>ui.say('New from your teacher: '+(fresh.length===1?(fresh[0].name):fresh.length+' new files')),0);
        }
        const boards=files.filter(file=>file.kind==='whiteboard'&&(!(teacherPage&&onlyTemplates)||file.template));
        boards.templatesOnly=teacherPage&&onlyTemplates;
        fileList(list,boards,state,file=>teacherPage?teacherButtons(file,ui,showFiles):file.worksheet
          ?[button('Continue in My files',()=>window.open(new URL('my-files.html',scriptUrl).href,'_blank'),'main'),...manageButtons(file,ui,showFiles)]
          :[button('Open',()=>openBoard(file,ui),'main'),...manageButtons(file,ui,showFiles)]);
        ui.say('');
      }catch(error){list.replaceChildren();ui.fail(error)}
    };
    if(!teacherPage){
      ui.body.append(h('p','ftt-saved-note','Your saved whiteboards. Only you can see them.'),sheetBox,list,
        button('📂 See all my files and PDFs',()=>window.open(new URL('my-files.html',scriptUrl).href,'_blank')));
      snapshot().then(snap=>{if(popSig===null)popSig=snap.sig},()=>{});   // what is here when the pop-up opens
      const stop=watch(snap=>{if(popSig===null||snap.sig===popSig){if(popSig===null)popSig=snap.sig;return}popSig=snap.sig;return showFiles(true)});
      const again=()=>showFiles(true);window.addEventListener?.('ftt-myfiles-changed',again);
      ui.dialog.addEventListener('close',()=>{stop();window.removeEventListener?.('ftt-myfiles-changed',again)});
      return showFiles();
    }
    const folders=h('div');folders.hidden=true;
    const studentsPanel=h('div');studentsPanel.hidden=true;
    const only=h('input');only.type='checkbox';only.id='fttSavedOnlyTemplates';
    const filter=h('label');filter.append(only,' Show templates only');
    only.addEventListener('change',()=>{onlyTemplates=only.checked;showFiles()});
    const tabs=h('div','ftt-saved-tabs');tabs.setAttribute('role','tablist');
    const tab=(text,panel,show)=>{
      const node=button(text,()=>{for(const other of tabs.children)other.setAttribute('aria-selected',String(other===node));list.hidden=panel!==list;filter.hidden=panel!==list;folders.hidden=panel!==folders;studentsPanel.hidden=panel!==studentsPanel;ui.say('');show()});
      node.setAttribute('role','tab');node.setAttribute('aria-selected',String(panel===list));tabs.append(node);
    };
    tab('My whiteboards',list,showFiles);tab('Class folders',folders,()=>showFolders(folders,ui));tab('Student files',studentsPanel,()=>showStudentFiles(studentsPanel,ui));
    ui.body.append(tabs,filter,list,folders,studentsPanel);
    return showFiles();
  }

  // Teacher: look at one student's saved whiteboards and the copies of what the teacher sent them. Read only:
  // small pictures, and View opens the picture larger. Nothing here can change or delete a student's file.
  let thumbChain=Promise.resolve();
  function studentFileRow(file,studentId,studentName){
    const row=h('div','ftt-saved-row'),box=h('span','ftt-saved-thumb',file.hasPicture?'…':'📝');
    box.setAttribute('aria-hidden','true');
    const name=h('span','ftt-saved-name',file.name);
    name.append(h('small',null,(file.fromTeacher?'Sent by you · ':'')+(file.worksheet?'Worksheet, '+file.pages+(file.pages===1?' page':' pages')+' · ':'')+(file.boardPages>1?file.boardPages+' pages · ':'')+(file.savedAt?'Saved '+savedText(file.savedAt):'')));
    row.append(box,name);
    if(!file.hasPicture){name.append(h('small',null,'No picture saved for this file.'));return row}
    // One picture at a time, so a long list does not flood the server.
    thumbChain=thumbChain.then(async()=>{
      if(!box.isConnected)return;
      try{
        const img=document.createElement('img');img.alt='';
        img.src=(await studentFilesCall({action:'picture',studentId,fileId:file.id})).url;
        await new Promise(resolve=>{img.onload=resolve;img.onerror=resolve});
        box.replaceChildren(img);
      }catch(_){box.textContent='📝'}
    });
    row.append(button('View',async()=>{
      const view=openDialog(file.name+' · '+studentName);
      view.say('Loading…');
      try{
        // A filled-in worksheet has one picture per page (id, id-p2, id-p3 ...); everything else has one.
        const pages=file.worksheet?Math.max(1,Math.min(60,file.pages||1)):1;
        for(let number=1;number<=pages;number+=1){
          const img=document.createElement('img');img.alt=(file.worksheet?'Page '+number+' of the worksheet of ':'Saved whiteboard of ')+studentName;img.style.cssText='display:block;max-width:100%;height:auto;margin:0 0 10px;border:1px solid #d3dcea;border-radius:8px;background:#fff';
          img.src=(await studentFilesCall({action:'picture',studentId,fileId:number>1?file.id+'-p'+number:file.id})).url;
          await new Promise(resolve=>{img.onload=resolve;img.onerror=resolve});
          view.body.append(img);view.say(number<pages?'Loading page '+(number+1)+' of '+pages+'…':'');
        }
      }catch(error){view.fail(error)}
    },'main'));
    return row;
  }
  async function showStudentFiles(panel,ui){
    panel.replaceChildren(h('p','ftt-saved-note','Loading students…'));
    let students;
    try{students=(await studentFilesCall({action:'students'})).students||[]}catch(error){panel.replaceChildren();ui.fail(error);return}
    ui.say('');
    const select=h('select');select.id='fttStudentPick';select.append(new Option(students.length?'Choose a student…':'No students in this class',''));
    for(const student of students)select.append(new Option(student.name,student.id));
    const label=h('label',null,'Student');label.htmlFor=select.id;
    const results=h('div');
    panel.replaceChildren(h('p','ftt-saved-note','Look at your students\' saved whiteboards and the copies of what you sent them. You can only look: nothing here changes a student\'s file.'),label,select,results);
    select.addEventListener('change',async()=>{
      results.replaceChildren();
      const studentId=select.value;if(!studentId)return;
      const studentName=students.find(student=>student.id===studentId)?.name||'Student';
      ui.say('Loading…');
      try{
        const files=(await studentFilesCall({action:'files',studentId})).files||[];
        if(select.value!==studentId)return;
        ui.say('');
        if(!files.length){results.append(h('p','ftt-saved-note',studentName+' has no saved whiteboards yet.'));return}
        for(const file of files)results.append(studentFileRow(file,studentId,studentName));
      }catch(error){ui.fail(error)}
    });
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

  // ---------- Student: keep my own copy of a picture the teacher sent ----------
  // When the teacher sends a whiteboard to every board, student-boards.js calls this with the picture. It is saved once as a
  // file of the student's own in My files (private, like every other file there), as a whiteboard that shows the picture with
  // nothing drawn on it yet. Opening it later puts the picture back (student-boards.js importBoard).
  const COPIES='fttTeacherCopies:';
  const copying=new Set(),kept=new Set();
  function copyKey(data){let hash=2166136261;for(let i=0;i<data.length;i+=7){hash^=data.charCodeAt(i);hash=Math.imul(hash,16777619)}return data.length.toString(36)+'-'+(hash>>>0).toString(36)}
  function toast(text,ms){
    // A notice that cannot be shown must never undo a copy that was saved.
    try{
      const node=h('div','ftt-saved ftt-saved-toast',text);node.setAttribute('role','status');
      node.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483600;max-width:min(92vw,520px);padding:10px 16px;border-radius:12px;background:#143a73;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 8px 30px #0006';
      document.body.append(node);setTimeout(()=>node.remove(),ms||5000);
    }catch(_){}
  }
  // A small PNG of the teacher's picture, so the copy has a thumbnail in My files like any other board. Never required:
  // when it cannot be made the copy is saved without one.
  async function copyPicture(dataUrl){
    try{
      const image=new Image();image.src=dataUrl;await image.decode();
      const scale=Math.min(1,640/image.naturalWidth),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    }catch(_){return null}
  }
  // ---------- Teacher: save the boards of the student groups ----------
  // student-boards.js hands over one entry for each group: {name, pages:[JPEG picture of each page], picture: PNG of page 1}.
  // Each becomes a whiteboard file of the teacher's own: one page the old way, several pages as a pages file. The page
  // pictures are the whole group board (everyone's lines), so opening the file shows exactly what the group made.
  async function saveGroupBoards(items){
    if(!teacherPage)return false;
    const ui=openDialog('Save group boards');
    ui.say('Saving…');
    try{
      const Pages=window.ClassPointerPages,size={w:1280,h:720},day=new Date().toLocaleDateString();
      const state=await store.folders().catch(()=>NO_FOLDERS),folderId=state.saveTarget&&state.folders[state.saveTarget]?state.saveTarget:'';
      const saved=[];
      for(const item of items){
        const pages=item.pages.map(data=>({pictures:[{data,x:0,y:0,w:1,h:1}],strokes:[]}));
        if(pages.length>1&&!Pages)throw Core.plain('Pages are not ready yet. Reload the page and try again.');
        const data=pages.length===1?{version:1,kind:'lesson-whiteboard',size,...pages[0]}:{...Pages.wrap('lesson-whiteboard',pages,0),size};
        ui.say('Saving '+(saved.length+1)+' of '+items.length+'…');
        await store.saveBoard({name:Core.cleanName(item.name+' '+day),folderId,data,picture:item.picture});
        saved.push(item.name);
      }
      ui.say('Saved '+saved.length+' group board'+(saved.length===1?'':'s')+' in your whiteboard files. Open 📂 My files to find '+(saved.length===1?'it':'them')+'.');
      return true;
    }catch(error){ui.fail(error);return false}
  }

  // The same for pictures the teacher sent as pages: one file of my own with every page picture as the background of
  // a page and nothing drawn on it yet. Opening it later brings the pages back (student-boards.js importBoard).
  async function keepTeacherPages(sent){
    const pages=Array.isArray(sent?.pages)?sent.pages.filter(p=>p&&typeof p.bg==='string'):[];
    if(teacherPage||!pages.length||pages.length>20||pages.some(p=>p.bg.length>200000))return false;
    const key=/^[A-Za-z0-9_-]{8,48}$/.test(String(sent.id||''))?'id:'+sent.id:copyKey(pages.map(p=>p.bg).join(''));
    if(copying.has(key)||kept.has(key))return false;
    copying.add(key);
    try{
      const me=await who(),memory=COPIES+me.prefix;
      let seen=[];try{seen=JSON.parse(localStorage.getItem(memory)||'[]')}catch(_){}
      if(!Array.isArray(seen)||seen.includes(key))return false;
      const state=await store.folders().catch(()=>NO_FOLDERS);
      const data={version:2,kind:'student-board',current:0,activity:null,pages:pages.map(p=>({strokes:[],images:[],text:null,bg:p.bg}))};
      await store.saveBoard({name:'From your teacher '+new Date().toLocaleDateString()+' '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),folderId:state.saveTarget&&state.folders[state.saveTarget]?state.saveTarget:'',data,picture:await copyPicture(pages[0].bg),
        subject:Core.cleanName(sent.subject,Core.LIMITS.folderName),fromTeacher:true,important:sent.important===true});
      kept.add(key);seen.push(key);try{localStorage.setItem(memory,JSON.stringify(seen.slice(-30)))}catch(_){}
      toast('Your teacher sent '+pages.length+' whiteboard pages. Your own copy is saved in 📂 My files.');
      try{window.dispatchEvent(new CustomEvent('ftt-myfiles-changed',{detail:{from:'teacher'}}))}catch(_){}
      return true;
    }catch(error){
      const text=Core.errorText(error);
      if(/already have \d+ saved files/.test(text))toast('Your teacher sent whiteboard pages, but My files is full ('+Core.LIMITS.studentFiles+' files), so your copy was NOT saved. Delete a file in 📂 My files, then ask your teacher to send them again.',15000);
      return false;
    }finally{copying.delete(key)}
  }
  async function keepTeacherCopy(activity){
    if(teacherPage||activity?.kind!=='image'||typeof activity.data!=='string'||activity.data.length>420000)return false;
    // One copy for each send (its id). Older teacher pages send no id: then the picture itself decides.
    const key=/^[A-Za-z0-9_-]{8,48}$/.test(String(activity.id||''))?'id:'+activity.id:copyKey(activity.data);
    if(copying.has(key)||kept.has(key))return false;
    copying.add(key);
    try{
      const me=await who(),memory=COPIES+me.prefix;
      let seen=[];try{seen=JSON.parse(localStorage.getItem(memory)||'[]')}catch(_){}
      if(!Array.isArray(seen)||seen.includes(key))return false;
      const state=await store.folders().catch(()=>NO_FOLDERS);
      const data={version:1,kind:'student-board',strokes:[],images:[],text:null,activity:{kind:'image',data:activity.data}};
      await store.saveBoard({name:'From your teacher '+new Date().toLocaleDateString()+' '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),folderId:state.saveTarget&&state.folders[state.saveTarget]?state.saveTarget:'',data,picture:await copyPicture(activity.data),
        subject:Core.cleanName(activity.subject,Core.LIMITS.folderName),fromTeacher:true,important:activity.important===true});
      kept.add(key);seen.push(key);try{localStorage.setItem(memory,JSON.stringify(seen.slice(-30)))}catch(_){}
      toast('Your teacher sent a whiteboard. Your own copy is saved in 📂 My files.');
      try{window.dispatchEvent(new CustomEvent('ftt-myfiles-changed',{detail:{from:'teacher'}}))}catch(_){}
      return true;
    }catch(error){
      // Saving may be off or the student may be signed out: the picture is still on their board, so say nothing,
      // except when the only problem is a full My files.
      const text=Core.errorText(error);
      if(/already have \d+ saved files/.test(text))toast('Your teacher sent a whiteboard, but My files is full ('+Core.LIMITS.studentFiles+' files), so your copy was NOT saved. Delete a file in 📂 My files, then ask your teacher to send it again.',15000);
      return false;
    }finally{copying.delete(key)}
  }

  // ---------- Live update (student) ----------
  // A cheap look at what is there: the names of the saved files (one list, no downloads) and the ids of the worksheets the
  // teacher sent. sig changes when something is added or removed. watch() calls onTick(snapshot) every 30 seconds while
  // the page is showing, and at once when the student comes back to it. It never runs on a teacher page.
  async function snapshot(){
    const me=await who();
    const [found,sheets]=await Promise.all([firebase.storage().ref(me.prefix).listAll(),worksheets.list().catch(()=>null)]);
    const names=found.items.map(ref=>ref.name).filter(name=>!name.endsWith('.png')&&name!==Core.PREFS_ID+'.json').sort();
    return{sig:names.join(',')+'|'+(sheets?sheets.map(sheet=>sheet.id).sort().join(','):'-'),sheets:sheets||[]};
  }
  function watch(onTick,every=30000){
    if(teacherPage||typeof setInterval!=='function'||typeof document.addEventListener!=='function')return()=>{};
    let busy=false;
    const tick=async()=>{if(busy||document.hidden)return;busy=true;try{await onTick(await snapshot())}catch(_){/* a failed look is tried again later */}finally{busy=false}};
    const timer=setInterval(tick,every),back=()=>{if(!document.hidden)tick()};
    document.addEventListener('visibilitychange',back);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',back)};
  }

  // ---------- Auto-save ----------
  // The whiteboard on this page saves itself as you work: the teacher's whiteboard and slides, a template opened as a copy,
  // and a student's own board and the copies the teacher sent. A small chip says "Saving…" / "✓ Saved". It uses the same
  // files, folders and rules as Save (nothing new is written anywhere else), plus a copy kept on this device until the
  // save has gone through, so closing or refreshing the page loses nothing.
  //   • A board is written to ONE file for as long as it is the same board (api.id()); a new board (New Slides, a board the
  //     teacher sent, a file opened) never writes over the old one's file.
  //   • A blank board is never saved, and a board that was cleared does not replace the saved copy with nothing.
  //   • Opening a template saves the copy as a new file; the template itself never changes.
  const auto=(()=>{
    const POLL=3000,GAP=teacherPage?15000:10000,RETRY=30000,DRAFT_KEEP=14*24*3600*1000,DRAFT_MAX=2400000,MAX_DRAFTS=5;
    let boardKey=null,savedJson='',lastJson='',lastSaveAt=0,failedAt=0,paused=0,prefixKey='',offered=false,chip=null,running=Promise.resolve(),started=false;
    const draftKey=()=>prefixKey?'ftt-board-draft:'+prefixKey:'';
    // Unsaved copies kept on this device, newest first. The newest is the stored value; the copies of other boards sit in "more" (at most MAX_DRAFTS in all), so a new board never pushes an older unsaved one out.
    const nonce=Date.now().toString(36)+Math.random().toString(36).slice(2,6),mineRef=()=>nonce+':'+(boardKey||'');
    function loadDrafts(){
      const key=draftKey();if(!key)return[];
      try{
        const saved=JSON.parse(localStorage.getItem(key)||'null');if(!saved)return[];
        const {more,...top}=saved,list=[top,...(Array.isArray(more)?more:[])];
        return list.filter(item=>item&&typeof item.json==='string'&&Date.now()-Number(item.at)<DRAFT_KEEP);
      }catch(_){return[]}
    }
    function storeDrafts(list){
      const key=draftKey();if(!key)return false;
      try{
        if(!list.length){localStorage.removeItem(key);return true}
        // If the browser has no room for all of them, the oldest go first; the newest is kept whenever it fits at all.
        for(let keep=Math.min(list.length,MAX_DRAFTS);keep>=1;keep-=1){
          try{localStorage.setItem(key,JSON.stringify({...list[0],more:list.slice(1,keep)}));return true}catch(_){}
        }
      }catch(_){}
      return false;
    }
    function writeDraft(json){
      const key=draftKey();if(!key||json.length>DRAFT_MAX)return false;
      const ref=mineRef();
      return storeDrafts([{at:Date.now(),json,b:ref},...loadDrafts().filter(item=>item.b!==ref)]);
    }
    function clearDraft(json){const ref=mineRef();storeDrafts(loadDrafts().filter(item=>item.b!==ref&&(!json||item.json!==json)))}
    function dropDraft(draft){storeDrafts(loadDrafts().filter(item=>!(item.b===draft.b&&item.at===draft.at)))}
    function readDraft(){return loadDrafts()[0]||null}
    // Which file this device last saved a board to, and what the board looked like then. After a refresh the class copy of the board comes back as a new board; if it is exactly what was saved, it carries on in the same file instead of making another.
    const linkKey=()=>prefixKey?'ftt-board-last:'+prefixKey:'';
    const hash=text=>{let n=5381;for(let i=0;i<text.length;i+=1)n=((n*33)^text.charCodeAt(i))>>>0;return text.length+':'+n};
    function writeLink(id,json){const key=linkKey();if(key)try{localStorage.setItem(key,JSON.stringify({id,hash:hash(json),at:Date.now()}))}catch(_){}}
    function readLink(json){const key=linkKey();if(!key)return null;try{const link=JSON.parse(localStorage.getItem(key)||'null');return link&&typeof link.id==='string'&&link.hash===hash(json)&&Date.now()-Number(link.at)<DRAFT_KEEP?link:null}catch(_){return null}}
    // My files is full: say so where it cannot be missed, for as long as it is true.
    let full=false,banner=null,bannerMsg=null;
    function showFull(text,onDevice){
      full=true;
      const limit=(String(text).match(/already have (\d+) saved files/)||[])[1];
      if(!banner){
        banner=h('div','ftt-autosave-full');banner.setAttribute('role','alert');
        banner.style.cssText='position:fixed;left:14px;bottom:52px;z-index:2147483000;max-width:min(92vw,380px);padding:12px 14px;border-radius:14px;background:#fff7ed;color:#7c2d12;font:600 14px system-ui,sans-serif;box-shadow:0 8px 30px #0006;border:2px solid #ea580c';
        bannerMsg=h('div');banner.append(bannerMsg);
        const row=h('div');row.style.cssText='display:flex;gap:8px;margin-top:10px';
        row.append(button('Open My files',()=>{void open()},'main'));banner.append(row);
        document.body.append(banner);
      }
      bannerMsg.textContent='My files is full'+(limit?' ('+limit+' files)':'')+'. Your whiteboard is not saved in your account yet'+(onDevice?', only on this computer':' and is NOT kept on this computer either')+'. Delete a file you no longer need in My files and this will save by itself.';
      banner.hidden=false;
    }
    function hideFull(){full=false;if(banner)banner.hidden=true}
    function say(text,tone,title){
      if(!text){if(chip)chip.hidden=true;return}
      if(!chip){
        chip=h('div','ftt-autosave');chip.setAttribute('role','status');chip.setAttribute('aria-live','polite');
        chip.style.cssText='position:fixed;left:14px;bottom:14px;z-index:2147483000;padding:5px 12px;border-radius:999px;color:#fff;font:600 13px system-ui,sans-serif;pointer-events:none;box-shadow:0 2px 10px #0003';
        document.body.append(chip);
      }
      chip.hidden=false;chip.textContent=text;chip.title=title||'';chip.style.background=tone==='warn'?'#9a3412e6':tone==='busy'?'#334155e6':'#14532de6';
    }
    // A board with nothing on it (no marks, pictures or pages with pictures on them) is never saved.
    function blank(data){
      const pages=Array.isArray(data?.pages)?data.pages:[data];
      return !pages.some(page=>page&&((page.strokes&&page.strokes.length)||(page.pictures&&page.pictures.length)||(page.images&&page.images.length)));
    }
    const unique=(base,existing)=>{
      const taken=new Set(existing.map(item=>Core.cleanName(item))),first=Core.cleanName(base);
      if(!taken.has(first))return first;
      for(let n=2;n<1000;n+=1){const next=Core.cleanName(first+' ('+n+')');if(!taken.has(next))return next}
      return Core.cleanName(first+' ('+Date.now().toString(36)+')');
    };
    // Writes the board to its file (a new one the first time). Returns the file, or throws.
    async function write(api,data){
      const me=await who();prefixKey=me.prefix;
      let file=null;
      if(current&&!current.template){
        // Keep the name, folder and star the owner gave the file in My files since the last save.
        try{const found=Core.fileFromMetadata(await firebase.storage().ref(me.prefix).child(Core.objectName(current.id,'json')).getMetadata());file=found&&!found.template?found:null}
        catch(error){if(error?.code!=='storage/object-not-found')throw error}
        if(!file)current=null;
      }
      let name,folderId,subject;
      if(file){name=file.name;folderId=file.folderId||'';subject=file.subject||''}
      else{
        const state=me.teacher?NO_FOLDERS:await store.folders().catch(()=>NO_FOLDERS),existing=(await store.list().catch(()=>[])).map(item=>item.name);
        name=fromTemplate?.name?unique(fromTemplate.name,existing):Core.autoName({date:new Date(),lesson:lessonName(),existing});
        folderId=state.saveTarget&&state.folders[state.saveTarget]?state.saveTarget:'';subject=fromTemplate?.subject||'';
      }
      const id=await store.saveBoard({id:file?file.id:undefined,name,folderId,subject,fromTeacher:file?.fromTeacher,important:file?.important,data,picture:await api.picture()});
      return{id,name,folderId,subject,template:false,created:!file};
    }
    async function step(force){
      if(paused)return{ok:false,reason:'busy'};
      const api=board();if(!api.canSave)return{ok:true,blank:true};
      let data=null;try{data=await api.read()}catch(_){data=null}
      if(!data){say('');return{ok:true,blank:true}}
      const key=api.id?api.id():null;
      // A different board from the one that was being saved: it starts its own file.
      const json=JSON.stringify(data);
      if(key!==boardKey){
        boardKey=key;current=null;savedJson='';lastJson='';failedAt=0;
        // The same board as was last saved on this device (a refresh brought it back): keep using that file.
        if(!fromTemplate&&!blank(data)){
          // On a page that has only just opened nobody has been looked up yet: find out whose files these are first.
          if(!prefixKey)try{prefixKey=(await who()).prefix}catch(_){}
          const link=readLink(json);if(link){current={id:link.id,name:'',folderId:'',subject:'',template:false};savedJson=json;if(!offered)void offerRestore(api)}}
      }
      lastJson=json;
      if(blank(data)){
        if(!offered)offerRestore(api);
        if(!savedJson)say('');
        return{ok:true,blank:true};
      }
      if(json===savedJson){say('✓ Saved');return{ok:true,id:current?.id}}
      const onDevice=writeDraft(json);
      if(!force&&(Date.now()-lastSaveAt<GAP||Date.now()-failedAt<RETRY)){say(failedAt&&Date.now()-failedAt<RETRY?(onDevice?'⚠ Saved on this device only':'⚠ Not saved yet'):'● Changes not saved yet',failedAt?'warn':'busy');return{ok:false,reason:'waiting'}}
      say('Saving…','busy');
      try{
        // With no connection an upload would just wait for minutes: say so at once. The copy on this device is already kept, and the save is tried again when the connection is back.
        if(typeof navigator!=='undefined'&&navigator.onLine===false)throw Core.plain('You are offline. Your work is kept on this computer and will save when you are back online.');
        const saved=await write(api,data);
        // The board may have been replaced while it was uploading: that file stays, but it is not the new board's file.
        if((api.id?api.id():null)===key){current={id:saved.id,name:saved.name,folderId:saved.folderId,subject:saved.subject,template:false};fromTemplate=null;savedJson=json}
        lastSaveAt=Date.now();failedAt=0;clearDraft(json);hideFull();say('✓ Saved');
        if((api.id?api.id():null)===key)writeLink(saved.id,json);
        if(saved.created)try{window.dispatchEvent(new CustomEvent('ftt-myfiles-changed',{detail:{from:'autosave'}}))}catch(_){}
        return{ok:true,id:saved.id};
      }catch(error){
        failedAt=Date.now();
        const text=Core.errorText?Core.errorText(error):String(error?.message||error);
        // Who is saving is known by now (unless nobody is signed in), so the copy on this device can be kept under their id.
        const kept=onDevice||writeDraft(json);
        const limitHit=/already have \d+ saved files/.test(text);if(limitHit)showFull(text,kept);
        say(text===SIGN_IN?'⚠ Not saved: sign in to save':limitHit?'⚠ My files full – not saved':kept?'⚠ Saved on this device only':'⚠ Not saved yet','warn',text);
        return{ok:false,error:text};
      }
    }
    // One step at a time, so a save never overlaps the next one.
    function run(force){const next=running.then(()=>step(force));running=next.catch(()=>{});return next}
    // A copy of the last board that was never saved (the page was closed or refreshed first): offer to bring it back.
    async function offerRestore(api){
      offered=true;
      // Only the person signed in on this device is offered their own copy (it is kept under their own id).
      try{prefixKey=(await who()).prefix}catch(_){return}
      const draft=readDraft();if(!draft||!api.canOpen)return;
      // A copy that is the board already saved is nothing to bring back.
      if(draft.json===savedJson){dropDraft(draft);return offerRestore(api)}
      let data=null;try{data=JSON.parse(draft.json)}catch(_){dropDraft(draft);return offerRestore(api)}
      if(!data||data.kind!==api.kind||blank(data)){dropDraft(draft);return offerRestore(api)}
      // The board may have been used while the sign-in was checked: then keep it as it is.
      let now=null;try{now=await api.read()}catch(_){}
      // Only a board with nothing on it, or one that is exactly what is already saved, can be replaced: never one with unsaved work.
      if(!now||!(blank(now)||(savedJson&&JSON.stringify(now)===savedJson)))return;
      const box=h('div','ftt-autosave-restore');box.setAttribute('role','alertdialog');box.setAttribute('aria-label','Restore your whiteboard');
      box.style.cssText='position:fixed;left:14px;bottom:52px;z-index:2147483000;max-width:min(92vw,360px);padding:12px 14px;border-radius:14px;background:#fff;color:#1f2937;font:600 14px system-ui,sans-serif;box-shadow:0 8px 30px #0006;border:2px solid #2563eb';
      const when=new Date(draft.at).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});
      box.append(h('div',null,'Your last whiteboard ('+when+') was not saved before the page closed.'));
      const row=h('div');row.style.cssText='display:flex;gap:8px;margin-top:10px';
      row.append(button('Bring it back',async()=>{
        box.remove();paused++;
        try{if(!await api.write(data))throw Core.plain('Open your whiteboard first, then try again.');dropDraft(draft)}
        catch(error){say('⚠ Could not bring it back','warn',Core.errorText?Core.errorText(error):'')}
        finally{paused--}
        void run(true);
      },'main'),button('Not now',()=>{box.remove();dropDraft(draft);void offerRestore(api)}));
      box.append(row);document.body.append(box);
    }
    function start(){
      if(started||typeof setInterval!=='function')return;started=true;
      setInterval(()=>{void run(false)},POLL);
      // A file was deleted in My files: if the board was waiting for room, save it now instead of at the next retry.
      window.addEventListener?.('online',()=>{failedAt=0;void run(true)});
      window.addEventListener?.('ftt-myfiles-changed',event=>{if(full&&event?.detail?.from!=='autosave'){failedAt=0;void run(true)}});
      // Leaving the page: keep what is there on this device at once, and try to save it too.
      const leaving=()=>{if(lastJson&&lastJson!==savedJson){let blankNow=true;try{blankNow=blank(JSON.parse(lastJson))}catch(_){}if(!blankNow)writeDraft(lastJson)}};
      window.addEventListener('pagehide',leaving);
      document.addEventListener('visibilitychange',()=>{if(document.hidden){leaving();void run(true)}});
    }
    return{
      start,
      // Saves now (waiting for any save in progress). {ok:true} when the board is saved or has nothing on it.
      flush:()=>run(true),
      pause(){paused++},resume(){paused=Math.max(0,paused-1)},
      // A file was opened onto the board (or saved by hand): this board now lives in that file and is up to date.
      async adopt(){
        const api=board();let data=null;try{data=api.canSave?await api.read():null}catch(_){}
        boardKey=api.id?api.id():null;savedJson=data?JSON.stringify(data):'';lastJson=savedJson;lastSaveAt=Date.now();failedAt=0;offered=true;
      },
      noteSaved(data){try{savedJson=JSON.stringify(data);if(current?.id)writeLink(current.id,savedJson);lastSaveAt=Date.now();failedAt=0;boardKey=board().id?.()??boardKey;clearDraft(savedJson);say('✓ Saved')}catch(_){}}
    };
  })();
  auto.start();

  window.FTTSavedWork={saveCurrent,open,sendCurrent,saveGroupBoards,keepTeacherCopy,keepTeacherPages,store,worksheets,snapshot,watch,auto,ui:{h,button,openDialog,folderPicker,fileList,manageButtons}};
})();
