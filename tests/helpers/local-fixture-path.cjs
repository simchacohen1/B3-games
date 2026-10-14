'use strict';
const path = require('node:path');

// Use the platform's path rules, including Windows separators and drive roots.
function resolveFixtureFile(root, file, paths = path) {
  const resolved = paths.resolve(root, file);
  const relative = paths.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + paths.sep) || paths.isAbsolute(relative)) return null;
  return resolved;
}

module.exports = { resolveFixtureFile };
