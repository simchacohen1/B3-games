'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { configFromEnvironment, renderConfigScript } = require('./generate-config.cjs');

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.txt', '.svg', '.xml', '.webmanifest', '.map', '.yaml', '.yml']);
const FORBIDDEN = [
  'b3-games.firebaseapp.com',
  'simcha5770@gmail.com',
  'b3-games.firebasestorage.app',
  'b3-games-default-rtdb.firebaseio.com',
  'us-central1-b3-games.cloudfunctions.net',
  'posuk-scorer.onrender.com',
  'nigrisync.onrender.com',
  'docs.google.com/spreadsheets/d/',
  'chaim_chaikin', 'mayer_chaim_chaikin', 'yossi_gourarie', 'sholom_huebner',
  'sholom_dovber_huebner', 'moshe_lapine', 'kehos_notik', 'yisroel_oirechman',
  'moshe_raichman', 'moshe_tuvia_raichman', 'avrohom_rosenfeld', 'levi_rozmarin',
  'arik_traxler', 'simcha_cohen', 'ari_greenberg', 'zev_rosenfeld', 'levi_schtroks',
  'yisroel_aryeh_simmonds', 'leibel_vogel', 'leib_wolf'
];
const PRODUCTION_STUDENT_NAMES = [
  'Mayer Chaim Chaikin', 'Chaim Chaikin', 'Yossi Gourarie', 'Sholom DovBer Huebner',
  'Sholom Huebner', 'Moshe Lapine', 'Kehos Notik', 'Yisroel Oirechman',
  'Moshe Tuvia Raichman', 'Moshe Raichman', 'Avrohom Rosenfeld', 'Levi Rozmarin',
  'Arik Traxler', 'Ari Greenberg', 'Zev Rosenfeld', 'Levi Schtroks',
  'Yisroel Aryeh Simmonds', 'Leibel Vogel', 'Yisroel Arye Leib Wolf', 'Rabbi Cohen'
];
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'tests', 'e2e', 'backend', 'docs', 'staging', 'staging-build']);

function requiredStagingUrl(value, name, blockedHost) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new Error('Missing or invalid ' + name + '.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname === blockedHost ||
      !/(staging|stage|test|dev)/i.test(parsed.hostname)) {
    throw new Error(name + ' must be an HTTPS staging/test endpoint, separate from production.');
  }
  return parsed.origin;
}

function optionalStagingUrl(value, name, blockedHost) {
  // These integrations can be unavailable in the no-billing launch slice.
  // Never leave their production origins in a staging package: .invalid is a
  // reserved, non-resolving TLD and keeps unsupported calls inert.
  if (value == null || String(value).trim() === '') return 'https://staging-disabled.invalid';
  return requiredStagingUrl(value, name, blockedHost);
}

function listFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && (EXCLUDED_DIRS.has(entry.name) || /^(preview-|backup-)/i.test(entry.name))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full));
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(full);
  }
  return result;
}

