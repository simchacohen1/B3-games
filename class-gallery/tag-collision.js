/* Swept tag collision: smallest distance between two moving players over one step. */
(function(root){
  'use strict';
  /* a0->a1 and b0->b1 are each player's start/end position for the same step. */
  function sweptMinDistance(a0,a1,b0,b1){
    var rx=a0.x-b0.x,rz=a0.z-b0.z;
    var vx=(a1.x-a0.x)-(b1.x-b0.x),vz=(a1.z-a0.z)-(b1.z-b0.z);
    var vv=vx*vx+vz*vz,t=vv>1e-12?-(rx*vx+rz*vz)/vv:0;
    if(t<0)t=0;else if(t>1)t=1;
    return Math.hypot(rx+vx*t,rz+vz*t);
  }
  /* Closest approach of the shown position and the latest network position, so a laggy
     smoothed avatar or a quick dash cannot slip past. */
  function tagDistance(me0,me1,shown0,shown1,net0,net1){
    var best=sweptMinDistance(me0,me1,shown0,shown1);
    if(net0&&net1)best=Math.min(best,sweptMinDistance(me0,me1,net0,net1));
    return best;
  }
  var api={sweptMinDistance:sweptMinDistance,tagDistance:tagDistance};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.B3TagCollision=api;
})(typeof self!=='undefined'?self:this);
