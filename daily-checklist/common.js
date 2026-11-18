/* Daily Checklist Poll — shared helpers (student + teacher pages).
   Data lives under b3Games/workspaces/{ws}/classes/{classId}/resources/daily-checklist:
     config/items/{itemId} = {name, star, order, removed}
     answers/{YYYY-MM-DD}/{studentId} = {name, t, items:{itemId:{v:1|0, n:itemName, s:1|0, o:order}}}
   Every answer carries a snapshot of the item name/star/order at the time it was given, so renaming or
   removing an item later never changes old answers or old CSV exports. No points or stars are awarded. */
(function(){
  "use strict";
  var DEFAULT_ITEMS=[
    {id:"tzedaka",name:"Daily Tzedaka",star:false},
    {id:"shacharis",name:"Shacharis",star:true},
    {id:"mincha",name:"Mincha",star:false},
    {id:"rebbes-kapitel",name:"Rebbe's Kapitel",star:false},
    {id:"sefer-hamitzvos",name:"Daily Sefer Hamitzvos",star:true},
    {id:"tanya-lines",name:"New Tanya Lines",star:true},
    {id:"homework",name:"Homework",star:false},
    {id:"nigel-vasser",name:"נעגל וואסער",star:false},
    {id:"prepare-nigel-vasser",name:"Prepare נעגל וואסער",star:false},
    {id:"tehillim",name:"Daily Tehillim",star:true}
  ];
  function schoolDate(date){
    var parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date||new Date());
    var v=function(t){var p=parts.find(function(x){return x.type===t});return p?p.value:""};
    return v("year")+"-"+v("month")+"-"+v("day");
  }
  function isDateKey(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||""))}
  // Turn the stored config/items object into an ordered list. removed items are kept only when asked.
  function itemsFromConfig(raw,includeRemoved){
    if(!raw||typeof raw!=="object")return DEFAULT_ITEMS.map(function(x,i){return {id:x.id,name:x.name,star:x.star,order:i,removed:false}});
    return Object.keys(raw).map(function(id){var r=raw[id]||{};return {id:id,name:String(r.name||id),star:!!r.star,order:Number(r.order)||0,removed:!!r.removed}})
      .filter(function(x){return includeRemoved||!x.removed}).sort(function(a,b){return a.order-b.order||(a.id<b.id?-1:1)});
  }
  function newItemId(){return "i"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
  function basePath(ws,classId){return "b3Games/workspaces/"+ws+"/classes/"+classId+"/resources/daily-checklist"}
  window.B3DailyChecklist={DEFAULT_ITEMS:DEFAULT_ITEMS,schoolDate:schoolDate,isDateKey:isDateKey,itemsFromConfig:itemsFromConfig,newItemId:newItemId,basePath:basePath};
})();
