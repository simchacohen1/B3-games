(function(root){
  'use strict';
  const DAY=86400000, ZONE='America/New_York';
  const cycleStart=Date.UTC(1984,3,29);
  const civilDate=iso=>new Date(iso+'T12:00:00Z');
  function shift(iso,amount){const date=civilDate(iso);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);}
  function civilNow(now=new Date()){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get=type=>parts.find(p=>p.type===type).value;
    return get('year')+'-'+get('month')+'-'+get('day');
  }
  function studyToday(now,sun){
    const iso=civilNow(now);
    // Noon UTC falls on the same civil date in Kingston, including DST transitions.
    const sunset=sun.getTimes(civilDate(iso),41.2626,-75.8969).sunset;
    return sunset&&now>=sunset?shift(iso,1):iso;
  }
  function lesson(iso,days){
    const n=Math.floor((civilDate(iso).getTime()-12*3600000-cycleStart)/DAY);
    if(n<0)throw new RangeError('Date is before the study cycle began.');
    const index=n%days.length,reading=days[index];
    return {day:index+1,reading,mitzvos:reading.match(/[PN]\d+/g)||[]};
  }
  function cardMap(days){
    const map={};let card=0;
    for(const reading of days)for(const ref of reading.match(/[PN]\d+/g)||[])if(!map[ref])map[ref]=++card;
    // Preserve the original artwork card IDs when the October 18/19 lessons swap N295 and N296.
    const originalN295Card=map.N296,originalN296Card=map.N295;
    if(originalN295Card&&originalN296Card){map.N295=originalN295Card;map.N296=originalN296Card;}
    return map;
  }
  function hebrewDate(iso,locale='en-u-ca-hebrew'){
    return new Intl.DateTimeFormat(locale,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(civilDate(iso)).replace('Heshvan','Cheshvan').replace('Tishri','Tishrei').replace('Tevet','Teves').replace('Shevat','Shevat');
  }
  const api={shift,civilNow,studyToday,lesson,cardMap,hebrewDate};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FTTMitzvahCalendar=api;
})(typeof window==='object'?window:globalThis);
