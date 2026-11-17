'use strict';
// Class Pointer: (1) Send to class from the teacher's own whiteboard, and (2) the lesson ending for everyone when the teacher
// goes back to "What are you teaching from?". These pin what the pages do; the full behaviour was run on staging.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'class-pointer-prototype', f), 'utf8').replace(/\r\n/g, '\n');
const boards = read('student-boards.js'), saved = read('saved-work.js'), dash = read('teacher-dashboard.js'),
  room = read('classroom.js'), share = read('activity-share.js'), annotate = read('classroom-annotate.js');

test('send: each picture send has its own id, so a resend arrives and a reconnect does not save twice', () => {
  assert.match(boards, /const id=\/\^\[A-Za-z0-9_-\]\{8,48\}\$\/\.test\(String\(raw\.id\|\|''\)\)\?String\(raw\.id\):'';/);
  assert.match(boards, /return\{kind:'image',data:raw\.data,\.\.\.\(id\?\{id\}:\{\}\)/);
  assert.match(boards, /sendActivity\(\{kind:'image',data,id:newSendId\(\),subject:extra\.subject/);
  assert.match(boards, /keepTeacherCopy\?\.\(\{kind:'image',data:activity\.data,id:activity\.id,/);
  assert.match(saved, /const key=\/\^\[A-Za-z0-9_-\]\{8,48\}\$\/\.test\(String\(activity\.id\|\|''\)\)\?'id:'\+activity\.id:copyKey\(activity\.data\);/);
});

test('send: the teacher is told it is not sent yet, what was sent, who was left out, and when nothing was sent', () => {
  assert.match(boards, /B\.status\('Not sent yet\. Press ✓ Send to all boards to send this to every student\.'\)/);
  assert.match(boards, /closePreview\(\);B\.status\('Nothing was sent\.'\)/);
  assert.match(boards, /'Sent to '\+got\+' of '\+here\.length\+' student'/);
  assert.match(boards, /'Not sent to '\+skipped\.slice\(0,5\)\.map\(m=>m\.name\)\.join\(', '\)/);
  assert.match(boards, /const here=admitted\(\),skipped=here\.filter\(m=>excluded\(m,'boards'\)\|\|isBlocked\(m\)\)/);
});

test('send: a full My files says the copy was NOT saved, and stays on screen long enough to read', () => {
  assert.match(saved, /so your copy was NOT saved\. Delete a file in 📂 My files, then ask your teacher to send it again\.',15000\)/);
  assert.match(saved, /setTimeout\(\(\)=>node\.remove\(\),ms\|\|5000\)/);
});

test('send: back on My screen a whiteboard goes back to the pen, so a drawing there draws', () => {
  assert.match(annotate, /event\.detail==='teach'\)FA\.select\(teacher&&B\.lessonKind\?\.\(\)==='whiteboard'\?'pen':'pointer'\)/);
  assert.doesNotMatch(annotate, /Back on My screen the toolbar starts on the Pointer/);
});

test('session: leaving the whiteboard clears the old status line', () => {
  assert.match(dash, /if\(wasLive&&!isLive\)\{const line=\$\('connectionStatus'\);if\(line\)line\.textContent='Nothing is shown to students right now\. Pick what to teach from\.'\}/);
  assert.match(dash, /const changed=wasLive!==isLive;wasLive=isLive;/);
});

test('session: the joined count says when nothing is shown', () => {
  assert.match(dash, /idle=!!stage&&!docOpen\(\)&&!sharingScreen\(\)&&!document\.body\.classList\.contains\('boards-on'\)/);
  assert.match(dash, /\(idle&&inClass\?' · nothing shown':''\)/);
});

test('session: a student sees a clear "Waiting for your teacher" screen, and is never left on "Reconnecting…"', () => {
  assert.match(room, /if\(!isTeacher\)\{const waiting=\$\('placeholder'\);if\(waiting\)waiting\.textContent='Waiting for your teacher…/);
  assert.match(room, /status\('Waiting for your teacher…'\)/);
  assert.doesNotMatch(room, /Teaching screen paused/);
  assert.match(share, /if\(lessonRetries>=6\)\{lessonStatus\.textContent='Waiting for your teacher… Nothing is showing right now\. Press Back to Activity to keep working; the lesson comes back by itself\.';return\}/);
});

test('versions: the changed scripts have new cache versions', () => {
  const html = read('classroom.html');
  const want = { 'student-boards': 'send1', 'saved-work': 'send1', 'classroom-annotate': 'send1', classroom: 'send2', 'teacher-dashboard': 'send2', 'activity-share': 'send2' };
  for (const [f, v] of Object.entries(want)) assert.match(html, new RegExp(f + '\\.js\\?v=20261117-' + v), f);
  assert.match(html, /teacher-dashboard\.css\?v=20261117-send2/);
  for (const page of ['chazara/index.html', 'chavrusa/index.html', 'gematria/index.html', 'halacha/index.html', 'shorashim/index.html'])
    assert.match(fs.readFileSync(path.join(__dirname, '..', page), 'utf8'), /activity-share\.js\?v=20261117-send2/, page);
});

// ---------- black / blue screen and the connection signs ----------
const css = read('teacher-dashboard.css');

test('black screen: the lesson window shows "Waiting for your teacher…" whenever there is no live picture', () => {
  assert.match(share, /lessonStage\.append\(lessonVideo,lessonWait,markLayer,pointerLayer,hitLayer\)/);
  assert.match(share, /function liveVideo\(\)\{[\s\S]*?track\.readyState==='live'&&lessonVideo\.readyState>=2&&!lessonVideo\.paused/);
  assert.match(share, /lessonWaitTitle\.textContent=lost\?'Reconnecting…':'Waiting for your teacher…'/);
  assert.match(share, /lessonOverlay\.style\.display='flex';watchWaiting\(\);/, 'a lesson announced: the panel is up until the picture arrives');
  assert.match(share, /lessonVideo\.srcObject=null;syncWaiting\(\)\}/, 'a closed picture brings the panel back at once');
  assert.match(share, /waitTimer=later\(\(\)=>\{waitTimer=null;if\(lessonOverlay\.style\.display!=='none'\)watchWaiting\(\)\},1000\)/, 'checked every second while the window is open');
});

test('connection: the student pings every 4 seconds and shows Reconnecting… or Weak connection', () => {
  assert.match(share, /conn\.send\(\{type:'ping',t:Date\.now\(\),rtt,weak:connState!=='ok'\}\)/);
  assert.match(share, /if\(!conn\.open\|\|age>12000\)showConn\('reconnecting'\);\s*else if\(rtt>2000\|\|age>7000\)showConn\('weak'\)/);
  assert.match(share, /connPill\.textContent=state==='reconnecting'\?'Reconnecting…':'Weak connection'/);
  assert.match(share, /if\(message\.type==='pong'\)\{if\(Number\.isFinite\(message\.t\)\)\{rtt=Math\.max\(0,Date\.now\(\)-message\.t\);lastPong=Date\.now\(\)\}return\}/);
  assert.match(share, /window\.addEventListener\('offline',\(\)=>\{if\(latestSession\)showConn\('reconnecting'\)\}\)/);
  assert.match(share, /window\.addEventListener\('online',\(\)=>\{if\(latestSession&&!presenceConn&&!presenceTimer\)\{presenceDelay=0;schedulePresence\(300\)\}\}\)/);
  assert.doesNotMatch(share, /if\(\+\+presenceFailures>6\)return/, 'a poor connection no longer gives up for good');
});

test('connection: the teacher answers the ping and the roster carries it to the weak-connection dot', () => {
  assert.match(room, /if\(message\.type==='ping'\)\{[\s\S]*?member\.lastPing=Date\.now\(\);[\s\S]*?connection\.send\(\{type:'pong',t:message\.t\}\)/);
  assert.match(room, /lastPing:m\.lastPing\|\|0,rtt:m\.rtt\|\|0,weak:m\.weak===true/);
  assert.match(room, /lastPing:p\.lastPing\|\|0,rtt:p\.rtt\|\|0,weak:p\.weak===true/);
  assert.match(dash, /const link=m\?\.admitted\?linkState\(m\):'';/);
  assert.match(dash, /el\('span','cp-weak cp-weak-'\+link\)/);
  assert.match(css, /\.cp-weak-weak\{background:#f59e0b/);
  assert.match(css, /\.cp-weak-lost\{background:#dc2626/);
});

test('connection: the dot is orange for a weak link, red for no signal, and absent for pages that send no heartbeat', () => {
  const src = dash.slice(dash.indexOf('function linkState(m){'), dash.indexOf('setInterval(()=>{if((R()'));
  const linkState = new Function(src + '\nreturn linkState;')();
  const now = Date.now();
  assert.equal(linkState({}), '', 'an older student page sends no heartbeat: no dot');
  assert.equal(linkState({ lastPing: now - 3000, rtt: 200, weak: false }), '');
  assert.equal(linkState({ lastPing: now - 3000, rtt: 2200, weak: false }), 'weak', 'slow answers');
  assert.equal(linkState({ lastPing: now - 3000, rtt: 0, weak: true }), 'weak', 'the student reports a bad link');
  assert.equal(linkState({ lastPing: now - 25000, rtt: 100, weak: false }), 'lost', 'nothing for 25 seconds');
});
