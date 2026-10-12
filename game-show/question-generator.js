/* Source-backed Game Show question generator.
 * Questions are built from Sefaria translations and references returned by its API.
 * It does not paraphrase or invent Torah claims; every generated answer keeps the cited source text for teacher review.
 */
(function () {
  "use strict";
  const books = {
    Genesis: "Bereishit", Exodus: "Shemot", Leviticus: "Vayikra",
    Numbers: "Bamidbar", Deuteronomy: "Devarim"
  };
  const api = "https://www.sefaria.org";
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
    const response = await fetch(api + "/api/v3/texts/" + encodeURIComponent(ref) + "?version=english", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Sefaria could not load " + ref + ".");
    const data = await response.json();
    const text = versionsText(data);
    if (!text) throw new Error("No English text is available for " + ref + ".");
    return { ref: data.ref || ref, text };
  }
  function phrase(text) {
    const words = text.replace(/[“”"]/g, "").split(/\s+/).filter(Boolean);
    return words.slice(0, Math.min(7, words.length)).join(" ");
  }
  function makeItems(sources, mode, topic) {
    const out = [];
    sources.forEach((source, index) => {
      const prompt = topic
        ? "According to " + source.ref + ", what does this halacha say about " + topic + "?"
        : "What does " + source.ref + " say happened?";
      if (mode === "open") {
        out.push({ q: prompt, ans: source.text + " (Source: " + source.ref + ")" });
      } else {
        if (sources.length < 4) throw new Error("Multiple choice needs at least four verified source references. Expand the range or search for more sources.");
        const options = [source.ref];
        for (let offset = 1; offset < sources.length && options.length < 4; offset++) {
          const candidate = sources[(index + offset) % sources.length].ref;
          if (!options.includes(candidate)) options.push(candidate);
        }
        out.push({
          q: "Which source contains the phrase “" + phrase(source.text) + "”?",
          ans: source.ref,
          choices: options,
          correctIndex: options.indexOf(source.ref)
        });
      }
    });
    return out;
  }
  async function chumashSources(form, status) {
    const book = books[form.book.value];
    const chapter = Number(form.chapter.value), from = Number(form.from.value), to = Number(form.to.value);
    if (!chapter || !from || !to || to < from || to - from > 19) throw new Error("Enter a valid perek and a range of 1–20 pesukim.");
    const rows = [];
    for (let verse = from; verse <= to; verse++) {
      const source = await getText(book + " " + chapter + ":" + verse);
      rows.push(source);
      status.textContent = "Verified " + source.ref + " with Sefaria…";
      if (form.rashi.checked) {
        try {
          const rashi = await getText("Rashi on " + book + " " + chapter + ":" + verse);
          if (rashi.text) rows.push({ ref: rashi.ref, text: rashi.text, isRashi: true });
        } catch (_) {
          status.textContent = "Verified " + source.ref + "; no English Rashi text was available for this pasuk.";
        }
      }
    }
    return rows;
  }
  async function halachaSources(form, status) {
    const topic = form.topic.value.trim();
    if (topic.length < 2) throw new Error("Type a halacha topic, such as Shabbat or berachot.");
    status.textContent = "Searching Sefaria for sources about " + topic + "…";
    const response = await fetch(api + "/api/search-wrapper", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: topic, type: "text", field: "naive_lemmatizer", size: 8, sort_method: "score", sort_fields: ["pagesheetrank"] })
    });
    if (!response.ok) throw new Error("Sefaria search did not complete.");
    const data = await response.json();
    const hits = data?.hits?.hits || data?.hits || data?.results || [];
    const refs = [...new Set(hits.map(hit => hit?.ref || hit?._source?.ref || hit?.source?.ref).filter(Boolean))].slice(0, 8);
    if (!refs.length) throw new Error("Sefaria found no source references for that topic. Try a different topic.");
    const rows = [];
    for (const ref of refs) {
      try { rows.push(await getText(ref)); } catch (_) {}
      status.textContent = "Checking Sefaria source " + rows.length + "…";
    }
    if (!rows.length) throw new Error("Sefaria returned references without an English source text.");
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
      '<label>Sefer<select id="sgBook" class="select">' + Object.keys(books).map(b => '<option>' + b + '</option>').join("") + '</select></label>' +
      '<label>Perek<input id="sgChapter" class="input" type="number" min="1" value="1"></label>' +
      '<label>First pasuk<input id="sgFrom" class="input" type="number" min="1" value="1"></label>' +
      '<label>Last pasuk<input id="sgTo" class="input" type="number" min="1" value="4"></label>' +
      '<label>Halacha topic<input id="sgTopic" class="input" type="search" placeholder="e.g. Shabbat"></label>' +
      '<label><input id="sgRashi" type="checkbox"> Include Rashi</label>' +
      '<label>Question style<select id="sgMode" class="select"><option value="open">Open answer</option><option value="mc">Multiple choice</option></select></label>' +
      '</div><div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<button class="btn btn-good" type="button" id="sgGenerate">Generate and review</button><span id="sgStatus" role="status" aria-live="polite"></span></div>';
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
    type.addEventListener("change", updateFields);
    updateFields();
    card.querySelector("#sgGenerate").addEventListener("click", async () => {
      const button = card.querySelector("#sgGenerate"), status = card.querySelector("#sgStatus");
      button.disabled = true;
      try {
        const mode = card.querySelector("#sgMode").value;
        const sources = type.value === "chumash" ? await chumashSources({
          book:card.querySelector("#sgBook"),chapter:card.querySelector("#sgChapter"),
          from:card.querySelector("#sgFrom"),to:card.querySelector("#sgTo"),
          rashi:card.querySelector("#sgRashi")
        },status) : await halachaSources({topic:card.querySelector("#sgTopic")},status);
        const topic = type.value === "halacha" ? card.querySelector("#sgTopic").value.trim() : "";
        const items = makeItems(sources, mode, topic);
        items.forEach(item => document.getElementById("editorList").appendChild(
          window.createQuestionRow(item.q, item.ans, item.choices, item.correctIndex)
        ));
        status.textContent = items.length + " source-based questions added below. Edit or remove any item, then use Save Questions.";
        document.getElementById("editorList").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        status.textContent = error.message || "Could not generate questions.";
      } finally { button.disabled = false; }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
  else inject();
})();
