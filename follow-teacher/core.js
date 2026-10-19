/* Follow the Teacher — navigation policy, phase 1 (Issue #150).
 * Pure, side-effect-free decisions. This module NEVER captures a screen,
 * writes to Firebase, redirects a browser or authenticates a student.
 * The transport/UI must authenticate the teacher and student separately.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FTTFollowTeacherCore = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const MODES = Object.freeze({
    INDEPENDENT: 'independent',
    FREE: 'free',
    LOCKED: 'locked'
  });
  // Expand ONLY after each activity is verified to load the shared gate.
  const DESTINATIONS = Object.freeze({
    shorashim: Object.freeze({label: 'Shorashim', path: '/shorashim/'})
  });
  const MAX_HEARTBEAT_AGE_MS = 90 * 1000;
  const MAX_LEASE_MS = 10 * 60 * 1000;
  const KEY = /^[A-Za-z0-9_-]{1,100}$/;

  function validId(value) {
    return typeof value === 'string' && KEY.test(value) &&
      !['__proto__', 'prototype', 'constructor'].includes(value);
  }

  function canonicalPath(currentUrl) {
    try {
      const url = new URL(currentUrl, 'https://funtorahtools.com');
      let path = url.pathname.replace(/\/index\.html$/i, '/');
      if (!path.endsWith('/')) path += '/';
      return path;
    } catch (_) { return ''; }
  }

  function targetApplies(targets, studentId) {
    if (targets === 'all') return true;
    return Array.isArray(targets) && targets.includes(studentId);
  }

  function fresh(state, now) {
    if (!state || !Number.isFinite(now) || !Number.isFinite(state.heartbeatAt) ||
        !Number.isFinite(state.expiresAt) || !Number.isFinite(state.issuedAt)) return false;
    // Reject future-dated and stale broadcasts and avoid indefinitely sticky locks.
    return now >= state.issuedAt && state.issuedAt <= state.heartbeatAt &&
      state.heartbeatAt <= now + 5000 && state.expiresAt > now &&
      state.expiresAt <= state.issuedAt + MAX_LEASE_MS &&
      now - state.heartbeatAt <= MAX_HEARTBEAT_AGE_MS;
  }

  /**
   * Caller must first verify the student's session, class membership, and
   * effective per-student tool permission using the existing access gate.
   * currentUrl is the student's current page (not an arbitrary teacher URL).
   *
   * Returns {action:'none'|'stay'|'navigate', reason, destination?, applyKey?}.
   * For free mode, persist applyKey in same-tab sessionStorage BEFORE navigate.
   * For locked mode, check again on each page and on direct URL loads.
   */
  function decide(state, context) {
    const c = context || {};
    const none = reason => ({action: 'none', reason});
    if (!c.studentAuthorized || !validId(c.studentId) ||
        !validId(c.workspaceId) || !validId(c.classId)) return none('student-not-verified');
    if (!state || state.mode === MODES.INDEPENDENT) return none('independent');
    if (![MODES.FREE, MODES.LOCKED].includes(state.mode)) return none('invalid-mode');
    if (state.workspaceId !== c.workspaceId || state.classId !== c.classId ||
        !validId(state.teacherUid) || !validId(state.revision)) return none('wrong-class');
    if (!fresh(state, c.now)) return none('expired');
    if (!targetApplies(state.targets, c.studentId)) return none('not-selected');
    const destination = DESTINATIONS[state.destination];
    if (!destination || c.allowedTools?.[state.destination] !== true) return none('not-permitted');
    const applyKey = [state.workspaceId, state.classId, state.revision, c.studentId].join(':');
    const alreadyThere = canonicalPath(c.currentUrl) === destination.path;
    if (state.mode === MODES.FREE) {
      if (c.lastAppliedKey === applyKey) return none('already-sent');
      return {action: alreadyThere ? 'stay' : 'navigate', reason: 'one-time',
        destination: destination.path, applyKey, mode: state.mode};
    }
    return {action: alreadyThere ? 'stay' : 'navigate',
      reason: 'teacher-locked', destination: destination.path, applyKey, mode: state.mode};
  }

  /**
   * Builds an untrusted proposed state, NOT an authorization grant.
   * The backend must validate the signed-in teacher's class assignment,
   * destination tool grant, targets, and revision before storing it.
   */
  function propose({workspaceId, classId, teacherUid, mode, destination,
                    revision, targets = 'all', issuedAt, heartbeatAt, expiresAt}) {
    if (![MODES.INDEPENDENT, MODES.FREE, MODES.LOCKED].includes(mode)) throw Error('Invalid mode');
    if (![workspaceId, classId, teacherUid, revision].every(validId)) throw Error('Invalid session identifier');
    if (mode !== MODES.INDEPENDENT && !DESTINATIONS[destination]) throw Error('Destination is not allowed');
    if (targets !== 'all' && (!Array.isArray(targets) || !targets.length ||
        targets.length > 60 || targets.some(id => !validId(id)) ||
        new Set(targets).size !== targets.length)) throw Error('Invalid student selection');
    if (![issuedAt, heartbeatAt, expiresAt].every(Number.isFinite) ||
        !(issuedAt <= heartbeatAt && heartbeatAt <= expiresAt) ||
        expiresAt > issuedAt + MAX_LEASE_MS) throw Error('Invalid lease');
    return {version: 1, workspaceId, classId, teacherUid, mode,
      destination: mode === MODES.INDEPENDENT ? null : destination,
      revision, targets, issuedAt, heartbeatAt, expiresAt};
  }

  return Object.freeze({MODES, DESTINATIONS, MAX_HEARTBEAT_AGE_MS,
    MAX_LEASE_MS, validId, canonicalPath, targetApplies, fresh, decide, propose});
});
