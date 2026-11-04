'use strict';
// Preview-only: adds the staging bootstrap <script> to a COPY of the site.
// The real pages never contain it, so the live site never requests it.
// Usage: node scripts/inject-preview-bootstrap.cjs <copy-of-site-folder>
const fs = require('node:fs');
const path = require('node:path');

const TAG = '<script src="/staging/preview-bootstrap.js"></script>';
const PAGES = [
  'index.html', 'teacher-home.html', 'student-report/index.html', 'student-rewards/index.html',
  'weekly-quiz/index.html', 'chazara/index.html', 'shorashim/index.html', 'record_pesukim/student.html',
  'rashi-letters/student.html', 'yiddish/index.html', 'halacha/index.html', 'game-show/player.html',
  'class-gallery/index.html', 'assignment-center/student.html', 'assignment-center/teacher.html'
];

function inject(html) {
  if (html.includes('/staging/preview-bootstrap.js')) return html;
  // Right after the opening <head ...> tag, or (pages without one) after <html ...>.
  const head = /<head(\s[^>]*)?>/i.exec(html) || /<html(\s[^>]*)?>/i.exec(html);
  if (!head) throw new Error('No <head> or <html> tag found');
  const at = head.index + head[0].length;
  return html.slice(0, at) + '\n' + TAG + '\n' + html.slice(at);
}

function injectAll(root) {
  for (const page of PAGES) {
    const file = path.join(root, page);
    const html = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, inject(html));
  }
  return PAGES.length;
}

if (require.main === module) {
  const root = process.argv[2];
  if (!root || !fs.existsSync(root)) { console.error('Give the folder that holds the copy of the site.'); process.exit(2); }
  console.log('Added the staging bootstrap to ' + injectAll(root) + ' pages in the preview copy.');
}
module.exports = { PAGES, TAG, inject, injectAll };
