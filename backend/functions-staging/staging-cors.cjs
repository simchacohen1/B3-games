'use strict';

const STAGING_ORIGIN = 'https://fun-torah-tools-staging.web.app';

function corsForProductionOrigins(origins) {
  if (process.env.B3_STAGING_DEPLOYMENT === 'true') return [STAGING_ORIGIN, /^https:\/\/fun-torah-tools-staging--[a-z0-9-]+\.web\.app$/];
  return origins.slice();
}

module.exports = { STAGING_ORIGIN, corsForProductionOrigins };
