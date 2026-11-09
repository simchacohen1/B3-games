'use strict';
/**
 * Fictional fixtures for Chazara AI Practice tests.
 * Fake providers stand in for ffmpeg and the local Whisper model so the
 * DECISION LOGIC can be tested. They prove nothing about real recognition
 * accuracy — see scripts/chazara-ai-audio-eval.cjs for real-audio validation.
 */

const PESUKIM = {
  '18_1': {
    hebrew: 'וַיֵּרָא אֵלָיו ה׳ בְּאֵלֹנֵי מַמְרֵא וְהוּא יֹשֵׁב פֶּתַח הָאֹהֶל כְּחֹם הַיּוֹם'
  },
  '18_2': {
    hebrew: 'וַיִּשָּׂא עֵינָיו וַיַּרְא וְהִנֵּה שְׁלֹשָׁה אֲנָשִׁים נִצָּבִים עָלָיו וַיַּרְא וַיָּרָץ לִקְרָאתָם מִפֶּתַח הָאֹהֶל וַיִּשְׁתַּחוּ אָרְצָה'
  },
  '18_3': {
    hebrew: 'וַיֹּאמַר אֲדֹנָי אִם נָא מָצָאתִי חֵן בְּעֵינֶיךָ אַל נָא תַעֲבֹר מֵעַל עַבְדֶּךָ'
  }
};

// What a Hebrew recognizer might output (modern spelling, no nekudos).
const HEARD = {
  '18_1': 'וירא אליו השם באלוני ממרא והוא יושב פתח האוהל כחום היום',
  '18_1_minor': 'ויירו אליו אדושם באלוני ממרא והו יושב פסח האוהל כחום היום',
  '18_1_major': 'וירא אליו השם בלוני אמר יושב',
  '18_2': 'וישא עיניו וירא והנה שלושה אנשים ניצבים עליו וירא וירץ לקראתם מפתח האוהל וישתחו ארצה',
  '18_3': 'ויאמר אדוני אם נא מצאתי חן בעיניך אל נא תעבור מעל עבדך'
};

// Builds one fake recorded segment. The buffer carries the scenario so the fake
// decoder/recognizer can produce the matching signal and transcripts.
function segment(spec) { return Buffer.from(JSON.stringify(spec)); }

function synth(kind, seconds = 12, sampleRate = 16000) {
  const n = Math.round(seconds * sampleRate), pcm = new Int16Array(n);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = rnd() * 0.002; // quiet room
    if (kind === 'speech' || (kind === 'short' && t < 0.8)) {
      // syllable-like bursts: ~4 per second, with pauses between words
      const syll = Math.max(0, Math.sin(Math.PI * 4 * t)) ** 2;
      const word = (Math.floor(t * 1.5) % 4 === 3) ? 0.05 : 1;
      v += syll * word * (0.25 * Math.sin(2 * Math.PI * 180 * t) + 0.08 * rnd());
    } else if (kind === 'noise') {
      v = rnd() * 0.3 + 0.05 * Math.sin(2 * Math.PI * 140 * t) * Math.max(0, Math.sin(Math.PI * 4 * t));
    } else if (kind === 'silence') {
      v = rnd() * 0.0008;
    }
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return pcm;
}

function fakeProviders({ recognizeFails = false } = {}) {
  const calls = { decode: 0, recognize: 0, languages: [] };
  const specs = new WeakMap();
  return {
    calls,
    decode: async buf => {
      calls.decode++;
      const spec = JSON.parse(buf.toString());
      if (spec.corrupt) throw Object.assign(new Error('bad audio'), { code: 'decode_failed' });
      const pcm = synth(spec.signal || 'speech', spec.seconds || 12);
      specs.set(pcm, spec);
      return pcm;
    },
    // Stands in for the local Whisper pass: returns what the scenario says was heard.
    recognize: async ({ pcm, language }) => {
      calls.recognize++;
      calls.languages.push(language);
      if (recognizeFails) throw Object.assign(new Error('model failed to load'), { code: 'ENOMEM' });
      const spec = specs.get(pcm) || {};
      return { transcript: spec.heard || '' };
    }
  };
}

function memoryStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  const touched = [];
  const parts = p => p.split('/').filter(Boolean);
  const get = p => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const set = (p, v) => {
    const ks = parts(p); let o = data;
    for (const k of ks.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {});
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  return {
    data, touched,
    async get(p) { touched.push(['get', p]); const v = get(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
    async set(p, v) { touched.push(['set', p]); set(p, v); },
    async update(changes) { for (const [p, v] of Object.entries(changes)) { touched.push(['set', p]); set(p, v); } },
    async tx(p, fn) {
      touched.push(['tx', p]);
      const cur = get(p);
      const next = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur)));
      if (next === undefined) return { committed: false, value: cur };
      set(p, next);
      return { committed: true, value: next };
    }
  };
}

const TEACHER = { uid: 'teacherA', email: 'teacher.a@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const OTHER_TEACHER = { uid: 'teacherB', email: 'teacher.b@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } };

function baseData() {
  return {
    b3Games: {
      students: {
        stu_a: { profile: { name: 'Fictional Student A', active: true, classId: 'class_one' } },
        stu_b: { profile: { name: 'Fictional Student B', active: true, classId: 'class_one' } },
        stu_c: { profile: { name: 'Fictional Student C', active: true, classId: 'class_two' } }
      },
      workspaces: { 'b3-2026': {
        teachers: { teacherA: { active: true, classIds: { class_one: true } }, teacherB: { active: true, classIds: { class_two: true } } },
        classes: {
          class_one: { active: true, name: 'Class One', toolGrants: { chazara: true }, members: { stu_a: { active: true }, stu_b: { active: true } } },
          class_two: { active: true, name: 'Class Two', toolGrants: { chazara: true }, members: { stu_c: { active: true } } }
        }
      } }
    },
    b3Private: { chazaraAiPractice: { config: { enabled: true } } }
  };
}

function aiAssignment(keys = ['18_1'], mode = 'ai') {
  const pesukim = {};
  for (const k of keys) { const [perek, posuk] = k.split('_').map(Number); pesukim[k] = { perek, posuk, ...PESUKIM[k] }; }
  const nums = keys.map(k => Number(k.split('_')[1]));
  return { title: 'Fictional practice', mode, sefer: 'Bereishis', perek: 18, from: Math.min(...nums), to: Math.max(...nums), pesukim };
}

module.exports = { PESUKIM, HEARD, segment, synth, fakeProviders, memoryStore, TEACHER, OTHER_TEACHER, baseData, aiAssignment };
