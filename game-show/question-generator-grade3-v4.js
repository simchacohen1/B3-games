/* Game Show question generator.
 * Questions use simple wording for third-grade Chabad boys.
 */
(function () {
  "use strict";
  const books = {
    Genesis: { label: "Bereishis" }, Exodus: { label: "Shemos" },
    Leviticus: { label: "Vayikra" }, Numbers: { label: "Bamidbar" },
    Deuteronomy: { label: "Devarim" }
  };
  const api = "https://www.sefaria.org";
  const repairText = value => window.GameShowTextEncoding ? window.GameShowTextEncoding.repairText(value) : String(value == null ? "" : value);
  const searchProxy = "https://us-central1-b3-games.cloudfunctions.net/searchSefariaQuestions";
  const nameMap = {
    "the lord": "Hashem", "god": "Hashem",
    "moses": "Moshe Rabbeinu", "abraham": "Avrohom", "isaac": "Yitzchok",
    "jacob": "Yaakov", "joseph": "Yosef", "aaron": "Aharon",
    "sarah": "Sarah", "rebecca": "Rivkah", "rebekah": "Rivkah",
    "leah": "Leah", "rachel": "Rachel", "noah": "Noach", "esau": "Esav",
    "pharaoh": "Paroh", "reuben": "Reuven", "simeon": "Shimon",
    "judah": "Yehudah", "naphtali": "Naftali",
    "gad": "Gad", "asher": "Asher", "issachar": "Yissachar",
    "zebulun": "Zevulun", "benjamin": "Binyamin", "ephraim": "Ephraim",
    "manasseh": "Menashe", "miriam": "Miriam", "joshua": "Yehoshua",
    "balaam": "Bilam", "laban": "Lavan", "jethro": "Yisro",
    "ishmael": "Yishmoel", "hagar": "Hagar"
  };
  const localizeText = value => String(value || "").replace(/\b(the\s+lord|g\s*od|moses|abraham|isaac|jacob|joseph|aaron|sarah|rebecca|rebekah|leah|rachel|noah|esau|pharaoh|reuben|simeon|judah|naphtali|gad|asher|issachar|zebulun|benjamin|ephraim|manasseh|miriam|joshua|balaam|laban|jethro|ishmael|hagar|lot)\b/gi, word => /^(the\s+lord|g\s*od)$/i.test(word) ? "Hashem" : nameMap[word.toLowerCase()] || (word.toLowerCase() === "lot" ? "Lot" : word));
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
    const words = repairText(text).replace(/[“”"]/g, "").split(/\s+/).filter(Boolean);
    return words.slice(0, Math.min(7, words.length)).join(" ");
  }
  function questionRecord(q, ans, choices, correctNumber) {
    const item = { q: repairText(String(q || "").trim()), ans: repairText(String(ans || "").trim()) };
    const options = Array.isArray(choices) ? choices.map(choice => repairText(String(choice || "").trim())).filter(Boolean) : [];
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
    const labels = ["the first day","the second day","the third day","the fourth day","the fifth day","the sixth day"];
    const day = ranges.findIndex(([from,to]) => verse >= from && verse <= to);
    return day < 0 ? "" : labels[day];  }

  // Never quiz children on reference numbers. Skip unclear questions.
  function contentContinuation() {
    // A quote-completion prompt is hard to understand without the source in
    // front of the student. Skip it and ask only questions with clear context.
    return null;
  }
  function rashiQuestionAndAnswer(source) {
    const match = String(source.ref || source.displayRef || "").match(/Rashi on (?:Genesis|Bereishis)\s+19:(\d+)/i);
    if (!match) return null;
    const questions = {
      1: { q: "According to Rashi, what did one of the malochim come to do for Lot?", answer: "Save Lot." },
      2: { q: "When Lot welcomed the malochim in Sedom, why did Lot ask the malochim to stay first?", answer: "So people would think they had just arrived." },
      3: { q: "According to Rashi, which Yom Tov was it when the malochim came to Lot?", answer: "Pesach." },
      4: { q: "According to Rashi, did anyone in Sedom stand up for Lot's guests?", answer: "No one." },
      5: { q: "When the men of Sedom came to Lot's house, what did the men want to do to Lot's guests?", answer: "Hurt Lot's guests." },
      9: { q: "According to Rashi, when the men of Sedom told Lot to move back, what did the men mean?", answer: "Move away." }
    };
    return questions[Number(match[1])] || null;
  }
  function bereishis18QuestionAndAnswer(source) {
    const match = String(source.ref || source.displayRef || "").match(/(?:Genesis|Bereishis)\s+18:(\d+)/i);
    if (!match) return null;
    const questions = {
      1: { q: "When Hashem appeared to Avrohom Avinu, where was Avrohom sitting?", answer: "At the entrance of his tent." },
      2: { q: "When Avrohom saw the three malochim, how many malochim did Avrohom see?", answer: "Three." },
      3: { q: "When Avrohom welcomed the three malochim, what did Avrohom ask the malochim not to do?", answer: "Walk past Avrohom's tent." },
      4: { q: "When Avrohom welcomed the three malochim, what did Avrohom ask his servant to bring?", answer: "A little water." },
      5: { q: "When Avrohom welcomed the three malochim, what food did Avrohom offer the malochim?", answer: "A little bread." },
      6: { q: "When Sarah Imeinu made food for the three malochim, what did Sarah make from the flour?", answer: "Cakes." },
      7: { q: "When Avrohom prepared food for the three malochim, what animal did Avrohom choose?", answer: "A calf." },
      8: { q: "When Avrohom served the three malochim, what three foods did Avrohom serve?", answer: "Butter, milk, and meat." },
      9: { q: "When the three malochim asked where Sarah Imeinu was, where did Avrohom say Sarah was?", answer: "In the tent." },
      10: { q: "When the three malochim spoke to Avrohom and Sarah Imeinu, what did one malach say Sarah would have?", answer: "A son." },
      11: { q: "In Bereishis 18, how does the posuk describe Avrohom and Sarah Imeinu's age?", answer: "They were old." },
      12: { q: "When Sarah Imeinu heard the three malochim say Sarah would have a son, what did Sarah do?", answer: "Sarah laughed." },
      13: { q: "After Sarah Imeinu laughed, what did Hashem ask Avrohom about Sarah?", answer: "Why Sarah had laughed." },
      14: { q: "When Hashem spoke to Avrohom about Sarah Imeinu having a son, what did Hashem say was too hard for Him?", answer: "Nothing." },
      15: { q: "When Hashem asked Avrohom why Sarah Imeinu had laughed, why did Sarah Imeinu say she laughed?", answer: "Sarah was afraid." },
      16: { q: "When the three malochim left Avrohom, toward which city did the three malochim look?", answer: "Sedom." },
      17: { q: "When Hashem spoke about Avrohom, what did Hashem think of telling Avrohom?", answer: "What Hashem was going to do." },
      18: { q: "When Hashem spoke about Avrohom, what did Hashem say Avrohom and his children would become?", answer: "A big, strong nation." },
      19: { q: "When Hashem spoke to Avrohom, what did Hashem say Avrohom should teach his children?", answer: "To follow Hashem's ways." },
      20: { q: "When Hashem spoke to Avrohom about the wicked cities, which two cities were very wicked?", answer: "Sedom and Amora." },
      21: { q: "When Hashem went down to see what was happening in Sedom, what did Hashem want to find out?", answer: "If the people were acting as badly as people said." },
      22: { q: "When the three malochim left Avrohom's tent, where did the three malochim go?", answer: "Sedom." },
      23: { q: "When Avrohom davened for Sedom, what did Avrohom ask Hashem about the tzaddikim?", answer: "Would Hashem save the tzaddikim?" },
      24: { q: "When Avrohom davened for Sedom, what number did Avrohom ask Hashem about first?", answer: "Fifty." },
      25: { q: "When Avrohom davened for Sedom, whom did Avrohom call the Judge of all the earth?", answer: "Hashem." },
      26: { q: "When Avrohom davened for Sedom, what did Hashem say Hashem would do if Hashem found fifty tzaddikim?", answer: "Save the whole place." },
      27: { q: "When Avrohom davened to Hashem about Sedom, how did Avrohom describe himself?", answer: "Dust and ashes." },
      28: { q: "When Avrohom davened for Sedom, what number did Avrohom ask Hashem about after fifty?", answer: "Forty-five." },
      29: { q: "When Avrohom davened for Sedom, what number did Avrohom ask Hashem about after forty-five?", answer: "Forty." },
      30: { q: "When Avrohom davened for Sedom, what number did Avrohom ask Hashem about after forty?", answer: "Thirty." },
      31: { q: "When Avrohom davened for Sedom, what number did Avrohom ask Hashem about after thirty?", answer: "Twenty." },
      32: { q: "When Avrohom davened for Sedom, what number did Avrohom ask Hashem about after twenty?", answer: "Ten." },
      33: { q: "When Avrohom finished davening for Sedom, where did Avrohom go?", answer: "Back to his place." }
    };
    return questions[Number(match[1])] || null;
  }
  function bereishis19QuestionAndAnswer(source) {
    const match = String(source.ref || source.displayRef || "").match(/(?:Genesis|Bereishis)\s+19:(\d+)/i);
    if (!match) return null;
    const questions = {
      1: { q: "When the two malochim came to Sedom in the evening, whom did the two malochim visit?", answer: "Lot." },
      2: { q: "When Lot welcomed the two malochim, where did the two malochim say they would sleep?", answer: "In the town square." },
      3: { q: "When Lot welcomed the two malochim, what did Lot bake for the malochim?", answer: "Matzos." },
      4: { q: "When the men of Sedom came to Lot's house, who gathered there?", answer: "The men of Sedom." },
      5: { q: "When the men of Sedom came to Lot's house, what did the men demand?", answer: "Bring Lot's guests outside." },
      6: { q: "When Lot went outside to speak to the men of Sedom, what did Lot shut?", answer: "The door." },
      7: { q: "When Lot spoke to the men of Sedom, what did Lot ask the men not to do?", answer: "Do something bad." },
      8: { q: "When Lot spoke to the men of Sedom, how many daughters did Lot say Lot had?", answer: "Two." },
      9: { q: "When Lot spoke to the men of Sedom, what did the men say Lot was acting like?", answer: "Their leader." },
      10: { q: "When the men of Sedom tried to get Lot, what did the two malochim do?", answer: "The two malochim pulled Lot into the house." },
      11: { q: "When the two malochim protected Lot's house, what happened to the men at Lot's door?", answer: "The men could not see." }
    };
    return questions[Number(match[1])] || null;
  }
  function questionAndAnswer(source, topic) {
    const text = repairText(localizeText(source.text)).replace(/\s+/g, " ").trim();
    const ref = source.displayRef || displayRef(source.ref);
    if (source.isKitzur) return kitzurQuestionAndAnswer(source, text);
    // Broad prompts do not tell a child what to look for.
    // eight-year-old what to look for. Leave these for teacher-written review.
    if (topic) return null;
    if (source.isRashi) return rashiQuestionAndAnswer(source);
    // A source-specific template is only valid when the supplied text matches
    // the event. Never infer the answer from the reference alone if source
    // content has been substituted or corrupted.
    if (/(?:Genesis|Bereishis)\s+18:2$/i.test(String(source.ref || "")) &&
        !/\b(?:saw|looked|eyes|men|three|angels|malochim)\b/i.test(text)) return null;
    const Bereishis18QA = bereishis18QuestionAndAnswer(source);
    if (Bereishis18QA) return Bereishis18QA;
    const Bereishis19QA = bereishis19QuestionAndAnswer(source);
    if (Bereishis19QA) return Bereishis19QA;

    const subject = "(Hashem|Moshe Rabbeinu|Moshe|Avrohom|Avraham|Yitzchok|Yitzchak|Yaakov|Yosef|Aharon|Sarah|Rivkah|Leah|Rachel|Noach|Esav|Paroh|Reuven|Shimon|Yehudah|Naftali|Gad|Asher|Yissachar|Zevulun|Binyamin|Ephraim|Menashe|Miriam|Yehoshua|Bilam|Lavan|Yisro|Lot|Pharaoh|Melchizedek|Eliezer|Hagar|Yishmoel|Yishmael|the three angels|the two angels|the angel|the angels|the malochim|the malach|the men|the people|the king|the servant|the woman|the man)";
    const verbs = {
      saw: "see", said: "say", spoke: "speak", appeared: "appear", called: "call", divided: "separate",
      separated: "separate", created: "create", made: "make", blessed: "bless", commanded: "command",
      took: "take", gave: "give", brought: "bring", asked: "ask", answered: "answer", found: "find",
      heard: "hear", built: "build", opened: "open", closed: "close", sent: "send", placed: "place",
      put: "put", ate: "eat", drank: "drink", came: "come", went: "go", stood: "stand", bowed: "bow",
      hurried: "hurry", ran: "run", washed: "wash", prepared: "prepare", returned: "return", turned: "turn",
      rose: "rise", entered: "enter", sat: "sit", passed: "pass", walked: "walk", stayed: "stay",
      dwelt: "live", pitched: "pitch", offered: "offer", slaughtered: "slaughter", cooked: "cook",
      served: "serve", laughed: "laugh", promised: "promise", knew: "know", lay: "lie", instructed: "instruct",
      told: "tell", replied: "reply", looked: "look", lifted: "lift", stretched: "stretch", reached: "reach",
      seized: "seize", grabbed: "grab", held: "hold", shut: "shut", locked: "lock", led: "lead",
      followed: "follow", approached: "approach", arrived: "arrive", waited: "wait", remained: "remain",
      watched: "watch", left: "leave", struck: "strike", blinded: "blind", pressed: "press", lingered: "stay",
      tarried: "stay", escaped: "escape", rescued: "rescue", destroyed: "destroy", rained: "rain",
      descended: "come down", warned: "warn", lived: "live", bought: "buy"
    };
    const verbPattern = Object.keys(verbs).join("|");
    const match = text.match(new RegExp("(?:^|[;.!?]\\s*)(?:And\\s+)?" + subject + "\\s+(" + verbPattern + ")\\b\\s*,?\\s+(.+)", "i"));
    // Do not guess from the pasuk number: many different events occur on
    // creation day one. If the posuk does not name a clear subject and action,
    // leave it out for the teacher to review.
    if (!match) return null;

    const name = match[1], verb = match[2].toLowerCase();
    let clause = match[3].split(/[;.!?]/)[0].trim();
    clause = clause.replace(/,\s+and\s+(?:Hashem|Moshe|Avraham|Yitzchak|Yaakov|Yosef|Aharon|Sarah|Rivkah|Leah|Rachel|Noach|Esav|Paroh)\b[\s\S]*$/i, "").trim();
    if (!clause) return null;

    const day = creationDay(source);
    const suffix = name.toLowerCase() === "hashem" && day ? " on " + day : "";
    // Short, clear questions on Creation avoid needless "in this pasuk" phrasing.
    const creationDayLabel = day === "the first day" ? "day one" : day.replace(/^the /, "");
    if (day && name.toLowerCase() === "hashem" && verbs[verb] === "see") {
      return { q: "What did Hashem see on " + creationDayLabel + "?", answer: localizeText(clause) };
    }
    if (day && name.toLowerCase() === "hashem" && verbs[verb] === "create") {
      return { q: "What did Hashem create on " + creationDayLabel + "?", answer: localizeText(clause) };
    }
    if (verb === "appeared") {
      const target = clause.match(/^to\s+(.+?)(?:\s+by\s+|[,.]|$)/i);
      if (target && !/^(him|her|them|me|us|you|it|himself|herself|the man|the woman)$/i.test(target[1].trim())) return { q: "In this pasuk, who appeared to " + target[1] + "?", answer: name };
      // Pronouns such as "him" have no clear referent when a pasuk stands alone.
      return null;
    }
    if (verb === "called") {
      const called = clause.match(/^(?:the\s+)?(light|darkness)\s+([A-Z][A-Za-z]+)/i);
      if (called) return { q: "In this pasuk, what did " + name + " call the " + called[1].toLowerCase() + suffix + "?", answer: called[2] };
      return { q: "In this pasuk, what name did " + name + " give" + suffix + "?", answer: clause };
    }
    const actionQuestions = {
      come: "In this pasuk, where did " + name + " come" + suffix + "?",
      go: "In this pasuk, where did " + name + " go" + suffix + "?",
      enter: "In this pasuk, where did " + name + " go" + suffix + "?",
      arrive: "In this pasuk, where did " + name + " arrive" + suffix + "?",
      sit: "In this pasuk, where was " + name + " sitting" + suffix + "?",
      stand: "In this pasuk, where was " + name + " standing" + suffix + "?",
      bow: "In this pasuk, before whom did " + name + " bow" + suffix + "?",
      hurry: "In this pasuk, where did " + name + " hurry" + suffix + "?",
      run: "In this pasuk, where did " + name + " run" + suffix + "?",
      return: "In this pasuk, where did " + name + " go back" + suffix + "?",
      leave: "In this pasuk, what did " + name + " leave" + suffix + "?",
      eat: "In this pasuk, what did " + name + " eat" + suffix + "?",
      drink: "In this pasuk, what did " + name + " drink" + suffix + "?",
      take: "In this pasuk, what did " + name + " take" + suffix + "?",
      give: "In this pasuk, what did " + name + " give" + suffix + "?",
      bring: "In this pasuk, what did " + name + " bring" + suffix + "?",
      offer: "In this pasuk, what did " + name + " offer" + suffix + "?",
      prepare: "In this pasuk, what did " + name + " make" + suffix + "?",
      wash: "In this pasuk, what did " + name + " wash" + suffix + "?",
      ask: "In this pasuk, what did " + name + " ask" + suffix + "?",
      tell: "In this pasuk, what did " + name + " tell" + suffix + "?",
      say: "In this pasuk, what did " + name + " say" + suffix + "?",
      speak: "In this pasuk, what did " + name + " say" + suffix + "?",
      answer: "In this pasuk, what did " + name + " answer" + suffix + "?",
      call: "In this pasuk, what did " + name + " call" + suffix + "?",
      look: "In this pasuk, what did " + name + " look at" + suffix + "?",
      see: "In this pasuk, what did " + name + " see" + suffix + "?",
      hear: "In this pasuk, what did " + name + " hear" + suffix + "?",
      bless: "In this pasuk, whom did " + name + " bless" + suffix + "?",
      command: "In this pasuk, what did " + name + " tell someone to do" + suffix + "?",
      instruct: "In this pasuk, what did " + name + " teach" + suffix + "?",
      strike: "In this pasuk, what did " + name + " hit" + suffix + "?",
      seize: "In this pasuk, whom did " + name + " grab" + suffix + "?",
      grab: "In this pasuk, whom did " + name + " grab" + suffix + "?",
      hold: "In this pasuk, whom did " + name + " hold" + suffix + "?",
      lead: "In this pasuk, where did " + name + " lead someone" + suffix + "?",
      follow: "In this pasuk, whom did " + name + " follow" + suffix + "?",
      approach: "In this pasuk, whom did " + name + " go near" + suffix + "?",
      wait: "In this pasuk, for whom did " + name + " wait" + suffix + "?",
      remain: "In this pasuk, where did " + name + " stay" + suffix + "?",
      escape: "In this pasuk, where did " + name + " escape to" + suffix + "?",
      rescue: "In this pasuk, whom did " + name + " save" + suffix + "?",
      warn: "In this pasuk, whom did " + name + " warn" + suffix + "?",
      live: "In this pasuk, where did " + name + " live" + suffix + "?",
      destroy: "In this pasuk, what did " + name + " destroy" + suffix + "?",
      rain: "In this pasuk, what did Hashem send" + suffix + "?"
    };
    if (!actionQuestions[verbs[verb]]) return null;
    return { q: actionQuestions[verbs[verb]], answer: localizeText(clause) };
  }

  function kitzurQuestionAndAnswer(source, text) {
    // Make clear, concrete prompts for third graders. Skip a seif if no
    // specific question and short answer can be built safely from its text.
    if (/i have set hashem before me always/i.test(text)) {
      return { q: "When the Kitzur teaches us to keep Hashem in mind, what should we remember?", answer: "Hashem is always with us." };
    }
    if (/as soon as you awaken you should remember the kindnesses of hashem/i.test(text)) {
      return { q: "When the Kitzur teaches what to remember upon waking, what should we remember?", answer: "Thank Hashem for giving your soul back." };
    }
    if (/while still in bed you should recite:/i.test(text)) {
      return { q: "When the Kitzur teaches what to say upon waking, which tefillah do we say?", answer: "Modeh Ani." };
    }
    if (/bold as a leopard[^.]*means,?\s*you should not be ashamed before people who mock you for worshipping hashem/i.test(text)) {
      return { q: "When the Kitzur teaches us to be brave like a leopard, what should we do?", answer: "Do what is right, even if others laugh." };
    }
    if (/light as an eagle[^.]*close your eyes to prevent the seeing of evil/i.test(text)) {
      return { q: "When the Kitzur teaches us to be like an eagle, what should we do with our eyes?", answer: "Turn away from things we should not see." };
    }
    if (/swift as a deer[^.]*legs should run to do good things/i.test(text)) {
      return { q: "When the Kitzur teaches us to be quick like a deer, what should we hurry to do?", answer: "Good things." };
    }
    if (/strong as a lion[^.]*true valor in serving the creator[^.]*heart/i.test(text)) {
      return { q: "When the Kitzur teaches us to be strong like a lion, what should our heart be strong to do?", answer: "Serve Hashem." };
    }
    if (/if you cannot rise at midnight/i.test(text)) {
      return { q: "When the Kitzur teaches about getting up at night, when should you get up if you cannot rise at midnight?", answer: "Before daybreak." };
    }
    if (/how can you rise now so early in the morning when the weather is so cold/i.test(text)) {
      return { q: "When the Kitzur talks about getting up on a cold morning, what excuse should not stop us?", answer: "The cold weather." };
    }
    if (/a blind person may recite them by heart/i.test(text)) {
      return { q: "When the Kitzur teaches about saying the words by heart, who may say the words?", answer: "A blind person." };
    }
    if (/the proper conclusion is:\s*[“"]blessed is the one who listens to prayer/i.test(text)) {
      return { q: "When the Kitzur teaches how to end this tefillah, which words do we say?", answer: "Blessed is the One Who listens to tefillah." };
    }
    return null;
  }
  function shortChoice(value) {
    const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    return words.length > 12 ? words.slice(0, 12).join(" ") + "…" : words.join(" ");
  }

  function shuffleOptions(rows) {
    const shuffled = rows.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Prefer wrong answers of the same kind as the correct answer. Unrelated
  // verses and se'ifim must not produce obviously nonsensical alternatives.
  function choiceKind(question, answer) {
    const q = String(question || "").toLowerCase();
    const a = String(answer || "").toLowerCase();
    if (/\b(how many|what number|which number)\b/.test(q)) return "number";
    if (/\b(which|what) (animal|creature)\b/.test(q)) return "animal";
    if (/\b(who|whom|whose)\b/.test(q) || /^(avrohom|sarah|lot|moshe|yaakov|yitzchok|yosef|rivkah|eliez|aaron|aharon)\b/.test(a)) return "person";
    if (/\b(where|which city|what city|which place|what place|which land)\b/.test(q)) return "place";
    if (/\b(when|which day|what day|what time)\b/.test(q)) return "time";
    if (/\b(what (animal|food|meal|drink)|which (food|meal|drink))\b/.test(q)) return "food";
    if (/\b(which tefillah|what tefillah|which prayer|what prayer)\b/.test(q)) return "prayer";
    return "other";
  }
  function plausibleOptions(qa, others, sourceRef = '') {
    const correct = localizeText(shortChoice(qa.answer));
    if (!correct) return [];
    const kind = choiceKind(qa.q, correct);
    const rows = [{ excerpt: correct, correct: true }];
    const normalized = value => String(value || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const seen = new Set([normalized(correct)]);
    const add = value => {
      const text = localizeText(shortChoice(value));
      const key = normalized(text);
      if (!text || !key || seen.has(key) || key.includes(normalized(correct)) || normalized(correct).includes(key)) return;
      seen.add(key);
      rows.push({ excerpt: text, correct: false });
    };
    const bank = {
      number: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Ten", "Twelve"],
      animal: ["A lamb", "A goat", "A sheep", "A donkey", "A calf"],
      person: ["Avrohom", "Lot", "Yitzchok", "Yaakov", "Sarah", "Rivkah", "Eliezer", "Yosef"],
      place: ["At the city gate", "Inside the tent", "Outside the house", "Near the well", "In the field", "On the road"],
      time: ["In the morning", "At midday", "In the evening", "At night", "The next day"],
      food: ["Bread", "Milk", "Meat", "Fruit", "Water"],
      prayer: ["Modeh Ani", "Shema", "Birchos HaTorah", "Ashrei"]
    };
    // Favor distractors found in the same selected Torah text, but only when
    // the two questions ask for the same answer category.
    for (const other of others) {
      if (!other || !other.answer || choiceKind(other.q, other.answer) !== kind) continue;
      if (kind === "other") {
        const significant = s => String(s || "").toLowerCase().split(/[^a-z]+/).filter(w => w.length > 4 && !["which","where","about","teaches","pasuk","kitzur","should","there","their","would","after","before"].includes(w));
        const topic = new Set(significant(qa.q));
        if (!significant(other.q).some(word => topic.has(word))) continue;
      }
      add(other.answer);
      if (rows.length === 4) break;
    }
    // Creation pesukim share a tightly related subject even when their
    // questions use different verbs (created, saw, named, separated).
    // Keep these distractors within that story, never from unrelated passages.
    if (rows.length < 4 && /^(Genesis|Bereishis) 1:/i.test(sourceRef)) {
      for (const other of others) {
        if (other?.answer) add(other.answer);
        if (rows.length === 4) break;
      }
      for (const value of ["Light", "Darkness", "Day", "Night", "The heavens and the earth", "The sun and the moon", "The sea", "The trees"]) {
        if (rows.length === 4) break;
        add(value);
      }
    }
    if (rows.length < 4) {
      for (const value of bank[kind] || []) {
        add(value);
        if (rows.length === 4) break;
      }
    }
    return rows.length === 4 ? rows : [];
  }
  function makeItems(sources, mode, topic, count, distractors) {
    const out = [];
    const choiceSources = distractors && distractors.length ? distractors : sources;
    const skipped = { unclear: 0, duplicate: 0, choices: 0 };
    const preferred = evenlyPick(sources, count);
    const preferredSet = new Set(preferred);
    const candidates = preferred.concat(sources.filter(source => !preferredSet.has(source)));
    candidates.forEach((source, index) => {
      if (out.length >= count) return;
      const ref = source.displayRef || displayRef(source.ref);
      const rawQa = questionAndAnswer(source, topic);
      if (!rawQa || !rawQa.q || !rawQa.answer) {
        skipped.unclear++;
        return;
      }
      // Normalize names in every generated question and answer, including
      // fixed source-specific templates that do not pass through source text.
      const qa = { q: localizeText(rawQa.q), answer: localizeText(rawQa.answer) };
      if (out.some(item => item.q === qa.q)) {
        skipped.duplicate++;
        return;
      }
      if (mode === "open") {
        out.push({ q: qa.q, ans: qa.answer });
      } else {
        const nearbyQuestions = choiceSources.filter(candidate => candidate.ref !== source.ref)
          .map(candidate => questionAndAnswer(candidate, topic)).filter(Boolean);
        const optionRows = plausibleOptions(qa, nearbyQuestions, source.ref);
        // Do not pad a question with unrelated or potentially duplicate answers.
        if (optionRows.length !== 4) {
          skipped.choices++;
          return;
        }
        const shuffledOptions = shuffleOptions(optionRows);
        out.push({
          q: qa.q,
          ans: qa.answer + " (Source: " + ref + ")",
          choices: shuffledOptions.map(row => row.excerpt),
          correctIndex: shuffledOptions.findIndex(row => row.correct)
        });
      }
    });
    out.skipped = skipped;
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
    const sourcePool = [];
    const rashiByRef = new Map();
    if (includeRashi) {
      for (const source of evenlyPick(verseRows, Math.min(verseRows.length, count))) {        status.textContent = "Checking Rashi for " + source.displayRef + "…";
        try {
          const rashi = await getText("Rashi on " + source.ref);
          if (rashi.text) rashiByRef.set(source.ref, { ...rashi, displayRef: "Rashi on " + source.displayRef, isRashi: true });
        } catch (_) {}
      }
    }
    for (const source of verseRows) {
      sourcePool.push(source);
      const rashi = rashiByRef.get(source.ref);
      if (rashi) sourcePool.push(rashi);
    }
    // Pass all source candidates to makeItems. It fills the requested count
    // after parsing and deduplication instead of losing slots to skipped rows.
    sourcePool.baseSourceCount = verseRows.length;
    const selected = sourcePool;
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
    status.textContent = "Loading Kitzur Shulchan Aruch, Siman " + siman + "…";
    const seifim = await kitzurSeifim(siman);
    if (to > seifim.length) throw new Error("The selected se'if range does not exist in this siman.");
    const rows = [];
    for (let seif = from; seif <= to; seif++) {
      if (!seifim[seif-1]) continue;
      const ref = kitzurBook + " " + siman + ":" + seif;
      rows.push({ref, displayRef:"Kitzur Shulchan Aruch " + siman + ":" + seif, text:seifim[seif-1], siman, seif, isKitzur:true});
    }
    if (!rows.length) throw new Error("No English text was found in the selected se'ifim.");
    const selected = rows;
    selected.baseSourceCount = rows.length;
    selected.distractors = rows;
    return selected;
  }
  function inject() {
    const setup = document.getElementById("tabSetup");
    const editor = document.getElementById("editorList");
    if (!setup || !editor || typeof createQuestionRow !== "function") return;
    const card = document.createElement("section");
    card.className = "card";
    card.id = "sefariaGenerator";
    card.style.cssText = "margin:18px 0;padding:20px;border:2px solid var(--line);border-radius:16px";
    const style = document.createElement("style");
    style.textContent = "#sefariaGenerator .sg-group{margin:16px 0;padding:14px;border:1px solid var(--line,#cbd5e1);border-radius:12px}#sefariaGenerator .sg-group legend{padding:0 8px;font-weight:800}#sefariaGenerator .sg-fields label{display:flex;flex-direction:column;gap:6px;font-weight:700}#sefariaGenerator .sg-fields input:not([type=checkbox]),#sefariaGenerator .sg-fields select{box-sizing:border-box;width:100%;min-height:42px}#sefariaGenerator .sg-fields [type=checkbox]{width:18px;height:18px}#sgQuestionList .editor-row{margin:12px 0;padding:16px;border:1px solid var(--line,#cbd5e1);border-radius:12px;background:rgba(255,255,255,.04)}#sgQuestionList{counter-reset:qrow}#sgQuestionList textarea.row-choices{min-height:100px}#sgStatus{font-weight:700}#sgReplace{border:1px solid #b91c1c}#sgReplace:disabled,#sgAdd:disabled{opacity:.65;cursor:wait}";
    document.head.appendChild(style);
    card.innerHTML = '<h3>Build a question set from Sefaria</h3>' +
      '<p class="hint">Questions use simple wording and short answers for third graders. This describes the wording, not which Torah content may be studied. Review the drafts before adding them to your current questions or replacing the set.</p>' +
      '<fieldset class="sg-group"><legend>1. Choose the source</legend><div class="sg-fields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;align-items:end">' +
      '<label>Source type<select id="sgType" class="select"><option value="chumash">Chumash</option><option value="halacha">Kitzur Shulchan Aruch</option></select></label>' +
      '<label>Sefer<select id="sgBook" class="select">' + bookNames.map(b => '<option value="' + b + '">' + books[b].label + '</option>').join("") + '</select></label>' +
      '<label>Perek<select id="sgChapter" class="select"><option>Loading…</option></select></label>' +
      '<label>First pasuk<select id="sgFrom" class="select"><option>Loading…</option></select></label>' +
      '<label>Last pasuk<select id="sgTo" class="select"><option>Loading…</option></select></label>' +
      '<label>Siman<select id="sgSiman" class="select">' + Array.from({length:221},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'</option>').join("") + '</select></label>' +
      '<label>First se’if<select id="sgSeifFrom" class="select"><option>Loading…</option></select></label>' +
      '<label>Last se’if<select id="sgSeifTo" class="select"><option>Loading…</option></select></label>' +
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
    let draftRequestedCount = null;
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
      if (replace) {
        const requested = draftRequestedCount || Number(card.querySelector("#sgCount").value) || 10;
        const countNote = items.length < requested ? " You requested " + requested + ", but this draft has " + items.length + "." : "";
        if (!window.confirm("Replace all current questions with these " + items.length + " reviewed questions?" + countNote)) return;
      }
      const buttons = [...review.querySelectorAll(".sg-save-actions button")];
      buttons.forEach(button => { button.disabled = true; });
      status.textContent = replace ? "Replacing the current question set…" : "Adding questions to the current set…";
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
    chapterSelect.addEventListener("change", updateVerses);    const simanSelect = card.querySelector("#sgSiman");
    const seifFromSelect = card.querySelector("#sgSeifFrom");
    const seifToSelect = card.querySelector("#sgSeifTo");
    async function updateSeifim() {
      seifFromSelect.disabled = seifToSelect.disabled = true;
      status.textContent = "Loading Kitzur Siman " + simanSelect.value + "…";
      try {
        const currentSiman = simanSelect.value;
        const seifim = await kitzurSeifim(Number(currentSiman));
        if (currentSiman !== simanSelect.value) return;
        const values = Array.from({length:seifim.length},(_,i)=>i+1);
        optionsFor(seifFromSelect,values,1);
        optionsFor(seifToSelect,values,values.length);
        status.textContent = "Siman " + currentSiman + " has " + values.length + " se’ifim.";
      } catch(error) {
        status.textContent = error.message || "Could not load se’ifim.";
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
        const items = makeItems(sources, mode, topic, requestedCount, sources.distractors);
        const shortfall = Math.max(0, requestedCount - items.length);
        const reasons = [];
        if (items.skipped?.unclear) reasons.push(items.skipped.unclear + " source" + (items.skipped.unclear === 1 ? " did" : "s did") + " not produce a supported factual question");
        if (items.skipped?.duplicate) reasons.push(items.skipped.duplicate + " duplicate question" + (items.skipped.duplicate === 1 ? " was" : "s were") + " skipped");
        if (mode !== "open" && items.skipped?.choices) reasons.push(items.skipped.choices + " question" + (items.skipped.choices === 1 ? " lacked" : "s lacked") + " three distinct answer choices");
        const previousDraftNote = !items.length && !review.hidden ? " No new drafts were made; the previous review drafts remain unchanged." : "";
        const resultMessage = items.length + " of " + requestedCount + " requested questions ready" +
          (shortfall ? ". " + (reasons.length ? reasons.join("; ") + "." : "The selected range provided " + sources.length + " source text" + (sources.length === 1 ? "" : "s") + ", and each source can produce at most one question.") : "") +
          (type.value === "halacha" ? " (one per se’if, with no repeats)" : "") +
          previousDraftNote + " Review them below; your current set is unchanged.";
        status.textContent = resultMessage;
        if (!items.length) return;
        draftRequestedCount = requestedCount;
        const list = review.querySelector("#sgQuestionList");
        list.replaceChildren(...items.map(item => createQuestionRow(item.q, item.ans, item.choices, item.correctIndex)));
        review.hidden = false;
        review.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        status.textContent = error.message || "Could not generate questions.";
      } finally { button.disabled = false; }
    });
  }
  window.FunTorahSefariaGeneratorCore = Object.freeze({ makeItems, questionAndAnswer, questionRecord, shortChoice, phrase, cleanText, localizeText, displayRef, evenlyPick, distribute, repairText, choiceKind, plausibleOptions });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
  else inject();
})();
