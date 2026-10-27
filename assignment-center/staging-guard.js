/* This prototype may use only the isolated staging Firebase project. */
(function (root) {
  'use strict';
  var project = 'fun-torah-tools-staging';
  var host = root.location && root.location.hostname ? root.location.hostname.toLowerCase() : '';
  var cfg = root.B3_STAGING_FIREBASE_CONFIG || root.B3_FIREBASE_CONFIG || null;
  var hostOk = host === 'fun-torah-tools-staging.web.app' ||
    host.endsWith('--fun-torah-tools-staging.web.app');
  var valid = hostOk && cfg && cfg.projectId === project;
  root.__B3_STAGING_BLOCKED__ = !valid;
  root.B3_STAGING_FIREBASE_CONFIG = valid ? cfg : null;
  root.B3_STAGING_FEATURES = { storage: false, posukScoring: false, nigriSync: false };
  root.B3_FIREBASE_CONFIG = valid ? cfg : null;

  function mountNotice() {
    if (!root.document || !root.document.body || root.document.querySelector('.b3-staging-notice')) return;
    var note = root.document.createElement('div');
    note.className = 'b3-staging-notice';
    note.setAttribute('role', 'status');
    note.textContent = valid
      ? 'STAGING PREVIEW · Fictional teacher and student accounts only'
      : 'STAGING ONLY · This preview is blocked because it is not connected to the isolated staging project.';
    note.style.cssText = 'position:sticky;top:0;z-index:10000;padding:8px 14px;background:#fff3c4;color:#754d00;border-bottom:1px solid #e4c46e;text-align:center;font:700 13px system-ui,sans-serif';
    root.document.body.prepend(note);
  }
  if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mountNotice, { once: true });
  else mountNotice();
})(typeof window !== 'undefined' ? window : globalThis);
