'use strict';
// #764: the homework pages are cached for 10 minutes but their shared scripts for 4 hours. A page that
// calls a helper added in the same release then runs against the old cached script and breaks (the
// Create Assignment button did nothing after #757). Each shared script tag therefore carries ?v= set to
// a short hash of the script, so a changed script is always fetched fresh.
// When this test fails, copy the expected tag from the message into teacher.html and student.html.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = path.join(__dirname, '..', 'assignment-center');
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const version = name => crypto.createHash('sha256').update(read(name).replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);

for (const page of ['teacher.html', 'student.html']) {
  for (const script of ['homework-common.js', 'messages-ui.js', 'homework-items.js']) {
    test(page + ' loads ' + script + ' with a version that matches its contents', () => {
      const tag = '<script src="' + script + '?v=' + version(script) + '"></script>';
      assert.ok(read(page).includes(tag), page + ' needs ' + tag);
    });
  }
}
