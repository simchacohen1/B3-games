/* Loads classes one at a time, for the owner, without ever reading the whole `classes` node.
 *
 * The hardened database rules allow reading a single class (b3Games/workspaces/<ws>/classes/<id>) but not the list of all classes.
 * So class IDs are found from places the owner can read: the classes assigned in teacher invitations, plus class IDs this
 * browser has seen before (remembered locally, e.g. a class just created in Owner Admin).
 * Limit: a class that no teacher is assigned to, and that this browser has never seen, cannot be listed until a teacher is assigned.
 */
(function (root) {
  "use strict";
  const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
  const STORE_KEY = "b3.ownerClassIds.";
  const MAX_REMEMBERED = 500;

  function storage(options) { return options && options.storage ? options.storage : (typeof localStorage !== "undefined" ? localStorage : null); }

  function remembered(ws, options) {
    try {
      const s = storage(options);
      const list = s ? JSON.parse(s.getItem(STORE_KEY + ws) || "[]") : [];
      return Array.isArray(list) ? list.filter(id => typeof id === "string" && SAFE_ID.test(id)) : [];
    } catch (e) { return []; }
  }

  function remember(ws, ids, options) {
    try {
      const s = storage(options);
      if (!s) return;
      const set = new Set(remembered(ws, options));
      [].concat(ids).forEach(id => { if (typeof id === "string" && SAFE_ID.test(id)) set.add(id); });
      s.setItem(STORE_KEY + ws, JSON.stringify([...set].slice(-MAX_REMEMBERED)));
    } catch (e) { /* storage can be blocked; the list just is not remembered */ }
  }

  // Class IDs assigned in teacher invitations ({inviteId: {classIds: {classId: true}}}).
  function idsFromInvites(invites) {
    const out = [];
    Object.keys(invites || {}).forEach(k => {
      const cids = (invites[k] && invites[k].classIds) || {};
      Object.keys(cids).forEach(c => { if (cids[c] === true && c !== "*" && SAFE_ID.test(c) && !out.includes(c)) out.push(c); });
    });
    return out;
  }

  function unique(ids) { return [...new Set(ids.filter(id => typeof id === "string" && SAFE_ID.test(id)))]; }

  // Reads each class on its own. A class that cannot be read is skipped and reported, never fatal.
  async function readClasses(db, ws, ids) {
    const classes = {}, unreadable = [];
    await Promise.all(unique(ids).map(async id => {
      try {
        const value = (await db.ref("b3Games/workspaces/" + ws + "/classes/" + id).once("value")).val();
        if (value && typeof value === "object") classes[id] = value;
      } catch (e) { unreadable.push(id); }
    }));
    return { classes, unreadable };
  }

  const api = { SAFE_ID, remembered, remember, idsFromInvites, unique, readClasses };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.B3OwnerClasses = api;
})(typeof window === "object" ? window : globalThis);
