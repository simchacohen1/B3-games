const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const homepage = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('student home exposes My files only after a real student session is restored', () => {
  assert.match(homepage, /id="studentSavedFilesLink" class="student-saved-files hidden" href="class-pointer-prototype\/my-files\.html"/);
  assert.match(homepage, /const signedInStudent=!isAuthorizedTeacher&&!isGuest\(\)&&!isStudentPreview&&Boolean\(myStudentId&&myClassId\)/);
  assert.match(homepage, /function renderGuest\(\)\s*\{[\s\S]*?renderStudentSavedFilesLink\(\)/);
  assert.match(homepage, /function renderStudentAccess\(\)\s*\{[\s\S]*?renderStudentSavedFilesLink\(\)/);
});
