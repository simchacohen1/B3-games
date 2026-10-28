/* Local demonstration state. Only teacherLoad reads the server; demo work stays here. */
(function () {
  'use strict';
  const api = window.YiddishAPI, liveCall = api.call.bind(api);
  let state = null, round = null;
  const shuffle = items => items.map(value => ({value, n:Math.random()})).sort((a,b)=>a.n-b.n).map(x=>x.value);
  const snapshot = () => round && ({id:round.id, group:round.group, part:round.part,
    index:round.index, total:round.items.length, finished:round.index===round.items.length,
    question:round.items[round.index] || null});
  api.ready = (async function () {
    // Guest Mode: sample Step 1 of the story, built here; no server, nothing saved.
    if (window.B3Guest && window.B3Guest.isGuest()) {
      const C = window.YIDDISH_CONTENT;
      const sections = [0,1,2,3].map(g => ({start:g*300, end:g===3?1194:(g+1)*300,
        first:[0,10,17,26][g], last:[9,16,25,35][g], verified:g===0,
        words:C.words.filter(w => w.group===g).map(w => w.id)}));
      state = {student:{id:'guest_preview', name:'Guest preview', classId:'demo'},
        config:{version:0, unlocked:{demo:1}, unlockedSteps:{demo:1}, sections}, progress:{}, noStory:false, storyTimes:null};
      api.preview = true;
      return;
    }
    const account = await window.B3TeacherAccountReady;
    if (!account.user || !account.authorized || B3SiteSettings.getActingStudent()) return;
    const requested = new URLSearchParams(location.search).get('class');
    const validClass = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
    const classId = validClass(requested) ? requested : (account.access?.classIds || []).find(validClass) || 'et';
    const loaded = await liveCall('teacherLoad', {classId, idToken:await account.user.getIdToken()});
    const config = structuredClone(loaded.config);
    config.unlocked[classId] = 4;
    delete config.unlockedSteps;
    config.sections.forEach(section => section.verified = true);
    state = {student:{id:'teacher_preview', name:'Teacher demonstration', classId},
      config, progress:{}, noStory:loaded.storyGranted===false, storyTimes:loaded.storyTimes};
    api.preview = true;
  })();
  api.call = async function (action, data = {}) {
    await api.ready;
    if (!state) return liveCall(action, data);
    if (action === 'status') return {...state, round:snapshot()};
    if (action === 'start') {
      if (state.noStory) throw Error('Your class does not have a Yiddish story yet.');
      const section = state.config.sections[data.group];
      if (!section) throw Error('Choose a story section.');
      const part = data.part || 0;
      const fresh = section.words.slice(part*4, part*4+4);
      const previous = [...state.config.sections.slice(0,data.group).flatMap(s=>s.words), ...section.words.slice(0,part*4)];
      const words = window.YIDDISH_CONTENT.words;
      const items = shuffle([...fresh,...shuffle(previous).slice(0,4)]).map(wordId => ({wordId,
        choices:shuffle([wordId,...shuffle(words.filter(w=>w.id!==wordId).map(w=>w.id)).slice(0,3)])}));
      round = {id:'demo-'+Date.now(), group:data.group, part, index:0, items, missed:new Set()};
      return {round:snapshot()};
    }
    if (action === 'answer') {
      const question = round?.items[round.index];
      if (!question || data.roundId !== round.id || data.index !== round.index) throw Error('Start a new demonstration round.');
      const correct = data.answer === question.wordId;
      if (!correct) round.missed.add(question.wordId);
      const firstTry = !round.missed.has(question.wordId);
      if (correct) {
        const old = state.progress[question.wordId] || {credits:0, rounds:0};
        state.progress[question.wordId] = {credits:Math.min(2,old.credits+(firstTry?1:0)),rounds:old.rounds+1};
        round.index++;
      }
      return {correct, firstTry, round:snapshot(), progress:state.progress};
    }
    throw Error('This action is unavailable in teacher demonstration mode.');
  };
})();
