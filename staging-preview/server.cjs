'use strict';
// Isolated staging UI server. NO Firebase, Stripe, or student records.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const content=fs.readFileSync(path.join(__dirname,'index.html'));
const user=process.env.STAGING_USERNAME;
const password=process.env.STAGING_PASSWORD;
if(!user||!password||password.length<32){
 console.error('Missing strong staging access credentials.');
 process.exit(1);
}
function safeEqual(a,b){
 const left=Buffer.from(String(a)),right=Buffer.from(String(b));
 return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
function permitted(header){
 if(typeof header!=='string'||!header.startsWith('Basic '))return false;
 try{
  const raw=Buffer.from(header.slice(6),'base64').toString('utf8');
  const colon=raw.indexOf(':');if(colon<0)return false;
  return safeEqual(raw.slice(0,colon),user)&&safeEqual(raw.slice(colon+1),password);
 }catch(_){return false;}
}
const server=http.createServer((req,res)=>{
 const headers={
  'Cache-Control':'no-store, max-age=0',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'X-Content-Type-Options':'nosniff',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-ancestors 'none'"
 };
 for(const [k,v] of Object.entries(headers))res.setHeader(k,v);
 if(req.url==='/health'){
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});
  res.end('ok');return;
 }
 if(!permitted(req.headers.authorization)){
  res.writeHead(401,{'Content-Type':'text/plain; charset=utf-8','WWW-Authenticate':'Basic realm="Fun Torah Tools staging", charset="UTF-8"'});
  res.end('Private preview. Sign in to continue.');return;
 }
 if(!['GET','HEAD'].includes(req.method)||!['/','/index.html'].includes(req.url)){
  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');return;
 }
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':content.length});
 res.end(req.method==='HEAD'?undefined:content);
});
const port=Number(process.env.PORT)||10000;
server.listen(port,'0.0.0.0',()=>console.log('Isolated staging preview listening on '+port));
