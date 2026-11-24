#!/usr/bin/env node
// Gives every page its own <title> ("Page · SOLS") and a per-section SVG favicon.
// Re-runnable: it regenerates assets/favicons/*.svg and rewrites the <title> and icon <link>s in the
// listed pages. Add a new page to PAGES (and a new section to ICONS if needed), then run:
//   node scripts/apply-page-identity.cjs
// Pages in KEEP_SOLS_ICON keep the main SOLS favicon (only the title changes).
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const SITE = 'SOLS';

// key: [background, glyph, glyph size]
const ICONS = {
  teacher: ['#4f46e5', 'T', 19], admin: ['#475569', 'Ad', 14], owner: ['#111827', 'Ow', 14],
  homework: ['#2563eb', 'H', 19], share: ['#0d9488', 'S', 19], pointer: ['#0891b2', 'P', 19],
  follow: ['#0e7490', 'F', 19], locks: ['#b91c1c', 'L', 19], arcade: ['#ea580c', 'A', 19],
  quiz: ['#c026d3', 'Q', 19], posuk: ['#16a34a', 'Po', 14], mishnayos: ['#92400e', 'M', 19],
  davening: ['#ca8a04', 'D', 19], chazara: ['#0284c7', 'Ch', 14], shorashim: ['#4d7c0f', 'Sh', 14],
  rashi: ['#7c3aed', 'R', 19], gematria: ['#be185d', 'G', 19], yiddish: ['#0f766e', 'Y', 19],
  halacha: ['#64748b', 'Ha', 14], rewards: ['#d97706', '★', 19], checklist: ['#15803d', '✓', 19],
  names: ['#9333ea', 'N', 19], timer: ['#0369a1', 'W', 19], chavrusa: ['#b45309', 'Cv', 14],
  dashboard: ['#1d4ed8', 'Db', 14], gallery: ['#db2777', 'W', 19], nigri: ['#7e22ce', 'Ni', 14],
  sefer: ['#854d0e', 'Sf', 14], kriah: ['#0f766e', 'K', 19], report: ['#334155', 'Sr', 14],
  wordbank: ['#a21caf', 'Wb', 14], log: ['#6b7280', 'Cl', 14], lab: ['#6d28d9', 'Hr', 14],
  misc: ['#6b7280', '≡', 19], missing: ['#6b7280', '?', 19],
};

