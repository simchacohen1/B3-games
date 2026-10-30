'use strict';

// Use the same ET/WT lock and exception semantics as game-gate.js.
// This is a SERVER guard for callable multiplayer actions: hiding the UI is
// not enough to prevent an authenticated direct-link or API bypass.
// Dates are evaluated in America/New_York, not the server's UTC timezone.
const TOOL = 'multiplayer-center';

function defaultWindows(classId) {
  const days = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
  const regular = classId === 'et'
    ? [['08:45','10:17'],['10:25','11:07'],['11:15','12:00'],['12:45','13:32'],['13:40','14:27'],['14:35','15:15']]
    : [['12:20','13:50'],['14:00','14:45'],['14:55','15:35'],['16:15','17:00'],['17:10','17:55'],['18:05','18:45']];
  const fri = classId === 'et'
    ? [['08:45','10:17'],['10:25','11:07'],['11:15','12:00']]
    : [['11:00','12:30'],['12:40','13:25'],['13:35','14:15']];
  for (const day of ['mon','tue','wed','thu']) days[day] = regular.map(([start,end])=>({start,end}));
  days.fri = fri.map(([start,end])=>({start,end}));
  return days;
}

function previousWindows(classId) {
  const days = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
  const ranges = classId === 'et' ? [['08:45','12:00'],['12:45','15:15']] : [['12:20','15:35'],['16:15','18:45']];
  for (const day of ['mon','tue','wed','thu']) days[day] = ranges.map(([start,end])=>({start,end}));
  return days;
}

function sameWindows(a,b) {
  return ['sun','mon','tue','wed','thu','fri','sat'].every(day => {
    const x = Array.isArray(a?.[day]) ? a[day] : [];
    const y = Array.isArray(b?.[day]) ? b[day] : [];
    return x.length === y.length && x.every((r,i)=>r?.start === y[i].start && r?.end === y[i].end);
  });
}

function newYorkNow(date = new Date()) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const parts = Object.fromEntries(formatted.filter(part => part.type !== 'literal').map(part=>[part.type,part.value]));
  const day = {Sun:'sun',Mon:'mon',Tue:'tue',Wed:'wed',Thu:'thu',Fri:'fri',Sat:'sat'}[parts.weekday] || 'sun';
  return {day, minutes: Number(parts.hour)*60+Number(parts.minute)};
}

function minutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return null;
  const [h,m]=value.split(':').map(Number);
  return h*60+m;
}

function inLockRange(value, range) {
  const start=minutes(range?.start), end=minutes(range?.end);
  if (start === null || end === null) return false;
  if (start === end) return true;
  return start < end ? value>=start && value<end : value>=start || value<end;
}

function isScheduledOpen(settings,classId,date) {
  const access=settings?.classAccess?.[classId] || {};
  if (access.mode === 'open') return true;
  if (access.mode === 'locked') return false;
  let locks=access.lockWindows || defaultWindows(classId);
  if (sameWindows(locks,previousWindows(classId))) locks=defaultWindows(classId);
  const local=newYorkNow(date);
  const ranges=Array.isArray(locks?.[local.day])?locks[local.day]:[];
  return !ranges.some(range=>inLockRange(local.minutes,range));
}

function classOverride(settings,classId,date) {
  const list=String(settings?.classLockedGameOverride?.[classId]||'').split(',').map(v=>v.trim());
  if (!list.includes(TOOL)) return false;
  const until=Number(settings?.classLockedGameOverrideUntil?.[classId]?.[TOOL])||0;
  return !until || until>date.getTime();
}

function allowsMultiplayer({actorRole,classId,studentId,settings={},classRow={},date=new Date()}) {
  // Authorized teachers follow the existing teacher-activity bypass, but
  // authorizeActor must still verify active teacher assignment and tool grant.
  if (actorRole === 'teacher') return true;

  // An activity switched off in Teacher Tools cannot be opened by exceptions.
  if (settings.games?.[TOOL] === false) return false;
  if (settings.classGames?.[classId]?.[TOOL] === false) return false;

  if (classId !== 'et' && classId !== 'wt') {
    // Other workspaces use the same simple class lock as game-gate.js.
    return settings.siteEnabled !== false && classRow.siteEnabled !== false && classRow.access?.mode !== 'locked';
  }

  // Same class-wide and individual activity exceptions as all other games.
  if (classOverride(settings,classId,date) || settings.studentGameOverrides?.[studentId]?.[TOOL] === true) return true;
  if (settings.siteEnabled === false) return false;
  return isScheduledOpen(settings,classId,date);
}

module.exports={allowsMultiplayer,isScheduledOpen,newYorkNow,inLockRange,defaultWindows,previousWindows};
