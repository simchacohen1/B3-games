'use strict';
// Intentionally RED: fictional-data-only checks for a principal whose cached
// teacher-level grants outlive a supervised teacher's revocation.
// These execute the real Teacher Center authorization reader, not Firebase rules.
// No network, credentials, live student records, or production writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = 'b3Games/workspaces/b3-2026';
const principal = {
  uid: 'fictional-principal',
  email: 'principal@example.test',
  emailVerified: true,
  getIdToken: async () => 'fictional'
};
function access(data) {
  const reads = [];
  const db = {
    ref(path) {
      return { once: async () => {
        reads.push(path);
        return { val: () => Object.prototype.hasOwnProperty.call(data, path) ? data[path] : null };
      } };
    }
  };
  const firebase = {
    apps: [{}],
    database: () => db,
    auth: () => ({ currentUser: principal })
  };
  const window = {
    firebase,
    B3_FIREBASE_CONFIG: Object.fromEntries(
      ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId']
        .map(k => [k, 'fictional'])
    )
  };
  const document = { readyState: 'complete', addEventListener() {} };
  const source = fs.readFileSync('site-settings.js', 'utf8')
    .replace('  window.B3SiteSettings = {',
      '  window.readAccessForTest = readUserAccess;\n  window.B3SiteSettings = {');
  assert.match(source, /window\.readAccessForTest = readUserAccess/);
  vm.runInNewContext(source, { window, firebase, document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null },
    console, Intl, Date, setTimeout, clearTimeout });
  return { read: () => window.readAccessForTest(principal), reads };
}
function teacherRecord(classIds) {
  return {
    active: true, role: 'teacher', accountType: 'principal',
    classIds, supervisedTeachers: { teacherA: { classIds: { et: true, wt: true } } }
  };
}

test('RED: disabled supervised teacher revokes principal before owner reconciliation', async () => {
  const x = access({
    [ROOT + '/teachers/fictional-principal']: teacherRecord({ et: true, wt: true }),
    [ROOT + '/teacherInvites/teacherA']: {
      role: 'teacher', active: false, classIds: { et: true, wt: true }
    }
  });
  const result = await x.read();
  assert.equal(result.authorized, false,
    'principal must not retain teacher privileges when their sole supervisor is disabled');
});

test('RED: supervisor class removal immediately removes only that principal class', async () => {
  const x = access({
    [ROOT + '/teachers/fictional-principal']: teacherRecord({ et: true, wt: true }),
    [ROOT + '/teacherInvites/teacherA']: {
      role: 'teacher', active: true, classIds: { et: true }
    }
  });
  const result = await x.read();
  assert.equal(result.authorized, true);
  assert.deepEqual(Array.from(result.classIds), ['et'],
    'principal must lose WT immediately, retaining the still-supervised ET class');
});


test('claimed supervisor disabled or missing denies a stale principal grant', async () => {
  for (const claimedRecord of [{active:false,classIds:{et:true}}, null]) {
    const data = {
      [ROOT + '/teachers/fictional-principal']: teacherRecord({et:true}),
      [ROOT + '/teacherInvites/teacherA']: {
        role:'teacher', active:true, classIds:{et:true}, claimedUid:'claimed-teacher'
      }
    };
    if (claimedRecord) data[ROOT + '/teachers/claimed-teacher'] = claimedRecord;
    const x = access(data);
    const result = await x.read();
    assert.equal(result.authorized, false,
      'a stale principal grant must not survive disabled or missing claimed teacher');
    assert.ok(x.reads.includes(ROOT + '/teachers/claimed-teacher'));
  }
});

test('overlapping supervisors retain only currently supervised classes', async () => {
  const cached = teacherRecord({et:true,wt:true});
  cached.supervisedTeachers.teacherB = {classIds:{et:true,wt:true}};
  const x = access({
    [ROOT + '/teachers/fictional-principal']: cached,
    [ROOT + '/teacherInvites/teacherA']: {
      role:'teacher', active:false, classIds:{et:true,wt:true}
    },
    [ROOT + '/teacherInvites/teacherB']: {
      role:'teacher', active:true, classIds:{wt:true}
    }
  });
  const result = await x.read();
  assert.equal(result.authorized, true);
  assert.deepEqual(Array.from(result.classIds), ['wt'],
    'revoking one supervisor must not revoke another supervisor\'s valid WT grant');
  assert.ok(!result.supervisedTeachers.teacherA);
  assert.ok(result.supervisedTeachers.teacherB);
});
