(function(root){
  'use strict';
  const WIDTH=1000,MAX_HEIGHT=19000,MAX_BYTES=8*1024*1024;
  function cleanUrl(value){
    try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null}catch{return null}
  }
  function cleanPayload(value){
    if(!value||typeof value.html!=='string'||!value.html.trim()||value.html.length>MAX_BYTES||value.width!==WIDTH||!Number.isFinite(value.height)||value.height<100||value.height>MAX_HEIGHT)return null;
    return{html:value.html,width:WIDTH,height:Math.ceil(value.height)};
  }
  // Scripts never run in lesson pages. Remove active content too, and apply a CSP inside
  // a sandboxed frame. Keep the page's own styles separate from the classroom's styles.
  function prepare(html,base){
    const doc=new DOMParser().parseFromString(html,'text/html');
    doc.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,base,meta[http-equiv],link[rel="preload"],link[rel="modulepreload"]').forEach(node=>node.remove());
    doc.querySelectorAll('*').forEach(node=>{
      for(const attr of Array.from(node.attributes))if(/^on/i.test(attr.name)||['srcdoc','nonce','integrity','autofocus','formaction','action'].includes(attr.name.toLowerCase()))node.removeAttribute(attr.name);
      if(node.tagName==='A'){
        // A link in the copy never works by itself. Where it led is kept as plain text in data-lesson-link
        // (full http/https address only), so the teacher's page can open that page as the next lesson.
        const raw=node.getAttribute('href'),kept=node.getAttribute('data-lesson-link');let dest=null;
        if(raw&&!/^\s*#/.test(raw)){try{dest=cleanUrl(new URL(raw,cleanUrl(base)||undefined).href)}catch{}}
        else if(!raw&&kept)dest=cleanUrl(kept);
        if(dest&&new URL(dest).hostname==='invalid.invalid')dest=null;
        node.removeAttribute('href');node.removeAttribute('target');
        if(dest)node.setAttribute('data-lesson-link',dest);else node.removeAttribute('data-lesson-link');
      }
      if(['INPUT','BUTTON','SELECT','TEXTAREA'].includes(node.tagName))node.disabled=true;
    });
    const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';
    policy.content="default-src 'none'; script-src 'none'; style-src https: http: 'unsafe-inline'; img-src https: http: data: blob:; font-src https: http: data:; media-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; form-action 'none'; base-uri https: http:";
    doc.head.prepend(policy);
    const safeBase=cleanUrl(base);if(safeBase){const tag=doc.createElement('base');tag.href=safeBase;policy.after(tag)}
    const style=doc.createElement('style');style.textContent='html{scroll-behavior:auto!important;overflow:hidden!important}body{animation:none!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';doc.head.appendChild(style);
    return '<!doctype html>'+doc.documentElement.outerHTML;
  }
  const api={WIDTH,MAX_HEIGHT,MAX_BYTES,cleanUrl,cleanPayload,prepare};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ClassPointerWebpageCore=api;
})(typeof window==='undefined'?{}:window);
