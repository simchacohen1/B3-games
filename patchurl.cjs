const fs=require('fs');const p='scripts/pointer-lab/server.cjs';let s=fs.readFileSync(p,'utf8');const crlf=s.includes('\r\n');s=s.replace(/\r\n/g,'\n');
const a="  .replace(/https:\/\/us-central1-b3-games\.cloudfunctions\.net\//g, '/_fn/')";
if(!s.includes(a))throw new Error('anchor');
s=s.replace(a,a+"\n  // pages that read the database over plain REST (game gate, Shorashim, ...) must read the emulator, never the real project\n  .replace(/https:\/\/b3-games-default-rtdb\.firebaseio\.com/g, 'http://' + DB_NS + '.localhost:9000')");
fs.writeFileSync(p,crlf?s.replace(/\n/g,'\r\n'):s);
