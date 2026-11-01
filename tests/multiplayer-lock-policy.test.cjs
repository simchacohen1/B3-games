'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../backend/functions/multiplayer-lock-policy.cjs');

test('Multiplayer Center obeys ET automatic class hours and manual class overrides', () => {
  const duringClass = new Date('2026-11-02T14:00:00.000Z'); // Monday, 9:00 AM New York.
  const afterClass = new Date('2026-11-02T22:00:00.000Z');
  assert.equal(policy.allowsMultiplayer({ actorRole: 'student', classId: 'et', studentId: 'avi', settings: {}, date: duringClass }), false);
  assert.equal(policy.allowsMultiplayer({ actorRole: 'student', classId: 'et', studentId: 'avi', settings: {}, date: afterClass }), true);
  assert.equal(policy.allowsMultiplayer({ actorRole: 'student', classId: 'et', studentId: 'avi', settings: { classAccess: { et: { mode: 'open' } } }, date: duringClass }), true);
  assert.equal(policy.allowsMultiplayer({ actorRole: 'student', classId: 'et', studentId: 'avi', settings: { classAccess: { et: { mode: 'locked' } } }, date: afterClass }), false);
});

test('activity disable blocks exception overrides, while a student-specific exception opens the activity', () => {
  const duringClass = new Date('2026-11-02T14:00:00.000Z');
  assert.equal(policy.allowsMultiplayer({ actorRole: 'student', classId: 'wt', studentId: 'benny', settings: { studentGameOverrides: { benny: { 'multiplayer-center': true } }, games: { 'multiplayer-center': false } }, date: duringClass }), false);
  assert.equal(policy.allowsMultiplayer({ actorRole: 'student', classId: 'wt', studentId: 'benny', settings: { studentGameOverrides: { benny: { 'multiplayer-center': true } } }, date: duringClass }), true);
});

test('non ET/WT class locks apply and assigned teachers retain authorized access', () => {
  assert.equal(policy.allowsMultiplayer({ actorRole: 'student', classId: 'grade3', studentId: 'avi', settings: {}, classRow: { access: { mode: 'locked' } } }), false);
  assert.equal(policy.allowsMultiplayer({ actorRole: 'student', classId: 'grade3', studentId: 'avi', settings: {}, classRow: { toolGrants: { 'multiplayer-center': true } } }), true);
  assert.equal(policy.allowsMultiplayer({ actorRole: 'teacher', classId: 'grade3', studentId: 'teacher_1', settings: {}, classRow: {} }), true);
});
