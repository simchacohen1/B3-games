'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { configFromEnvironment, renderConfigScript } = require('./generate-config.cjs');

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.txt']);
const FORBIDDEN = [
  'b3-games.firebaseapp.com',
  'b3-games.firebasestorage.app',
  'b3-games-default-rtdb.firebaseio.com',
  'us-central1-b3-games.cloudfunctions.net',
  'posuk-scorer.onrender.com',
  'nigrisync.onrender.com'
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
  const scorerOrigin = requiredStagingUrl(env.B3_STAGING_POSUK_SCORER_URL, 'B3_STAGING_POSUK_SCORER_URL', 'posuk-scorer.onrender.com');
  const syncOrigin = requiredStagingUrl(env.B3_STAGING_SYNC_URL, 'B3_STAGING_SYNC_URL', 'nigrisync.onrender.com');
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
    if (/\.html$/i.test(file)) {
      const relative = path.relative(root, file);
      const depth = path.dirname(relative) === '.' ? 0 : path.dirname(relative).split(path.sep).length;
      const prefix = '../'.repeat(depth) || './';
      const marker = 'data-b3-staging-guard';
      if (!content.includes(marker)) {
        const bootstrap = '<script ' + marker + ' src="' + prefix + 'staging/firebase-config.generated.js"></script>\n' +
          '<script src="' + prefix + 'staging/staging-config.js"></script>\n';
        if (!/<head(?:\s[^>]*)?>/i.test(content)) throw new Error('Cannot inject staging guard into ' + relative + ': <head> not found.');
        content = content.replace(/<head(?:\s[^>]*)?>/i, match => match + '\n' + bootstrap);
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

module.exports = { stageSource, requiredStagingUrl, listFiles };
