const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const body = html.slice(html.indexOf('async function loadClassManagementNow()'), html.indexOf('const classSel=el("manageClassSelect")'));

test('a teacher reads only their own classes one by one; only an owner reads the whole classes list', () => {
  assert.match(body, /if\(isOwner\)\{\s*allClasses=\(await db\.ref\("b3Games\/workspaces\/"\+workspaceId\+"\/classes"\)\.once\("value"\)\)\.val\(\)\|\|\{\};/);
  assert.match(body, /\[\.\.\.allowedClassIds\]\.filter\(id=>\/\^\[A-Za-z0-9_-\]\{1,100\}\$\/\.test\(id\)\)\.map\(async id=>\[id,\(await db\.ref\("b3Games\/workspaces\/"\+workspaceId\+"\/classes\/"\+id\)\.once\("value"\)\)\.val\(\)\]\)/);
  assert.doesNotMatch(body, /const classesSnap=await db\.ref\("b3Games\/workspaces\/"\+workspaceId\+"\/classes"\)/);
});
