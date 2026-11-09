'use strict';
// Staging-only deployment of Chazara AI Practice (#688).
// Deploy ONLY with: firebase deploy --config firebase.chazara-ai-staging.json --project fun-torah-tools-staging
// The chazara-ai/ folder and the two auth helpers are copies made by
// scripts/sync-chazara-ai-staging.cjs (a test checks they match the production source).
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { createHandler } = require('./chazara-ai/http.cjs');
const { decodeWithFfmpeg, googleRecognizer, claudeJudge } = require('./chazara-ai/providers.cjs');
const { makeJudge } = require('./chazara-ai/pipeline.cjs');

const PROJECT = 'fun-torah-tools-staging';
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
// Refuse to load against production, even with production credentials.
if (project && project !== PROJECT) throw new Error('chazara-ai-staging may only run in ' + PROJECT);

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
if (!admin.apps.length) admin.initializeApp();

const allowedOrigin = origin => origin === 'https://' + PROJECT + '.web.app' ||
  /^https:\/\/fun-torah-tools-staging--[a-z0-9-]+\.web\.app$/.test(origin || '');

exports.chazaraAiPractice = onRequest({
  region: 'us-central1', secrets: [ANTHROPIC_API_KEY],
  memory: '1GiB', timeoutSeconds: 120, maxInstances: 1, concurrency: 2
}, createHandler({
  admin,
  allowedOrigin,
  getProviders: () => {
    const speech = require('@google-cloud/speech');
    const Anthropic = require('@anthropic-ai/sdk');
    return {
      decode: decodeWithFfmpeg(require('ffmpeg-static')),
      recognize: googleRecognizer(new speech.SpeechClient()),
      judge: makeJudge(claudeJudge(new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })))
    };
  }
}));
