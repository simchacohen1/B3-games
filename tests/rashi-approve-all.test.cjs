const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');

test('Rashi teacher page has a confirmed Approve All for waiting recordings',()=>{
  const html=fs.readFileSync('rashi-letters/teacher.html','utf8');
  assert.match(html,/id="approveAllBtn"/);
  assert.match(html,/confirm\('Approve all '/);
  assert.ok(html.includes("rashiApi('rashi-approve', { requestId: id })"));
});
