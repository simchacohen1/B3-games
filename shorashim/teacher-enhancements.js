/* Teacher-only Shorashim enhancements — 2026-09-17
   1) Commonness 1–10 on every Shorashim word (never rendered in the student app).
   2) Richer, direct picture choices. People are no longer thrown away wholesale.
   3) Borderline/person imagery is held in pendingArtReview until the teacher approves it.
   4) Regenerate means "find more": existing/rejected choices are sent as an avoid list.
*/
(() => {
  'use strict';

  const ENH_VERSION = '20260917-commonness-pictures-v1';
  const ENH_MAX_APPROVED = 10;
  const ENH_MAX_PENDING = 12;

  const enhOriginalSmartArtFor = (typeof smartArtFor === 'function') ? smartArtFor : (() => []);

  const ENH_HARD_BLOCK = new Set([
    // Explicit romance/kissing.
    '💋','💌','💏','💑','👩‍❤️‍👨','👨‍❤️‍👩','👩‍❤️‍👩','👨‍❤️‍👨',
    '👩‍❤️‍💋‍👨','👨‍❤️‍💋‍👩','👩‍❤️‍💋‍👩','👨‍❤️‍💋‍👨',
    // Non-Jewish religious imagery.
    '✝️','☦️','⛪',
    // Weapons/gore.
    '🔫','🗡️','⚔️','🩸'
  ]);

  // Human figures are useful for many meanings (brother, father, run, stand, etc.),
  // but the teacher should decide whether a particular Unicode rendering is suitable.
  const ENH_PERSON_RE = /[\u{1F466}-\u{1F469}\u{1F471}-\u{1F478}\u{1F481}-\u{1F487}\u{1F575}\u{1F57A}\u{1F645}-\u{1F647}\u{1F64B}-\u{1F64F}\u{1F6B6}\u{1F3C3}\u{1F9CD}-\u{1F9DD}\u{1F937}\u{1F926}\u{1F3CB}\u{1F3C4}\u{1F3CA}\u{1F3C7}]/u;
  const ENH_FAMILY_RE = /👨‍👩|👩‍👩|👨‍👨|🧑‍🤝‍🧑|👬|👭|👫/u;

  function enhUnique(values, max = 99) {
    const out = [];
    for (const raw of (Array.isArray(values) ? values : [])) {
      const v = String(raw || '').trim();
      if (v && !out.includes(v)) out.push(v);
      if (out.length >= max) break;
    }
    return out;
  }

  function enhHardSafe(value) {
    const v = String(value || '').trim();
    if (!v || ENH_HARD_BLOCK.has(v)) return false;
    for (const bad of ENH_HARD_BLOCK) {
      if (v.includes(bad)) return false;
    }
    return true;
  }

  function enhNeedsTeacherReview(value) {
    const v = String(value || '').trim();
    if (!v) return false;
    return ENH_PERSON_RE.test(v) || ENH_FAMILY_RE.test(v);
  }

  function enhSanitize(values, max = ENH_MAX_APPROVED) {
    return enhUnique(values, 99).filter(enhHardSafe).slice(0, max);
  }

  function enhHebrewKey(v) {
    return String(v || '')
      .normalize('NFD')
      .replace(/[\u0591-\u05C7]/g, '')
      .replace(/[^א-ת]/g, '');
  }

  const ENH_COMMONNESS_EXACT = new Map([
    // Extremely common core Chumash vocabulary.
    ['אמר',10],['היה',10],['עשה',10],['בא',10],['הלך',10],['ראה',10],
    ['נתן',10],['לקח',10],['איש',10],['בן',10],['אב',10],['אח',9],
    ['יד',10],['עין',9],['יום',10],['ארץ',10],['מים',10],['אחד',10],
    ['טוב',10],['בית',10],['זה',10],['יש',10],['אין',10],['גם',10],['מי',9],
    ['שמע',9],['יצא',9],['עלה',9],['אכל',9],['עמד',9],['ישב',9],['קרא',9],
    ['דבר',9],['מצא',9],['חיה',9],['מות',9],['ראש',9],['פנים',9],['לב',9],
    ['דרך',9],['עיר',9],['אש',9],['שמים',9],['בת',9],['לילה',9],['גדול',9],
    ['קטן',9],['שמר',9],['זכר',9],['שלח',9],['שוב',9],['בקר',8],
    // Useful but less pervasive.
    ['חזק',8],['שבר',8],['נגש',8],['ברח',7],['הר',8],['זרע',8],['חסד',8],
    ['צדק',7],['שפט',7],['פתח',8],['אהל',7],['לחם',8],['רגל',8],
    // Specialized / comparatively rare vocabulary in these perakim.
    ['סנורים',1],['גפרית',2],['קיטור',2],['כבשן',2],['סאה',2],['סלת',3],
    ['פצר',3],['התמהמה',3],['יאל',2],['קורה',3],['משתה',4],['מצה',4],
    ['מחרת',4],['אמש',3],['חלל',4],['עפר',5],['אפר',4],['חסר',6],
    ['שחת',5],['חמאה',3],['עדנה',2],['גר',5],['צער',4]
  ]);

  function enhEstimateCommonness(item) {
    const h = enhHebrewKey(item?.front || item?.hebrew);
    if (ENH_COMMONNESS_EXACT.has(h)) return ENH_COMMONNESS_EXACT.get(h);

    const e = String(item?.english || '').toLowerCase();

    // Very common grammatical/core words.
    if (/\b(this|who|what|why|also|again|still|there is|there are|not|no|one|two|three|four|ten|day|night|man|men|son|daughter|father|brother|hand|eye|head|heart|house|home|land|earth|water|fire|good|big|great|small|said|say|came|come|go|went|saw|see|gave|give|took|take|made|did|do)\b/.test(e)) return 9;

    // Frequent narrative vocabulary.
    if (/\b(walk|run|stand|sit|hear|speak|eat|drink|send|return|find|live|die|remember|guard|city|way|morning|evening|bread|tree|field|mountain|king|master|child|people)\b/.test(e)) return 8;

    // Strong indicators of specialized vocabulary.
    if (/\b(sulfur|furnace|blindness|se'?ah|fine flour|roof beam|grove|bridegroom|son-in-law|last night|ashes|smoke|outcry)\b/.test(e)) return 3;
    if (/\b(linger|urge strongly|profane|district|feast|matzah|dawn|compassion|plain|shade|tender)\b/.test(e)) return 5;

    return 6;
  }

  function enhCommonnessLabel(n) {
    n = Number(n) || 0;
    if (n >= 9) return 'Very common';
    if (n >= 7) return 'Common';
    if (n >= 5) return 'Moderate';
    if (n >= 3) return 'Uncommon';
    return 'Rare';
  }

  function enhExtraLocalArt(item) {
    const text = `${item?.english || ''} ${item?.front || ''}`.toLowerCase();
    const out = [];
    const add = (...xs) => xs.flat().forEach(x => {
      const v = String(x || '').trim();
      if (v && !out.includes(v)) out.push(v);
    });

    // Deliberately direct visual cues for meanings where people are the picture.
    if (/\bbrother\b|\bsibling\b/.test(text)) add('👦 👦','👨 👨','👥','👬','🧑‍🤝‍🧑','🤝');
    if (/\bfather\b/.test(text)) add('👨','👨 👦','👔','🏠','❤️');
    if (/\bmother\b|\bwoman\b|\bwomen\b/.test(text)) add('👩','👩 👩','👥','🏠','🌷');
    if (/\bson\b|\bboy\b|\byouth\b|\blad\b/.test(text)) add('👦','🧒','👨 👦','📘','🏠');
    if (/\bman\b|\bmen\b|\bperson\b|\bpeople\b/.test(text)) add('👨','🧑','👥','🧍','🗣️');

    // "Old" was specifically too abstract before. A cane/elder is more descriptive.
    if (/\bold\b|\belder\b/.test(text)) add('🦯','🧓','👴','⌛','🕰️','📜');

    // Direct action cues that broad people-filtering used to throw away.
    if (/\bstand\b|\bstood\b|standing/.test(text)) add('🧍','🧍‍♂️','📍');
    if (/\brun\b|\bran\b|running/.test(text)) add('🏃','🏃‍♂️','💨','👟');
    if (/\bwalk\b|\bwent\b|walking/.test(text)) add('🚶','🚶‍♂️','👣','🛣️');
    if (/\bbow\b|bowed|prostrate/.test(text)) add('🙇','🧎','⬇️');

    try { add(enhOriginalSmartArtFor(item?.english || '', item?.front || '')); } catch (_) {}
    return enhSanitize(out, 20);
  }

  // Replace the over-broad original sanitizer. Person imagery is no longer discarded;
  // it can be held for teacher approval instead.
  isClassSafeArtChoice = enhHardSafe;
  sanitizeClassArt = values => enhSanitize(values, ENH_MAX_APPROVED);

  function enhHasBadAutoArt(item) {
    const art = Array.isArray(item?.art) ? item.art : [];
    if (item?.autoArt === true) return true;
    if (!art.length && !(item?.pendingArtReview || []).length) return true;
    if (art.some(x => !enhHardSafe(x))) return true;
    return false;
  }
  hasBadAutoArt = enhHasBadAutoArt;

  async function enhGenerateAiArtForItems(items) {
    const clean = (items || []).filter(Boolean).map(i => ({
      id: String(i.id || ''),
      front: String(i.front || ''),
      english: String(i.english || ''),
      avoid: enhUnique([
        ...(Array.isArray(i.art) ? i.art : []),
        ...(Array.isArray(i.pendingArtReview) ? i.pendingArtReview : []),
        ...(Array.isArray(i.rejectedArt) ? i.rejectedArt : [])
      ], 30)
    })).filter(i => i.id && i.english);

    const out = new Map();
    if (!clean.length || !GENERATE_SHORASHIM_ART_URL) return out;

    for (let n = 0; n < clean.length; n += 40) {
      const batch = clean.slice(n, n + 40);
      try {
        const res = await fetch(GENERATE_SHORASHIM_ART_URL, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({items: batch})
        });
        if (!res.ok) throw new Error(`AI art request failed (${res.status})`);
        const data = await res.json();

        for (const row of (data.items || [])) {
          const id = String(row?.id || '');
          if (!id) continue;
          const art = enhSanitize(row?.art, 12);
          const reviewFromService = enhUnique(row?.review, 12).filter(enhHardSafe);
          const review = enhUnique([
            ...reviewFromService,
            ...art.filter(enhNeedsTeacherReview)
          ], 12);
          const commonness = Math.max(1, Math.min(10, Math.round(Number(row?.commonness) || 0))) || null;
          out.set(id, {art, review, commonness});
        }
      } catch (err) {
        console.warn('generateShorashimArt failed; using direct local choices', err);
      }
    }
    return out;
  }
  generateAiArtForItems = enhGenerateAiArtForItems;

  async function enhFillArtForShorashim(items, {force=false, merge=false} = {}) {
    const targets = (items || []).filter(i => force || enhHasBadAutoArt(i));
    if (!targets.length) return 0;

    const ai = await enhGenerateAiArtForItems(targets);
    let changed = 0;

    for (const item of targets) {
      const row = ai.get(String(item.id)) || {};
      const approvedReview = new Set(enhUnique(item.approvedArtReview, 50));
      const rejected = new Set(enhUnique(item.rejectedArt, 50));

      let candidates = enhUnique([
        ...(row.art || []),
        ...enhExtraLocalArt(item)
      ], 30).filter(v => !rejected.has(v) && enhHardSafe(v));

      // On regenerate, truly search for MORE rather than replacing the set with the same 4.
      const existing = enhUnique(item.art, ENH_MAX_APPROVED).filter(enhHardSafe);
      const pendingExisting = enhUnique(item.pendingArtReview, ENH_MAX_PENDING).filter(enhHardSafe);

      const directApproved = [];
      const directPending = [];
      for (const v of candidates) {
        const serviceFlag = (row.review || []).includes(v);
        if ((serviceFlag || enhNeedsTeacherReview(v)) && !approvedReview.has(v)) directPending.push(v);
        else directApproved.push(v);
      }

      const nextApproved = merge
        ? enhUnique([...existing, ...directApproved], ENH_MAX_APPROVED)
        : enhUnique(directApproved, ENH_MAX_APPROVED);

      const nextPending = enhUnique([
        ...(merge ? pendingExisting : []),
        ...directPending
      ], ENH_MAX_PENDING).filter(v => !nextApproved.includes(v));

      item.art = nextApproved;
      item.pendingArtReview = nextPending;
      item.rejectedArt = enhUnique(item.rejectedArt, 50);
      item.autoArt = false;
      item.aiArtGenerated = true;
      item.aiArtGeneratedAt = Date.now();

      if (row.commonness && item.commonnessEstimated !== false) {
        item.commonness = row.commonness;
        item.commonnessEstimated = false;
      } else if (!(Number(item.commonness) >= 1 && Number(item.commonness) <= 10)) {
        item.commonness = enhEstimateCommonness(item);
        item.commonnessEstimated = true;
      }
      changed++;
    }
    return changed;
  }
  fillArtForShorashim = enhFillArtForShorashim;

  function enhMigrateTeacherMetadata() {
    const list = state?.catalog?.shorashim;
    if (!Array.isArray(list) || !list.length) return false;
    let changed = false;

    for (const item of list) {
      if (!(Number(item.commonness) >= 1 && Number(item.commonness) <= 10)) {
        item.commonness = enhEstimateCommonness(item);
        item.commonnessEstimated = true;
        changed = true;
      }

      const approvedReview = new Set(enhUnique(item.approvedArtReview, 50));
      const current = enhUnique(item.art, ENH_MAX_APPROVED).filter(enhHardSafe);
      const pending = enhUnique(item.pendingArtReview, ENH_MAX_PENDING).filter(enhHardSafe);
      const keep = [];
      const newlyPending = [];

      for (const v of current) {
        if (enhNeedsTeacherReview(v) && !approvedReview.has(v)) newlyPending.push(v);
        else keep.push(v);
      }

      const nextPending = enhUnique([...pending, ...newlyPending], ENH_MAX_PENDING);
      if (keep.join('\u0001') !== current.join('\u0001') ||
          nextPending.join('\u0001') !== pending.join('\u0001')) {
        item.art = keep;
        item.pendingArtReview = nextPending;
        changed = true;
      }
    }
    return changed;
  }

  async function enhSetCommonness(id, value) {
    const item = (state.catalog.shorashim || []).find(x => x.id === id);
    if (!item) return;
    const n = Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
    item.commonness = n;
    item.commonnessEstimated = false; // Teacher choice always wins over later AI estimates.
    renderCatalog();
    await saveCatalog();
  }

  async function enhApprovePicture(id, value) {
    const item = (state.catalog[currentTrack] || []).find(x => x.id === id);
    if (!item || !enhHardSafe(value)) return;
    if (!confirm(`Approve ${value} for “${item.front} — ${item.english}”?\n\nOnce approved, students may choose this picture for their card.`)) return;

    item.pendingArtReview = enhUnique(item.pendingArtReview, ENH_MAX_PENDING).filter(x => x !== value);
    item.approvedArtReview = enhUnique([...(item.approvedArtReview || []), value], 50);
    item.rejectedArt = enhUnique(item.rejectedArt, 50).filter(x => x !== value);
    item.art = enhUnique([...(item.art || []), value], ENH_MAX_APPROVED);
    renderCatalog();
    await saveCatalog();
  }

  async function enhRejectPicture(id, value) {
    const item = (state.catalog[currentTrack] || []).find(x => x.id === id);
    if (!item) return;
    item.pendingArtReview = enhUnique(item.pendingArtReview, ENH_MAX_PENDING).filter(x => x !== value);
    item.rejectedArt = enhUnique([...(item.rejectedArt || []), value], 50);
    item.art = enhUnique(item.art, ENH_MAX_APPROVED).filter(x => x !== value);
    renderCatalog();
    await saveCatalog();
  }

  async function enhRemovePictureChoice(id, value) {
    const item = (state.catalog[currentTrack] || []).find(x => x.id === id);
    if (!item) return;
    item.art = enhUnique(item.art, ENH_MAX_APPROVED).filter(x => x !== value);
    item.approvedArtReview = enhUnique(item.approvedArtReview, 50).filter(x => x !== value);
    item.rejectedArt = enhUnique([...(item.rejectedArt || []), value], 50);
    item.autoArt = false;
    renderCatalog();
    await saveCatalog();
  }
  removePictureChoice = enhRemovePictureChoice;

  async function enhRegeneratePictures(id) {
    const item = (state.catalog[currentTrack] || []).find(x => x.id === id);
    if (!item) return;

    const before = new Set([
      ...(item.art || []),
      ...(item.pendingArtReview || [])
    ]);
    status('☁️ Finding more direct picture choices…', 'syncing');
    item.autoArt = true;
    await enhFillArtForShorashim([item], {force:true, merge:true});
    const after = new Set([
      ...(item.art || []),
      ...(item.pendingArtReview || [])
    ]);
    const added = [...after].filter(x => !before.has(x)).length;
    item.autoArt = false;
    renderCatalog();
    await saveCatalog();
    const pending = (item.pendingArtReview || []).length;
    status(added
      ? `☁️ Saved • ${added} new picture choice${added === 1 ? '' : 's'}${pending ? ` • ${pending} awaiting approval` : ''}`
      : `☁️ Saved • No new direct pictures found${pending ? ` • ${pending} awaiting approval` : ''}`);
  }
  regeneratePictures = enhRegeneratePictures;

  function enhRenderCatalog() {
    currentTrack = $('teacherTrack').value;
    refreshNamedLists();
    const chosen = $('teacherListName')?.value || 'Main List',
          perekFilter = $('teacherPerekFilter')?.value || 'all',
          all = state.catalog[currentTrack] || [],
          list = all
            .filter(i => listNameOf(i) === chosen)
            .filter(i => currentTrack !== 'shorashim' || perekFilter === 'all' || perekOf(i) === Number(perekFilter));

    const perekWrap = $('teacherPerekWrap');
    if (perekWrap) perekWrap.classList.toggle('hidden', currentTrack !== 'shorashim');

    $('teacherCatalog').innerHTML = list.map((i, idx) => {
      const art = enhUnique(i.art, ENH_MAX_APPROVED).map(a =>
        `<button type="button" class="teacher-art-chip" data-a="art" data-art="${esc(a)}" title="Click to remove this approved picture">${esc(a)}</button>`
      ).join('');

      const pending = enhUnique(i.pendingArtReview, ENH_MAX_PENDING).map(a =>
        `<span class="enh-review-choice">
           <span class="enh-review-emoji">${esc(a)}</span>
           <button type="button" class="enh-approve" data-a="approve-art" data-art="${esc(a)}">✓ Approve</button>
           <button type="button" class="enh-reject" data-a="reject-art" data-art="${esc(a)}">✕</button>
         </span>`
      ).join('');

      const commonness = Math.max(1, Math.min(10, Number(i.commonness) || enhEstimateCommonness(i)));
      const commonOptions = Array.from({length:10}, (_, n) => n + 1)
        .map(n => `<option value="${n}"${n === commonness ? ' selected' : ''}>${n}</option>`).join('');

      const artBlock = currentTrack === 'shorashim'
        ? `<div class="enh-teacher-meta-row">
             <label class="enh-commonness" title="10 = extremely common/useful throughout Chumash; 1 = very rare or specialized">
               <span>Commonness</span>
               <select data-a="commonness">${commonOptions}</select>
               <small>${enhCommonnessLabel(commonness)}</small>
             </label>
           </div>
           <div class="teacher-art-preview">${art || '<span class="mini-note">No approved pictures yet</span>'}</div>
           ${pending ? `<div class="enh-review-box"><b>⚠ Needs your approval</b><div class="enh-review-list">${pending}</div><div class="mini-note">Students do not see these unless you approve them.</div></div>` : ''}
           <div class="mini-actions">
             <button data-a="regen" class="ghost">↻ Find More Pictures</button>
           </div>`
        : '';

      return `<div class="catalog-teacher-row${i.hidden ? ' hidden-item' : ''}" data-id="${esc(i.id)}">
        <div class="mini-actions"><button data-a="up" ${idx === 0 ? 'disabled' : ''}>▲</button><button data-a="down" ${idx === list.length - 1 ? 'disabled' : ''}>▼</button></div>
        <div class="hebrew">${esc(i.front)}</div>
        <div>
          <b>${esc(i.english)}</b>
          <div class="mini-note">${currentTrack === 'shorashim' ? `<span class="unit-pill">${perekLabel(i)}</span> • ` : ''}${i.pasuk ? `Pasuk ${esc(i.pasuk)} • ` : ''}${i.hidden ? 'Hidden from future learning' : 'Active'} • ${esc(chosen)}</div>
          ${artBlock}
        </div>
        <div class="mini-actions">
          <button data-a="edit" class="ghost">Edit Word</button>
          <button data-a="hide" class="${i.hidden ? 'primary' : 'ghost'}">${i.hidden ? 'Restore' : 'Hide'}</button>
          <button data-a="delete" class="danger catalog-remove-btn">🗑 Delete</button>
        </div>
      </div>`;
    }).join('') || '<p class="mini-note">This list is empty.\nAdd an item or use Bulk Add.</p>';

    [...$('teacherCatalog').querySelectorAll('.catalog-teacher-row')].forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-a=up]').onclick = () => moveNamed(id, -1);
      row.querySelector('[data-a=down]').onclick = () => moveNamed(id, 1);
      row.querySelector('[data-a=edit]').onclick = () => openEdit(id);
      row.querySelector('[data-a=hide]').onclick = () => toggleHide(id);
      row.querySelector('[data-a=delete]').onclick = () => deleteCatalogItem(id);

      const regen = row.querySelector('[data-a=regen]');
      if (regen) regen.onclick = () => enhRegeneratePictures(id);

      const common = row.querySelector('[data-a=commonness]');
      if (common) common.onchange = () => enhSetCommonness(id, common.value);

      row.querySelectorAll('[data-a=art]').forEach(btn => {
        btn.onclick = () => enhRemovePictureChoice(id, btn.dataset.art);
      });
      row.querySelectorAll('[data-a=approve-art]').forEach(btn => {
        btn.onclick = () => enhApprovePicture(id, btn.dataset.art);
      });
      row.querySelectorAll('[data-a=reject-art]').forEach(btn => {
        btn.onclick = () => enhRejectPicture(id, btn.dataset.art);
      });
    });
  }
  renderCatalog = enhRenderCatalog;

  const style = document.createElement('style');
  style.textContent = `
    .enh-teacher-meta-row{display:flex;align-items:center;gap:10px;margin-top:8px}
    .enh-commonness{display:inline-flex;align-items:center;gap:7px;border:1px solid #d9dfeb;background:#f8fafc;border-radius:10px;padding:6px 9px;font-size:13px;font-weight:700}
    .enh-commonness select{font:inherit;font-weight:800;padding:3px 5px;border:1px solid #cbd5e1;border-radius:7px;background:white}
    .enh-commonness small{font-size:11px;font-weight:600;color:#64748b;white-space:nowrap}
    .enh-review-box{margin-top:9px;border:1px solid #f2c766;background:#fff9df;border-radius:11px;padding:9px 10px}
    .enh-review-box>b{font-size:12px;color:#8a5a00}
    .enh-review-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}
    .enh-review-choice{display:inline-flex;align-items:center;gap:5px;background:#fff;border:1px solid #ecd89d;border-radius:10px;padding:4px 5px}
    .enh-review-emoji{font-size:27px;line-height:1.1;min-width:30px;text-align:center}
    .enh-review-choice button{font-size:11px;padding:4px 6px;border-radius:7px}
    .enh-approve{background:#e9f9ee;border:1px solid #8bd0a2;color:#176333}
    .enh-reject{background:#fff0f0;border:1px solid #e3aaaa;color:#8b1e1e}
  `;
  document.head.appendChild(style);

  // Wait until the core has actually loaded the Firebase catalog, then add teacher-only
  // metadata once and persist it. Realtime updates thereafter use the patched renderer.
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    const list = state?.catalog?.shorashim;
    if (Array.isArray(list) && list.length) {
      clearInterval(timer);
      const changed = enhMigrateTeacherMetadata();
      renderCatalog();
      if (changed) {
        try {
          status('☁️ Saving teacher commonness / picture-review data…', 'syncing');
          await saveCatalog();
        } catch (err) {
          console.warn('Could not save Shorashim teacher metadata', err);
        }
      }
      console.info('Shorashim teacher enhancements active:', ENH_VERSION);
    } else if (tries > 60) {
      clearInterval(timer);
    }
  }, 250);
})();
