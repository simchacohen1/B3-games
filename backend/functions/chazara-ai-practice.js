'use strict';
// Chazara AI Practice endpoint (production project). Not deployed until the owner approves.
// The service is OFF until the owner sets b3Private/chazaraAiPractice/config/enabled = true.
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { ALLOWED_ORIGINS } = require('./paid-api');
const { createHandler } = require('./chazara-ai/http.cjs');
const { decodeWithFfmpeg, googleRecognizer, claudeJudge } = require('./chazara-ai/providers.cjs');
const { makeJudge } = require('./chazara-ai/pipeline.cjs');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
if (!admin.apps.length) admin.initializeApp();

const handler = createHandler({
  admin,
  allowedOrigin: origin => ALLOWED_ORIGINS.includes(origin),
  getProviders: () => {
    // Built on first request so deploy-time analysis never constructs paid clients.
    const speech = require('@google-cloud/speech');
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    return {
      decode: decodeWithFfmpeg(require('ffmpeg-static')),
      recognize: googleRecognizer(new speech.SpeechClient()),
      judge: makeJudge(claudeJudge(client))
    };
  }
});

exports.chazaraAiPractice = onRequest({
  region: 'us-central1', secrets: [ANTHROPIC_API_KEY],
  memory: '1GiB', timeoutSeconds: 120, maxInstances: 3, concurrency: 4
}, handler);
