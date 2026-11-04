'use strict';

// ONE rule for which websites may call staging functions: the main staging site
// and every Firebase Hosting preview link of the staging project
// (fun-torah-tools-staging--<channel>-<id>.web.app). Nothing else.
// Every staging deploy source keeps an identical copy of this file:
//   backend/functions-staging/, backend/functions/, backend/functions/homework-staging/
const STAGING_ORIGIN = 'https://fun-torah-tools-staging.web.app';
const STAGING_PREVIEW_ORIGIN = /^https:\/\/fun-torah-tools-staging--[a-z0-9-]+\.web\.app$/;

function isStagingProject() {
  return process.env.B3_STAGING_DEPLOYMENT === 'true' ||
    process.env.GCLOUD_PROJECT === 'fun-torah-tools-staging';
}

function stagingOrigins() {
  return [STAGING_ORIGIN, STAGING_PREVIEW_ORIGIN];
}

// In the staging project: the staging list. Anywhere else (live): the given list, unchanged.
function corsForProductionOrigins(origins) {
  return isStagingProject() ? stagingOrigins() : origins.slice();
}

module.exports = { STAGING_ORIGIN, STAGING_PREVIEW_ORIGIN, stagingOrigins, corsForProductionOrigins };
