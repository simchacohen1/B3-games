const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('teacher dashboard exposes four sections and keeps roster and permission controls visible',()=>{
  const html=read('class-pointer-prototype/classroom.html');
  const ui=read('class-pointer-prototype/teacher-dashboard.js');
  const css=read('class-pointer-prototype/teacher-dashboard.css');
  for(const name of ['Classroom','Sharing','Student Activities','Display & Tools'])assert.ok(ui.includes("section('"+name+"'"),name+' section is present');
  assert.match(html,/teacher-dashboard\.css/);
  assert.match(html,/teacher-dashboard\.js/);
  assert.match(ui,/getElementById\('tbStudentsMenu'\)/);
  assert.match(ui,/getElementById\('tbStudentsBtn'\)/);
  assert.match(ui,/studentMenu\.hidden=false/);
  assert.match(css,/teacher-dashboard-roster\[hidden\]\{display:block/);
  assert.match(ui,/teacherActivitiesButton/);
  assert.match(ui,/showModal\(\)/);
});

test('student activity chooser reuses the existing screen and whiteboard actions',()=>{
  const ui=read('class-pointer-prototype/teacher-dashboard.js');
  assert.match(ui,/Send to Screen Sharing/);
  assert.match(ui,/Send to Whiteboards/);
  assert.match(ui,/getElementById\('openWhiteboard'\)/);
  assert.match(ui,/getElementById\('studentBoards'\)/);
  assert.match(ui,/getElementById\('cpShareEnabled'\)/);
});

test('activity requests move screen capture into a persistent, student-approved sharing window',()=>{
  const activity=read('class-pointer-prototype/activity-share.js');
  assert.match(activity,/Your teacher would like to see your screen/);
  assert.match(activity,/Open Sharing Window/);
  assert.match(activity,/Choose Entire Screen/);
  assert.match(activity,/student-share-window\.html\?pointerShare=1/);
  assert.match(activity,/if\(!openPersistentShareWindow\(\)\)return beginShare\(event\)/);
  assert.match(activity,/persistentShareWindow/);
  assert.match(activity,/navigator\.mediaDevices\.getDisplayMedia/);
});
test('persistent screen sharing asks for Entire Screen and contains no browser-tab share control',()=>{
  const boards=read('class-pointer-prototype/student-boards.js');
  const activity=read('class-pointer-prototype/activity-share.js');
  const shareWindow=read('class-pointer-prototype/student-share-window.html');
  assert.match(boards,/displaySurface:'monitor'/);
  assert.match(boards,/surface!=='monitor'/);
  assert.doesNotMatch(boards,/Share a browser tab/);
  assert.doesNotMatch(boards,/startShare\('tab'\)/);
  assert.match(activity,/select <strong>Entire Screen<\/strong>/);
  assert.match(shareWindow,/Keep this window open while you visit Shorashim or another activity/);
  assert.match(shareWindow,/Choose <strong>Entire Screen<\/strong>/);
  assert.match(activity,/displaySurface:'monitor'/);
  assert.match(activity,/displaySurface&&displaySurface!=='monitor'/);
});
