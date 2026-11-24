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
  // The day before/after a YYYY-MM-DD key (pure calendar math, no time zone involved).
  function shiftDate(key,n){
    var p=String(key).split("-");var d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]+n));
    return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0");
  }
  // A simple picture for each standard item, so a boy who cannot read yet knows what it is.
  var ICONS={"tzedaka":"🪙","shacharis":"🌅","mincha":"☀️","rebbes-kapitel":"📖","sefer-hamitzvos":"📚","tanya-lines":"📜","homework":"✏️","nigel-vasser":"💧","prepare-nigel-vasser":"🫗","tehillim":"🙏"};
  var ICON_WORDS=[[/tzedak|charity|צדק/i,"🪙"],[/shachar|שחר/i,"🌅"],[/mincha|מנח/i,"☀️"],[/maariv|ערבית|מעריב/i,"🌙"],[/tehillim|תהל/i,"🙏"],[/tanya|תני/i,"📜"],[/homework|hw/i,"✏️"],[/wash|נעגל|וואסער|water/i,"💧"],[/read|kapitel|book/i,"📖"],[/daven|pray/i,"🙏"]];
  // The picture the teacher chose is stored on the item: icon = an emoji, "-" = no picture, missing = automatic.
  var NO_ICON="-";
  // Keep only the first emoji of whatever was typed or pasted; "" if it is plain text (letters, digits, punctuation).
  function cleanIcon(s){
    s=String(s==null?"":s).trim();if(!s)return "";
    var first=s;
    try{if(typeof Intl!=="undefined"&&Intl.Segmenter){first=Array.from(new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(s))[0].segment}
        else first=Array.from(s)[0]}catch(e){first=Array.from(s)[0]}
    if(!/\p{Extended_Pictographic}|\p{Regional_Indicator}|[⃣]/u.test(first))return "";
    return first.length>16?"":first;
  }
  function iconFor(item){
    if(item&&item.icon===NO_ICON)return "";
    if(item&&item.icon)return item.icon;
    if(item&&ICONS[item.id])return ICONS[item.id];
    var n=String(item&&item.name||"");
    for(var i=0;i<ICON_WORDS.length;i++)if(ICON_WORDS[i][0].test(n))return ICON_WORDS[i][1];
    return "📝";
  }
  function isDateKey(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||""))}
  // Turn the stored config/items object into an ordered list. removed items are kept only when asked.
  function itemsFromConfig(raw,includeRemoved){
    if(!raw||typeof raw!=="object")return DEFAULT_ITEMS.map(function(x,i){return {id:x.id,name:x.name,star:x.star,order:i,removed:false}});
    return Object.keys(raw).map(function(id){var r=raw[id]||{};return {id:id,name:String(r.name||id),star:!!r.star,order:Number(r.order)||0,removed:!!r.removed,icon:typeof r.icon==="string"?r.icon:""}})
      .filter(function(x){return includeRemoved||!x.removed}).sort(function(a,b){return a.order-b.order||(a.id<b.id?-1:1)});
  }
  function newItemId(){return "i"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
  function basePath(ws,classId){return "b3Games/workspaces/"+ws+"/classes/"+classId+"/resources/daily-checklist"}
  // Teacher marking a cell: blank -> yes (1) -> no (0) -> blank (null).
  function nextMark(v){return v===1?0:(v===0?null:1)}
  // The Firebase update for one cell. Same shape a student's own answer saves; null (blank) removes that item's answer.
  function markUpdate(item,v,studentName,ts){
    var u={name:studentName,t:ts};
    u["items/"+item.id]=(v===1||v===0)?{v:v,n:item.name,s:item.star?1:0,o:item.order}:null;
    return u;
  }
  window.B3DailyChecklist={DEFAULT_ITEMS:DEFAULT_ITEMS,schoolDate:schoolDate,shiftDate:shiftDate,iconFor:iconFor,cleanIcon:cleanIcon,NO_ICON:NO_ICON,isDateKey:isDateKey,itemsFromConfig:itemsFromConfig,newItemId:newItemId,basePath:basePath,nextMark:nextMark,markUpdate:markUpdate};
})();
