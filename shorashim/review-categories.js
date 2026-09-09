/* Shorashim Learning Lab — category-aware Flashcard Review
   Adds separate Shorashim / Prefixes / Suffixes review pickers while
   preserving the existing card renderer, review timing, selection,
   manual ordering, shuffle, and daily completion system. */
(() => {
  'use strict';

  let reviewTrack = 'shorashim';

  const TRACK_META = {
    shorashim: { label: 'Shorashim', empty: 'shorashim' },
    prefix: { label: 'Prefixes', empty: 'prefixes' },
    suffix: { label: 'Suffixes', empty: 'suffixes' }
  };

  function fixStaticReviewLabelsAndAffixIcons() {
    document.querySelectorAll('[data-review-track]').forEach(btn => {
      const meta = TRACK_META[btn.dataset.reviewTrack];
      const title = btn.querySelector('.track-title');
      if (meta && title) title.textContent = meta.label;
    });

    const prefixIcon = document.querySelector('[data-track="prefix"] .feature-icon');
    if (prefixIcon) {
      prefixIcon.textContent = 'ב־';
      prefixIcon.setAttribute('dir', 'rtl');
    }

    const suffixIcon = document.querySelector('[data-track="suffix"] .feature-icon');
    if (suffixIcon) {
      suffixIcon.textContent = '־ו';
      suffixIcon.setAttribute('dir', 'rtl');
    }
  }

  function cardsForReviewTrack(track = reviewTrack, s = student()) {
    return learnedCards(s, track, false).filter(c => !!getItem(c.itemKey));
  }

  function reviewTrackProgress(track, s = student()) {
    const dr = ensureDailyReview(s);
    const keys = cardsForReviewTrack(track, s).map(c => c.itemKey);
    const seen = keys.filter(k => dr.seen[k]).length;
    return { seen, total: keys.length, complete: keys.length > 0 && seen === keys.length };
  }

  function updateReviewTrackTabs() {
    document.querySelectorAll('[data-review-track]').forEach(btn => {
      const track = btn.dataset.reviewTrack;
      const p = reviewTrackProgress(track);
      const active = track === reviewTrack;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      const progress = btn.querySelector('.track-progress');
      if (progress) {
        progress.textContent = p.total
          ? `${p.seen} / ${p.total} reviewed today${p.complete ? ' ✓' : ''}`
          : 'No learned cards yet';
      }
    });
  }

  function selectReviewTrack(track) {
    if (!TRACK_META[track]) return;
    reviewTrack = track;
    reviewDeck = [];
    reviewIndex = 0;
    reviewFlipped = false;
    document.body.classList.remove('shorashim-review-active');
    document.getElementById('reviewArea')?.classList.add('hidden');
    document.getElementById('reviewEmpty')?.classList.add('hidden');
    document.getElementById('reviewSetup')?.classList.remove('hidden');
    updateReviewTrackTabs();
    renderReviewPicker();
    window.scrollTo(0, 0);
  }

  function wireReviewTrackButtons() {
    document.querySelectorAll('[data-review-track]').forEach(btn => {
      btn.onclick = () => selectReviewTrack(btn.dataset.reviewTrack);
    });
    updateReviewTrackTabs();
  }

  const originalBindReview = bindReview;
  bindReview = function categoryAwareBindReview() {
    originalBindReview();
    wireReviewTrackButtons();
  };

  reviewSortedCards = function categoryAwareReviewSortedCards() {
    let arr = cardsForReviewTrack().slice();
    const mode = document.getElementById('reviewSort')?.value || 'learned';
    if (mode === 'alpha') {
      arr.sort((a, b) => (getItem(a.itemKey)?.front || '').localeCompare(getItem(b.itemKey)?.front || '', 'he'));
    } else if (mode === 'manual') {
      arr.sort((a, b) => (a.reviewOrder ?? a.learnedAt) - (b.reviewOrder ?? b.learnedAt));
    } else {
      arr.sort((a, b) => a.learnedAt - b.learnedAt);
    }
    return arr;
  };

  renderReviewPicker = function categoryAwareRenderReviewPicker() {
    const box = document.getElementById('reviewPicker');
    if (!box) return;
    const arr = reviewSortedCards();
    const manual = document.getElementById('reviewSort')?.value === 'manual';
    box.innerHTML = '';

    if (!arr.length) {
      const meta = TRACK_META[reviewTrack];
      box.innerHTML = `<div class="review-track-empty">No learned ${escapeHTML(meta.empty)} yet. Learn one, then come back here.</div>`;
      updateReviewSelectionCount();
      updateReviewTrackTabs();
      return;
    }

    arr.forEach(c => {
      const item = getItem(c.itemKey);
      const row = document.createElement('div');
      row.className = 'review-pick-row' + (manual ? ' manual-draggable' : '');
      row.dataset.key = c.itemKey;
      row.draggable = manual;
      row.innerHTML = `<label><input class="review-pick-check" type="checkbox" data-key="${escapeHTML(c.itemKey)}" checked> <b class="hebrew">${escapeHTML(item.front)}</b><span>${escapeHTML(item.english)}</span>${manual ? '<span class="review-drag-hint">↕ Drag to reorder</span>' : ''}</label>`;
      box.appendChild(row);
    });

    box.querySelectorAll('.review-pick-check').forEach(x => x.onchange = updateReviewSelectionCount);
    if (manual) bindReviewDragDrop(box);
    updateReviewSelectionCount();
    updateReviewTrackTabs();
  };

  renderReviewAvailability = function categoryAwareRenderReviewAvailability() {
    const hasAny = eligibleLearnedCards().length > 0;
    const empty = document.getElementById('reviewEmpty');
    const setup = document.getElementById('reviewSetup');
    const area = document.getElementById('reviewArea');
    empty?.classList.toggle('hidden', hasAny);
    setup?.classList.toggle('hidden', !hasAny);
    if (!hasAny) {
      area?.classList.add('hidden');
    } else {
      updateReviewTrackTabs();
      renderReviewPicker();
    }
  };

  startReview = function categoryAwareStartReview() {
    const keys = [...document.querySelectorAll('.review-pick-check:checked')].map(x => x.dataset.key);
    const map = new Map(cardsForReviewTrack().map(c => [c.itemKey, c]));
    let arr = keys.map(k => map.get(k)).filter(Boolean);

    if (!arr.length) {
      alert(`Select at least one ${TRACK_META[reviewTrack].label.toLowerCase()} card to review.`);
      return;
    }

    if (document.querySelector('input[name="reviewOrderMode"]:checked')?.value === 'shuffle') {
      arr = shuffle(arr.slice());
    }

    reviewDeck = arr;
    reviewIndex = 0;
    reviewFlipped = false;
    document.getElementById('reviewEmpty')?.classList.add('hidden');
    document.getElementById('reviewSetup')?.classList.add('hidden');
    document.body.classList.add('shorashim-review-active');
    document.getElementById('reviewArea')?.classList.remove('hidden');
    renderReviewCard();
  };

  const originalRenderDailyStatus = renderDailyStatus;
  renderDailyStatus = function categoryAwareRenderDailyStatus() {
    originalRenderDailyStatus();
    updateReviewTrackTabs();
  };

  /* ===== Meaning-aware pictures for bulk/custom Shorashim =====
     Only genuinely related choices are shown; unrelated filler icons are never added. */
  const GENERIC_ART = new Set(['✨','⭐','🖍️']);
  const ART_RULES = [
    // Places / objects
    [/entrance|opening|door|gate/,['🚪','🏠','🚧','↔️'],{src:'assets/illustrations/entrance.svg',label:'A doorway entrance'}],
    [/\btent\b|ohel/,['⛺','🏕️','🏠','🌵'],{src:'assets/illustrations/tent.svg',label:'A tent'}],
    [/grove|tree|wood|forest/,['🌳','🌲','🌿','🪵'],{src:'assets/illustrations/grove.svg',label:'A grove of trees'}],
    [/\bland\b|\bearth\b|ground|soil/,['🌍','🏞️','🌱','🗺️']],
    [/\bhouse\b|\bhome\b/,['🏠','🏡','🚪','🛏️']],
    [/\bcity\b|town/,['🏙️','🏘️','🛣️','🏢']],
    [/\bfield\b/,['🌾','🌱','🚜','🏞️']],
    [/\bmountain\b|\bhill\b/,['⛰️','🏔️','🥾','🌄']],
    [/\briver\b|stream/,['🌊','🏞️','💧','🚣']],
    [/\bwell\b|\bspring\b/,['🪣','💧','🌊','🏞️']],
    [/\broad\b|\bway\b|\bpath\b/,['🛣️','➡️','👣','🗺️']],
    [/\bplace\b|\bthere\b|\bhere\b/,['📍','🗺️','➡️','🏠']],

    // Seeing / speaking / thinking
    [/\bsee\b|\bsaw\b|\bseen\b|\blook\b|\bappear\b|\bappeared\b/,['👀','👁️','🔎','✨'],{src:'assets/illustrations/seeing-binoculars.svg',label:'Looking'}],
    [/behold|look!|notice/,['👀','❗','🔎','✨']],
    [/\beye\b|\beyes\b/,['👁️','👀','🙂','🔎'],{src:'assets/illustrations/eye.svg',label:'An eye'}],
    [/\bhear\b|\bheard\b|\blisten\b/,['👂','🔊','🎧','🎶']],
    [/\bcall\b|\bcalled\b|\bsay\b|\bsaid\b|\bspeak\b|\bspoke\b|tell|told/,['🗣️','💬','📣','👄']],
    [/ask|asked|question/,['❓','🗣️','💬','🙋']],
    [/answer|answered|reply/,['💬','✅','🗣️','↩️']],
    [/know|knew|understand|think|thought|remember/,['🧠','💡','📖','🤔']],
    [/find|found|search|seek|sought/,['🔎','🎯','👀','✅']],

    // Movement / actions
    [/\bsit\b|\bsat\b|sitting/,['🪑','🧎','🛋️','🏕️'],{src:'assets/illustrations/sitting.svg',label:'A person sitting'}],
    [/\bstand\b|\bstood\b|standing|firm/,['🧍','📍','⬆️','🚶']],
    [/\brun\b|\bran\b|running|hurr(y|ied)|quick/,['🏃','💨','👟','⚡']],
    [/\bwalk\b|\bgo\b|\bwent\b|\btravel\b|\bjourney\b/,['🚶','👣','➡️','🛣️']],
    [/\bcome\b|\bcame\b|\barrive\b/,['➡️','🚶','👋','🏠']],
    [/\blift\b|\blifted\b|\bcarry\b|\bcarried\b|\braise\b/,['⬆️','🙌','📦','💪'],{src:'assets/illustrations/carrying.svg',label:'Carrying'}],
    [/\btake\b|\btook\b|\btaken\b|\bgrab\b/,['✋','🤲','📦','⬅️']],
    [/\bgive\b|\bgave\b|\bgiven\b/,['🎁','🤲','➡️','💝']],
    [/\bbring\b|\bbrought\b/,['📦','➡️','🤲','🚶']],
    [/return|returned|back again/,['↩️','🔙','🏠','🔄']],
    [/cross|passed|pass over|across/,['➡️','🌉','🚶','🛣️']],
    [/greet|meet|toward|towards/,['🤝','👋','👥','➡️']],
    [/\bbow\b|bowed|prostrate/,['🙇','🙏','🧎','⬇️']],
    [/serve|served|work|worked|labor/,['🛠️','🤲','💼','⚙️']],
    [/\bmake\b|\bmade\b|\bdo\b|\bdid\b|prepare|prepared/,['🛠️','✅','🧱','🔧']],
    [/open|opened/,['🚪','🔓','📖','↔️']],
    [/close|closed|shut/,['🚪','🔒','📕','⛔']],
    [/send|sent/,['📨','➡️','✉️','🕊️']],
    [/leave|left|depart/,['🚶','➡️','👋','🛣️']],
    [/stay|remain|remained/,['📍','🛑','🏠','🧍']],

    // Food / household
    [/\bbread\b|\bloaf\b/,['🍞','🥖','🥯','🌾']],
    [/\bwater\b/,['💧','🚰','🌊','🫗']],
    [/\bflour\b/,['🌾','🥣','🍞','🫙']],
    [/knead|kneaded/,['🤲','🍞','🥣','👨‍🍳']],
    [/\bcake\b|\bcakes\b/,['🍰','🧁','🥮','🎂']],
    [/\bbutter\b/,['🧈','🥛','🍞','🐄']],
    [/\bmilk\b/,['🥛','🐄','🍼','🤍']],
    [/\beat\b|\bate\b|\beaten\b|food|meal/,['🍽️','🥘','😋','🍴']],
    [/\bdrink\b|\bdrank\b/,['🥤','💧','🫗','🥛']],
    [/\bwash\b|washed|washing/,['🧼','💦','🫧','🚿']],

    // People / family
    [/\bman\b|\bmen\b|\bperson\b|\bpeople\b/,['👨','🧍','👥','🙂']],
    [/\bwoman\b|\bwomen\b/,['👩','👩‍🦱','👥','🙂']],
    [/\bson\b|\bboy\b|\byouth\b|\blad\b/,['👦','🧒','👨‍👦','🏃']],
    [/\bdaughter\b|\bgirl\b/,['👧','🧒','👨‍👧','🏠']],
    [/\bchild\b|\bchildren\b/,['🧒','👦','👧','🏠']],
    [/\bmother\b/,['👩','👩‍👦','🏠','❤️']],
    [/\bfather\b/,['👨','👨‍👦','🏠','❤️']],
    [/\bbrother\b/,['👦','👬','🏠','🤝']],
    [/\bsister\b/,['👧','👭','🏠','🤝']],
    [/\bwife\b/,['👩','💍','🏠','❤️']],
    [/\bhusband\b/,['👨','💍','🏠','❤️']],
    [/\bmaster\b|\blord\b|\bking\b/,['👑','🏛️','⭐','🫅']],

    // Body
    [/\bface\b/,['🙂','👤','👀','😊']],
    [/\bhand\b|\bhands\b/,['✋','🤲','🖐️','👋']],
    [/\bhead\b/,['👤','🧠','🙂','🧢']],
    [/\bmouth\b/,['👄','🗣️','💬','😮']],
    [/\bheart\b|\bhearts\b/,['❤️','💗','🫶','💓']],
    [/\bfoot\b|\bfeet\b|\bleg\b|\blegs\b/,['🦶','👣','🧦','👟']],
    [/\bear\b|\bears\b/,['👂','🎧','🔊','🙂']],

    // Animals / nature
    [/cattle|cow|ox|bull/,['🐄','🐂','🐮','🌾']],
    [/\banimal\b|\bbeast\b/,['🐄','🐑','🐐','🐎']],
    [/\bsheep\b|\blamb\b/,['🐑','🌾','🐏','🧶']],
    [/\bdonkey\b/,['🫏','🐴','🛤️','📦']],
    [/\bhorse\b/,['🐎','🏇','🌾','🛣️']],
    [/\bbird\b/,['🐦','🪶','🪺','🌳']],
    [/\bseed\b|plant/,['🌱','🌾','🫘','🌻']],
    [/\bfire\b|burn/,['🔥','🪵','☀️','🚒']],
    [/\bheat\b|\bhot\b|warm/,['☀️','🔥','🌡️','🥵'],{src:'assets/illustrations/heat.svg',label:'Heat'}],
    [/\bcold\b/,['🥶','❄️','🧊','🌨️']],

    // Time / quantity / qualities
    [/\bday\b|daytime/,['☀️','🌤️','📅','🌅'],{src:'assets/illustrations/day.svg',label:'Daytime'}],
    [/\bnight\b/,['🌙','⭐','🌌','🛏️']],
    [/\bmorning\b/,['🌅','☀️','⏰','🌄']],
    [/\bevening\b/,['🌇','🌙','🌆','🕯️']],
    [/\btime\b/,['⏰','⌛','🕰️','📅']],
    [/\bfirst\b|beginning|start/,['1️⃣','▶️','🌅','🏁']],
    [/\blast\b|end|ending/,['🔚','🏁','⏹️','📅']],
    [/\bthree\b|\b3\b/,['3️⃣','🔺','👨‍👨‍👦','3'],{src:'assets/illustrations/three-people.svg',label:'Three people'}],
    [/\btwo\b|\b2\b/,['2️⃣','👥','✌️','⚖️']],
    [/\bone\b|\b1\b/,['1️⃣','☝️','👤','🎯']],
    [/\bfour\b|\b4\b/,['4️⃣','🟦','🧩','👥']],
    [/\bfive\b|\b5\b/,['5️⃣','🖐️','⭐','👥']],
    [/\bmany\b|much|numerous/,['👥','🔢','📚','🌾']],
    [/\ball\b|every|whole/,['🌐','👥','✅','💯']],
    [/\blittle\b|\bfew\b|small amount|morsel/,['🤏','1️⃣','🔹','🐜']],
    [/\bbig\b|\bgreat\b|\blarge\b/,['🐘','⬆️','🔷','💪']],
    [/\bsmall\b|\blittle\b/,['🐜','🤏','🔹','🐭']],
    [/\bold\b|elder/,['👴','🕰️','📜','⌛']],
    [/\bnew\b/,['🆕','🌱','🎁','✨']],
    [/soft|tender/,['🧸','☁️','🪶','🤲']],
    [/\bgood\b|fine|excellent/,['👍','⭐','😊','✅']],
    [/\bbad\b|evil/,['👎','⚠️','❌','🌩️']],
    [/\blight\b|bright/,['💡','☀️','🔦','✨']],
    [/\bdark\b|darkness/,['🌑','🌙','🌌','🕶️']],
    [/\blive\b|\blived\b|\blife\b/,['❤️','🌱','🙂','🌿']],
    [/\bdie\b|\bdied\b|death/,['🪦','🥀','⌛','🕯️']],

    // Money / possession
    [/\bbuy\b|\bbought\b/,['🛒','💰','🧾','🛍️']],
    [/\bsell\b|\bsold\b/,['💵','🏷️','🤝','🛍️']],
    [/\bmoney\b|silver|gold/,['💰','💵','🪙','🏦']],
    [/own|belong|possess/,['🔑','🏠','✋','📦']],

    // Pronouns / grammar words — symbolic, but directly tied to the meaning
    [/\bhe\b|\bhim\b|\bhis\b/,['👦','👨','👉','👤']],
    [/\bshe\b|\bher\b|\bhers\b/,['👧','👩','👉','👤']],
    [/\bthey\b|\bthem\b|\btheir\b/,['👥','👨‍👩‍👧‍👦','👉','🤝']],
    [/\byou\b|\byour\b|\byours\b/,['👉','🙂','👤','🫵']],
    [/\bi\b|\bme\b|\bmy\b|\bmine\b/,['🙋','👤','🫵','❤️']],
    [/\bwe\b|\bus\b|\bour\b/,['👥','🤝','🙌','🏠']],
    [/\bwho\b/,['❓','👤','🕵️','🙋']],
    [/\bwhat\b/,['❓','📦','🤔','🔎']],
    [/\bwhere\b/,['📍','🗺️','❓','🏠']],
    [/\bwhen\b/,['⏰','📅','❓','⌛']],
    [/\bthis\b/,['👉','📍','1️⃣','🫵']],
    [/\bthat\b/,['👉','➡️','📍','👀']],
    [/\bthese\b|\bthose\b/,['👥','👉','📍','➡️']],
    [/\bto\b|\btoward\b|\btowards\b/,['➡️','👉','🛣️','🏠']],
    [/\bfrom\b|\bout of\b/,['⬅️','📤','🚪','🏠']],
    [/\bin\b|\binside\b|\binto\b/,['📥','🏠','📦','⬇️']],
    [/\bon\b|\bupon\b|\bover\b|\babove\b/,['⬆️','📍','🔝','🧱']],
    [/\bunder\b|\bbelow\b/,['⬇️','👇','🪜','📉']],
    [/\bbetween\b/,['↔️','👥','⚖️','📍']],
    [/\bwith\b|\btogether\b/,['🤝','👥','➕','🫶']],
    [/\bwithout\b/,['🚫','➖','🙅','❌']],
    [/\bbefore\b|\bfront\b/,['⏩','👀','➡️','1️⃣']],
    [/\bafter\b|\bbehind\b/,['⬅️','👣','🚶','🔙']],
    [/\bnear\b|\bclose\b/,['📍','🤝','🏠','👥']],
    [/\bfar\b/,['↔️','🗺️','🔭','🛣️']],
    [/\bup\b|\babove\b/,['⬆️','🪜','☝️','🚀']],
    [/\bdown\b|\bbelow\b/,['⬇️','👇','🪜','📉']],
    [/\bright\b/,['➡️','👉','✅','🖐️']],
    [/\bleft\b/,['⬅️','👈','🖐️','↩️']],
    [/\bagain\b|also|more/,['🔁','➕','🔄','2️⃣']],
    [/\bnot\b|\bno\b/,['🚫','❌','🙅','⛔']],
    [/\byes\b/,['✅','👍','✔️','🙂']],
    [/because|therefore|so that/,['🔗','➡️','💭','📖']],
    [/if|perhaps|maybe/,['❓','🤔','🔀','💭']],
    [/then|now/,['⏰','➡️','📅','▶️']],
    [/very|greatly/,['⬆️','💯','⭐','❗']],

    // Torah-story words often appearing in Vayeira
    [/grace|favor|favour|kindness/,['❤️','🤲','😊','✨']],
    [/angel|messenger/,['🕊️','📨','✨','👤']],
    [/promise|swear|oath/,['🤝','✅','📜','✋']],
    [/laugh|laughed|laughter/,['😂','😊','😄','🤣']],
    [/fear|afraid/,['😨','⚠️','🙈','💓']],
    [/pray|prayed|prayer/,['🙏','📖','🕯️','🤲']],
    [/destroy|destroyed/,['💥','🔥','🏚️','❌']],
    [/save|saved|rescue/,['🛟','✅','🤲','🏠']]
  ];

  function genericArt(art) {
    return !Array.isArray(art) || !art.length || art.every(x => GENERIC_ART.has(x));
  }

  function smartArt(item) {
    const text = `${item?.english || ''} ${item?.front || ''}`.toLowerCase();
    const out = [];
    const add = v => { if (v && !out.includes(v)) out.push(v); };
    ART_RULES.forEach(([re, choices]) => {
      if (re.test(text)) choices.forEach(add);
    });
    // Last-resort phrase classifiers. These are still tied to the actual meaning,
    // and are intentionally conservative: no random brain/lightbulb/search icons.
    if (!out.length) {
      if (/^and\s+/.test(text)) {
        const stripped = text.replace(/^and\s+/, '');
        if (/\bhe\b|\bhim\b|\bhis\b/.test(stripped)) ['👦','👨','👤'].forEach(add);
        else if (/\bshe\b|\bher\b/.test(stripped)) ['👧','👩','👤'].forEach(add);
        else if (/\bthey\b|\bthem\b/.test(stripped)) ['👥','👨‍👩‍👧‍👦'].forEach(add);
      }
    }
    return out.slice(0, 4);
  }

  function smartIllustrations(item) {
    const text = `${item?.english || ''} ${item?.front || ''}`.toLowerCase();
    const out = [];
    const seen = new Set();
    const add = a => {
      if (!a || !a.src || seen.has(a.src)) return;
      seen.add(a.src);
      out.push(a);
    };
    const existing = item?.id ? (ILLUSTRATIONS[item.id] || []) : [];
    existing.forEach(add);
    ART_RULES.forEach(([re, , illustration]) => {
      if (illustration && re.test(text)) add(illustration);
    });
    return out;
  }

  const originalRenderArtChoices = renderArtChoices;
  renderArtChoices = function meaningAwareRenderArtChoices(item) {
    if (!item) return originalRenderArtChoices(item);

    const emojis = document.getElementById('emojiChoices');
    const ills = document.getElementById('illustrationChoices');
    if (!emojis || !ills) return originalRenderArtChoices(item);

    const art = (item.autoArt || genericArt(item.art)) ? smartArt(item) : (item.art || []);
    emojis.innerHTML = '';
    ills.innerHTML = '';

    if (!art.length) {
      emojis.innerHTML = '<span class="mini-note">No matching picture suggestion yet.</span>';
    }

    art.forEach(value => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'art-choice';
      b.textContent = value;
      b.onclick = () => addArtToEditor({kind:'emoji', value, label:value});
      emojis.appendChild(b);
    });

    const choices = smartIllustrations(item);
    if (!choices.length) {
      ills.innerHTML = '<span class="mini-note">No illustration for this item yet.</span>';
      return;
    }

    choices.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'art-choice';
      const img = document.createElement('img');
      img.src = a.src;
      img.alt = a.label || '';
      b.appendChild(img);
      b.onclick = () => addArtToEditor({kind:'illustration', value:a.src, label:a.label || ''});
      ills.appendChild(b);
    });
  };

  /* ===== Longer Target Shoot =====
     Student request: make the old 10-word target round 20 words.
     The display uses the actual pool length so it stays correct if changed later. */
  const originalRenderShootRound = renderShootRound;
  startShootGame = function longerTargetShoot() {
    cleanupGameRuntime();
    const learned = eligibleLearnedCards();
    if (learned.length < 3) {
      alert('Learn at least three cards before playing Target Shoot.');
      return;
    }
    const pool = [];
    while (pool.length < 20) pool.push(...shuffle([...learned]));
    shootState = {
      pool: pool.slice(0, 20),
      index: 0,
      score: 0,
      shots: 0,
      hits: 0,
      locked: false,
      startedAt: performance.now(),
      targets: []
    };
    renderShootRound();
    focusGameStage();
  };

  renderShootRound = function longerTargetShootRender() {
    originalRenderShootRound();
    const span = document.querySelector('#gameStage .game-scorebox span');
    if (span && shootState?.pool) {
      span.textContent = `Hit ${Math.min(shootState.index + 1, shootState.pool.length)}/${shootState.pool.length}`;
    }
  };

  fixStaticReviewLabelsAndAffixIcons();
  wireReviewTrackButtons();
})();