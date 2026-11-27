/* "Who recorded" strip for the Posuk Practice teacher page: one chip per student in the class.
   Green with a check and ×1 / ×2 / ×3 = recorded in the chosen period (Today / Yesterday / This week), gray = did not.
   Tapping a chip picks that boy (the page then shows only him); tapping him again, or "Show everyone", clears it.
   It listens to each student's recordings, so it updates by itself when a new one comes in. READ ONLY.
   The period dates come from RashiHistoryCore.range (rashi-letters/history-core.js), the same helper the Rashi page uses. */
(function(root){
  "use strict";

  const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week']];
  const WORD = { today: 'today', yesterday: 'yesterday', week: 'this week' };
  function startOfDay(now){ const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // How many of these recordings fall in [range[0], range[1]). isRecording(item) says what counts at all (not deleted, has an id).
  function countIn(items, isRecording, range){
    return Object.values(items || {}).filter(item => item && isRecording(item) && (Number(item.submittedAt) || 0) >= range[0] && (Number(item.submittedAt) || 0) < range[1]).length;
  }

  // students: { id: name }. counts: { id: number }. The order stays by name so chips do not jump around.
  function chips(students, counts){
    return Object.entries(students || {})
      .map(([sid, name]) => ({ sid, name: String(name || sid), count: counts[sid] || 0, recorded: (counts[sid] || 0) > 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // state: { period, selected, nameOf }
  function html(list, state){
    const period = (state && state.period) || 'today', selected = (state && state.selected) || '';
    const done = list.filter(c => c.recorded).length, word = WORD[period] || WORD.today;
    const pick = selected ? list.find(c => c.sid === selected) : null;
    return '<div class="wr-head"><b>Who recorded</b><span class="wr-switch" role="group" aria-label="Period">' +
        PERIODS.map(([k, l]) => '<button type="button" data-period="' + k + '" aria-pressed="' + (period === k) + '">' + l + '</button>').join('') +
      '</span><span class="wr-total">' + done + ' of ' + list.length + '</span></div>' +
      '<div class="wr-chips">' + (list.length ? list.map(c =>
        '<button type="button" class="wr-chip ' + (c.recorded ? 'done' : 'none') + (selected === c.sid ? ' sel' : '') + '" data-wr-sid="' + esc(c.sid) + '" aria-pressed="' + (selected === c.sid) + '" aria-label="' +
          esc(c.name + (c.recorded ? ': recorded ' + c.count + (c.count === 1 ? ' time ' : ' times ') + word : ': no recording ' + word)) + '">' +
          (c.recorded ? '<span class="wr-check" aria-hidden="true">✓</span> ' : '') + esc(c.name) +
          (c.recorded ? '<span class="wr-n">×' + c.count + '</span>' : '') + '</button>').join('') : '<span class="wr-empty">No students in this class.</span>') + '</div>' +
      (selected ? '<div class="wr-pick">Showing only ' + esc(pick ? pick.name : selected) + '<button type="button" data-clear="1">Show everyone</button></div>' : '');
  }

  // options: { db, el, path, students: () => ({id: name}), isRecording(item), selected: () => sid, onPick(sid), range(period, now) -> [from,to), now }
  function mount(options){
    const now = options.now || (() => Date.now());
    const items = {}, offs = new Map();
    let stopped = false, timer = null, lastDay = startOfDay(now()), period = 'today';

    function counts(){
      const r = options.range(period, now()), out = {};
      Object.keys(items).forEach(sid => { out[sid] = countIn(items[sid], options.isRecording, r); });
      return out;
    }
    function render(){
      if(stopped || !options.el) return;
      options.el.innerHTML = html(chips(options.students(), counts()), { period, selected: options.selected ? options.selected() : '' });
    }
    function watch(sid){
      const ref = options.db.ref(options.path + '/' + sid);
      const onValue = snap => { items[sid] = snap.val() || {}; render(); };
      ref.on('value', onValue, () => { items[sid] = {}; render(); });
      offs.set(sid, () => ref.off('value', onValue));
    }
    // Call again whenever the class list may have changed.
    function sync(){
      const ids = new Set(Object.keys(options.students() || {}));
      for(const [sid, off] of offs){ if(!ids.has(sid)){ off(); offs.delete(sid); delete items[sid]; } }
      for(const sid of ids) if(!offs.has(sid)) watch(sid);
      render();
    }
    if(options.el) options.el.onclick = e => {
      const t = e.target, hit = sel => t && t.closest && t.closest(sel);
      const per = hit('[data-period]'), chip = hit('[data-wr-sid]'), clr = hit('[data-clear]');
      if(per){ period = per.dataset.period; render(); }
      else if(clr){ if(options.onPick) options.onPick(''); }
      else if(chip && options.onPick) options.onPick(chip.dataset.wrSid);
    };
    // The day can change while the page stays open: re-count so yesterday's chips turn gray again.
    timer = setInterval(() => { if(startOfDay(now()) !== lastDay){ lastDay = startOfDay(now()); render(); } }, 60000);
    sync();
    return { sync, redraw: render, stop(){ stopped = true; clearInterval(timer); offs.forEach(off => off()); offs.clear(); } };
  }

  const api = { startOfDay, countIn, chips, html, mount };
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.B3WhoRecorded = api;
})(typeof self !== 'undefined' ? self : this);
