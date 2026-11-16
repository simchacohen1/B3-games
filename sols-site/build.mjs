#!/usr/bin/env node
/*
 * Turns a checkout of B3-games into the sols.tools copy, in place.
 *
 *   node sols-site/build.mjs <folder holding the B3-games checkout>
 *
 * What it changes in that folder (and nothing else):
 *   - CNAME becomes sols.tools
 *   - .github is removed, so no workflow, monitor or deploy job runs in the copy
 *   - sols-brand.js (sols-site/pointer-only.js followed by sols-site/brand.js) and
 *     the school emblem icons (sols-site/icons) are added at the
 *     top level; favicon.ico, apple-touch-icon.png, favicon-*.png and
 *     android-chrome-*.png are replaced by the emblem
 *   - every .html page gets the emblem icons and og:/twitter: share tags written
 *     into its <head> (link-preview crawlers do not run scripts), plus one
 *     <script src="/sols-brand.js"> tag; "Fun Torah Tools" inside its <title>
 *     becomes "Shluchim Online School"
 *   - sols-share-image.png (1200x630) is the link-preview picture
 *
 * It never talks to Firebase and never edits the folder it was started from
 * unless that is the folder you pass in.
 */
import { readdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import authDomain from './auth-domain.cjs';

const HOST = 'sols.tools';
const NAME = 'Shluchim Online School';
const TAG = '<script src="/sols-brand.js"></script>';
const DESCRIPTION = 'Learning games and practice tools';
const SHARE_IMAGE = 'https://' + HOST + '/sols-share-image.png';
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
if (!target || !existsSync(target) || !statSync(target).isDirectory()) {
  console.error('Usage: node sols-site/build.mjs <folder>');
  process.exit(2);
}
if (!existsSync(join(target, 'firebase-config.js')) || !existsSync(join(target, 'index.html'))) {
  console.error('Refusing to run: ' + target + ' does not look like a B3-games checkout.');
  process.exit(2);
}

const PREFIX = 'SOLS Tools';

// Tab and share title. Students also use the real school site, so every sols.tools
// tab starts with "SOLS Tools": "SOLS Tools | Shluchim Online School" on the home
// page and "SOLS Tools | <page name>" on inner pages. sols-site/brand.js applies
// the same rule to titles that a page sets while it runs.
export function solsTitle(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/^SOLS Tools\b/i.test(text)) return text;
  const rest = text
    .replace(/Fun Torah Tools/gi, ' ')
    .replace(/Shluchim Online School/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|—–•:-]+|[\s|—–•:-]+$/g, '');
  return PREFIX + ' | ' + (rest || NAME);
}

const esc = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = text => String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// Link-preview crawlers (WhatsApp, iMessage, Facebook, Slack) read the raw HTML and
// do not run scripts, so the icons and share tags are written into the page itself
// instead of being added later by sols-brand.js.
function headBlock(title, description, urlPath) {
  const page = 'https://' + HOST + urlPath;
  return [
    TAG,
    '<link rel="icon" type="image/png" sizes="32x32" href="/sols-favicon-32x32.png" data-sols="1">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/sols-favicon-16x16.png" data-sols="1">',
    '<link rel="apple-touch-icon" href="/sols-apple-touch-icon.png" data-sols="1">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="' + PREFIX + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(description) + '">',
    '<meta property="og:url" content="' + esc(page) + '">',
    '<meta property="og:image" content="' + SHARE_IMAGE + '">',
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="' + NAME + ' emblem">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + esc(title) + '">',
    '<meta name="twitter:description" content="' + esc(description) + '">',
    '<meta name="twitter:image" content="' + SHARE_IMAGE + '">',
    '<meta name="twitter:image:alt" content="' + NAME + ' emblem">',
    '<link rel="image_src" href="' + SHARE_IMAGE + '">'
  ].join('\n');
}

const findAnchor = text => text.match(/<head\b[^>]*>/i) || text.match(/<html\b[^>]*>/i) || text.match(/<!doctype\b[^>]*>/i);

