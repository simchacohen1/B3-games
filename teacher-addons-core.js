/* Teacher Add-ons, step 1: the records (no upload yet).
 * Pure rules shared by the page and the functions that come in the later steps. Nothing here talks to a database.
 *
 * Where the data lives (Realtime Database, top-level node `teacherAddons`):
 *   owners/<addonId>   = the owning teacher's uid
 *   profile/<addonId>  = { name, icon, description?, classIds:{<classId>:true}, version, createdAt, updatedAt }  (the teacher edits this)
 *   admin/<addonId>    = { disabled?, disabledBy?, disabledAt?, reason? }                                         (only the owner/admin can change it)
 */
(function (root) {
  'use strict';
  var LIMITS = { nameMax: 60, iconMax: 16, descriptionMax: 300, versionMax: 100000, maxClasses: 50 };
  var ID_PATTERN = /^ad_[a-z0-9]{8,40}$/;

  function newAddonId(random) {
    var rnd = random || Math.random, chars = 'abcdefghijklmnopqrstuvwxyz0123456789', out = 'ad_';
    for (var i = 0; i < 16; i++) out += chars.charAt(Math.floor(rnd() * chars.length));
    return out;
  }
  function validId(id) { return typeof id === 'string' && ID_PATTERN.test(id); }

  // Plain text only: no angle brackets, no control characters. The page shows these as text, never as HTML.
  function cleanText(value, max) {
    var text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max).trim() : text;
  }

  // input: what the teacher typed. allowedClassIds: the classes this teacher teaches (null = an admin, any class).
  // Returns { ok, profile, errors }. A class the teacher does not teach is an error, never silently dropped.
  function cleanProfile(input, allowedClassIds, now) {
    var errors = [], src = input || {};
    var name = cleanText(src.name, LIMITS.nameMax), icon = cleanText(src.icon, LIMITS.iconMax), description = cleanText(src.description, LIMITS.descriptionMax);
    if (!name) errors.push('Give the add-on a name.');
    if (!icon) errors.push('Pick an icon.');
    var ids = Array.isArray(src.classIds) ? src.classIds : Object.keys(src.classIds || {}).filter(function (k) { return src.classIds[k] === true; });
    var classIds = {}, seen = 0;
    ids.forEach(function (id) {
      var key = String(id || '');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(key) || classIds[key]) return;
      if (allowedClassIds && allowedClassIds.indexOf(key) < 0) { errors.push('You do not teach the class "' + key + '".'); return; }
      classIds[key] = true; seen++;
    });
    if (seen > LIMITS.maxClasses) errors.push('Too many classes.');
    var version = Number(src.version);
    if (!Number.isInteger(version) || version < 0 || version > LIMITS.versionMax) version = 0;
    var stamp = typeof now === 'number' ? now : Date.now();
    var profile = { name: name, icon: icon, classIds: classIds, version: version, updatedAt: stamp };
    if (description) profile.description = description;
    if (src.createdAt != null && Number.isFinite(Number(src.createdAt))) profile.createdAt = Number(src.createdAt); else profile.createdAt = stamp;
    return { ok: errors.length === 0, profile: profile, errors: errors };
  }

  // The only addresses an add-on may be shown from (never an address that comes from a link or from a teacher).
  var ALLOWED_HOSTS = ['https://apps.sols.tools', 'https://fun-torah-tools-staging-apps.web.app'];
  // The viewer's sandbox. NO allow-same-origin (the add-on gets no origin, so no cookies, storage or access to our page),
  // NO allow-top-navigation (it cannot move our page), NO allow-popups (it cannot open other sites).
  var SANDBOX = 'allow-scripts allow-forms allow-modals';
  function viewerFrameUrl(host, addonId) {
    if (ALLOWED_HOSTS.indexOf(host) < 0 || !validId(addonId)) return '';
    return host + '/a/' + addonId + '/';
  }

  // Who may manage an add-on: its owner (the teacher who made it), the site owner, or an active admin.
  function canManage(ownerUid, uid, isOwnerOrAdmin) { return !!isOwnerOrAdmin || (!!uid && !!ownerUid && ownerUid === uid); }

  // An add-on is switched off for everyone the moment the owner or an admin sets admin/<id>/disabled = true.
  function isLive(adminRecord) { return !(adminRecord && adminRecord.disabled === true); }
  function status(adminRecord) { return isLive(adminRecord) ? 'live' : 'switched-off'; }

  var api = { LIMITS: LIMITS, ID_PATTERN: ID_PATTERN, newAddonId: newAddonId, validId: validId, cleanText: cleanText, cleanProfile: cleanProfile, canManage: canManage, isLive: isLive, status: status, ALLOWED_HOSTS: ALLOWED_HOSTS, SANDBOX: SANDBOX, viewerFrameUrl: viewerFrameUrl };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.B3TeacherAddons = api;
})(typeof window !== 'undefined' ? window : this);
