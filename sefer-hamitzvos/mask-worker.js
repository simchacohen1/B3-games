'use strict';
// Segmentation runs off the main page so paging through detailed artwork stays responsive.
// The unchanged fill algorithm remains the single source of truth for safety boundaries.
importScripts('fill.js?v=20261023-objects1');
self.onmessage=function(event){
 const request=event.data||{};
 try{
  const data=new Uint8ClampedArray(request.pixels);
  const mask=self.FTTMitzvahFill.createObjectMask({data},request.width,request.height,request.groups);
  if(!mask)throw new Error('Mask unavailable');
  const labels=mask.fine.buffer,objects=mask.labels.buffer;
  self.postMessage({revision:request.revision,card:request.card,width:mask.width,height:mask.height,labels,objects,groups:mask.groups},[labels,objects]);
 }catch(error){
  self.postMessage({revision:request.revision,card:request.card,error:String(error&&error.message||error)});
 }
};
