'use strict';
// SYNTHETIC test data only. Made-up names and made-up passcodes; none belong to any real
// person, class, ET or WT. Used by automated tests and as the plan for a later test class.
// "synth-a" has Homework and Messages switched on; "synth-b" has neither (isolation checks).
const WS = 'b3-2026';
const student = (name, classId) => ({ profile: { name }, memberships: { m: { workspaceId: WS, classId } } });
function seed() {
  return {
    b3Games: {
      admins: {},
      workspaces: { [WS]: {
        classes: {
          'synth-a': { name: 'Synthetic Test Class A', toolGrants: { homework: true, messages: true },
            members: { synthA1: { active: true }, synthA2: { active: true }, synthA3: { active: true }, synthAgone: { active: false } } },
          'synth-b': { name: 'Synthetic Test Class B', toolGrants: { homework: true, messages: true },
            members: { synthB1: { active: true }, synthB2: { active: true } } },
          'synth-off': { name: 'Synthetic Switched-Off Class', members: { synthO1: { active: true } } }
        },
        teachers: {
          synthTeacherA: { active: true, classIds: { 'synth-a': true } },
          synthTeacherB: { active: true, classIds: { 'synth-b': true } },
          synthTeacherBoth: { active: true, classIds: { 'synth-a': true, 'synth-off': true } }
        }
      } },
      students: {
        synthA1: student('Avi Synthetic', 'synth-a'), synthA2: student('Benny Synthetic', 'synth-a'),
        synthA3: student('Chaim Synthetic', 'synth-a'), synthAgone: student('Dovid Removed', 'synth-a'),
        synthB1: student('Eli Synthetic', 'synth-b'), synthB2: student('Fivel Synthetic', 'synth-b'),
        synthO1: student('Gavriel Switchedoff', 'synth-off')
      }
    },
    b3Private: { passcodes: {
      synthA1: { passcode: '1001' }, synthA2: { passcode: '1002' }, synthA3: { passcode: '1003' },
      synthB1: { passcode: '2001' }, synthB2: { passcode: '2002' }, synthO1: { passcode: '3001' } } }
  };
}
const login = (id, name, pin, classId) => ({ studentId: id, studentName: name, pin, classId });
const students = {
  a1: login('synthA1', 'Avi Synthetic', '1001', 'synth-a'), a2: login('synthA2', 'Benny Synthetic', '1002', 'synth-a'),
  a3: login('synthA3', 'Chaim Synthetic', '1003', 'synth-a'), b1: login('synthB1', 'Eli Synthetic', '2001', 'synth-b'),
  b2: login('synthB2', 'Fivel Synthetic', '2002', 'synth-b'), o1: login('synthO1', 'Gavriel Switchedoff', '3001', 'synth-off')
};
const googleTeacher = (uid, name) => ({ identity: { uid, name, email: uid + '@synthetic.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const teachers = { a: googleTeacher('synthTeacherA', 'Synthetic Teacher A'), b: googleTeacher('synthTeacherB', 'Synthetic Teacher B'),
  both: googleTeacher('synthTeacherBoth', 'Synthetic Teacher Both') };

function makeStore(data = seed()) {
  const files = new Map();
  const parts = p => p.split('/');
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  const get = async p => { let n = data; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = Object.prototype.hasOwnProperty.call(n, k) ? n[k] : undefined; } return n === undefined ? null : clone(n); };
  const set = async (p, v) => { const k = parts(p); let n = data; for (const s of k.slice(0, -1)) n = n[s] = n[s] || {}; if (v === null) delete n[k[k.length - 1]]; else n[k[k.length - 1]] = clone(v); };
  // Transactions are serialized, like Realtime Database transactions are atomic.
  let lock = Promise.resolve();
  const tx = (p, fn) => (lock = lock.then(async () => { const cur = await get(p); const out = fn(cur); if (out === undefined) return { committed: false }; await set(p, out); return { committed: true }; }, () => 0));
  const page = async (p, { limit, before }) => { const node = (await get(p)) || {}; return Object.keys(node).sort().filter(k => !before || k < before).slice(-limit).map(k => node[k]); };
  return { data, files, get, set, tx, page,
    putFile: async (path, buf) => { files.set(path, Buffer.from(buf)); }, getFile: async path => files.get(path), delFile: async path => { files.delete(path); } };
}
module.exports = { seed, students, teachers, makeStore, WS };
