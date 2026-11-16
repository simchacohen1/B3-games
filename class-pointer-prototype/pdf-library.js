'use strict';
/* Private teacher-only PDF library. Firebase Storage rules enforce ownership by auth UID. */
(function(){
  const panel=document.getElementById('teacherPanel');
  // Never initialize the library on student pages, even though both panels exist in the HTML.
  if(!panel||new URL(location.href).searchParams.get('dashboard')!=='teacher'||!window.ClassPointerBridge?.isTeacher)return;
  const trigger=document.createElement('button');trigger.id='pointerPdfLibrary';trigger.type='button';trigger.textContent='📚 PDF Library';trigger.title='Open your private saved lesson PDFs';
  // The redesigned teacher workspace hides old .session-controls buttons. Put
  // this action in the visible teaching dock, beside Present, including fullscreen.
  const dock=document.getElementById('teacherDock');
  const presentMenu=dock?.querySelector('#tbShareMenu');
  const presentWrap=presentMenu?.closest('.tb-menu-wrap');
  if(presentWrap){
    trigger.className='tb-btn pointer-pdf-library-trigger';
    presentWrap.after(trigger);
    const menuItem=document.createElement('button');menuItem.type='button';menuItem.textContent='📚 My PDF Library';
    menuItem.addEventListener('click',()=>{
      presentMenu.hidden=true;
      presentWrap.querySelector('[data-menu="tbShareMenu"]')?.setAttribute('aria-expanded','false');
      trigger.click();
    });
    const showPdf=Array.from(presentMenu.querySelectorAll('button')).find(btn=>btn.textContent?.trim()==='Show a PDF');
    if(showPdf)showPdf.after(menuItem);else presentMenu.append(menuItem);
  }else{
    // Fallback stays visible even if the toolbar fails to initialize.
    const oldControls=panel.querySelector('.session-controls');
    if(oldControls)oldControls.after(trigger);else panel.prepend(trigger);
  }
  const MAX_PDF_BYTES=500*1024*1024;
  const dialog=document.createElement('dialog');dialog.id='pointerPdfLibraryDialog';dialog.className='pointer-library-dialog';
  dialog.innerHTML='<div class="pointer-library-header"><h2>My PDF Library</h2><button type="button" id="pointerLibraryClose">✕</button></div><p>Only you can browse these saved PDFs. Students see a file only when you present it or send it as a worksheet.</p><div class="pointer-library-actions"><button id="pointerLibrarySave" type="button">⬆ Upload from computer</button><input id="pointerLibraryFile" type="file" accept="application/pdf,.pdf" hidden><span id="pointerLibraryStatus" role="status"></span></div><div class="pointer-library-upload-meter"><progress id="pointerLibraryProgress" value="0" max="100" aria-label="PDF upload progress" hidden></progress><span id="pointerLibraryProgressLabel" aria-live="polite" hidden></span></div><div id="pointerLibraryItems"></div>';
  document.body.append(dialog);
  const close=dialog.querySelector('#pointerLibraryClose'),save=dialog.querySelector('#pointerLibrarySave'),status=dialog.querySelector('#pointerLibraryStatus'),items=dialog.querySelector('#pointerLibraryItems');
  const progress=dialog.querySelector('#pointerLibraryProgress'),progressLabel=dialog.querySelector('#pointerLibraryProgressLabel');
  const style=document.createElement('style');style.textContent='.pointer-library-dialog{max-width:min(660px,94vw);width:660px;max-height:82vh;overflow:auto;border:1px solid #c9d4e4;border-radius:16px;padding:18px;box-shadow:0 15px 60px #10223a66;color:#172d49;background:#fff}.pointer-library-dialog::backdrop{background:#101d3888}.pointer-library-header,.pointer-library-row,.pointer-library-actions{display:flex;align-items:center;gap:12px;justify-content:space-between}.pointer-library-row{border-top:1px solid #e4e9f1;padding:12px 0;flex-wrap:wrap}.pointer-library-row strong{overflow-wrap:anywhere;flex:1;min-width:160px}.pointer-library-row button{white-space:nowrap}.pointer-library-actions{justify-content:flex-start;flex-wrap:wrap;margin:14px 0}.pointer-library-dialog button{cursor:pointer}.pointer-library-upload-meter{display:flex;align-items:center;gap:10px;margin:6px 0}.pointer-library-upload-meter progress{width:min(260px,55vw);height:14px;accent-color:#1d5cb2}.pointer-library-upload-meter [hidden]{display:none}';document.head.append(style);
  // Worksheets already sent to this class (the server keeps them; students read them from My files).
  const fileInput=dialog.querySelector('#pointerLibraryFile');
  const sentBox=document.createElement('div');items.after(sentBox);
  async function refreshSent(){
    sentBox.replaceChildren();
    const api=window.FTTSavedWork?.worksheets;if(!api)return;
    try{
      const list=await api.list();
      if(!list.length)return;
      const title=document.createElement('h3');title.textContent='Worksheets sent to this class';sentBox.append(title);
      for(const sheet of list){
        const row=document.createElement('div');row.className='pointer-library-row';
        const label=document.createElement('strong');label.textContent=sheet.name;
        const stop=document.createElement('button');stop.type='button';stop.textContent='Stop sharing';
        stop.onclick=async()=>{
          if(!confirm('Stop sharing "'+sheet.name+'"? Students who already have their copy keep it.'))return;
          stop.disabled=true;
          try{await api.remove(sheet.id);await refreshSent()}catch(e){setStatus(errorText(e));stop.disabled=false}
        };
        row.append(label,stop);sentBox.append(row);
      }
    }catch(_){/* the library works without this list */}
  }
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
    let response;
    try{
      response=await fetch(url,{headers:{Authorization:'Firebase '+token},cache:'no-store'});
    }catch(error){
      throw Error('Could not reach this saved PDF. Check your connection and try again. Your saved PDF has not been deleted.');
    }
    if(!response.ok)throw Error('Private PDF download failed (HTTP '+response.status+'). Check your Firebase Storage permissions. Your saved PDF has not been deleted.');
    const length=Number(response.headers.get('content-length')||'0');
    if(length>MAX_PDF_BYTES)throw Error('This saved PDF is larger than the 500 MB library limit.');
    let blob;
    try{
      // fetch() can resolve after headers arrive, then reject while consuming a
      // dropped/aborted response body. Keep that browser TypeError out of status.
      blob=await response.blob();
    }catch(error){
      throw Error('The PDF download was interrupted. Your saved PDF has not been deleted; please try again.');
    }
    if(blob.size>MAX_PDF_BYTES)throw Error('This PDF is too large to open from the library (500 MB maximum).');
    return blob;
  }
  const errorText=e=>e?.code==='storage/unauthorized'?'Library access was denied. Please sign in as your teacher account.':(e?.message||'Library unavailable. Check Firebase Storage and its security rules.');
  let currentFile=null,activeId=null,openedPage=1;
  const setStatus=s=>{status.textContent=s};
  async function refresh(successMessage=''){
    items.replaceChildren();setStatus('Loading…');
    try{
      const own=await teacherPrefix();
      const result=await own.listAll();
      const entries=await Promise.all(result.items.map(async ref=>({ref,meta:await ref.getMetadata()})));
      entries.sort((a,b)=>new Date(b.meta.updated)-new Date(a.meta.updated));
      if(!entries.length){items.textContent='No saved PDFs yet.';setStatus(successMessage);return}
      for(const {ref,meta} of entries){
        const row=document.createElement('div');row.className='pointer-library-row';
        const name=document.createElement('strong');name.textContent=meta.customMetadata?.displayName||meta.name.replace(/\.pdf$/i,'');
        const page=Number.parseInt(meta.customMetadata?.lastPage||'1',10);
        let savedLayout=null;try{const l=JSON.parse(meta.customMetadata?.layout||'null');if(l&&typeof l==='object')savedLayout={spread:!!l.spread,rtl:l.rtl!==false,shift:!!l.shift}}catch(_){}
        const open=document.createElement('button');open.textContent='Open';open.type='button';
        open.onclick=async()=>{setStatus('Opening '+name.textContent+'…');open.disabled=true;try{
          const blob=await privateDownload(ref);
          const file=new File([blob],name.textContent+'.pdf',{type:'application/pdf'});
          const opened=await window.ClassPointerPdf.openFile(file);if(!opened)throw Error('PDF could not be opened');
          // Keep the saved page in its own variable: changing the layout reports "page 1" back
          // through onPageChanged, which must not replace the page we are about to resume on.
          const resumePage=Number.isFinite(page)&&page>0?page:1;
          if(savedLayout){
            // The viewer keeps the layout of the PDF that was open before, so put this PDF's own layout back.
            const now=window.ClassPointerPdf.getLayout();
            if(savedLayout.spread?(!now.spread||now.rtl!==savedLayout.rtl||now.shift!==savedLayout.shift):now.spread)window.ClassPointerPdf.setLayout(savedLayout);
          }
          // Only start remembering once the saved layout is back, so opening never saves "page 1".
          activeId=meta.name;openedPage=resumePage;notify();
          window.ClassPointerPdf.goToPage(resumePage-1);dialog.close();
        }catch(e){setStatus(errorText(e))}finally{open.disabled=false}};
        const rename=document.createElement('button');rename.textContent='Rename';rename.type='button';
        rename.onclick=async()=>{const next=prompt('New PDF name:',name.textContent);if(!next?.trim())return;try{await ref.updateMetadata({customMetadata:{...(meta.customMetadata||{}),displayName:next.trim().slice(0,100)}});await refresh()}catch(e){setStatus(errorText(e))}};
        const remove=document.createElement('button');remove.textContent='Delete';remove.type='button';
        remove.onclick=async()=>{if(!confirm('Delete "'+name.textContent+'" from your private library?'))return;try{await ref.delete();if(activeId===meta.name)activeId=null;if(pendingSave?.id===meta.name){clearTimeout(pageTimer);pendingSave=null}await refresh()}catch(e){setStatus(errorText(e))}};
        const send=document.createElement('button');send.textContent='📤 Send to class';send.type='button';send.title='Every student in this class gets their own copy to fill in';
        send.onclick=async()=>{
          const api=window.FTTSavedWork?.worksheets;
          if(!api){setStatus('Sending is not ready on this page yet. Refresh the page and try again.');return}
          if(!confirm('Send "'+name.textContent+'" to every student in this class?\n\nEach student gets their own copy to fill in (write, type, highlight) and saves it in their My files. You can see their copies in My files, then Student files.'))return;
          send.disabled=true;setStatus('Sending…');
          try{const sent=await api.send(meta.name,name.textContent);setStatus('Sent "'+sent.name+'" to the class.');await refreshSent()}catch(e){setStatus(errorText(e))}finally{send.disabled=false}
        };
        row.append(name,open,send,rename,remove);items.append(row);
      }
      setStatus(successMessage);
    }catch(e){setStatus(errorText(e))}
  }
  trigger.onclick=()=>{dialog.showModal();refresh();refreshSent()};
  close.onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
  // ---- Save the open PDF into the library: one click from the PDF view, nothing to type ----
  let saving=false;
  function notify(){try{document.dispatchEvent(new CustomEvent('pointer-pdf-library-state',{detail:{open:!!currentFile||!!activeId,saved:!!activeId&&!saving,saving}}))}catch(_){/* the Save button on the PDF view just keeps its last state */}}
  function toast(text){
    try{
      document.querySelector('.pointer-library-toast')?.remove();
      const node=document.createElement('div');node.className='pointer-library-toast';node.setAttribute('role','status');node.textContent=text;
      node.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483600;max-width:min(92vw,520px);padding:10px 16px;border-radius:12px;background:#143a73;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 8px 30px #0006';
      document.body.append(node);setTimeout(()=>node.remove(),4500);
    }catch(_){}
  }
  // The message shows in the library window when it is open, and as a small notice when it is not.
  const say=text=>{setStatus(text);if(!dialog.open&&text)toast(text)};
  async function saveCurrentPdf(){
    if(saving)return false;
    if(!currentFile){say('Open a PDF first, then save it.');return false}
    if(activeId){say('This PDF is already in your library.');return true}
    const file=currentFile;
    if(file.size>MAX_PDF_BYTES){say('The library supports PDFs up to 500 MB. You can still present larger PDFs without saving.');return false}
    const displayName=(file.name.replace(/\.pdf$/i,'').trim()||'PDF').slice(0,100);
    saving=true;notify();
    progress.hidden=false;progressLabel.hidden=false;progress.value=0;
    progressLabel.textContent='0%';say('Saving to your library…');
    try{
      const id=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)) + '.pdf';
      const ref=(await teacherPrefix()).child(id);
      const upload=ref.put(file,{contentType:'application/pdf',customMetadata:{displayName,lastPage:String(Math.max(1,window.ClassPointerPdf.currentPage()+1)),layout:JSON.stringify(window.ClassPointerPdf.getLayout())}});
      await new Promise((resolve,reject)=>upload.on('state_changed',snapshot=>{
        const total=snapshot.totalBytes||file.size;
        const percent=total?Math.min(100,Math.floor(snapshot.bytesTransferred*100/total)):0;
        progress.value=percent;
        progressLabel.textContent=percent+'% ('+(snapshot.bytesTransferred/1048576).toFixed(1)+' of '+(total/1048576).toFixed(1)+' MB)';
        setStatus('Saving to your library… '+percent+'%');
      },reject,resolve));
      progress.value=100;progressLabel.textContent='100% — upload complete';
      if(currentFile===file)activeId=id;
      saving=false;notify();
      say('Saved to your PDF library as "'+displayName+'".');
      if(dialog.open)await refresh('Saved privately.');
      return true;
    }catch(e){say(errorText(e));progressLabel.textContent='Upload not completed';return false}
    finally{saving=false;notify()}
  }
  // "Upload from computer": choose a PDF, it opens for teaching and is saved in the library at the same time.
  save.onclick=()=>fileInput.click();
  fileInput.onchange=async()=>{
    const file=fileInput.files[0];fileInput.value='';
    if(!file)return;
    if(!window.ClassPointerPdf?.openFile){setStatus('The PDF viewer is not ready yet. Try again in a moment.');return}
    dialog.close();
    if(await window.ClassPointerPdf.openFile(file))await saveCurrentPdf();
  };
  let pageTimer,pendingSave=null;
  // Remember where the teacher is (page) and how it is laid out (one or two pages) for the next time.
  function scheduleSave(page){
    if(!activeId)return;
    clearTimeout(pageTimer);
    pendingSave={id:activeId,page:page||openedPage||1,layout:JSON.stringify(window.ClassPointerPdf.getLayout())};
    pageTimer=setTimeout(flushSave,2500);
  }
  // Write the waiting page now. Also called when the PDF is closed or another one is opened,
  // so a page turned in the last couple of seconds is not forgotten.
  function flushSave(){
    clearTimeout(pageTimer);const saving=pendingSave;pendingSave=null;
    if(!saving)return;
    (async()=>{
      try{
        const ref=(await teacherPrefix()).child(saving.id);const m=await ref.getMetadata();
        await ref.updateMetadata({customMetadata:{...(m.customMetadata||{}),lastPage:String(saving.page),layout:saving.layout}});
      }catch(_){}
    })();
  }
  window.PointerPdfLibrary={
    onOpened(file){flushSave();currentFile=file;activeId=null;notify()},
    onClosed(){flushSave();currentFile=null;activeId=null;notify()},
    saveCurrent:saveCurrentPdf,
    onPageChanged(page){openedPage=page;scheduleSave(page)},
    onLayoutChanged(){scheduleSave(window.ClassPointerPdf.currentPage()+1)}
  };
})();
