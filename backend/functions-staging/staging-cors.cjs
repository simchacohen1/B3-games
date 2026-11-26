'use strict';

const STAGING_ORIGIN = 'https://fun-torah-tools-staging.web.app';
// A session's own Hosting preview channel (fun-torah-tools-staging--<channel>-<hash>.web.app). It is allowed only
// when named in B3_STAGING_PREVIEW_ORIGINS at deploy time, and only if it has exactly this staging-preview shape.
const PREVIEW_ORIGIN = /^https:\/\/fun-torah-tools-staging--[a-z0-9-]+\.web\.app$/;

function previewOrigins() {
  return String(process.env.B3_STAGING_PREVIEW_ORIGINS || '').split(',').map(origin => origin.trim()).filter(origin => PREVIEW_ORIGIN.test(origin));
}

function corsForProductionOrigins(origins) {
  if (process.env.B3_STAGING_DEPLOYMENT === 'true') return [STAGING_ORIGIN, ...previewOrigins()];
  return origins.slice();
}

module.exports = { STAGING_ORIGIN, PREVIEW_ORIGIN, previewOrigins, corsForProductionOrigins };
