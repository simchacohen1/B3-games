const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const dash=read('class-pointer-prototype/teacher-dashboard.js');
const css=read('class-pointer-prototype/teacher-dashboard.css');
const annotate=read('class-pointer-prototype/classroom-annotate.js');
const share=read('class-pointer-prototype/activity-share.js');

test('whiteboard buttons are not squashed in full screen (issue 66, bug 1)',()=>{
  // The old left rail shifted the things inside the lesson and squashed the PDF/whiteboard buttons under it.
  // The rail is gone (#770). The one drawing toolbar gets its own strip: the whole lesson moves over, so the
  // button bar is simply centred in the lesson again and nothing inside the lesson is shifted.
  assert.ok(!fs.existsSync(path.join(root,'class-pointer-prototype/teacher-dock-left.js')));
  assert.doesNotMatch(css,/tb-docked-left|dock-left/);
  assert.match(css,/body\.teacher-view\.cp-tool-gutter\.lesson-expanded #stage\.lesson-fullscreen\{left:var\(--cp-tool-gutter\)!important;width:calc\(100% - var\(--cp-tool-gutter\)\)!important\}/);
  assert.doesNotMatch(css,/cp-tool-gutter[^{]*#pdfNav/);
});

test('one Stop button while live, in every view (issue 66, bug 2)',()=>{
  // The red Stop above the lesson is the one Stop button (it is no longer hidden in favour of a copy in the old dock).
  assert.doesNotMatch(css,/\.cp-live-wrap>\.cp-stop-btn\{display:none\}/);
  assert.match(css,/\.cp-live-wrap>\.cp-stop-btn\{[^}]*background:#dc2626/);
  assert.match(dash,/stopBtn\.id='cpStopBtn'/);
  assert.match(css,/#pdfNav \.pdf-close\{display:none!important\}/);
  // Full screen hides that row, so the drawing toolbar shows a red Stop there (and only there) that clicks the same button.
  assert.match(annotate,/\{id:'stop',icon:'⏹',label:'Stop',danger:true,hidden:!\(expanded\(\)&&live\(\)\),title:stopLabel\(\),onClick:\(\)=>click\('cpStopBtn'\)\}/);
});

test('reminder appears for an unused whiteboard and never closes it by itself',()=>{
  assert.match(dash,/syncReminder\(isLive&&docOpen\(\)&&lastDoc==='Whiteboard'\)/);
  assert.match(dash,/visibilitychange/);
  assert.match(dash,/IDLE_MS=5\*60\*1000/);
  const block=dash.slice(dash.indexOf('Reminder: whiteboard still on'),dash.indexOf('function syncLive()'));
  // The only place the reminder closes the whiteboard is the teacher's own click on its Stop button.
  const stops=block.match(/stopBtn\.click\(\)/g)||[];
  assert.equal(stops.length,1);
  assert.match(block,/reminderStop\.addEventListener\('click',\(\)=>\{reminder\.hidden=true;stopBtn\.click\(\)\}\)/);
  assert.match(css,/\.cp-board-reminder\{[^}]*z-index:10002/);
});

test('students already on their page switch accounts live (issue 66, bug 3)',()=>{
  // Old behaviour: the identity timer shut the module down for good. Now it adopts the new student in place.
  assert.doesNotMatch(share,/clearInterval\(identityTimer\)\}\},1000\)/);
  assert.match(share,/async function adoptNewIdentity\(\)/);
  assert.match(share,/sessions\.off\('value',onSessions\)/);
  assert.match(share,/sessionStorage\.removeItem\('classPointerRemovedRoom'\)/);
  assert.match(share,/sessions\.on\('value',onSessions,onSessionsError\)/);
  assert.match(share,/!switching&&!sameStudent\(\)/);
  // Old class/student state is dropped before the new boy is verified.
  const body=share.slice(share.indexOf('async function adoptNewIdentity'),share.indexOf('const identityTimer'));
  assert.ok(body.indexOf('stopPresence()')<body.indexOf('studentAuth'));
  assert.ok(body.indexOf("id='';")<body.indexOf('studentAuth'));
});

test('students panel shows full names and where each boy is (issue 66, bug 4)',()=>{
  assert.match(css,/--cp-drawer:440px/);
  assert.match(css,/\.cp-student-name \.cp-name-text\{[^}]*white-space:normal!important/);
  assert.match(css,/\.cp-student-name \.cp-where\{flex:1 0 100%!important;white-space:normal!important/);
});
