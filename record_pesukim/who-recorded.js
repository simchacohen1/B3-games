/* "Who recorded" strip for the teacher pages: one chip per student in the class.
   Green with a check = recorded today, gray = not today. Tapping a chip jumps to that student's recordings.
   It listens to each student's recordings, so it updates by itself when a new one comes in.
   Shared by the Posuk Practice and Rashi Letters teacher pages (each passes its own path and test). */
(function(root){
  "use strict";

  function startOfDay(now){ const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // How many of these recordings count as "recorded today". isRecording(item) says what counts at all.
  function countToday(items, isRecording, now){
    const from = startOfDay(now);
    return Object.values(items || {}).filter(item => item && isRecording(item, from)).length;
  }

  // students: { id: name }. counts: { id: number | undefined (not loaded yet) }. Recorded first is NOT used: the order stays by name so chips do not jump around.
  function chips(students, counts){
    return Object.entries(students || {})
      .map(([sid, name]) => ({ sid, name: String(name || sid), count: counts[sid] || 0, recorded: (counts[sid] || 0) > 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function html(list, title){
    const done = list.filter(c => c.recorded).length;
    return '<div class="wr-head"><b>' + esc(title || 'Who recorded today') + '</b><span>' + done + ' of ' + list.length + '</span></div>' +
      '<div class="wr-chips">' + (list.length ? list.map(c =>
        '<button type="button" class="wr-chip ' + (c.recorded ? 'done' : 'none') + '" data-wr-sid="' + esc(c.sid) + '" aria-label="' +
          esc(c.name + (c.recorded ? ': recorded today' + (c.count > 1 ? ' (' + c.count + ')' : '') : ': no recording today')) + '">' +
          (c.recorded ? '<span class="wr-check" aria-hidden="true">✓</span> ' : '') + esc(c.name) +
          (c.count > 1 ? '<span class="wr-n">×' + c.count + '</span>' : '') + '</button>').join('') : '<span class="wr-empty">No students in this class.</span>') + '</div>';
  }

  // options: { db, el, path, students: () => ({id: name}), isRecording(item, startOfToday), onPick(sid), title, now }
  function mount(options){
    const now = options.now || (() => Date.now());
    const counts = {}, offs = new Map();
    let stopped = false, timer = null, lastDay = startOfDay(now());

    function render(){
      if(stopped || !options.el) return;
      options.el.innerHTML = html(chips(options.students(), counts), options.title);
    }
    function watch(sid){
      const ref = options.db.ref(options.path + '/' + sid);
      const onValue = snap => { counts[sid] = countToday(snap.val(), options.isRecording, now()); render(); };
      ref.on('value', onValue, () => { counts[sid] = 0; render(); });
      offs.set(sid, () => ref.off('value', onValue));
    }
    // Call again whenever the class list may have changed.
    function sync(){
      const ids = new Set(Object.keys(options.students() || {}));
      for(const [sid, off] of offs){ if(!ids.has(sid)){ off(); offs.delete(sid); delete counts[sid]; } }
      for(const sid of ids) if(!offs.has(sid)) watch(sid);
      render();
    }
    if(options.el) options.el.onclick = e => {
      const chip = e.target.closest && e.target.closest('[data-wr-sid]');
      if(chip && options.onPick) options.onPick(chip.dataset.wrSid);
    };
    // The day can change while the page stays open: then yesterday's chips turn gray again.
    timer = setInterval(() => {
      // Counts were taken against the day they arrived; reload them when the day changes.
      if(startOfDay(now()) !== lastDay){ lastDay = startOfDay(now()); for(const [sid, off] of offs){ off(); offs.delete(sid); } sync(); }
    }, 60000);
    sync();
    return { sync, stop(){ stopped = true; clearInterval(timer); offs.forEach(off => off()); offs.clear(); } };
  }

  const api = { startOfDay, countToday, chips, html, mount };
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.B3WhoRecorded = api;
})(typeof self !== 'undefined' ? self : this);
