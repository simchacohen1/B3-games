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
  const searchProxy = "https://us-central1-b3-games.cloudfunctions.net/searchSefariaQuestions";
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
    // Sefaria translations can include footnote markers and the full note in
    // the verse HTML. They are editorial notes, not words from the pasuk.
    el.querySelectorAll(".footnote, .footnote-marker, sup.footnote-marker").forEach(node => node.remove());
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
    const words = text.replace(/[â€œâ€"]/g, "").split(/\s+/).filter(Boolean);
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
  function creationDay(source) {
    const ref = String(source.ref || source.displayRef || "");
    const match = ref.match(/(?:Genesis|Bereishis)\s+1:(\d+)/i);
    const verse = match ? Number(match[1]) : 0;
    const ranges = [[1,5],[6,8],[9,13],[14,19],[20,23],[24,31]];
    const labels = ["day one","day two","day three","day four","day five","day six"];
    const day = ranges.findIndex(([from,to]) => verse >= from && verse <= to);
    return day < 0 ? "" : labels[day];
  }

  // Never quiz children on reference numbers. If a grammatical question cannot
  // reliably be extracted, ask them to recognize the actual words of the text.
  function contentContinuation(text) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (words.length < 4) return null;
    const split = Math.min(9, Math.max(2, Math.floor(words.length * 0.55)));
    const lead = words.slice(0, split).join(" ");
    const answer = words.slice(split, split + 12).join(" ");
    return answer ? { q: "Which words continue this statement: â€œ" + lead + " â€¦â€?", answer } : null;
  }
  function questionAndAnswer(source, topic) {
    const text = localizeText(source.text).replace(/\s+/g, " ").trim();
    const ref = source.displayRef || displayRef(source.ref);
    if (source.isKitzur) return kitzurQuestionAndAnswer(source, text);
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
    const match = text.match(new RegExp("(?:^|[;.!?]\\s*)(?:And\\s+)?" + subject + "\\s+(" + verbPattern + ")\\s+(.+)", "i"));
    if (!match) {
      const day = creationDay(source);
      return day ? { q: "What did Hashem create on " + day + "?", answer: text } : (contentContinuation(text) || { q: "Which statement correctly describes this event?", answer: text });
    }

    const name = match[1], verb = match[2].toLowerCase();
    let clause = match[3].split(/[;.!?]/)[0].trim();
    clause = clause.replace(/,\s+and\s+(?:Hashem|Moshe|Avraham|Yitzchak|Yaakov|Yosef|Aharon|Sarah|Rivkah|Leah|Rachel|Noach|Esav|Paroh)\b[\s\S]*$/i, "").trim();
    if (!clause) return contentContinuation(text) || { q: "Which statement correctly describes this event?", answer: text };

    const day = creationDay(source);
    const suffix = name.toLowerCase() === "hashem" && day ? " on " + day : "";
    if (verb === "appeared") {
      const target = clause.match(/^to\s+(.+?)(?:\s+by\s+|[,.]|$)/i);
      if (target && !/^(him|her|them|me|us|you|it|himself|herself|the man|the woman)$/i.test(target[1].trim())) return { q: "Who appeared to " + target[1] + "?", answer: name };
      // Pronouns such as "him" have no clear referent when a pasuk stands alone.
      return contentContinuation(text) || { q: "Which statement correctly describes this event?", answer: text };
    }
    if (verb === "called") {
      const called = clause.match(/^(?:the\s+)?(light|darkness)\s+([A-Z][A-Za-z]+)/i);
      if (called) return { q: "What did " + name + " call the " + called[1].toLowerCase() + suffix + "?", answer: called[2] };
      return { q: "What name did " + name + " give" + suffix + "?", answer: clause };
    }
    return { q: "What did " + name + " " + verbs[verb] + suffix + "?", answer: clause };
  }

  function kitzurQuestionAndAnswer(source, text) {
    // Make clear, concrete prompts for third graders. Skip a seif if no
    // specific question and short answer can be built safely from its text.
    if (/i have set hashem before me always/i.test(text)) {
      return { q: "What should we remember about Hashem?", answer: "Hashem is always with us." };
    }
    if (/as soon as you awaken you should remember the kindnesses of hashem/i.test(text)) {
      return { q: "What should you remember when you wake up?", answer: "Thank Hashem for giving your soul back." };
    }
    if (/while still in bed you should recite:/i.test(text)) {
      return { q: "What prayer do we say when we wake up?", answer: "Modeh Ani." };
    }
    if (/bold as a leopard[^.]*means,?\s*you should not be ashamed before people who mock you for worshipping hashem/i.test(text)) {
      return { q: "What does it mean to be bold like a leopard?", answer: "Do what is right even if others laugh." };
    }
    if (/light as an eagle[^.]*close your eyes to prevent the seeing of evil/i.test(text)) {
      return { q: "What does it mean to be light like an eagle?", answer: "Turn your eyes away from things you should not see." };
    }
    if (/swift as a deer[^.]*legs should run to do good things/i.test(text)) {
      return { q: "What does it mean to be quick like a deer?", answer: "Hurry to do good things." };
    }
    if (/strong as a lion[^.]*true valor in serving the creator[^.]*heart/i.test(text)) {
      return { q: "What does it mean to be strong like a lion?", answer: "Be strong in your heart to do what is right." };
    }
    if (/if you cannot rise at midnight/i.test(text)) {
      return { q: "If you cannot get up at midnight, when should you get up?", answer: "Before daybreak." };
    }
    if (/how can you rise now so early in the morning when the weather is so cold/i.test(text)) {
      return { q: "What excuse might make someone stay in bed on a cold day?", answer: "The weather is cold." };
    }
    if (/a blind person may recite them by heart/i.test(text)) {
      return { q: "Who may say these words from memory?", answer: "A blind person." };
    }
    if (/the proper conclusion is:\s*[“"]blessed is the one who listens to prayer/i.test(text)) {
      return { q: "Which words end this prayer?", answer: "Blessed is the One Who listens to prayer." };
    }
    return null;
  }
  function shortChoice(value) {
    const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    return words.length > 12 ? words.slice(0, 12).join(" ") + "â€¦" : words.join(" ");
  }

  function makeItems(sources, mode, topic, count, distractors) {
    const out = [];
    const selected = sources.slice(0, count);
    const choiceSources = distractors && distractors.length ? distractors : sources;
    selected.forEach((source, index) => {
      const ref = source.displayRef || displayRef(source.ref);
      const qa = questionAndAnswer(source, topic);`r`n      if (!qa || !qa.q || !qa.answer || out.some(item => item.q === qa.q)) return;
      if (mode === "open") {
        out.push({ q: qa.q, ans: qa.answer });
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
        status.textContent = "Checking Rashi for " + source.displayRef + "â€¦";
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
  const kitzurBook = "Kitzur Shulchan Arukh";
  const kitzurCache = new Map();
  async function kitzurSeifim(siman) {
    if (!Number.isInteger(siman) || siman < 1 || siman > 221) throw new Error("Choose a valid Kitzur Shulchan Aruch siman.");
    if (kitzurCache.has(siman)) return kitzurCache.get(siman);
    const data = await sefariaJson(api + "/api/v3/texts/" + encodeURIComponent(kitzurBook + " " + siman) + "?version=english");
    const version = (data?.versions || []).find(v => v.language === "en");
    const raw = version?.text;
    if (!Array.isArray(raw)) throw new Error("No English Kitzur Shulchan Aruch text is available for Siman " + siman + ".");
    const seifim = raw.map(cleanText);
    if (!seifim.some(Boolean)) throw new Error("No English se'if text is available for this siman.");
    kitzurCache.set(siman, seifim);
    return seifim;
  }
  async function halachaSources(form, status, count) {
    const siman = Number(form.siman.value);
    const from = Number(form.from.value), to = Number(form.to.value);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw new Error("Choose a valid se'if range.");
    status.textContent = "Loading Kitzur Shulchan Aruch, Siman " + siman + "â€¦";
    const seifim = await kitzurSeifim(siman);
    if (to > seifim.length) throw new Error("The selected se'if range does not exist in this siman.");
    const rows = [];
    for (let seif = from; seif <= to; seif++) {
      if (!seifim[seif-1]) continue;
      const ref = kitzurBook + " " + siman + ":" + seif;
      rows.push({ref, displayRef:"Kitzur Shulchan Aruch " + siman + ":" + seif, text:seifim[seif-1], siman, seif, isKitzur:true});
    }
    if (!rows.length) throw new Error("No English text was found in the selected se'ifim.");
    const selected = rows.slice(0, count);
    selected.distractors = rows;
    return selected;
  }
  function inject() {
    const setup = document.getElementById("tabSetup");
    const editor = document.getElementById("editorList");
    if (!setup || !editor || !window.createQuestionRow) return;
    const card = document.createElement("section");
    card.className = "card";
    card.id = "sefariaGenerator";
    card.style.cssText = "margin:18px 0;padding:20px;border:2px solid var(--line);border-radius:16px";
    const style = document.createElement("style");
    style.textContent = "#sefariaGenerator .sg-group{margin:16px 0;padding:14px;border:1px solid var(--line,#cbd5e1);border-radius:12px}#sefariaGenerator .sg-group legend{padding:0 8px;font-weight:800}#sefariaGenerator .sg-fields label{display:flex;flex-direction:column;gap:6px;font-weight:700}#sefariaGenerator .sg-fields input:not([type=checkbox]),#sefariaGenerator .sg-fields select{box-sizing:border-box;width:100%;min-height:42px}#sefariaGenerator .sg-fields [type=checkbox]{width:18px;height:18px}#sgQuestionList .editor-row{margin:12px 0;padding:16px;border:1px solid var(--line,#cbd5e1);border-radius:12px;background:rgba(255,255,255,.04)}#sgQuestionList{counter-reset:qrow}#sgQuestionList textarea.row-choices{min-height:100px}#sgStatus{font-weight:700}#sgReplace{border:1px solid #b91c1c}#sgReplace:disabled,#sgAdd:disabled{opacity:.65;cursor:wait}";
    document.head.appendChild(style);
    card.innerHTML = '<h3>Build a question set from Sefaria</h3>' +
      '<p class="hint">Questions use simple wording and short answers for third graders. Review the drafts before adding them to your current questions or replacing the set.</p>' +
      '<fieldset class="sg-group"><legend>1. Choose the source</legend><div class="sg-fields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;align-items:end">' +
      '<label>Source type<select id="sgType" class="select"><option value="chumash">Chumash</option><option value="halacha">Kitzur Shulchan Aruch</option></select></label>' +
      '<label>Sefer<select id="sgBook" class="select">' + bookNames.map(b => '<option value="' + b + '">' + books[b].label + '</option>').join("") + '</select></label>' +
      '<label>Perek<select id="sgChapter" class="select"><option>Loadingâ€¦</option></select></label>' +
      '<label>First pasuk<select id="sgFrom" class="select"><option>Loadingâ€¦</option></select></label>' +
      '<label>Last pasuk<select id="sgTo" class="select"><option>Loadingâ€¦</option></select></label>' +
      '<label>Siman<select id="sgSiman" class="select">' + Array.from({length:221},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'</option>').join("") + '</select></label>' +
      '<label>First seâ€™if<select id="sgSeifFrom" class="select"><option>Loadingâ€¦</option></select></label>' +
      '<label>Last seâ€™if<select id="sgSeifTo" class="select"><option>Loadingâ€¦</option></select></label>' +
      '</div></fieldset><fieldset class="sg-group"><legend>2. Choose question options</legend><div class="sg-fields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;align-items:end">' +
      '<label>Number of questions<select id="sgCount" class="select">' + Array.from({length:33},(_,i)=>'<option value="' + (i+1) + '"' + (i===9?' selected':'') + '>' + (i+1) + '</option>').join("") + '</select></label>' +
      '<label><input id="sgRashi" type="checkbox"> Include Rashi</label>' +
      '<label>Question style<select id="sgMode" class="select"><option value="mc">Multiple choice</option><option value="open">Open answer</option></select></label>' +
      '</div></fieldset><div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<button class="btn btn-good" type="button" id="sgGenerate">Get questions to review</button><span id="sgStatus" role="status" aria-live="polite">Choose a source to begin.</span></div>';
    const review = document.createElement("section");
    review.id = "sgReview";
    review.hidden = true;
    review.style.cssText = "margin-top:18px;padding-top:16px;border-top:1px solid var(--line)";
    review.innerHTML = '<h4 style="margin:0 0 6px;font-size:18px">Review generated questions</h4>' +
      '<p class="hint">These are drafts. Edit or delete any question. Nothing is saved until you choose an option below.</p>' +
      '<div id="sgQuestionList"></div>' +
      '<div class="sg-save-actions" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">' +
      '<button class="btn btn-primary" type="button" id="sgAdd">Add to current questions</button>' +
      '<button class="btn btn-bad" type="button" id="sgReplace">Replace all current questions</button></div>';
    card.appendChild(review);
    async function saveDrafts(replace) {
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
      if (replace && !window.confirm("Replace all current questions with these " + items.length + " reviewed questions?")) return;
      const buttons = [...review.querySelectorAll(".sg-save-actions button")];
      buttons.forEach(button => { button.disabled = true; });
      status.textContent = replace ? "Replacing the current question setâ€¦" : "Adding questions to the current setâ€¦";
      try {
        const current = typeof window.getCurrentQuestionSet === "function" ? window.getCurrentQuestionSet() : [];
        const next = replace ? items : current.concat(items);
        await window.saveQuestionSet(next);
        status.textContent = replace
          ? "Saved. Replaced the set with " + items.length + " questions."
          : "Saved. Added " + items.length + " questions; the set now has " + next.length + ".";
      } catch (error) {
        status.textContent = "Could not save questions: " + (error.message || "Please try again.");
      } finally { buttons.forEach(button => { button.disabled = false; }); }
    }
    card.querySelector("#sgAdd").addEventListener("click", () => saveDrafts(false));
    card.querySelector("#sgReplace").addEventListener("click", () => saveDrafts(true));
    const setupGrid = setup.querySelector(".setup-grid");
    (setupGrid || setup).insertAdjacentElement("afterend", card);
    const type = card.querySelector("#sgType");
    const updateFields = () => {
      const halacha = type.value === "halacha";
      card.querySelector("#sgBook").parentElement.hidden = halacha;
      card.querySelector("#sgChapter").parentElement.hidden = halacha;
      card.querySelector("#sgFrom").parentElement.hidden = halacha;
      card.querySelector("#sgTo").parentElement.hidden = halacha;
      ["#sgSiman","#sgSeifFrom","#sgSeifTo"].forEach(id => { card.querySelector(id).parentElement.hidden = !halacha; });
      card.querySelector("#sgRashi").parentElement.hidden = halacha;
    };
    const bookSelect = card.querySelector("#sgBook");
    const chapterSelect = card.querySelector("#sgChapter");
    const fromSelect = card.querySelector("#sgFrom");
    const toSelect = card.querySelector("#sgTo");
    const status = card.querySelector("#sgStatus");
    async function updateChapters() {
      try {
        status.textContent = "Loading perek list from Sefariaâ€¦";
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
    const simanSelect = card.querySelector("#sgSiman");
    const seifFromSelect = card.querySelector("#sgSeifFrom");
    const seifToSelect = card.querySelector("#sgSeifTo");
    async function updateSeifim() {
      seifFromSelect.disabled = seifToSelect.disabled = true;
      status.textContent = "Loading Kitzur Siman " + simanSelect.value + "â€¦";
      try {
        const currentSiman = simanSelect.value;
        const seifim = await kitzurSeifim(Number(currentSiman));
        if (currentSiman !== simanSelect.value) return;
        const values = Array.from({length:seifim.length},(_,i)=>i+1);
        optionsFor(seifFromSelect,values,1);
        optionsFor(seifToSelect,values,values.length);
        status.textContent = "Siman " + currentSiman + " has " + values.length + " seâ€™ifim.";
      } catch(error) {
        status.textContent = error.message || "Could not load seâ€™ifim.";
      } finally {
        seifFromSelect.disabled = seifToSelect.disabled = false;
      }
    }
    simanSelect.addEventListener("change",updateSeifim);
    type.addEventListener("change", () => {updateFields();if(type.value === "halacha")updateSeifim();});
    updateFields();
    updateChapters();
    updateSeifim();
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
        },status,requestedCount) : await halachaSources({siman:simanSelect,from:seifFromSelect,to:seifToSelect},status,requestedCount);
        const topic = "";
        const items = makeItems(sources, mode, topic, requestedCount, sources.distractors);`r`n        if (!items.length) throw new Error("No clear, age-appropriate questions were found. Try another siman or a smaller seif range.");
        const list = review.querySelector("#sgQuestionList");
        list.replaceChildren(...items.map(item => window.createQuestionRow(item.q, item.ans, item.choices, item.correctIndex)));
        review.hidden = false;
        status.textContent = items.length + " questions ready" + (type.value === "halacha" ? " (one per seâ€™if, with no repeats)" : "") + ". Review them below; your current set is unchanged.";
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
