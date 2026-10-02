(function(root){
  'use strict';
  function deadline(work,ms,label,cancel){
    return new Promise((resolve,reject)=>{
      let settled=false;
      const timer=setTimeout(()=>{
        if(settled)return;
        settled=true;
        const error=new Error(label+' timed out.');error.code='recording/timeout';
        reject(error);
        try{if(cancel)cancel()}catch{}
      },ms);
      Promise.resolve(work).then(value=>{if(!settled){settled=true;clearTimeout(timer);resolve(value)}},error=>{if(!settled){settled=true;clearTimeout(timer);reject(error)}});
    });
  }
  async function upload(ref,blob,onProgress,ms=60000){
    const task=ref.put(blob,{contentType:blob.type||'audio/webm'});
    const unsubscribe=task.on('state_changed',snapshot=>{
      if(onProgress)onProgress(snapshot.totalBytes?Math.round(snapshot.bytesTransferred/snapshot.totalBytes*100):0);
    });
    try{await deadline(task,ms,'Audio upload',()=>task.cancel());return await deadline(ref.getDownloadURL(),15000,'Audio link')}finally{if(unsubscribe)unsubscribe()}
  }
  const api={deadline,upload};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ChazaraRecordingSave=api;
})(typeof window==='object'?window:globalThis);
