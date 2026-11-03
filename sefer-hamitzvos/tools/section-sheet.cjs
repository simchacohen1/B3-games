'use strict';
// Authoring helper: draws a crop of one picture with every fillable section in
// its own color and its number on top, so region-groups.js entries can be
// chosen by eye. Section numbers are only for authoring; the saved file uses
// seed points, which never depend on these numbers.
//   FTT_CANVAS_MODULE=<path to @napi-rs/canvas> node sefer-hamitzvos/tools/section-sheet.cjs <card> <out.png> [x y w h scale] [--fine] [--groups]
// Also writes <out>.json: { sectionNumber: [seedX, seedY] }.
const fs=require('fs'),path=require('path');
const {createCanvas,loadImage}=require(process.env.FTT_CANVAS_MODULE||'@napi-rs/canvas');
const F=require('../fill.js');
(async()=>{
 const args=process.argv.slice(2).filter(a=>!a.startsWith('--')),flags=new Set(process.argv.slice(2).filter(a=>a.startsWith('--')));
 const [card,out,X=0,Y=0,W,H,S=2]=args,root=path.resolve(__dirname,'..');
 const src=fs.existsSync(path.join(root,'coloring-v2',card+'.png'))?path.join(root,'coloring-v2',card+'.png'):path.join(root,'coloring',String(card).padStart(3,'0')+'.png');
 const im=await loadImage(src),c=createCanvas(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);
 const art=x.getImageData(0,0,im.width,im.height);
 let groups=[];if(flags.has('--groups')){const ctx={window:{}};ctx.window=ctx;require('vm').runInNewContext(fs.readFileSync(path.join(root,'region-groups.js'),'utf8'),ctx);groups=(ctx.FTT_SEFER_REGION_GROUPS||{})[card]||[];}
 const m=F.createObjectMask(art,im.width,im.height,groups),L=flags.has('--fine')?m.fine:m.labels;
 const sum=new Map();
 for(let i=0;i<L.length;i++){const l=L[i];if(!l)continue;let e=sum.get(l);if(!e){e=[0,0,0];sum.set(l,e)}e[0]++;e[1]+=i%im.width;e[2]+=(i/im.width)|0;}
 const seed=new Map();
 for(const [l,e] of sum)seed.set(l,[e[1]/e[0],e[2]/e[0],1e18,0,0]);
 for(let i=0;i<L.length;i++){const l=L[i];if(!l)continue;const s=seed.get(l),px=i%im.width,py=(i/im.width)|0,d=(px-s[0])**2+(py-s[1])**2;if(d<s[2]){s[2]=d;s[3]=px;s[4]=py;}}
 const o=x.createImageData(im.width,im.height);
 for(let i=0;i<L.length;i++){const l=L[i],p=i*4,dark=art.data[p]<150;
  if(!l||dark){const v=dark?art.data[p]:255;o.data[p]=o.data[p+1]=o.data[p+2]=v;}
  else{const h=Math.imul(l,2654435761)>>>0;o.data[p]=110+(h&127);o.data[p+1]=110+((h>>8)&127);o.data[p+2]=110+((h>>16)&127);}
  o.data[p+3]=255;}
 x.putImageData(o,0,0);
 const w=+W||im.width,h=+H||im.height,s=+S,o2=createCanvas(w*s,h*s),g=o2.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(c,+X,+Y,w,h,0,0,w*s,h*s);
 g.font='bold 13px sans-serif';g.textAlign='center';
 const seeds={};
 for(const [l,e] of sum){const sx=seed.get(l)[3],sy=seed.get(l)[4];seeds[l]=[sx,sy];if(e[0]<25||sx<X||sy<Y||sx>=+X+w||sy>=+Y+h)continue;
  const tx=(sx-X)*s,ty=(sy-Y)*s;g.lineWidth=3;g.strokeStyle='#fff';g.strokeText(l,tx,ty+4);g.fillStyle='#000';g.fillText(l,tx,ty+4);}
 fs.writeFileSync(out,o2.toBuffer('image/png'));fs.writeFileSync(out+'.json',JSON.stringify(seeds));
})();
