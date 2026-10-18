const test=require('node:test');
const assert=require('node:assert/strict');
const {traceRegion}=require('../sefer-hamitzvos/fill.js');
function canvas(width,height){
 const data=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<width*height;i++){data[i*4]=255;data[i*4+1]=255;data[i*4+2]=255;data[i*4+3]=255;}
 return {width,height,data:{data}};
}
function box(image,left,top,right,bottom){
 const {width,height,data:{data}}=image;
 for(let x=left;x<=right;x++)for(const y of [top,bottom]){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}
 for(let y=top;y<=bottom;y++)for(const x of [left,right]){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}
}
test('fills only the connected white section inside a closed black outline',()=>{
 const image=canvas(9,9);box(image,2,2,6,6);
 const result=traceRegion(image.data,9,9,4,4);
 assert.equal(result.reason,undefined);
 assert.equal(result.pixels.length,9);
 assert.ok([...result.pixels].every(i=>{const x=i%9,y=Math.floor(i/9);return x>=3&&x<=5&&y>=3&&y<=5;}));
});
test('a click on a black outline is rejected',()=>{
 const image=canvas(9,9);box(image,2,2,6,6);
 assert.equal(traceRegion(image.data,9,9,2,4).reason,'border');
});
test('a white region that reaches the image edge is rejected as open',()=>{
 const image=canvas(5,5);
 assert.equal(traceRegion(image.data,5,5,2,2).reason,'open');
});
test('large enclosed sections remain fillable',()=>{
 const image=canvas(9,9);box(image,1,1,7,7);
 const result=traceRegion(image.data,9,9,4,4);
 assert.equal(result.pixels.length,25);
});
test('out-of-bounds taps are rejected',()=>{
 const image=canvas(5,5);
 assert.equal(traceRegion(image.data,5,5,-1,2).reason,'outside');
});

test('high resolution page keeps narrow outline gaps from joining adjacent sections',()=>{
 const image=canvas(160,160);
 box(image,10,10,75,145);
 box(image,75,10,150,145);
 // Shared divider has one white pixel gap.
 const i=(77*160+75)*4;
 image.data.data[i]=image.data.data[i+1]=image.data.data[i+2]=255;
 const result=traceRegion(image.data,160,160,30,70);
 assert.ok(result.pixels&&result.pixels.length>0);
 assert.ok([...result.pixels].every(index=>index%160<75),'paint must not spill across the divider');
});
