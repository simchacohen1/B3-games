const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const csv = require('../student-roster-csv.js');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the CSV has the four columns, quotes every cell, and starts with a byte-order mark for Excel', () => {
  const text = csv.rosterCsv([{ className: 'Test Class Alef', name: 'Test Student A1', passcode: '123456', status: 'Enabled' }]);
  assert.equal(text.charCodeAt(0), 0xfeff);
  const lines = text.slice(1).split('\r\n');
  assert.equal(lines[0], '"Class","Student name","Current passcode","Access status"');
  assert.equal(lines[1], '"Test Class Alef","Test Student A1","123456","Enabled"');
});

test('a name that looks like a spreadsheet formula, a quote or a line break cannot break out of its cell', () => {
  const text = csv.rosterCsv([{ className: 'C', name: '=HYPERLINK("x")', passcode: '+1', status: 'a\nb' }]);
  assert.match(text, /"'=HYPERLINK\(""x""\)","'\+1","a b"/);
  assert.equal(csv.cell('say "hi"'), '"say ""hi"""');
  assert.equal(csv.cell(null), '""');
});

test('access status says what is off: this class only, or the whole account', () => {
  assert.equal(csv.accessStatus({ active: true }, { active: true }), 'Enabled');
  assert.equal(csv.accessStatus({}, {}), 'Enabled');
  assert.equal(csv.accessStatus({ active: false }, {}), 'Blocked in this class');
  assert.equal(csv.accessStatus({ active: true }, { active: false }), 'Account off');
  assert.equal(csv.accessStatus({ active: false }, { active: false }), 'Account off');
});

test('file names are safe and carry the date', () => {
  assert.equal(csv.fileName('Test Class Alef', new Date('2026-11-18T10:00:00Z')), 'roster-test-class-alef-2026-11-18.csv');
  assert.equal(csv.fileName('all-classes', new Date('2026-11-18T10:00:00Z')), 'roster-all-classes-2026-11-18.csv');
  assert.match(csv.fileName('../../x:y'), /^roster-x-y-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('the Students page has the button and the scope choice; "All classes" is added for the owner only', () => {
  assert.match(index, /id="downloadRosterButton"[^>]*>⬇ Download roster \(CSV\)/);
  assert.match(index, /id="rosterCsvScope"[\s\S]{0,200}<option value="class">This class<\/option>/);
  assert.match(index, /const wantAll=isOwner&&classIds\.length>1;/);
  assert.match(index, /const all=el\("rosterCsvScope"\)\.value==="all"&&ctx\.isOwner;/);
  assert.match(index, /<script src="student-roster-csv\.js\?v=20261118-roster1" defer><\/script>/);
});

test('passcodes come only from the existing server list request, which checks the teacher owns the class; no new endpoint', () => {
  assert.match(index, /trustedStudentAction\("list",\{classId\}\)/);
  const start = index.indexOf('async function downloadRoster');
  const block = index.slice(start, index.indexOf('async function trustedStudentAction', start));
  assert.doesNotMatch(block, /ref\("[^"]*passcode/i);
  assert.doesNotMatch(block, /fetch\(/);
});

test('an owner whose account cannot read the whole student directory still gets the class list (and so the roster download)', () => {
  assert.match(index, /try\{studentIds=await ownerStudentIds\(\);\}\s*catch\(error\)\{[\s\S]{0,400}Object\.values\(classes\)\.forEach\(row=>Object\.keys\(\(row&&row\.members\)\|\|\{\}\)\.forEach\(id=>ids\.add\(id\)\)\);\s*studentIds=\[\.\.\.ids\];/);
});

test('the staging banner spans the full row, so it cannot squeeze the two-column admin page', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'staging', 'staging-config.js'), 'utf8');
  assert.match(cfg, /\.b3-staging-notice\{grid-column:1\/-1;/);
});