function stageSource(siteRoot, env = process.env) {
  const root = path.resolve(siteRoot);
  const config = configFromEnvironment(env);
  const functionsOrigin = 'https://us-central1-' + config.projectId + '.cloudfunctions.net';
  const stagingOwnerEmail = 'owner@funtorahtools-staging.test';
  const scorerOrigin = optionalStagingUrl(env.B3_STAGING_POSUK_SCORER_URL, 'B3_STAGING_POSUK_SCORER_URL', 'posuk-scorer.onrender.com');
  // The legacy sync protocol requires a browser-embedded shared key, so it
  // stays disabled even when an endpoint is supplied. Move its auth behind a
  // server function before enabling any staging sync service.
  const syncOrigin = 'https://staging-disabled.invalid';
  const configPath = path.join(root, 'firebase-config.js');
  if (!fs.existsSync(configPath)) throw new Error('Staging source is missing root firebase-config.js.');
  const productionConfig = fs.readFileSync(configPath, 'utf8');
  const keyMatch = productionConfig.match(/apiKey\s*:\s*["']([^"']+)["']/);
  if (!keyMatch) throw new Error('Could not identify the existing app Firebase configuration for staging replacement.');
  const productionApiKey = keyMatch[1];

  const replacements = [
    [productionApiKey, config.apiKey],
    ['b3-games.firebaseapp.com', config.authDomain],
    ['b3-games.firebasestorage.app', config.storageBucket],
    ['b3-games-default-rtdb.firebaseio.com', new URL(config.databaseURL).hostname],
    ['us-central1-b3-games.cloudfunctions.net', new URL(functionsOrigin).hostname],
    ['simcha5770@gmail.com', stagingOwnerEmail],
    ['posuk-scorer.onrender.com', new URL(scorerOrigin).hostname],
    ['nigrisync.onrender.com', new URL(syncOrigin).hostname],
    ["projectId: \"b3-games\"", "projectId: \"" + config.projectId + "\""],
    ["projectId: 'b3-games'", "projectId: '" + config.projectId + "'"]
  ];

  const files = listFiles(root);
  for (const file of files) {
    if (path.resolve(file) === configPath) continue;
    let content = fs.readFileSync(file, 'utf8');
    for (const [from, to] of replacements) content = content.split(from).join(to);
    const relative = path.relative(root, file).replace(/\\/g, '/').toLowerCase();
    content = content.replace(/(\bprojectId\s*:\s*)(["'])b3-games\2/gi, '$1"' + config.projectId + '"');
    if (relative === 'sync-to-nigri/school-marks.html' || relative === 'weekly-quiz/b3schoolmarksbridge.html') {
      content = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staging integration disabled</title></head><body><main><h1>Integration disabled in staging</h1><p>Student mark syncing is unavailable in the staging site.</p><a href="../index.html">Return to Fun Torah Tools</a></main></body></html>';
    }
    if (relative === 'weekly-quiz/nigri-sync.js') {
      content = "window.B3_STAGING_DISABLED_INTEGRATIONS = window.B3_STAGING_DISABLED_INTEGRATIONS || [];\n" +
        "window.B3_STAGING_DISABLED_INTEGRATIONS.push('nigri-sync');\n";
    }
    if (relative === 'chossid-lamdan.html') {
      const fictionalRoster = "const DEFAULT_DATA={date:'2026-10-26',classes:[" +
        "{id:'TEST-A-ET',label:'Test Class Alef',students:[['Test Student A1',92,'Fictional staging data'],['Test Student A2',88,'Fictional staging data']]}," +
        "{id:'TEST-B-WT',label:'Test Class Beis',students:[['Test Student B1',95,'Fictional staging data'],['Test Student B2',90,'Fictional staging data']]}]};";
      const rosterPattern = /const DEFAULT_DATA\s*=\s*\{[\s\S]*?\n\};(?=\s*function\s+esc\s*\()/;
      if (!rosterPattern.test(content) && /Chaikin|Gourarie|Huebner|Oirechman|Schtroks/i.test(content)) {
        throw new Error('Cannot safely replace embedded production roster in chossid-lamdan.html.');
      }
      content = content.replace(rosterPattern, fictionalRoster);
    }
    if (relative === 'index.html') {
      const legacyRosterPattern = /const LEGACY_MIGRATION_CLASSES\s*=\s*\{[\s\S]*?\n\s*\};/;
      if (!legacyRosterPattern.test(content)) {
        throw new Error('Cannot safely remove the embedded production student migration roster from index.html.');
      }
      content = content.replace(legacyRosterPattern, 'const LEGACY_MIGRATION_CLASSES={et:new Set(),wt:new Set()};');
      const policyScript = '<script src="backend/functions/student-tool-policy.js" defer></script>';
      if (!content.includes(policyScript)) throw new Error('Cannot find the student tool policy script in index.html.');
      content = content.replace(policyScript, '<script src="backend/functions/student-tool-policy.js"></script>');
    }
    if (relative === 'site-settings.js') {
      const pattern = /const LEGACY_CLASS_MIGRATION\s*=\s*\{[\s\S]*?\n\s*\};/;
      if (!pattern.test(content)) throw new Error('Cannot safely remove the production roster migration from site-settings.js.');
      content = content.replace(pattern, 'const LEGACY_CLASS_MIGRATION={et:[],wt:[]};');
    }
    if (relative === 'class-gallery/index.html') {
      const pattern = /const PRESENCE_STUDENTS\s*=\s*\{[\s\S]*?\n\};/;
      if (!pattern.test(content)) throw new Error('Cannot safely remove the embedded class-gallery student roster.');
      content = content.replace(pattern, 'const PRESENCE_STUDENTS={};');
    }
    if (relative === 'chazara/teacher.html') {
      const pattern = /ET=new Set\(\[[\s\S]*?\]\),WT=new Set\(\[[\s\S]*?\]\);/;
      if (!pattern.test(content)) throw new Error('Cannot safely remove the Chazara teacher legacy rosters.');
      content = content.replace(pattern, 'ET=new Set(),WT=new Set();');
    }
    if (relative === 'weekly-quiz/index.html' || relative === 'weekly-quiz/teacher.html') {
      const pattern = /const CLASS_ROSTERS\s*=\s*\{[\s\S]*?\n\};/;
      if (!pattern.test(content)) throw new Error('Cannot safely replace a Weekly Quiz legacy roster.');
      content = content.replace(pattern,
        "const CLASS_ROSTERS={'TEST-ALEF':{label:'Test Class Alef',students:['test_student_alef']},'TEST-BEIS':{label:'Test Class Beis',students:['test_student_beis']},'CUSTOM-PRINCIPAL':{label:'Principal Test Class',students:['test_student_principal']}};");
      content = content.replace(/'simcha_cohen'/g, "'staging_owner_placeholder'");
      if (relative === 'weekly-quiz/teacher.html') {
        content = content.replace("(new URLSearchParams(location.search).get('class')||'').trim()", "(new URLSearchParams(location.search).get('class')||'TEST-ALEF').trim()");
        content = content.replace("CLASS_SPACE?WQ_CLASS:'et'", "CLASS_SPACE?WQ_CLASS:'TEST-ALEF'");
      }
    }
    if (relative === 'comment-log/b3-comment-log.html') {
      const sheetPattern = /const CSV_URL\s*=\s*["'][^"']*docs\.google\.com\/spreadsheets\/[^"']*["'];/i;
      if (!sheetPattern.test(content) && /docs\.google\.com\/spreadsheets\/d\//i.test(content)) {
        throw new Error('Cannot safely disable the production spreadsheet in comment-log/b3-comment-log.html.');
      }
      content = content.replace(sheetPattern, "const CSV_URL = 'https://staging-disabled.invalid/student-comments.csv';");
    }
    content = content.replace(/(\bSYNC_KEY\s*=\s*)['"][^'"]*['"]/g, '$1""');
    content = content.replace(/(\bADMIN_PASSWORD_HASH\s*=\s*)['"][a-f0-9]{64}['"]/gi, '$1"staging-disabled"');
    for (const name of PRODUCTION_STUDENT_NAMES) content = content.split(name).join('Fictional Staging Student');
    if (/\.html$/i.test(file)) {
      const depth = path.dirname(relative) === '.' ? 0 : path.dirname(relative).split(/[\\/]/).length;
      const prefix = '../'.repeat(depth) || './';
      const marker = 'data-b3-staging-guard';
      if (!content.includes(marker)) {
        const bootstrap = '<script ' + marker + ' src="' + prefix + 'staging/firebase-config.generated.js"></script>\n' +
          '<script src="' + prefix + 'staging/staging-config.js"></script>\n';
        if (/<head(?:\s[^>]*)?>/i.test(content)) {
          content = content.replace(/<head(?:\s[^>]*)?>/i, match => match + '\n' + bootstrap);
        } else if (/<html(?:\s[^>]*)?>/i.test(content)) {
          // Some standalone pages rely on the browser's implied <head>.
          // Inject after <html>, before any scripts, so guard order stays safe.
          content = content.replace(/<html(?:\s[^>]*)?>/i, match => match + '\n' + bootstrap);
        } else {
          throw new Error('Cannot inject staging guard into ' + relative + ': neither <head> nor <html> found.');
        }
      }
    }
    fs.writeFileSync(file, content, 'utf8');
  }

  const stageDir = path.join(root, 'staging');
  fs.mkdirSync(stageDir, { recursive: true });
  fs.writeFileSync(path.join(stageDir, 'firebase-config.generated.js'), renderConfigScript(config), 'utf8');
  fs.writeFileSync(configPath,
    'window.B3_STAGING_FIREBASE_CONFIG = window.B3_STAGING_FIREBASE_CONFIG || null;\n' +
    'if (!window.B3_STAGING_FIREBASE_CONFIG) throw new Error("Staging Firebase configuration is missing.");\n' +
    'window.B3_FIREBASE_CONFIG = window.B3_STAGING_FIREBASE_CONFIG;\n', 'utf8');
  fs.copyFileSync(path.join(__dirname, 'staging-config.js'), path.join(stageDir, 'staging-config.js'));

  const outputFiles = listFiles(root);
  const violations = [];
  for (const file of outputFiles) {
    if (file === path.join(stageDir, 'staging-config.js')) continue;
    const content = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const value of FORBIDDEN) if (content.includes(value)) violations.push(path.relative(root, file) + ' contains a production endpoint/config marker');
    if (/(?:['"`])b3-games(?:['"`])/.test(content)) violations.push(path.relative(root, file) + ' contains a hard-coded production Firebase project ID');
  }
  if (violations.length) throw new Error('Staging source audit failed closed:\n' + [...new Set(violations)].join('\n'));
  return { fileCount: files.length, projectId: config.projectId };
}

if (require.main === module) {
  const root = process.argv[2];
  if (!root) throw new Error('Usage: node staging/prepare-site.cjs <prepared-site-directory>');
  const result = stageSource(root);
  console.log('Prepared ' + result.fileCount + ' files for Firebase project ' + result.projectId + '.');
}

module.exports = { stageSource, requiredStagingUrl, optionalStagingUrl, listFiles };
