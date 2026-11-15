'use strict';
const fs = require('node:fs');
const path = require('node:path');
const excluded = /^(?:\.git|\.github|node_modules|backend|staging|sols-site|tests|e2e.*|docs|security|scripts|vendor|backup.*|preview.*)$/;
// Only the generated SOLS copy is passed here. Never rewrite staging settings,
// project IDs, persistence, database URLs or the sign-in methods.
function applyAuthDomain(target, settings) {
  if (settings.domain !== 'auth.sols.tools' || typeof settings.enabled !== 'boolean') {
    throw new Error('Invalid SOLS authentication-domain settings');
  }
  if (!settings.enabled) return 0;
  const root = fs.readFileSync(path.join(target, 'firebase-config.js'), 'utf8');
  if (!/projectId:\s*["']b3-games["']/.test(root) || /B3_FIREBASE_CONFIG\s*=\s*window.B3_STAGING_FIREBASE_CONFIG;\s*$/.test(root)) {
    throw new Error('Custom SOLS auth domain requires a production source build');
  }
  let changed = 0;
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && !excluded.test(entry.name)) visit(file);
      else if (entry.isFile() && /\.(?:js|html?)$/.test(entry.name)) {
        const before = fs.readFileSync(file, 'utf8');
        const after = before.replace(/(\bauthDomain\s*:\s*)(["'])b3-games\.firebaseapp\.com\2/g,
          (_, prefix, quote) => prefix + quote + settings.domain + quote);
        if (after !== before) { fs.writeFileSync(file, after); changed++; }
      }
    }
  }
  visit(target);
  return changed;
}
module.exports = {applyAuthDomain};
