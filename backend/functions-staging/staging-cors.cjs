'use strict';

const STAGING_ORIGIN = 'https://fun-torah-tools-staging.web.app';
// Preview channels of the staging site only, e.g. https://fun-torah-tools-staging--pr-543-multiplayer-abc123.web.app
const STAGING_PREVIEW_ORIGIN = /^https:\/\/fun-torah-tools-staging--[a-z0-9-]+\.web\.app$/;

function corsForProductionOrigins(origins) {
  if (process.env.B3_STAGING_DEPLOYMENT === 'true') return [STAGING_ORIGIN, STAGING_PREVIEW_ORIGIN];
  return origins.slice();
}

module.exports = { STAGING_ORIGIN, STAGING_PREVIEW_ORIGIN, corsForProductionOrigins };
