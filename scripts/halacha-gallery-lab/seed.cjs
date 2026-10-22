'use strict';
// Synthetic-only fixtures. No real student names, ids or passcodes.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const students = {
  syn_et_a: { name: 'Synthetic Aleph', classId: 'et', pin: '4821' },
  syn_et_b: { name: 'Synthetic Bet', classId: 'et', pin: '7390' },
  syn_wt_c: { name: 'Synthetic Gimel', classId: 'wt', pin: '5512' },
  syn_alpha_d: { name: 'Synthetic Dalet', classId: 'synalpha', pin: '6604' }
};
function seed() {
  const data = { b3Games: { students: {}, workspaces: { 'b3-2026': { classes: {}, teachers: {
    syn_teacher_et: { active: true, classIds: { et: true } },
    syn_teacher_wt: { active: true, classIds: { wt: true } },
    syn_teacher_alpha: { active: true, classIds: { synalpha: true } }
  } } }, siteSettings: { siteEnabled: true, classAccess: { et: { mode: 'open' }, wt: { mode: 'open' } } } },
  b3Private: { passcodes: {} }, classGallery: { posts: {} } };
  const classes = data.b3Games.workspaces['b3-2026'].classes;
  classes.et = { name: 'B3 ET', active: true, members: {}, halachaAccess: { maxSiman: 'ו' } };
  classes.wt = { name: 'B3 WT', active: true, members: {}, halachaAccess: { maxSiman: 'ו' } };
  classes.synalpha = { name: 'Synthetic Alpha Class', active: true, members: {}, toolGrants: { halacha: true, gallery: true }, halachaAccess: { maxSiman: 'ו' } };
  for (const [id, s] of Object.entries(students)) {
    data.b3Games.students[id] = { profile: { name: s.name, active: true, classId: s.classId },
      memberships: { ['b3-2026_' + s.classId]: { workspaceId: 'b3-2026', classId: s.classId, active: true } } };
    classes[s.classId].members[id] = { active: true, name: s.name };
    data.b3Private.passcodes[id] = { passcode: s.pin };
  }
  // Pre-existing Gallery posts that must remain byte-for-byte untouched.
  data.classGallery.posts['-SynExistingApproved'] = { studentId: 'syn_et_b', classId: 'et', studentName: 'Synthetic Bet', className: 'B3 ET', title: 'Existing approved post', category: 'Chumash', galleryRoom: 'hallway', image: TINY_PNG, status: 'approved', createdAt: '2026-10-01T12:00:00.000Z' };
  data.classGallery.posts['-SynExistingPending'] = { studentId: 'syn_wt_c', classId: 'wt', studentName: 'Synthetic Gimel', className: 'B3 WT', title: 'Existing pending post', category: 'Other', galleryRoom: 'hallway', image: TINY_PNG, status: 'pending', createdAt: '2026-10-02T12:00:00.000Z' };
  data.b3Games.workspaces['b3-2026'].classes.synalpha.resources = { gallery: { posts: { '-SynExistingAlpha': { studentId: 'syn_alpha_d', classId: 'synalpha', studentName: 'Synthetic Dalet', title: 'Existing alpha post', image: TINY_PNG, status: 'approved', createdAt: '2026-10-03T12:00:00.000Z' } } } };
  return data;
}
module.exports = { seed, students, TINY_PNG };
