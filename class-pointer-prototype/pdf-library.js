'use strict';
/* Private teacher-only PDF library. Firebase Storage rules enforce ownership by auth UID. */
(function(){
  const panel=document.getElementById('teacherPanel');
  // Never initialize the library on student pages, even though both panels exist in the HTML.
  if(!panel||new URL(location.href).searchParams.get('dashboard')!=='teacher'||!window.ClassPointerBridge?.isTeacher)return;
  const trigger=document.createElement('button');trigger.id='pointerPdfLibrary';trigger.type='button';trigger.textContent='📚 My PDF Library';trigger.title='Your private saved lesson PDFs';
  document.getElementById('openPdf')?.after(trigger);
  const dialog=document.createElement('dialog');dialog.id='pointerPdfLibraryDialog';dialog.className='pointer-library-dialog';
  dialog.innerHTML='<div class="pointer-library-header"><h2>My PDF Library</h2><button type="button" id="pointerLibraryClose">✕</button></div><p>Only you can browse these saved PDFs. Students see a file only when you present it.</p><div class="pointer-library-actions"><button id="pointerLibrarySave" type="button">Save current PDF</button><span id="pointerLibraryStatus" role="status"></span></div><div id="pointerLibraryItems"></div>';
  document.body.append(dialog);
  const close=dialog.querySelector('#pointerLibraryClose'),save=dialog.querySelector('#pointerLibrarySave'),status=dialog.querySelector('#pointerLibraryStatus'),items=dialog.querySelector('#pointerLibraryItems');
  const style=document.createElement('style');style.textContent='.pointer-library-dialog{max-width:min(660px,94vw);width:660px;max-height:82vh;overflow:auto;border:1px solid #c9d4e4;border-radius:16px;padding:18px;box-shadow:0 15px 60px #10223a66;color:#172d49;background:#fff}.pointer-library-dialog::backdrop{background:#101d3888}.pointer-library-header,.pointer-library-row,.pointer-library-actions{display:flex;align-items:center;gap:12px;justify-content:space-between}.pointer-library-row{border-top:1px solid #e4e9f1;padding:12px 0;flex-wrap:wrap}.pointer-library-row strong{overflow-wrap:anywhere;flex:1;min-width:160px}.pointer-library-row button{white-space:nowrap}.pointer-library-actions{justify-content:flex-start;flex-wrap:wrap;margin:14px 0}.pointer-library-dialog button{cursor:pointer}';document.head.append(style);
  const auth=()=>window.firebase?.auth?.().currentUser||null;
  const storage=()=>window.firebase?.storage?.()||null;
  async function teacherPrefix(){
    // Do not trust the URL or the hidden teacher panel: await real class-scoped authorization.
    const ready=window.ClassPointerDashboard?.ready;
    if(!ready)throw Error('Open the PDF Library from an authorized teacher classroom.');
    const context=await ready;
    const user=auth();
    if(!user||user.uid!==context.user?.uid||!storage())throw Error('Sign in as an authorized teacher to use the library.');
    return storage().ref('pointerPdfLibrary/'+user.uid+'/');
  }
  // Authenticated Firebase Storage request, not a reusable public getDownloadURL token.
  async function privateDownload(ref){
    await teacherPrefix();
    const user=auth();
    const token=await user.getIdToken();
    const url='https://firebasestorage.googleapis.com/v0/b/'+encodeURIComponent(ref.bucket)+'/o/'+encodeURIComponent(ref.fullPath)+'?alt=media';
    const response=await fetch(url,{headers:{Authorization:'Firebase '+token},cache:'no-store'});
    if(!response.ok)throw Error('Private PDF download failed ('+response.status+'). Check your Storage access and CORS settings.');
    const length=Number(response.headers.get('content-length')||'0');
    if(length>50*1024*1024)throw Error('This saved PDF is larger than the 50 MB library limit.');
    const blob=await response.blob();
    if(blob.size>50*1024*1024)throw Error('This PDF is too large to open from the library.');
    return blob;
  }
  const errorText=e=>e?.code==='storage/unauthorized'?'Library access was denied. Please sign in as your teacher account.':(e?.message||'Library unavailable. Check Firebase Storage and its security rules.');
  let currentFile=null,activeId=null,openedPage=1;
  const setStatus=s=>{status.textContent=s};
  async function refresh(){
    items.replaceChildren();setStatus('Loading…');
    try{
      const own=await teacherPrefix();
      const result=await own.listAll();
      const entries=await Promise.all(result.items.map(async ref=>({ref,meta:await ref.getMetadata()})));
      entries.sort((a,b)=>new Date(b.meta.updated)-new Date(a.meta.updated));
      if(!entries.length){items.textContent='No saved PDFs yet.';setStatus('');return}
      for(const {ref,meta} of entries){
        const row=document.createElement('div');row.className='pointer-library-row';
        const name=document.createElement('strong');name.textContent=meta.customMetadata?.displayName||meta.name.replace(/\.pdf$/i,'');
        const page=Number.parseInt(meta.customMetadata?.lastPage||'1',10);
        const open=document.createElement('button');open.textContent='Open';open.type='button';
        open.onclick=async()=>{setStatus('Opening '+name.textContent+'…');open.disabled=true;try{
          const blob=await privateDownload(ref);
          const file=new File([blob],name.textContent+'.pdf',{type:'application/pdf'});
          const opened=await window.ClassPointerPdf.openFile(file);if(!opened)throw Error('PDF could not be opened');activeId=meta.name;openedPage=Number.isFinite(page)&&page>0?page:1;
          window.ClassPointerPdf.goToPage(openedPage-1);dialog.close();
        }catch(e){setStatus(errorText(e))}finally{open.disabled=false}};
        const rename=document.createElement('button');rename.textContent='Rename';rename.type='button';
        rename.onclick=async()=>{const next=prompt('New PDF name:',name.textContent);if(!next?.trim())return;try{await ref.updateMetadata({customMetadata:{...(meta.customMetadata||{}),displayName:next.trim().slice(0,100)}});await refresh()}catch(e){setStatus(errorText(e))}};
        const remove=document.createElement('button');remove.textContent='Delete';remove.type='button';
        remove.onclick=async()=>{if(!confirm('Delete "'+name.textContent+'" from your private library?'))return;try{await ref.delete();if(activeId===meta.name)activeId=null;await refresh()}catch(e){setStatus(errorText(e))}};
        row.append(name,open,rename,remove);items.append(row);
      }
      setStatus('');
    }catch(e){setStatus(errorText(e))}
  }
  trigger.onclick=()=>{dialog.showModal();refresh()};
  close.onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
  save.onclick=async()=>{
    if(!currentFile){setStatus('Open a PDF from your computer first.');return}
    const displayName=(prompt('Save as:',currentFile.name.replace(/\.pdf$/i,''))||'').trim();
    if(!displayName)return;
    if(currentFile.size>50*1024*1024){setStatus('The library supports files up to 50 MB. Larger PDFs can still be presented without saving.');return}
    save.disabled=true;setStatus('Saving…');
    try{
      const id=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)) + '.pdf';
      const ref=(await teacherPrefix()).child(id);
      await ref.put(currentFile,{contentType:'application/pdf',customMetadata:{displayName:displayName.slice(0,100),lastPage:String(Math.max(1,window.ClassPointerPdf.currentPage()+1))}});
      activeId=id;setStatus('Saved privately.');await refresh();
    }catch(e){setStatus(errorText(e))}finally{save.disabled=false}
  };
  let pageTimer;
  window.PointerPdfLibrary={
    onOpened(file){currentFile=file;activeId=null;clearTimeout(pageTimer)},
    onClosed(){currentFile=null;activeId=null;clearTimeout(pageTimer)},
    onPageChanged(page){
      openedPage=page;
      if(!activeId)return;
      clearTimeout(pageTimer);const id=activeId;
      pageTimer=setTimeout(async()=>{
        if(activeId!==id)return;
        try{const ref=(await teacherPrefix()).child(id);const m=await ref.getMetadata();await ref.updateMetadata({customMetadata:{...(m.customMetadata||{}),lastPage:String(page)}})}catch(_){}
      },2500);
    }
  };
})();