export function brandHtml(html, urlPath = '/') {
  let out = html.replace(/<title\b([^>]*)>([\s\S]*?)<\/title>/i, (all, attrs, text) =>
    '<title' + attrs + '>' + esc(solsTitle(unesc(text))) + '</title>');
  if (out.includes('/sols-brand.js')) return out;
  // Some pages leave out <head> (browsers allow that), so fall back to <html>
  // and then <!doctype>. A file with none of these is a fragment, not a page.
  if (!findAnchor(out)) return null;
  const titleMatch = out.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? unesc(titleMatch[1]).replace(/\s+/g, ' ').trim() : solsTitle('');
  const descTag = out.match(/<meta\b[^>]*\bname=["']description["'][^>]*>/i);
  const descContent = descTag ? descTag[0].match(/\bcontent=["']([^"']*)["']/i) : null;
  const description = descContent ? unesc(descContent[1]).replace(/Fun Torah Tools/g, NAME) : DESCRIPTION;
  if (descTag) out = out.replace(descTag[0], descTag[0].replace(/Fun Torah Tools/g, NAME));
  // Drop the Fun Torah Tools icons and any share tags the page already has.
  out = out
    .replace(/<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*\brel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*\brel=["']image_src["'][^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*\b(?:property|name)=["'](?:og|twitter):[^"']*["'][^>]*>\s*/gi, '');
  const anchor = findAnchor(out);
  const at = anchor.index + anchor[0].length;
  return out.slice(0, at) + '\n' + headBlock(title, description, urlPath) + '\n' + out.slice(at);
}

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* htmlFiles(join(dir, entry.name));
    } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

// Production SOLS cutover; auth-domain.json also provides the legacy-domain rollback.
const authSettings = JSON.parse(readFileSync(join(here, 'auth-domain.json'), 'utf8'));
authDomain.applyAuthDomain(target, authSettings);

rmSync(join(target, '.github'), { recursive: true, force: true });
writeFileSync(join(target, 'CNAME'), HOST + '\n');
// One script for every page: first the rule that sols.tools shows only Class Pointer to teachers and students
// (it may send the visitor to the home page before anything else runs), then the school's name and icons.
writeFileSync(join(target, 'sols-brand.js'), readFileSync(join(here, 'pointer-only.js'), 'utf8') + '\n' + readFileSync(join(here, 'brand.js'), 'utf8'));
for (const name of ['sols-favicon-16x16.png', 'sols-favicon-32x32.png', 'sols-apple-touch-icon.png', 'sols-icon-192.png', 'sols-icon-512.png', 'sols-share-image.png']) {
  copyFileSync(join(here, 'icons', name), join(target, name));
}
// Crawlers and browsers also ask for the standard file names on their own.
for (const [from, to] of [
  ['sols-favicon-16x16.png', 'favicon-16x16.png'],
  ['sols-favicon-32x32.png', 'favicon-32x32.png'],
  ['sols-apple-touch-icon.png', 'apple-touch-icon.png'],
  ['sols-icon-192.png', 'android-chrome-192x192.png'],
  ['sols-icon-512.png', 'android-chrome-512x512.png'],
  ['sols-favicon.ico', 'favicon.ico']
]) {
  copyFileSync(join(here, 'icons', from), join(target, to));
}

let branded = 0;
const noHead = [];
for (const file of htmlFiles(target)) {
  const before = readFileSync(file, 'utf8');
  const urlPath = '/' + relative(target, file).split(sep).join('/');
  const after = brandHtml(before, urlPath.replace(/\/index\.html$/, '/'));
  if (after === null) { noHead.push(file); continue; }
  if (after !== before) { writeFileSync(file, after); branded += 1; }
}

const home = readFileSync(join(target, 'index.html'), 'utf8');
if (!home.includes(TAG) || !home.includes('og:image" content="' + SHARE_IMAGE) ||
    readFileSync(join(target, 'CNAME'), 'utf8').trim() !== HOST) {
  console.error('Build check failed: the home page or CNAME was not updated.');
  process.exit(1);
}
console.log('sols.tools build ready: ' + branded + ' pages branded, ' + noHead.length + ' files that are not full pages left as they were.');
for (const file of noHead) console.log('  not a full page: ' + file);
