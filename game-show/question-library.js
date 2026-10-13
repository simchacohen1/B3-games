/*
 * Game Show – Question Library add-on
 * -----------------------------------
 * 1. After questions are saved (generator "Add"/"Replace" or the editor's
 *    "Save changes"), the teacher is asked to name the set.
 * 2. Named sets are kept in a library (Firebase, next to the active set:
 *    <setRef parent>/library) and listed in a "Question library" card on the
 *    Setup tab, where each one can be loaded, renamed or deleted.
 *
 * Install: in teacher.html add this line AFTER the question-generator script:
 *   <script src="question-library.js?v=20261013-1"></script>
 */
(function () {
  'use strict';

  if (typeof window.saveQuestionSet !== 'function' || typeof setRef === 'undefined') {
    console.warn('[question-library] saveQuestionSet/setRef not found – add-on disabled.');
    return;
  }

  const libRef = setRef.parent.child('library');
  const activeIdRef = setRef.parent.child('activeLibraryId');
  const TS = firebase.database.ServerValue.TIMESTAMP;

  let library = {};          // id -> {name, questions, count, updatedAt}
  let activeId = null;       // library entry the current set came from
  let suppressPrompt = false;

  // ---------- helpers ----------
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const clean = items => JSON.parse(JSON.stringify(items || []));   // strips undefined for Firebase
  const fmtDate = t => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent = `
    .ql-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px}
    .ql-modal{background:rgb(10,22,44);color:rgb(255,247,232);border:1px solid rgba(126,200,255,.3);border-radius:18px;padding:22px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:inherit}
    .ql-modal h3{margin:0 0 6px}
    .ql-modal p{margin:0 0 14px;opacity:.8;font-size:.95em}
    .ql-input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.4);color:inherit;border:1px solid rgba(126,200,255,.3);font:inherit;font-size:1em}
    .ql-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px}
    .ql-list{list-style:none;margin:10px 0 0;padding:0;max-height:340px;overflow:auto}
    .ql-item{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid rgba(126,200,255,.18);border-radius:12px;margin-bottom:8px}
    .ql-item.active{border-color:#ffd76a;box-shadow:0 0 0 1px #ffd76a inset}
    .ql-meta{flex:1;min-width:0}
    .ql-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ql-sub{font-size:.82em;opacity:.7}
    .ql-btns{display:flex;gap:4px;flex-shrink:0}
    .ql-empty{opacity:.7;font-size:.95em;margin-top:10px}
    .ql-search{margin-top:10px}\n    #qlImportHelp{margin:8px 0 0;font-size:.82em;opacity:.72}
  `;
  document.head.appendChild(css);

  // ---------- name prompt ----------
  function promptForName(items) {
    const current = activeId && library[activeId];
    const overlay = document.createElement('div');
    overlay.className = 'ql-overlay';
    overlay.innerHTML = `
      <div class="ql-modal" role="dialog" aria-modal="true" aria-labelledby="qlTitle">
        <h3 id="qlTitle">Name this question set</h3>
        <p>${items.length} question${items.length === 1 ? '' : 's'} saved. Give the set a name to keep it in your library.</p>
        <input class="ql-input" id="qlName" maxlength="80" placeholder="e.g. Bereishis 19 – review" value="${esc(current ? current.name : '')}">
        <div class="ql-actions">
          <button class="btn btn-ghost btn-sm" data-act="skip">Not now</button>
          ${current ? `<button class="btn btn-ghost btn-sm" data-act="new">Save as new set</button>` : ''}
          <button class="btn btn-primary btn-sm" data-act="save">${current ? 'Update “' + esc(current.name) + '”' : 'Save to library'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#qlName');
    setTimeout(() => { input.focus(); input.select(); }, 30);

    const close = () => overlay.remove();
    const commit = asNew => {
      const name = input.value.trim();
      if (!name) { input.focus(); input.style.borderColor = '#ff7a7a'; return; }
      if (!asNew && current) {
        // updating: if the name changed to match another set, still update this one
        libRef.child(activeId).update({ name, questions: clean(items), count: items.length, updatedAt: TS })
          .then(close).catch(err => alert('Could not update the library: ' + err.message));
      } else {
        saveNew(name, items).then(close).catch(err => alert('Could not save to the library: ' + err.message));
      }
    };

    overlay.addEventListener('click', e => {
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (e.target === overlay || act === 'skip') close();
      else if (act === 'save') commit(false);
      else if (act === 'new') commit(true);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') commit(false);
      if (e.key === 'Escape') close();
    });
  }

  function saveNew(name, items) {
    const ref = libRef.push();
    return ref.set({ name, questions: clean(items), count: items.length, createdAt: TS, updatedAt: TS })
      .then(() => activeIdRef.set(ref.key));
  }

  // ---------- wrap the existing save ----------
  const originalSave = window.saveQuestionSet;
  window.saveQuestionSet = function (items) {
    return Promise.resolve(originalSave.apply(this, arguments)).then(result => {
      if (!suppressPrompt && Array.isArray(items) && items.length) promptForName(items);
      return result;
    });
  };

  // ---------- library card on the Setup tab ----------
  let card, listEl, searchEl;
  function buildCard() {
    const grid = document.querySelector('#tabSetup .setup-grid') || document.querySelector('#tabSetup');
    if (!grid) return;
    card = document.createElement('section');
    card.className = 'card';
    card.id = 'questionLibraryCard';
    card.innerHTML = `
      <h3>Question library</h3>
      <p class="hint">Saved question sets. Load one to make it the current game.</p>
      <div class="row">
        <button class="btn btn-primary btn-sm" id="qlSaveCurrent">Save current questions…</button>
        <button class="btn btn-ghost btn-sm" id="qlImportClass">Import from another class</button>
      </div>
      <p class="ql-sub" id="qlImportHelp">Copy a saved set from another class into this class’s library. Each class keeps its own copy.</p>
      <input class="ql-input ql-search" id="qlSearch" placeholder="Search sets…" style="display:none">
      <ul class="ql-list" id="qlList"></ul>`;
    // place it right after the "Questions" card
    const qCard = document.getElementById('editBtn') && document.getElementById('editBtn').closest('.card');
    if (qCard && qCard.parentElement === grid) qCard.after(card); else grid.appendChild(card);

    listEl = card.querySelector('#qlList');
    searchEl = card.querySelector('#qlSearch');
    searchEl.addEventListener('input', render);
    card.querySelector('#qlSaveCurrent').addEventListener('click', () => {
      const qs = (typeof questions !== 'undefined' && Array.isArray(questions)) ? questions : [];
      if (!qs.length) { alert('There are no current questions to save.'); return; }
      promptForName(qs);
    });
    card.querySelector('#qlImportClass').addEventListener('click', openClassImport);
    listEl.addEventListener('click', onListClick);
  }

  function render() {
    if (!listEl) return;
    const ids = Object.keys(library).sort((a, b) => (library[b].updatedAt || 0) - (library[a].updatedAt || 0));
    searchEl.style.display = ids.length > 5 ? '' : 'none';
    const term = searchEl.value.trim().toLowerCase();
    const shown = ids.filter(id => !term || String(library[id].name || '').toLowerCase().includes(term));
    if (!ids.length) { listEl.innerHTML = '<li class="ql-empty">No saved sets yet. After you add or generate questions you’ll be asked to name the set.</li>'; return; }
    if (!shown.length) { listEl.innerHTML = '<li class="ql-empty">No sets match your search.</li>'; return; }
    listEl.innerHTML = shown.map(id => {
      const s = library[id];
      const n = s.count || (s.questions ? s.questions.length : 0);
      return `<li class="ql-item${id === activeId ? ' active' : ''}" data-id="${esc(id)}">
        <div class="ql-meta">
          <div class="ql-name" title="${esc(s.name)}">${esc(s.name || 'Untitled set')}</div>
          <div class="ql-sub">${n} question${n === 1 ? '' : 's'}${s.updatedAt ? ' · ' + fmtDate(s.updatedAt) : ''}${id === activeId ? ' · <b>in use</b>' : ''}</div>
        </div>
        <div class="ql-btns">
          <button class="btn btn-primary btn-sm" data-act="load">Load</button>
          <button class="btn btn-ghost btn-sm" data-act="rename" title="Rename">✎</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" title="Delete">🗑</button>
        </div>
      </li>`;
    }).join('');
  }

  function onListClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.ql-item').getAttribute('data-id');
    const set = library[id];
    if (!set) return;
    const act = btn.getAttribute('data-act');

    if (act === 'load') {
      const qs = set.questions || [];
      if (!qs.length) { alert('This set has no questions.'); return; }
      if (!confirm('Replace the current questions with “' + set.name + '” (' + qs.length + ' questions)?')) return;
      suppressPrompt = true;
      Promise.resolve(originalSave(clean(qs)))
        .then(() => activeIdRef.set(id))
        .catch(err => alert('Could not load the set: ' + err.message))
        .finally(() => { suppressPrompt = false; });
    } else if (act === 'rename') {
      const name = prompt('Rename question set:', set.name || '');
      if (name && name.trim()) libRef.child(id).update({ name: name.trim(), updatedAt: TS });
    } else if (act === 'delete') {
      if (!confirm('Delete “' + set.name + '” from the library? The game’s current questions are not affected.')) return;
      libRef.child(id).remove();
      if (id === activeId) activeIdRef.remove();
    }
  }


  // ---------- copy a saved set from another permitted class ----------
  async function openClassImport() {
    const allowed = Array.isArray(window.gameShowLibraryClassIds) ? window.gameShowLibraryClassIds : [];
    const currentClass = (typeof GS_CLASS !== 'undefined' && GS_CLASS) ? GS_CLASS : '';
    const sourceIds = [...new Set(allowed.map(String))].filter(id => id && id !== currentClass && /^[A-Za-z0-9_-]{1,100}$/.test(id));
    if (!sourceIds.length) {
      alert('No other class is available to share questions with. Ask the admin to assign you to both classes.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ql-overlay';
    overlay.innerHTML = `
      <div class="ql-modal" role="dialog" aria-modal="true" aria-labelledby="qlImportTitle">
        <h3 id="qlImportTitle">Import questions from another class</h3>
        <p>Choose a class, then copy one of its saved sets into this class’s library. The original stays unchanged.</p>
        <select class="ql-input" id="qlSourceClass" aria-label="Source class"></select>
        <ul class="ql-list" id="qlSourceSets"><li class="ql-empty">Loading classes…</li></ul>
        <div class="ql-actions"><button class="btn btn-ghost btn-sm" data-act="close">Close</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-act="close"]')) close(); });
    const select = overlay.querySelector('#qlSourceClass');
    const sourceList = overlay.querySelector('#qlSourceSets');
    const workspaceId = window.B3SiteSettings && window.B3SiteSettings.workspaceId;
    if (!workspaceId) {
      sourceList.innerHTML = '<li class="ql-empty">Could not identify the teacher workspace.</li>';
      return;
    }

    const classRows = {};
    await Promise.all(sourceIds.map(async id => {
      try {
        const snap = await db.ref('b3Games/workspaces/' + workspaceId + '/classes/' + id).once('value');
        const row = snap.val();
        if (row && row.active !== false) classRows[id] = row;
      } catch (err) { console.warn('[question-library] cannot read source class:', id, err.message); }
    }));
    const visibleIds = sourceIds.filter(id => classRows[id]);
    if (!visibleIds.length) {
      sourceList.innerHTML = '<li class="ql-empty">No accessible source classes were found.</li>';
      return;
    }
    select.innerHTML = visibleIds.map(id => '<option value="' + esc(id) + '">' + esc(classRows[id].name || id) + '</option>').join('');

    async function showSets() {
      sourceList.innerHTML = '<li class="ql-empty">Loading saved sets…</li>';
      const id = select.value;
      try {
        const snap = await db.ref('questionSets/classes/' + id + '/set/library').once('value');
        const sets = snap.val() || {};
        const entries = Object.keys(sets).map(setId => ({ id: setId, set: sets[setId] || {} }))
          .filter(x => Array.isArray(x.set.questions) && x.set.questions.length)
          .sort((a,b) => (b.set.updatedAt || 0) - (a.set.updatedAt || 0));
        if (!entries.length) {
          sourceList.innerHTML = '<li class="ql-empty">This class has no saved question sets yet.</li>';
          return;
        }
        sourceList.innerHTML = entries.map(x => {
          const n = x.set.questions.length;
          return '<li class="ql-item"><div class="ql-meta"><div class="ql-name">' + esc(x.set.name || 'Untitled set') +
            '</div><div class="ql-sub">' + n + ' question' + (n === 1 ? '' : 's') + '</div></div>' +
            '<div class="ql-btns"><button class="btn btn-primary btn-sm" data-copy="' + esc(x.id) + '">Copy here</button></div></li>';
        }).join('');
        sourceList.onclick = async e => {
          const button = e.target.closest('button[data-copy]');
          if (!button) return;
          button.disabled = true;
          const sourceSetId = button.getAttribute('data-copy');
          const source = sets[sourceSetId];
          if (!source || !Array.isArray(source.questions) || !source.questions.length) {
            button.disabled = false;
            alert('That set is no longer available.');
            return;
          }
          const duplicate = Object.keys(library).some(localSetId =>
            library[localSetId] && library[localSetId].copiedFrom && library[localSetId].copiedFrom.classId === id && library[localSetId].copiedFrom.setId === sourceSetId);
          if (duplicate) {
            button.disabled = false;
            alert('This set has already been copied into this class library.');
            return;
          }
          const newRef = libRef.push();
          const copy = {
            name: source.name || 'Imported question set',
            questions: clean(source.questions),
            count: source.questions.length,
            createdAt: TS,
            updatedAt: TS,
            copiedFrom: { classId: id, className: classRows[id].name || id, setId: sourceSetId }
          };
          try {
            await newRef.set(copy);
            close();
            alert('Copied ' + copy.count + ' questions into this class library. Load the set when you are ready to use it.');
          } catch (err) {
            button.disabled = false;
            alert('Could not copy this set: ' + err.message);
          }
        };
      } catch (err) {
        sourceList.innerHTML = '<li class="ql-empty">Could not load that class’s library.</li>';
        console.warn('[question-library] cannot load source library:', err.message);
      }
    }
    select.addEventListener('change', showSets);
    await showSets();
  }

  // ---------- live data ----------
  libRef.on('value', snap => { library = snap.val() || {}; render(); },
    err => console.warn('[question-library] cannot read library:', err.message));
  activeIdRef.on('value', snap => { activeId = snap.val(); render(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { buildCard(); render(); });
  else { buildCard(); render(); }
})();
