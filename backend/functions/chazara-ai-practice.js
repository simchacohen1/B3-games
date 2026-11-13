'use strict';
// Chazara AI Practice endpoint (production project). Not deployed until the owner approves.
// The service is OFF until the owner sets b3Private/chazaraAiPractice/config/enabled = true.
// Speech is transcribed by OpenAI gpt-4o-mini-transcribe (secret OPENAI_API_KEY).
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { ALLOWED_ORIGINS } = require('./paid-api');
const { createHandler } = require('./chazara-ai/http.cjs');
const { openaiTranscriber } = require('./chazara-ai/providers.cjs');

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
if (!admin.apps.length) admin.initializeApp();

const handler = createHandler({
  admin,
  allowedOrigin: origin => ALLOWED_ORIGINS.includes(origin),
  getProviders: () => ({ transcribe: openaiTranscriber({ apiKey: () => OPENAI_API_KEY.value() }) })
});

// Light work (the transcription runs at OpenAI): small, short-lived instances.
exports.chazaraAiPractice = onRequest({
  region: 'us-central1', secrets: [OPENAI_API_KEY], memory: '256MiB', timeoutSeconds: 60, maxInstances: 3, concurrency: 20
}, handler);
