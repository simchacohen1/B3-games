// "Who recorded" strip on the Rashi Letters teacher page: worked out from the list the server already returned.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const W = require('../record_pesukim/who-recorded.js');
const page = fs.readFileSync('rashi-letters/teacher.html', 'utf8').replace(/\r\n/g, '\n');

test('Rashi teacher page has the strip above the recordings and loads the shared script', () => {
  assert.ok(page.indexOf('id="whoRecordedStrip"') < page.indexOf('id="recPanel"'));
  assert.match(page, /<script src="\.\.\/record_pesukim\/who-recorded\.js/);
});

test('the strip turns green for students with a reading today and stays gray for the rest', () => {
  const block = page.split('<script>').find(b => b.includes('const drawList=renderRecordings'));
  const code = block.split('</script>')[0];
  const strip = { innerHTML: '', onclick: null };
  let drawn = 0;
  const ctx = { document: { getElementById: () => strip, querySelectorAll: () => [] }, window: { B3WhoRecorded: W }, B3WhoRecorded: W,
    teacherScope: { students: { s1: { name: 'Avi' }, s2: { name: 'Yossi' }, s3: { name: 'Dovid' } } }, recRows: {} };
  ctx.renderRecordings = function(){ drawn++; };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const today = Date.now(), yesterday = Date.now() - 36 * 3600 * 1000;
  ctx.renderRecordings([{ id: 'a', studentId: 's2', createdAt: today }], [{ id: 'b', studentId: 's3', createdAt: yesterday }]);
  assert.equal(drawn, 1, 'the normal list is still drawn');
  assert.match(strip.innerHTML, /1 of 3/);
  assert.match(strip.innerHTML, /wr-chip done[^>]*data-wr-sid="s2"/);
  assert.match(strip.innerHTML, /wr-chip none[^>]*data-wr-sid="s3"/);
  assert.match(strip.innerHTML, /wr-chip none[^>]*data-wr-sid="s1"/);
});
