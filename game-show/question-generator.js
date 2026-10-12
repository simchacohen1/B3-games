/* Source-backed Game Show question generator.
 * Questions are built from Sefaria translations and references returned by its API.
 * It does not paraphrase or invent Torah claims; every generated answer keeps the cited source text for teacher review.
 */
(function () {
  "use strict";
  const books = {
    Genesis: { label: "Bereishis" }, Exodus: { label: "Shemos" },
    Leviticus: { label: "Vayikra" }, Numbers: { label: "Bamidbar" },
    Deuteronomy: { label: "Devarim" }
  };
  const api = "https://www.sefaria.org";
  const nameMap = {
    "the lord": "Hashem", "god": "Hashem",
    "moses": "Moshe", "abraham": "Avraham", "isaac": "Yitzchak",
    "jacob": "Yaakov", "joseph": "Yosef", "aaron": "Aharon",
    "sarah": "Sarah", "rebecca": "Rivkah", "rebekah": "Rivkah",
    "leah": "Leah", "rachel": "Rachel", "noah": "Noach", "esau": "Esav",
    "pharaoh": "Paroh", "reuben": "Reuven", "simeon": "Shimon",
    "judah": "Yehudah", "naphtali": "Naftali",
    "gad": "Gad", "asher": "Asher", "issachar": "Yissachar",
    "zebulun": "Zevulun", "benjamin": "Binyamin", "ephraim": "Ephraim",
    "manasseh": "Menashe", "miriam": "Miriam", "joshua": "Yehoshua",
    "balaam": "Bilam", "laban": "Lavan", "jethro": "Yisro"
  };
  const localizeText = value => String(value || "").replace(/\b(the lord|god|moses|abraham|isaac|jacob|joseph|aaron|sarah|rebecca|rebekah|leah|rachel|noah|esau|pharaoh|reuben|simeon|judah|naphtali|gad|asher|issachar|zebulun|benjamin|ephraim|manasseh|miriam|joshua|balaam|laban|jethro)\b/gi, word => nameMap[word.toLowerCase()] || word);
  const displayRef = ref => {
    const match = String(ref || "").match(/^(Rashi on )?(Genesis|Exodus|Leviticus|Numbers|Deuteronomy)(?=\s)/);
    if (!match) return ref;
    const title = books[match[2]].label;
    return (match[1] || "") + title + String(ref).slice(match[0].length);
  };
  const bookNames = Object.keys(books);
  let jsonpCounter = 0;
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const callback = "__sefariaJsonp" + (++jsonpCounter);
      const script = document.createElement("script");
      const timer = setTimeout(() => finish(new Error("Sefaria request timed out.")), 15000);
      function finish(error, data) {
        clearTimeout(timer);
        delete window[callback];
        script.remove();
        if (error) reject(error); else resolve(data);
      }
      window[callback] = data => finish(null, data);
      script.onerror = () => finish(new Error("Sefaria could not return source data."));
      script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + callback;
      document.head.appendChild(script);
    });
  }
  async function sefariaJson(url) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Sefaria request failed.");
      return await response.json();
    } catch (_) {
      return jsonp(url);
    }
  }
  const indexCache = new Map();
  const chapterCache = new Map();
  async function getBookIndex(book) {
    if (indexCache.has(book)) return indexCache.get(book);
    const data = await sefariaJson(api + "/api/v2/raw/index/" + encodeURIComponent(book));
    const chapters = Number(data?.schema?.lengths?.[0]);
    if (!Number.isInteger(chapters) || chapters < 1) throw new Error("Sefaria did not return valid perek information.");
    const result = { chapters };
    indexCache.set(book, result);
    return result;
  }
  async function getChapter(book, chapter) {
    const key = book + ":" + chapter;
    if (chapterCache.has(key)) return chapterCache.get(key);
    const ref = book + " " + chapter;
    const data = await sefariaJson(api + "/api/v3/texts/" + encodeURIComponent(ref) + "?version=english");
    const version = (data?.versions || []).find(v => v.language === "en") || (data?.versions || [])[0];
    const raw = version?.text ?? data?.text;
    const verses = Array.isArray(raw) ? raw.flat(Infinity).map(cleanText) : [];
    if (!verses.length) throw new Error("Sefaria did not return verse-by-verse text for " + books[book].label + " " + chapter + ".");
    const result = { data, verses };
    chapterCache.set(key, result);
    return result;
  }
  function evenlyPick(items, count) {
    const wanted = Math.max(0, Math.min(items.length, count));
    if (wanted === items.length) return items.slice();
    const indexes = new Set();
    for (let i = 0; i < wanted; i++) indexes.add(wanted === 1 ? Math.floor((items.length - 1) / 2) : Math.round(i * (items.length - 1) / (wanted - 1)));
    return [...indexes].sort((a,b)=>a-b).map(index => items[index]);
  }
  function distribute(items, count) {
    if (!items.length || count < 1) return [];
    if (count <= items.length) return evenlyPick(items, count);
    return Array.from({ length: count }, (_, i) => items[Math.round(i * (items.length - 1) / (count - 1 || 1))]);
  }
  function optionsFor(select, values, selected) {
    select.replaceChildren(...values.map(value => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = String(value);
      option.selected = String(value) === String(selected);
      return option;
    }));
  }
  const esc = value => String(value || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const cleanText = value => {
    if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(" ");
    if (typeof value !== "string") return "";
    const el = document.createElement("div");
    el.innerHTML = value;
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  };
  const versionsText = data => {
    const version = (data && data.versions || []).find(v => v.language === "en") || (data && data.versions || [])[0];
    return version ? cleanText(version.text) : "";
  };
  async function getText(ref) {
    const data = await sefariaJson(api + "/api/v3/texts/" + encodeURIComponent(ref) + "?version=english");
    const text = versionsText(data);
    if (!text) throw new Error("No English text is available for " + ref + ".");
    return { ref: data.ref || ref, text };
  }
  function phrase(text) {
    const words = text.replace(/[“”"]/g, "").split(/\s+/).filter(Boolean);
    return words.slice(0, Math.min(7, words.length)).join(" ");
  }
  function questionRecord(q, ans, choices, correctNumber) {
    const item = { q: String(q || "").trim(), ans: String(ans || "").trim() };
    const options = Array.isArray(choices) ? choices.map(choice => String(choice || "").trim()).filter(Boolean) : [];
    const correct = Number(correctNumber);
    if (options.length) {
      item.choices = options;
      if (Number.isInteger(correct) && correct > 0 && correct <= options.length) item.correctIndex = correct - 1;
    }
    return item;
  }
  function questionAndAnswer(source, topic) {
    const text = localizeText(source.text).replace(/\\s+/g, " ").trim();
    if (topic) return { q: "What does this source say about " + topic + "?", answer: text };
    if (source.isRashi) return { q: "What does Rashi explain about this pasuk?", answer: text };

    const subject = "(Hashem|Moshe|Avraham|Yitzchak|Yaakov|Yosef|Aharon|Sarah|Rivkah|Leah|Rachel|Noach|Esav|Paroh|Reuven|Shimon|Yehudah|Naftali|Gad|Asher|Yissachar|Zevulun|Binyamin|Ephraim|Menashe|Miriam|Yehoshua|Bilam|Lavan|Yisro)";
    const verbs = {
      saw: "see", said: "say", spoke: "say", appeared: "appear", called: "call", divided: "separate",
      separated: "separate", created: "create", made: "make", blessed: "bless",
      commanded: "command", took: "take", gave: "give", brought: "bring",
      asked: "ask", answered: "answer", found: "find", heard: "hear",
      built: "build", opened: "open", closed: "close", sent: "send",
      placed: "place", put: "put", ate: "eat", drank: "drink"
    };
    const verbPattern = Object.keys(verbs).join("|");
    const match = text.match(new RegExp("(?:^|[;.!?]\\s*)(?:And\\s+)?"+subject+"\\s+("+verbPattern+")\\s+(.+)", "i"));
    if (!match) return { q: "What happens in this pasuk?", answer: text };

    const name = match[1], verb = match[2].toLowerCase();
    let clause = match[3].split(/[;.!?]/)[0].trim();
    clause = clause.replace(/,\\s+and\\s+(?:Hashem|Moshe|Avraham|Yitzchak|Yaakov|Yosef|Aharon|Sarah|Rivkah|Leah|Rachel|Noach|Esav|Paroh)\\b[\\s\\S]*$/i, "").trim();
    if (!clause) return { q: "What happens in this pasuk?", answer: text };

    if (verb === "appeared") {
      const target = clause.match(/^to\\s+(.+?)(?:\\s+by\\s+|[,.]|$)/i);
      if (target) return { q: "Who appeared to " + target[1] + "?", answer: name };
    }
    if (verb === "called") {
      const called = clause.match(/^(?:the\\s+)?(light|darkness)\\s+([A-Z][A-Za-z]+)/i);
      if (called) return { q: "What did " + name + " call the " + called[1].toLowerCase() + "?", answer: called[2] };
      return { q: "What name did " + name + " give?", answer: clause };
    }
    return { q: "What did " + name + " " + verbs[verb] + "?", answer: clause };
  }

  function shortChoice(value) {
    const words = String(value || "").replace(/\\s+/g, " ").trim().split(" ").filter(Boolean);
    return words.length > 12 ? words.slice(0, 12).join(" ") + "…" : words.join(" ");
  }

  function makeItems(sources, mode, topic, count, distractors) {
    const out = [];
    const selected = sources.slice(0, count);
    const choiceSources = distractors && distractors.length ? distractors : sources;
    selected.forEach((source, index) => {
      const ref = source.displayRef || displayRef(source.ref);
      const qa = questionAndAnswer(source, topic);
      if (mode === "open") {
        out.push({ q: qa.q, ans: qa.answer + " (Source: " + ref + ")" });
      } else {
        const correctExcerpt = localizeText(shortChoice(qa.answer));
        const optionRows = correctExcerpt ? [{ excerpt: correctExcerpt, ref: source.ref }] : [];
        for (let offset = 1; offset <= choiceSources.length && optionRows.length < 4; offset++) {
          const candidate = choiceSources[(index + offset) % choiceSources.length];
          if (candidate.ref === source.ref) continue;
          const candidateAnswer = questionAndAnswer(candidate, topic).answer;
          const excerpt = localizeText(shortChoice(candidateAnswer));
          if (excerpt && !optionRows.some(row => row.excerpt === excerpt)) optionRows.push({ excerpt, ref: candidate.ref });
        }
        if (optionRows.length < 4) throw new Error("Multiple choice needs four distinct Sefaria excerpts. Select at least four pesukim or sources.");
        const correctIndex = optionRows.findIndex(row => row.ref === source.ref || row.excerpt === correctExcerpt);
        if (correctIndex < 0) throw new Error("Could not match this question to its verified source. Please try again.");
        out.push({
          q: qa.q,
          ans: qa.answer + " (Source: " + ref + ")",
          choices: optionRows.map(row => row.excerpt),
          correctIndex
        });
      }
    });
    return out;
  }
  async function chumashSources(form, status, count) {
    const book = form.book.value;
    const chapter = Number(form.chapter.value), from = Number(form.from.value), to = Number(form.to.value);
    if (!bookNames.includes(book) || !chapter || !from || !to || to < from) throw new Error("Choose a valid sefer, perek, and pasuk range.");
    const chapterData = await getChapter(book, chapter);
    if (chapter > (await getBookIndex(book)).chapters || to > chapterData.verses.length) throw new Error("Choose a perek and pasuk range that exists in this sefer.");
    const verseRows = [];
    for (let verse = from; verse <= to; verse++) {
      const text = chapterData.verses[verse - 1];
      if (!text) continue;
      const ref = book + " " + chapter + ":" + verse;
      verseRows.push({ ref, displayRef: books[book].label + " " + chapter + ":" + verse, text });
    }
    if (!verseRows.length) throw new Error("Sefaria returned no English text for the selected pesukim.");
    const includeRashi = form.rashi.checked;
    const sourcePool = verseRows.slice();
    if (includeRashi) {
      for (const source of evenlyPick(verseRows, Math.min(verseRows.length, count))) {
        status.textContent = "Checking Rashi for " + source.displayRef + "…";
        try {
          const rashi = await getText("Rashi on " + source.ref);
          if (rashi.text) sourcePool.push({ ...rashi, displayRef: "Rashi on " + source.displayRef, isRashi: true });
        } catch (_) {}
      }
    }
    const selected = distribute(sourcePool, count);
    selected.distractors = verseRows;
    return selected;
  }
  async function halachaSources(form, status, count) {
    const topic = form.topic.value.trim();
    if (topic.length < 2) throw new Error("Type a halacha topic, such as Shabbat or berachot.");
    status.textContent = "Searching Sefaria for sources about " + topic + "…";
    const response = await fetch(api + "/api/search-wrapper", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: topic, type: "text", field: "naive_lemmatizer", size: 33, sort_method: "score", sort_fields: ["pagesheetrank"] })
    });
    if (!response.ok) throw new Error("Sefaria search did not complete.");
    const data = await response.json();
    const hits = data?.hits?.hits || data?.hits || data?.results || [];
    const refs = [...new Set(hits.map(hit => hit?.ref || hit?._source?.ref || hit?.source?.ref).filter(Boolean))].slice(0, 33);
    if (!refs.length) throw new Error("Sefaria found no source references for that topic. Try a different topic.");
    const rows = [];
    for (const ref of refs) {
      try { rows.push(await getText(ref)); } catch (_) {}
      status.textContent = "Checking Sefaria source " + rows.length + "…";
      if (rows.length >= count && rows.length >= 4) break;
    }
    if (!rows.length) throw new Error("Sefaria returned references without an English source text.");
    rows.forEach(row => { row.displayRef = displayRef(row.ref); });
    return rows;
  }
  function inject() {
    const setup = document.getElementById("tabSetup");
    const editor = document.getElementById("editorList");
    if (!setup || !editor || !window.createQuestionRow) return;
    const card = document.createElement("section");
    card.className = "card";
    card.id = "sefariaGenerator";
    card.style.cssText = "margin:14px 0;padding:16px";
    card.innerHTML = '<h3>Generate questions from Sefaria</h3>' +
      '<p class="hint">Source text and references are checked against Sefaria. Review and edit every question before saving it.</p>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px;align-items:end">' +
      '<label>Source type<select id="sgType" class="select"><option value="chumash">Chumash</option><option value="halacha">Halacha topic</option></select></label>' +
      '<label>Sefer<select id="sgBook" class="select">' + bookNames.map(b => '<option value="' + b + '">' + books[b].label + '</option>').join("") + '</select></label>' +
      '<label>Perek<select id="sgChapter" class="select"><option>Loading…</option></select></label>' +
      '<label>First pasuk<select id="sgFrom" class="select"><option>Loading…</option></select></label>' +
      '<label>Last pasuk<select id="sgTo" class="select"><option>Loading…</option></select></label>' +
      '<label>Question count<select id="sgCount" class="select">' + Array.from({length:33},(_,i)=>'<option value="' + (i+1) + '"' + (i===9?' selected':'') + '>' + (i+1) + '</option>').join("") + '</select></label>' +
      '<label>Halacha topic<input id="sgTopic" class="input" type="search" placeholder="e.g. Shabbat"></label>' +
      '<label><input id="sgRashi" type="checkbox"> Include Rashi</label>' +
      '<label>Question style<select id="sgMode" class="select"><option value="open">Open answer</option><option value="mc">Multiple choice</option></select></label>' +
      '</div><div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<button class="btn btn-good" type="button" id="sgGenerate">Generate and review</button><span id="sgStatus" role="status" aria-live="polite"></span></div>';
    const review = document.createElement("section");
    review.id = "sgReview";
    review.hidden = true;
    review.style.cssText = "margin-top:18px;padding-top:16px;border-top:1px solid var(--line)";
    review.innerHTML = '<h4 style="margin:0 0 6px;font-size:18px">Review generated questions</h4>' +
      '<p class="hint">Edit or delete questions here. Multiple-choice questions include four source-based options, with the correct choice preselected. Save Questions replaces the current question set.</p>' +
      '<div id="sgQuestionList"></div>' +
      '<button class="btn btn-primary" type="button" id="sgSave">Save Questions</button>';
    card.appendChild(review);
    card.querySelector("#sgSave").addEventListener("click", () => {
      const rows = [...review.querySelectorAll("#sgQuestionList > .editor-row")];
      const items = rows.map(row => {
        const choices = (row.querySelector(".row-choices")?.value || "").split(/\r?\n/);
        return questionRecord(
          row.querySelector(".row-q").value,
          row.querySelector(".row-ans").value,
          choices,
          row.querySelector(".row-correct")?.value
        );
      }).filter(item => item.q || item.ans);
      if (!items.length) {
        status.textContent = "Add at least one question before saving.";
        return;
      }
      const editorList = document.getElementById("editorList");
      editorList.replaceChildren(...items.map(item => window.createQuestionRow(item.q, item.ans, item.choices, item.correctIndex)));
      window.saveEditor();
      status.textContent = "Saving " + items.length + " questions…";
    });
    const setupGrid = setup.querySelector(".setup-grid");
    (setupGrid || setup).insertAdjacentElement("afterend", card);
    const type = card.querySelector("#sgType");
    const updateFields = () => {
      const halacha = type.value === "halacha";
      card.querySelector("#sgBook").parentElement.hidden = halacha;
      card.querySelector("#sgChapter").parentElement.hidden = halacha;
      card.querySelector("#sgFrom").parentElement.hidden = halacha;
      card.querySelector("#sgTo").parentElement.hidden = halacha;
      card.querySelector("#sgTopic").parentElement.hidden = !halacha;
      card.querySelector("#sgRashi").parentElement.hidden = halacha;
    };
    const bookSelect = card.querySelector("#sgBook");
    const chapterSelect = card.querySelector("#sgChapter");
    const fromSelect = card.querySelector("#sgFrom");
    const toSelect = card.querySelector("#sgTo");
    const status = card.querySelector("#sgStatus");
    async function updateChapters() {
      try {
        status.textContent = "Loading perek list from Sefaria…";
        const { chapters } = await getBookIndex(bookSelect.value);
        optionsFor(chapterSelect, Array.from({length:chapters},(_,i)=>i+1), 1);
        await updateVerses();
      } catch (error) { status.textContent = error.message || "Could not load perakim."; }
    }
    async function updateVerses() {
      try {
        const data = await getChapter(bookSelect.value, Number(chapterSelect.value));
        const total = data.verses.length;
        optionsFor(fromSelect, Array.from({length:total},(_,i)=>i+1), 1);
        optionsFor(toSelect, Array.from({length:total},(_,i)=>i+1), total);
        status.textContent = "Perek " + chapterSelect.value + " has " + total + " pesukim.";
      } catch (error) { status.textContent = error.message || "Could not load pasuk range."; }
    }
    bookSelect.addEventListener("change", updateChapters);
    chapterSelect.addEventListener("change", updateVerses);
    type.addEventListener("change", updateFields);
    updateFields();
    updateChapters();
    card.querySelector("#sgGenerate").addEventListener("click", async () => {
      const button = card.querySelector("#sgGenerate"), status = card.querySelector("#sgStatus");
      button.disabled = true;
      try {
        const mode = card.querySelector("#sgMode").value;
        const requestedCount = Number(card.querySelector("#sgCount").value) || 10;
        const sources = type.value === "chumash" ? await chumashSources({
          book:card.querySelector("#sgBook"),chapter:card.querySelector("#sgChapter"),
          from:card.querySelector("#sgFrom"),to:card.querySelector("#sgTo"),
          rashi:card.querySelector("#sgRashi")
        },status,requestedCount) : await halachaSources({topic:card.querySelector("#sgTopic")},status,requestedCount);
        const topic = type.value === "halacha" ? card.querySelector("#sgTopic").value.trim() : "";
        const items = makeItems(sources, mode, topic, requestedCount, sources.distractors);
        const list = review.querySelector("#sgQuestionList");
        list.replaceChildren(...items.map(item => window.createQuestionRow(item.q, item.ans, item.choices, item.correctIndex)));
        review.hidden = false;
        status.textContent = items.length + " source-based questions are ready to review below.";
        review.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        status.textContent = error.message || "Could not generate questions.";
      } finally { button.disabled = false; }
    });
  }
  window.FunTorahSefariaGeneratorCore = Object.freeze({ makeItems, questionAndAnswer, questionRecord, shortChoice, phrase, cleanText, localizeText, displayRef, evenlyPick, distribute });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
  else inject();
})();
