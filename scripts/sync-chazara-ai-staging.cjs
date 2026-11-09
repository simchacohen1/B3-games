#!/usr/bin/env node
'use strict';
// Copies the Chazara AI Practice source into the staging-only Functions codebase.
// Usage: node scripts/sync-chazara-ai-staging.cjs        (writes the copies)
//        node scripts/sync-chazara-ai-staging.cjs --check (exit 1 if out of date)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'backend/functions'), dst = path.join(root, 'backend/chazara-ai-staging');
const files = [
  ...fs.readdirSync(path.join(src, 'chazara-ai')).filter(f => f.endsWith('.cjs')).map(f => 'chazara-ai/' + f),
  'student-practice-auth.cjs', 'student-tool-policy.js'
];
const check = process.argv.includes('--check');
let stale = [];
for (const f of files) {
  const from = fs.readFileSync(path.join(src, f));
  const to = path.join(dst, f);
  const same = fs.existsSync(to) && fs.readFileSync(to).equals(from);
  if (same) continue;
  if (check) { stale.push(f); continue; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, from);
  console.log('copied', f);
}
// Files left over in the staging copy that no longer exist in the source.
const extra = fs.readdirSync(path.join(dst, 'chazara-ai')).filter(f => !files.includes('chazara-ai/' + f));
for (const f of extra) {
  if (check) stale.push('chazara-ai/' + f + ' (should be removed)');
  else { fs.unlinkSync(path.join(dst, 'chazara-ai', f)); console.log('removed', 'chazara-ai/' + f); }
}
if (check && stale.length) { console.error('Staging copy out of date:', stale.join(', ')); process.exit(1); }
module.exports = { files };
