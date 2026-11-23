'use strict';
// The live site is sols.tools: the same pages as this repository, rebranded by
// sols-site/build.mjs when the copy is published. To check that a merged change
// reached the live site, run that same build on a throwaway copy of the files and
// compare against what the live site serves. Line endings are normalised so a
// Windows checkout compares the same as CI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const sha = text => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

function expectedLiveFiles(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sols-expected-'));
  try {
    const needed = new Set(['index.html', 'firebase-config.js', 'CNAME', ...files]);
    for (const file of needed) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
    execFileSync(process.execPath, [path.join(__dirname, '..', 'sols-site', 'build.mjs'), dir], { stdio: 'pipe' });
    const out = new Map();
    for (const file of files) out.set(file, fs.readFileSync(path.join(dir, file), 'utf8'));
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// What a tab title becomes on sols.tools (same rule as solsTitle() in sols-site/build.mjs):
// "SOLS Tools | Shluchim Online School" for the home page, "<page name> | SOLS Tools" elsewhere.
function solsTitle(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/^SOLS Tools\b/i.test(text) || /\|\s*SOLS Tools$/i.test(text)) return text;
  const rest = text.replace(/Fun Torah Tools/gi, ' ').replace(/Shluchim Online School/gi, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s|—–•:-]+|[\s|—–•:-]+$/g, '');
  const page = rest.replace(/\s*·\s*SOLS$/i, '').trim();
  return !page || page === 'Home' ? 'SOLS Tools | Shluchim Online School' : page + ' | SOLS Tools';
}

module.exports = { expectedLiveFiles, sha, solsTitle };
