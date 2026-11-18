const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'owner-admin.html'), 'utf8');

test('Owner Admin still shows teachers and classes when schools, principal links or the student directory cannot be read', () => {
  const load = html.slice(html.indexOf('async function load(){'), html.indexOf('// Owner as a teacher (#726)'));
  // Teachers and classes stay required; the three extras are each guarded so one denied read cannot empty the page.
  assert.match(load, /teacherData=ts\.val\(\)\|\|\{\};classData=cs\.val\(\)\|\|\{\};/);
  assert.match(load, /try\{schoolsRaw=\(await db\.ref\("b3Games\/workspaces\/"\+WS\+"\/schools"\)\.once\("value"\)\)\.val\(\);\}catch/);
  assert.match(load, /schoolData=B3SchoolScope\.normalizeSchools\(schoolsRaw\);/);
  assert.match(load, /try\{await reconcilePrincipals\(teacherData,classData\);\}catch/);
  assert.match(load, /try\{await loadStudentData\(\);\}catch\(error\)\{[^}]*studentRecords=\{\};rosterData=B3StudentScope\.rosterStudents\(classData\);\}/);
  assert.ok(load.trim().endsWith('applyNav();\n}') || /applyNav\(\);\s*\}\s*$/.test(load), 'the page is always drawn');
});
