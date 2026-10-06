'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ClassPointerViewportCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  function clamp(value,min,max){return Math.min(max,Math.max(min,value))}
  function outputSize(width,height,maxWidth=2560,maxHeight=1440){
    if(!(width>0&&height>0))return{width:2560,height:1440};
    const scale=Math.min(1,maxWidth/width,maxHeight/height);
    return{width:Math.max(2,Math.round(width*scale)),height:Math.max(2,Math.round(height*scale))};
  }
  function cleanRegion(region){
    if(!region||![region.x,region.y,region.w,region.h].every(Number.isFinite))return null;
    if(region.w<=0||region.h<=0)return null;
    const w=clamp(region.w,0.01,1),h=clamp(region.h,0.01,1);
    return{x:clamp(region.x,0,1-w),y:clamp(region.y,0,1-h),w,h};
  }
  function zoomRegion(base,zoom,center){
    base=cleanRegion(base)||{x:0,y:0,w:1,h:1};
    const z=clamp(Number(zoom)||1,1,6),w=base.w/z,h=base.h/z;
    const cx=Number.isFinite(center?.x)?center.x:base.x+base.w/2;
    const cy=Number.isFinite(center?.y)?center.y:base.y+base.h/2;
    return{x:clamp(cx-w/2,base.x,base.x+base.w-w),y:clamp(cy-h/2,base.y,base.y+base.h-h),w,h};
  }
  function panRegion(base,view,deltaX,deltaY){
    base=cleanRegion(base)||{x:0,y:0,w:1,h:1};view=cleanRegion(view)||base;
    return{x:clamp(view.x+(Number(deltaX)||0),base.x,base.x+base.w-view.w),y:clamp(view.y+(Number(deltaY)||0),base.y,base.y+base.h-view.h),w:view.w,h:view.h};
  }
  function selectionFromDrag(start,end,width,height,aspect){
    if(!start||!end||!(width>0&&height>0&&aspect>0))return null;
    const dx=end.x-start.x,dy=end.y-start.y,sx=dx<0?-1:1,sy=dy<0?-1:1;
    const availableW=sx>0?width-start.x:start.x,availableH=sy>0?height-start.y:start.y;
    const wantedW=Math.max(Math.abs(dx),Math.abs(dy)*aspect);
    const selectionW=Math.min(wantedW,availableW,availableH*aspect);
    if(selectionW<12)return null;
    const selectionH=selectionW/aspect,left=sx>0?start.x:start.x-selectionW,top=sy>0?start.y:start.y-selectionH;
    return cleanRegion({x:left/width,y:top/height,w:selectionW/width,h:selectionH/height});
  }
  return{clamp,outputSize,cleanRegion,zoomRegion,panRegion,selectionFromDrag};
});
