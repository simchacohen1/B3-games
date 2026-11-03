const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const dash=read('class-pointer-prototype/teacher-dashboard.js');
const css=read('class-pointer-prototype/teacher-dashboard.css');
const rail=read('class-pointer-prototype/teacher-dock-left.js');
const share=read('class-pointer-prototype/activity-share.js');

test('whiteboard buttons are not squashed in full screen (issue 66, bug 1)',()=>{
  // The PDF/whiteboard button bar is centred in the space right of the rail, not shifted under it.
  assert.match(rail,/#stage\.tb-docked-left > #pdfNav\{left:calc\(\$\{RAIL\}px \+ \(100% - \$\{RAIL\}px\) \/ 2\)!important;transform:translateX\(-50%\)!important/);
  assert.match(rail,/max-width:calc\(100% - \$\{RAIL \+ 24\}px\)!important/);
  // The Stop button gets a readable two-line label inside the narrow rail.
  assert.match(rail,/cp-dock-stop::after\{content:attr\(data-short\)/);
});

test('one Stop button while live, in every view (issue 66, bug 2)',()=>{
  assert.match(css,/body\.cp-simple\.teacher-view \.cp-live-wrap>\.cp-stop-btn\{display:none\}/);
  assert.match(css,/#pdfNav \.pdf-close\{display:none!important\}/);
  // It stays visible even when the floating toolbar is collapsed.
  assert.match(css,/\.collapsed > \.tb-group:last-child > \.cp-dock-stop:not\(\[hidden\]\)\{display:inline-flex!important\}/);
  assert.match(dash,/dockStop\.addEventListener\('click',\(\)=>stopBtn\.click\(\)\)/);
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
