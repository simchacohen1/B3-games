'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OWNER_EMAIL = 'owner@funtorahtools-staging.test';
const PRODUCTION_OWNER_EMAIL = 'simcha5770@gmail.com';

function prepareRules(sourcePath, outputPath) {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  if (!source.rules || source.rules['.read'] !== false || source.rules['.write'] !== false) {
    throw new Error('Refusing to prepare staging rules without a deny-by-default root.');
  }
  const serialized = JSON.stringify(source.rules).replaceAll(PRODUCTION_OWNER_EMAIL, OWNER_EMAIL);
  if (serialized.includes(PRODUCTION_OWNER_EMAIL) || /b3-games|simcha5770@gmail\.com/i.test(serialized)) {
    throw new Error('Refusing to prepare staging rules containing production project or owner identifiers.');
  }
  const rules = JSON.parse(serialized);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ rules }, null, 2) + '\n', 'utf8');
  return rules;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const output = process.argv[2] || path.join(__dirname, 'database.rules.json');
  prepareRules(path.join(root, 'firebase-rules.hardened.json'), output);
  console.log('Prepared staging Realtime Database rules with public access denied.');
}

module.exports = { OWNER_EMAIL, prepareRules };
