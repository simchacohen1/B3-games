(function(root){
  'use strict';
  const ENDPOINT='https://us-central1-b3-games.cloudfunctions.net/privateMediaUrl';
  async function url(path){
    const user=root.firebase?.auth?.().currentUser;
    if(!user)throw new Error('Sign in to open this recording.');
    const token=await user.getIdToken(),response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({path}),cache:'no-store'}),body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||'Recording is not available.');
    return body.url;
  }
  async function setSource(element,path,fallback=''){
    if(!element)return;
    const value=path?await url(path):fallback;
    if(element.dataset.privatePath===path&&element.src===value)return;
    element.dataset.privatePath=path||'';element.src=value;element.load?.();
  }
  function audioMarkup(path,fallback=''){
    const esc=value=>String(value||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return path?'<audio controls preload="metadata" data-private-path="'+esc(path)+'"></audio>':fallback?'<audio controls preload="metadata" src="'+esc(fallback)+'"></audio>':'';
  }
  function attach(container=root.document){
    container?.querySelectorAll?.('audio[data-private-path]').forEach(element=>{
      if(element.dataset.privateLoading==='true'||element.dataset.privateReady==='true')return;
      element.dataset.privateLoading='true';
      setSource(element,element.dataset.privatePath).then(()=>{element.dataset.privateReady='true'}).catch(error=>{
        element.dataset.privateLoading='false';element.title='Recording unavailable: '+error.message;
      });
    });
  }
  if(root.document&&typeof root.MutationObserver==='function')new root.MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1){if(node.matches?.('audio[data-private-path]'))attach(node.parentNode);else attach(node)}}))).observe(root.document.documentElement,{childList:true,subtree:true});
  root.B3PrivateMedia={url,setSource,audioMarkup,attach};
})(typeof window==='object'?window:globalThis);
