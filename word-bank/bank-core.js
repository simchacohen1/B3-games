/* Shared Sefer HaMitzvos + Halacha vocabulary bank. Student data is
   partitioned by workspace, class and student; cloud writes go through the
   authenticated Functions endpoint, never directly to the student tree. */
(function (root) {
  'use strict';
  const KEY = 'ftt-word-bank-v1';
  const API = 'https://us-central1-b3-games.cloudfunctions.net/funTorahVocabularyBank';
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ');
  function context() {
    const studentId = clean(sessionStorage.getItem('b3Games_studentId') || sessionStorage.getItem('posukPractice_studentId'));
    const classId = clean(sessionStorage.getItem('b3Games_studentClass') || new URLSearchParams(location.search).get('class'));
    const workspaceId = clean(sessionStorage.getItem('b3Games_workspaceId')) || 'b3-2026';
    return { studentId, classId, workspaceId };
  }
  function storageKey(ctx = context()) { return KEY + ':' + JSON.stringify([ctx.workspaceId, ctx.classId || 'unknown-class', ctx.studentId || 'guest']); }
  function readLocal(ctx) {
    try { const row = JSON.parse(localStorage.getItem(storageKey(ctx)) || '{"words":{}}'); return row && row.words ? row : { words: {} }; }
    catch (_) { return { words: {} }; }
  }
  function writeLocal(bank, ctx) {
    try { localStorage.setItem(storageKey(ctx), JSON.stringify(bank)); return true; }
    catch (_) { return false; }
  }
  function normalizeWords(words) {
    return (Array.isArray(words) ? words : []).map(word => {
      const hebrew = clean(word.hebrew), id = clean(word.id) || ('word:' + hebrew.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('he'));
      return { id, hebrew, english: clean(word.english), source: word.source === 'halacha' ? 'halacha' : 'sefer-hamitzvos' };
    }).filter(word => word.id && word.hebrew && word.english);
  }
  function mergeBank(target, incoming) {
    for (const [key, remote] of Object.entries(incoming || {})) {
      const id = remote.id || key;
      const local = target.words[id] || {};
      const sources = [...new Set([...(local.sources || [local.source].filter(Boolean)), ...(remote.sources || [remote.source].filter(Boolean))])];
      const lessons = [...(local.lessons || [])];
      for (const lesson of remote.lessons || []) if (!lessons.some(row => row.id === lesson.id && row.source === lesson.source)) lessons.push(lesson);
      const editorChange = remote.editorChange || local.editorChange;
      target.words[id] = { ...remote, ...local, id, sources, source: sources.length > 1 ? 'both' : (sources[0] || remote.source),
        lessons, practiceCount: Math.max(Number(remote.practiceCount || 0), Number(local.practiceCount || 0)),
        correctCount: Math.max(Number(remote.correctCount || 0), Number(local.correctCount || 0)),
        mastered: Boolean(remote.mastered || local.mastered),
        ...(editorChange ? { editorChange, hebrew: editorChange.hebrew, english: editorChange.english } : {}) };
    }
    return target;
  }
  function authReady(auth) {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise(resolve => {
      let finished = false, unsubscribe = () => {};
      const done = user => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        try { unsubscribe(); } catch (_) { }
        resolve(user || null);
      };
      const timer = setTimeout(() => done(auth.currentUser), 5000);
      try { unsubscribe = auth.onAuthStateChanged(done, () => done(null)); }
      catch (_) { done(null); }
    });
  }
  async function authFor(ctx = context(), teacher = false) {
    try {
      if (!root.firebase) return null;
      const apps = root.firebase.apps || [], readyUsers = await Promise.all(apps.map(async app => {
        try { return app.auth ? await authReady(app.auth()) : null; } catch (_) { return null; }
      }));
      for (const user of readyUsers) {
        if (!user || !user.getIdTokenResult) continue;
        try {
          const token = await user.getIdTokenResult(), claims = token.claims || {};
          if (teacher ? token.signInProvider === 'google.com' : claims.b3StudentId === ctx.studentId && claims.b3ClassId === ctx.classId) return user;
        } catch (_) { }
      }
    } catch (_) { return null; }
    return null;
  }
  async function request(action, body = {}, ctx = context(), teacher = false) {
    const user = await authFor(ctx, teacher);
    if (!user) return null;
    const token = await user.getIdToken();
    const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ action, classId: ctx.classId, studentId: ctx.studentId, ...body }), signal: AbortSignal.timeout(12000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not sync word bank.');
    return result;
  }
  let pendingCollections = [], pendingContext = null, collectTimer = 0;
  function collect(lesson, words, ctx = context()) {
    if (!ctx.studentId || !ctx.classId || sessionStorage.getItem('b3Games_guest') === '1' || root.B3_READ_ONLY_TEACHER_PREVIEW || /(?:teacherView=|teacher=1)/.test(location.search)) return { collected: 0, skipped: 'not-student' };
    const normalized = normalizeWords(words), bank = readLocal(ctx), now = new Date().toISOString();
    for (const word of normalized) {
      const existing = bank.words[word.id] || { id: word.id, hebrew: word.hebrew, english: word.english, source: word.source, sources: [], lessons: [], collectedAt: now, practiceCount: 0, correctCount: 0, mastered: false };
      if (!existing.editorChange) { existing.hebrew = word.hebrew; existing.english = word.english; } else { existing.hebrew = existing.editorChange.hebrew; existing.english = existing.editorChange.english; }
      existing.sources = Array.isArray(existing.sources) ? existing.sources : [existing.source].filter(Boolean);
      if (!existing.sources.includes(word.source)) existing.sources.push(word.source);
      existing.source = existing.sources.length > 1 ? 'both' : existing.sources[0];
      existing.lessons = Array.isArray(existing.lessons) ? existing.lessons : [];
      if (lesson && !existing.lessons.some(item => item.id === lesson.id && item.source === word.source)) existing.lessons.push({ id: lesson.id, title: clean(lesson.title), source: word.source, openedAt: now });
      bank.words[word.id] = existing;
    }
    writeLocal(bank, ctx);
    // Keep the lesson opening immediate; sync is retried when the student opens
    // My Word Bank. The active student's Firebase token is validated server-side.
    pendingCollections.push({ lesson: { ...lesson, source: normalized[0]?.source }, words: normalized });
    pendingContext = ctx;
    clearTimeout(collectTimer);
    collectTimer = setTimeout(() => {
      const items = pendingCollections.splice(0), target = pendingContext; pendingContext = null;
      request('collectBatch', { items }, target).then(result => {
        if (result?.summary) root.dispatchEvent(new CustomEvent('ftt-wordbank-synced', { detail: result.summary }));
      }).catch(error => console.warn('Word bank cloud save unavailable:', error.message));
    }, 180);
    return { collected: normalized.length, total: Object.keys(bank.words).length, localOnly: true };
  }
  function recordAnswer(wordId, correct, ctx = context()) {
    const bank = readLocal(ctx), word = bank.words[wordId];
    if (!word) return null;
    word.practiceCount = Number(word.practiceCount || 0) + 1;
    word.correctCount = Number(word.correctCount || 0) + (correct ? 1 : 0);
    word.mastered = Number(word.correctCount) >= 3;
    word.lastPracticedAt = new Date().toISOString(); writeLocal(bank, ctx);
    request('review', { wordId, correct: !!correct }, ctx).catch(error => console.warn('Word bank review sync unavailable:', error.message));
    return word;
  }
  async function sync(ctx = context()) {
    const result = await request('read', {}, ctx);
    if (result?.bank) { const bank = mergeBank(readLocal(ctx), result.bank); writeLocal(bank, ctx); root.dispatchEvent(new CustomEvent('ftt-wordbank-synced', { detail: result.summary || {} })); }
    return readLocal(ctx);
  }
  function teacherRequest(action, body = {}, ctx = context()) { return request(action, body, ctx, true); }
  function list(source = 'all', ctx = context()) {
    return Object.values(readLocal(ctx).words).filter(word => source === 'all' || (word.sources || [word.source]).includes(source))
      .sort((a, b) => a.hebrew.localeCompare(b.hebrew, 'he'));
  }
  root.FTTWordBank = { context, collect, list, recordAnswer, read: readLocal, sync, request, teacherRequest, mergeBank, storageKey, authFor };
})(typeof window === 'object' ? window : globalThis);
