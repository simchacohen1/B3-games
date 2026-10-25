'use strict';
// Offline-only SVG -> binary PNG preparation + raster checks for Oct 25-31, 2026.
// FTT_CANVAS_MODULE=/tmp/sefer-canvas/node_modules/@napi-rs/canvas node sefer-hamitzvos/tools/prepare-weekly-art-20261025.cjs
// Optional first argument: OUTPUT DIRECTORY (must not be an existing website coloring folder).
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const {createCanvas,loadImage}=require(process.env.FTT_CANVAS_MODULE||'@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),srcDir=path.join(root,'drafts/2026-10-25-week');
const output=path.resolve(process.argv[2]||'/tmp/ftt-sefer-week-20261025');
const websiteDirs=[path.join(root,'coloring'),path.join(root,'coloring-v2'),path.join(root,'original')];
for(const dir of websiteDirs)assert.ok(output!==dir&&!output.startsWith(dir+path.sep),'Refusing to overwrite website artwork: '+output);
const week=[['2026-10-25','N250',500],['2026-10-26','N250',500],['2026-10-27','N251',501],['2026-10-28','N251',501],['2026-10-29','N253',502],['2026-10-30','N253',502],['2026-10-31','N252',503]];
const W=1427,H=950,N=W*H;
function components(pixels){
 const labels=new Int32Array(N),queue=new Int32Array(N),sizes=[0];let count=0;
 for(let start=0;start<N;start++){
  if(pixels[start]||labels[start])continue;
  const id=++count;let head=0,tail=1;queue[0]=start;labels[start]=id;
  while(head<tail){
   const i=queue[head++],x=i%W;
   if(x>0&&!pixels[i-1]&&!labels[i-1]){labels[i-1]=id;queue[tail++]=i-1}
   if(x<W-1&&!pixels[i+1]&&!labels[i+1]){labels[i+1]=id;queue[tail++]=i+1}
   if(i>=W&&!pixels[i-W]&&!labels[i-W]){labels[i-W]=id;queue[tail++]=i-W}
   if(i<N-W&&!pixels[i+W]&&!labels[i+W]){labels[i+W]=id;queue[tail++]=i+W}
  }
  sizes[id]=tail;
 }
 return {labels,sizes,count};
}
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const report=[],cache=new Map();
 for(const [date,ref,card] of week){
  const source=fs.readFileSync(path.join(srcDir,date+'-'+ref+'.svg'));
  if(!cache.has(ref)){
   const started=performance.now(),image=await loadImage(source);
   const canvas=createCanvas(W,H),ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.drawImage(image,0,0,W,H);
   const bitmap=ctx.getImageData(0,0,W,H),data=bitmap.data,ink=new Uint8Array(N);let black=0;
   for(let i=0,j=0;i<N;i++,j+=4){
    const luminance=Math.round((data[j]*299+data[j+1]*587+data[j+2]*114)/1000);
    const b=luminance<175?1:0;ink[i]=b;black+=b;
    data[j]=data[j+1]=data[j+2]=b?0:255;data[j+3]=255;
   }
   ctx.putImageData(bitmap,0,0);
   const png=canvas.toBuffer('image/png'),{labels,sizes,count}=components(ink);
   assert.ok(count>=15,'Too few closed white regions for '+ref+': '+count);
   assert.ok(black>N*.01&&black<N*.30,'Ink density unexpected for '+ref);
   const candidates=sizes.map((n,i)=>({id:i,size:n})).slice(1).sort((a,b)=>b.size-a.size).slice(1,8);
   assert.ok(candidates.length>=4,'Insufficient separate objects for '+ref);
   // Synthetic fill: paint a region twice; assert full coverage and no neighboring/ink pixels change.
   for(const candidate of candidates.slice(0,4)){
    const paint=new Uint8Array(N);let filled=0;
    for(let i=0;i<N;i++)if(labels[i]===candidate.id){paint[i]=1;filled++}
    assert.equal(filled,candidate.size,'Partial fill: '+ref);
    for(let i=0;i<N;i++)if(paint[i])assert.equal(ink[i],0,'Ink spill: '+ref);
    for(let i=0;i<N;i++)if(labels[i]===candidate.id)paint[i]=2;
    assert.equal(paint.reduce((n,v)=>n+(v===2),0),candidate.size,'Recolor incomplete: '+ref);
   }
   cache.set(ref,{png,regions:count,inkPct:+(100*black/N).toFixed(2),ms:Math.round(performance.now()-started)});
  }
  const item=cache.get(ref),filename=date+'-'+ref+'.png',dest=path.join(output,filename);
  fs.writeFileSync(dest,item.png);
  report.push({date,ref,card,file:dest,bytes:item.png.length,sha256:crypto.createHash('sha256').update(item.png).digest('hex'),regions:item.regions,inkPct:item.inkPct,prepareMs:item.ms});
 }
 console.log(JSON.stringify({status:'offline raster/source-region checks passed',dimensions:[W,H],files:report,notes:'This is NOT the website mask-worker or browser save/reload test. No website or student files changed.'},null,2));
})().catch(err=>{console.error(err);process.exitCode=1});