const T = ':t'; // suffix on an icon key = teacher variant (small dark "T" badge in the corner)
// file: [page name, icon key]   (a null icon key keeps the SOLS favicon)
const PAGES = {
  'index.html': ['Home', null],
  'auth-hosting/index.html': ['Sign In', null],
  'teacher-home.html': ['Teacher Home', 'teacher'],
  'teacher-preview-tool.html': ['Tool Preview', 'teacher' + T],
  'teacher-student-split.html': ['Split View', 'teacher'],
  'admin.html': ['Admin', 'admin'],
  'owner-admin.html': ['Owner Admin', 'owner'],
  '404.html': ['Not Found', 'missing'],
  'all-pages.html': ['All Pages', 'misc'],
  'assignment-center/index.html': ['Homework', 'homework'],
  'assignment-center/prototype.html': ['Homework Design', 'homework'],
  'assignment-center/student.html': ['My Homework', 'homework'],
  'assignment-center/teacher.html': ['Homework Teacher', 'homework' + T],
  'chavrusa/index.html': ['Chavrusa', 'chavrusa'],
  'chazara/index.html': ['Chazara', 'chazara'],
  'chazara/teacher.html': ['Chazara Teacher', 'chazara' + T],
  'chossid-lamdan.html': ['Weekly Marks', 'nigri'],
  'class-dashboard/index.html': ['Class Dashboard', 'dashboard'],
  'class-gallery/index.html': ['Class Wall', 'gallery'],
  'class-pointer-prototype/classroom.html': ['Pointer Classroom', 'pointer'],
  'class-pointer-prototype/dashboard.html': ['Class Pointer', 'pointer' + T],
  'class-pointer-prototype/index.html': ['Pointer Home', 'pointer'],
  'class-pointer-prototype/my-files.html': ['My Files', 'pointer'],
  'class-pointer-prototype/student-share-window.html': ['Screen Share', 'share'],
  'class-pointer-prototype/student-view.html': ['Presentation', 'pointer'],
  'follow-teacher/teacher.html': ['Follow Teacher', 'follow' + T],
  'comment-log/b3-comment-log.html': ['Comment Log', 'log'],
  'daily-checklist/index.html': ['Checklist', 'checklist'],
  'daily-checklist/teacher.html': ['Checklist Teacher', 'checklist' + T],
  'davening_student_app_et/index.html': ['Davening ET', 'davening'],
  'davening_student_app_wt/index.html': ['Davening WT', 'davening'],
  'game-show/player.html': ['Game Show', 'quiz'],
  'game-show/teacher.html': ['Game Show Teacher', 'quiz' + T],
  'gematria/index.html': ['Gematria', 'gematria'],
  'gematria/teacher.html': ['Gematria Teacher', 'gematria' + T],
  'halacha/index.html': ['Halacha', 'halacha'],
  'halacha/teacher.html': ['Halacha Teacher', 'halacha' + T],
  'hebrew-reading-validation/index.html': ['Reading Lab', 'lab'],
  'kriah-assessment/index.html': ['Kriah', 'kriah'],
  'mishnayos/student.html': ['Mishnayos', 'mishnayos'],
  'mishnayos/teacher.html': ['Mishnayos Teacher', 'mishnayos' + T],
  'multiplayer/game.html': ['Arcade Game', 'arcade'],
  'multiplayer/index.html': ['Arcade', 'arcade'],
  'name-picker/index.html': ['Name Picker', 'names'],
  'rashi-letters/student.html': ['Rashi', 'rashi'],
  'rashi-letters/teacher.html': ['Rashi Teacher', 'rashi' + T],
  'record-mishnayos/progress.html': ['Mishnayos Progress', 'mishnayos'],
  'record-mishnayos/student.html': ['Mishnayos', 'mishnayos'],
  'record-mishnayos/teacher.html': ['Mishnayos Teacher', 'mishnayos' + T],
  'record_pesukim/progress.html': ['Posuk Progress', 'posuk'],
  'record_pesukim/student.html': ['Posuk', 'posuk'],
  'record_pesukim/teacher.html': ['Posuk Teacher', 'posuk' + T],
  'scripts/sols-auth-test/index.html': ['Auth Test', 'misc'],
  'sefer-hamitzvos/index.html': ['Sefer HaMitzvos', 'sefer'],
  'shorashim/index.html': ['Shorashim', 'shorashim'],
  'shorashim/teacher.html': ['Shorashim Teacher', 'shorashim' + T],
  'shorashim/backup-before-review-categories-20260906-001156/index.html': ['Shorashim Backup', 'shorashim'],
  'student-report/index.html': ['Student Report', 'report'],
  'student-rewards/index.html': ['Rewards', 'rewards'],
  'student-rewards/student.html': ['Rewards', 'rewards'],
  'student-rewards/teacher.html': ['Rewards Teacher', 'rewards' + T],
  'sync-to-nigri/chossid-lamdan.html': ['Weekly Marks', 'nigri'],
  'sync-to-nigri/classtime.html': ['Classtime Sync', 'nigri'],
  'sync-to-nigri/index.html': ['Nigri Sync', 'nigri'],
  'sync-to-nigri/my-login.html': ['Nigri Login', 'nigri'],
  'sync-to-nigri/school-marks.html': ['School Marks', 'nigri'],
  'weekly-quiz/B3SchoolMarksBridge.html': ['School Marks', 'quiz' + T],
  'weekly-quiz/chossid-lamdan.html': ['Weekly Marks', 'quiz' + T],
  'weekly-quiz/index.html': ['Weekly Quiz', 'quiz'],
  'weekly-quiz/practice.html': ['Practice Quiz', 'quiz'],
  'weekly-quiz/teacher.html': ['Quiz Teacher', 'quiz' + T],
  'word-bank/index.html': ['Word Bank', 'wordbank'],
  'word-bank/teacher.html': ['Word Bank Teacher', 'wordbank' + T],
  'work-timer/index.html': ['Work Timer', 'timer'],
  'work_timer_v4/index.html': ['Work Timer', 'timer'],
  'yiddish/index-library.html': ['Yiddish', 'yiddish'],
  'yiddish/index.html': ['Yiddish', 'yiddish'],
  'yiddish/story.html': ['Yiddish Story', 'yiddish'],
  'yiddish/story2/index.html': ['Yiddish Story 2', 'yiddish'],
  'yiddish/sync.html': ['Story Timing', 'yiddish'],
  'yiddish/teacher.html': ['Yiddish Teacher', 'yiddish' + T],
};

function svgFor(key) {
  const teacher = key.endsWith(T);
  const base = teacher ? key.slice(0, -T.length) : key;
  const [bg, glyph, size] = ICONS[base];
  const y = teacher ? 19 : 22;
  const x = teacher ? 14 : 16;
  const badge = teacher
    ? '<circle cx="24" cy="24" r="7.5" fill="#111827" stroke="#fff" stroke-width="1.5"/>' +
      '<text x="24" y="27.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" fill="#fff">T</text>'
    : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    `<rect width="32" height="32" rx="7" fill="${bg}"/>` +
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="700" fill="#fff">${glyph}</text>` +
    badge + '</svg>\n';
}
const iconFile = (key) => key.replace(':t', '-teacher') + '.svg';

const outDir = path.join(root, 'assets', 'favicons');
fs.mkdirSync(outDir, { recursive: true });
const used = new Set(Object.values(PAGES).map((p) => p[1]).filter(Boolean));
used.add('quiz');
for (const key of used) fs.writeFileSync(path.join(outDir, iconFile(key)), svgFor(key));

const rows = [];
for (const [file, [name, key]] of Object.entries(PAGES)) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, 'utf8');
  const title = `${name} · ${SITE}`;
  const before = html;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  if (key) {
    html = html.replace(/[ \t]*<link\s+rel="(?:shortcut )?icon"[^>]*>[ \t]*\r?\n?/gi, '');
    html = html.replace(/(<\/title>)/i, `$1\n<link rel="icon" type="image/svg+xml" href="/assets/favicons/${iconFile(key)}">`);
  }
  if (html === before) console.warn('unchanged:', file);
  fs.writeFileSync(full, html);
  rows.push(`| \`${file}\` | ${title} | ${key ? '`' + iconFile(key) + '`' : 'main SOLS icon'} |`);
}
fs.writeFileSync(path.join(__dirname, 'page-identity-table.md'),
  '| Page | Title | Icon |\n|---|---|---|\n' + rows.join('\n') + '\n');
console.log(`Updated ${rows.length} pages, ${used.size} icons.`);
