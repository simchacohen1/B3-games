'use strict';

// Server-side version of the activity and class lock checks used by game-gate.js.
const TOOL = 'multiplayer-center';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function defaultWindows(classId) {
  const result = Object.fromEntries(DAYS.map(day => [day, []]));
  const regular = classId === 'et'
    ? [['08:45','10:17'],['10:25','11:07'],['11:15','12:00'],['12:45','13:32'],['13:40','14:27'],['14:35','15:15']]
    : [['12:20','13:50'],['14:00','14:45'],['14:55','15:35'],['16:15','17:00'],['17:10','17:55'],['18:05','18:45']];
  const friday = classId === 'et'
    ? [['08:45','10:17'],['10:25','11:07'],['11:15','12:00']]
    : [['11:00','12:30'],['12:40','13:25'],['13:35','14:15']];
  for (const day of ['mon','tue','wed','thu']) result[day] = regular.map(([start,end]) => ({ start, end }));
  result.fri = friday.map(([start,end]) => ({ start, end }));
  return result;
}

function newYorkNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { day: ({Sun:'sun',Mon:'mon',Tue:'tue',Wed:'wed',Thu:'thu',Fri:'fri',Sat:'sat'})[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function minuteValue(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function inRange(value, range) {
  const start = minuteValue(range?.start), end = minuteValue(range?.end);
  if (start === null || end === null) return false;
  if (start === end) return true;
  return start < end ? value >= start && value < end : value >= start || value < end;
}

function scheduledOpen(settings, classId, date = new Date()) {
  const access = settings?.classAccess?.[classId] || {};
  if (access.mode === 'open') return true;
  if (access.mode === 'locked') return false;
  const local = newYorkNow(date);
  const ranges = access.lockWindows?.[local.day] || defaultWindows(classId)[local.day];
  return !ranges.some(range => inRange(local.minutes, range));
}

function allowsMultiplayer({ actorRole, classId, studentId, settings = {}, classRow = {}, date = new Date() }) {
  if (actorRole === 'teacher') return true; // Caller must verify the active class assignment.
  if (settings.games?.[TOOL] === false || settings.classGames?.[classId]?.[TOOL] === false) return false;
  if (classId !== 'et' && classId !== 'wt') {
    return settings.siteEnabled !== false && classRow.siteEnabled !== false && classRow.access?.mode !== 'locked';
  }
  const overrideList = String(settings.classLockedGameOverride?.[classId] || '').split(',').map(value => value.trim());
  const overrideUntil = Number(settings.classLockedGameOverrideUntil?.[classId]?.[TOOL]) || 0;
  const classOverride = overrideList.includes(TOOL) && (!overrideUntil || overrideUntil > date.getTime());
  if (classOverride || settings.studentGameOverrides?.[studentId]?.[TOOL] === true) return true;
  return settings.siteEnabled !== false && scheduledOpen(settings, classId, date);
}

module.exports = { allowsMultiplayer, scheduledOpen, newYorkNow, inRange, defaultWindows };
