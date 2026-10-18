const fs=require('fs');const p='scripts/pointer-lab/server.cjs';let s=fs.readFileSync(p,'utf8');const crlf=s.includes('\r\n');s=s.replace(/\r\n/g,'\n');
const a="  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+\//g, '/vendor/firebase/12.15.0/')";
if(!s.includes(a))throw new Error('anchor a');
// only the version we vendor is served locally; older SDKs (v8 pages such as Rashi Letters) load from gstatic and are pointed at the emulator below
s=s.replace(a,"  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/12\.[0-9.]+\//g, '/vendor/firebase/12.15.0/')");
const b="  body = rewrite(body);";
if(!s.includes(b))throw new Error('anchor b');
s=s.replace(b,b+`
  if (ext === '.html' && /firebasejs\/8\.[0-9.]+\/firebase-database\.js/.test(body)) {
    // Firebase v8 pages: send database calls to the emulator (same idea as the shim for the newer SDK)
    const V8 = '<script>(function(){var o=firebase.database;var w=function(){var d=o.apply(this,arguments);if(!d.__lab){d.__lab=1;try{d.useEmulator("127.0.0.1",9000)}catch(e){}}return d};for(var k in o)try{w[k]=o[k]}catch(e){}firebase.database=w})();<\/script>';
    body = body.replace(/(<script[^>]*firebasejs\/8\.[0-9.]+\/firebase-database\.js[^>]*><\/script>)/, '$1' + V8);
  }`);
fs.writeFileSync(p,crlf?s.replace(/\n/g,'\r\n'):s);
