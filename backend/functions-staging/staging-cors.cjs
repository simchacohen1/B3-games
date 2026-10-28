'use strict';

const STAGING_ORIGIN = 'https://fun-torah-tools-staging.web.app';

function corsForProductionOrigins(origins) {
  if (process.env.B3_STAGING_DEPLOYMENT === 'true') return [STAGING_ORIGIN];
  return origins.slice();
}

module.exports = { STAGING_ORIGIN, corsForProductionOrigins };
