#!/usr/bin/env node
/*
 * Turns a checkout of B3-games into the sols.tools copy, in place.
 *
 *   node sols-site/build.mjs <folder holding the B3-games checkout>
 *
 * What it changes in that folder (and nothing else):
 *   - CNAME becomes sols.tools
 *   - .github is removed, so no workflow, monitor or deploy job runs in the copy
 *   - sols-brand.js and sols-favicon.svg are added at the top level
 *   - every .html page gets one <script src="/sols-brand.js"> tag in <head>,
 *     and "Fun Torah Tools" inside its <title> becomes "Shluchim Online School"
 *
 * It never talks to Firebase and never edits the folder it was started from
 * unless that is the folder you pass in.
 */
import { readdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'sols.tools';
const NAME = 'Shluchim Online School';
const TAG = '<script src="/sols-brand.js"></script>';
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

export function brandHtml(html) {
  let out = html.replace(/<title\b([^>]*)>([\s\S]*?)<\/title>/i, (all, attrs, text) =>
    '<title' + attrs + '>' + text.replace(/Fun Torah Tools/g, NAME) + '</title>');
  if (out.includes('/sols-brand.js')) return out;
  // Some pages leave out <head> (browsers allow that), so fall back to <html>
  // and then <!doctype>. A file with none of these is a fragment, not a page.
  const anchor = out.match(/<head\b[^>]*>/i) || out.match(/<html\b[^>]*>/i) || out.match(/<!doctype\b[^>]*>/i);
  if (!anchor) return null;
  const at = anchor.index + anchor[0].length;
  return out.slice(0, at) + '\n' + TAG + out.slice(at);
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

rmSync(join(target, '.github'), { recursive: true, force: true });
writeFileSync(join(target, 'CNAME'), HOST + '\n');
copyFileSync(join(here, 'brand.js'), join(target, 'sols-brand.js'));
copyFileSync(join(here, 'favicon.svg'), join(target, 'sols-favicon.svg'));

let branded = 0;
const noHead = [];
for (const file of htmlFiles(target)) {
  const before = readFileSync(file, 'utf8');
  const after = brandHtml(before);
  if (after === null) { noHead.push(file); continue; }
  if (after !== before) { writeFileSync(file, after); branded += 1; }
}

const home = readFileSync(join(target, 'index.html'), 'utf8');
if (!home.includes(TAG) || readFileSync(join(target, 'CNAME'), 'utf8').trim() !== HOST) {
  console.error('Build check failed: the home page or CNAME was not updated.');
  process.exit(1);
}
console.log('sols.tools build ready: ' + branded + ' pages branded, ' + noHead.length + ' files that are not full pages left as they were.');
for (const file of noHead) console.log('  not a full page: ' + file);
