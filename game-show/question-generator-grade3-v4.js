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
  const repairText = value => window.GameShowTextEncoding ? window.GameShowTextEncoding.repairText(value) : String(value == null ? "" : value);
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
    const labels = ["day one","day two","day three","day four","day five","day six"];
    const day = ranges.findIndex(([from,to]) => verse >= from && verse <= to);
    return day < 0 ? "" : labels[day];  }

  // Never quiz children on reference numbers. If a grammatical question cannot
  // reliably be extracted, ask them to recognize the actual words of the text.
  function contentContinuation() {
    // A quote-completion prompt is hard to understand without the source in
    // front of the student. Skip it and ask only questions with clear context.
    return null;
  }
  function rashiQuestionAndAnswer(source) {
    const match = String(source.ref || source.displayRef || "").match(/Rashi on (?:Genesis|Bereishis)\s+19:(\d+)/i);
    if (!match) return null;
    const questions = {
      1: { q: "According to Rashi, what was one angel sent to do?", answer: "Rescue Lot." },
      2: { q: "According to Rashi, why did Lot ask them to stay first?", answer: "So they would look newly arrived." },
      3: { q: "According to Rashi, which holiday was it?", answer: "Passover." },
      4: { q: "According to Rashi, did anyone protest in the city?", answer: "No, not one person." },
      5: { q: "According to Rashi, what did the men mean by “know them”?", answer: "They wanted to abuse them." },
      9: { q: "According to Rashi, what did “step back” mean?", answer: "Move farther away." }
    };
    return questions[Number(match[1])] || null;
  }
  function bereishis18QuestionAndAnswer(source) {
    const match = String(source.ref || source.displayRef || "").match(/(?:Genesis|Bereishis)\s+18:(\d+)/i);
    if (!match) return null;
    const questions = {
      1: { q: "Where was Abraham sitting as the day grew hot?", answer: "At the entrance of the tent." },
      2: { q: "How many visitors did Abraham see?", answer: "Three." },
      3: { q: "What did Abraham ask the visitors not to do?", answer: "Go past his tent." },
      4: { q: "What did Abraham ask to have brought?", answer: "A little water." },
      5: { q: "What food did Abraham offer the visitors?", answer: "A morsel of bread." },
      6: { q: "What did Sarah make from the flour?", answer: "Cakes." },
      7: { q: "What animal did Abraham choose from the herd?", answer: "A calf." },
      8: { q: "Which foods did Abraham serve the three visitors?", answer: "Curds, milk, and a calf." },
      9: { q: "Where did Abraham say Sarah was?", answer: "In the tent." },
      10: { q: "What did the visitor say Sarah would have?", answer: "A son." },
      11: { q: "How did the text describe Abraham and Sarah?", answer: "They were old." },
      12: { q: "What did Sarah do when she heard the news?", answer: "She laughed." },
      13: { q: "What did Hashem ask Abraham about Sarah?", answer: "Why she laughed." },
      14: { q: "What did Hashem say was too wondrous for Him?", answer: "Nothing." },
      15: { q: "Why did Sarah say she had not laughed?", answer: "She was frightened." },
      16: { q: "Toward which city did the visitors look?", answer: "Toward Sodom." },
      17: { q: "What did Hashem consider hiding from Abraham?", answer: "What He was about to do." },
      18: { q: "What would Abraham become?", answer: "A great and populous nation." },
      19: { q: "What was Abraham to teach his children?", answer: "The way of Hashem." },
      20: { q: "Which two cities had a grave sin?", answer: "Sodom and Gomorrah." },
      21: { q: "What did Hashem go down to find out?", answer: "If the people acted as reported." },
      22: { q: "Where did the visitors go?", answer: "To Sodom." },
      23: { q: "What did Abraham ask about the innocent and guilty?", answer: "Would they be treated alike?" },
      24: { q: "How many innocent people did Abraham first suggest?", answer: "Fifty." },
      25: { q: "Who did Abraham call the Judge of all the earth?", answer: "Hashem." },
      26: { q: "What would Hashem do if He found fifty innocent people?", answer: "Spare the whole place." },
      27: { q: "What did Abraham call himself?", answer: "Dust and ashes." },
      28: { q: "What number did Abraham suggest after fifty?", answer: "Forty-five." },
      29: { q: "What number did Abraham suggest next?", answer: "Forty." },
      30: { q: "What number did Abraham suggest next?", answer: "Thirty." },
      31: { q: "What number did Abraham suggest next?", answer: "Twenty." },
      32: { q: "What was the last number Abraham suggested?", answer: "Ten." },
      33: { q: "Where did Abraham go after the visitors left?", answer: "Back to his place." }
    };
    return questions[Number(match[1])] || null;
  }
  function bereishis19QuestionAndAnswer(source) {
    const match = String(source.ref || source.displayRef || "").match(/(?:Genesis|Bereishis)\s+19:(\d+)/i);
    if (!match) return null;
    const questions = {
      1: { q: "Who arrived in Sodom in the evening?", answer: "The two angels." },
      2: { q: "Where did the visitors say they would spend the night?", answer: "In the square." },
      3: { q: "What did Lot bake for his visitors?", answer: "Unleavened bread." },
      4: { q: "Who gathered around Lot’s house?", answer: "The men of Sodom." },
      5: { q: "What did the men demand Lot do?", answer: "Bring the visitors outside." },
      6: { q: "What did Lot shut after he went outside?", answer: "The door." },
      7: { q: "What did Lot ask the men not to do?", answer: "Do something wrong." },
      8: { q: "How many daughters did Lot say he had?", answer: "Two." },
      9: { q: "What did the men say Lot was acting like?", answer: "Their ruler." },
      10: { q: "What did the visitors do to Lot?", answer: "Pulled him into the house." },
      11: { q: "What happened to the people at the entrance?", answer: "They were struck blind." }
    };
    return questions[Number(match[1])] || null;
  }
  function questionAndAnswer(source, topic) {
    const text = repairText(localizeText(source.text)).replace(/\s+/g, " ").trim();
    const ref = source.displayRef || displayRef(source.ref);
    if (source.isKitzur) return kitzurQuestionAndAnswer(source, text);
    // Broad prompts such as “What does this source say?” do not tell an
    // eight-year-old what to look for. Leave these for teacher-written review.
    if (topic) return null;
    if (source.isRashi) return rashiQuestionAndAnswer(source);
    const Bereishis18QA = bereishis18QuestionAndAnswer(source);
    if (Bereishis18QA) return Bereishis18QA;
    const Bereishis19QA = bereishis19QuestionAndAnswer(source);
    if (Bereishis19QA) return Bereishis19QA;

    const subject = "(Hashem|Moshe|Avraham|Yitzchak|Yaakov|Yosef|Aharon|Sarah|Rivkah|Leah|Rachel|Noach|Esav|Paroh|Reuven|Shimon|Yehudah|Naftali|Gad|Asher|Yissachar|Zevulun|Binyamin|Ephraim|Menashe|Miriam|Yehoshua|Bilam|Lavan|Yisro|Lot|Pharaoh|Melchizedek|Eliezer|Hagar|Yishmael|the angels|the angel|the men|the people|the king|the servant|the woman|the man)";
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
    // creation day one. If the text does not name a clear subject and action,
    // leave it out for the teacher to review.
    if (!match) return null;

    const name = match[1], verb = match[2].toLowerCase();
    let clause = match[3].split(/[;.!?]/)[0].trim();
    clause = clause.replace(/,\s+and\s+(?:Hashem|Moshe|Avraham|Yitzchak|Yaakov|Yosef|Aharon|Sarah|Rivkah|Leah|Rachel|Noach|Esav|Paroh)\b[\s\S]*$/i, "").trim();
    if (!clause) return null;

    const day = creationDay(source);
    const suffix = name.toLowerCase() === "hashem" && day ? " on " + day : "";
    if (verb === "appeared") {
      const target = clause.match(/^to\s+(.+?)(?:\s+by\s+|[,.]|$)/i);
      if (target && !/^(him|her|them|me|us|you|it|himself|herself|the man|the woman)$/i.test(target[1].trim())) return { q: "Who appeared to " + target[1] + "?", answer: name };
      // Pronouns such as "him" have no clear referent when a pasuk stands alone.
      return null;
    }
    if (verb === "called") {
      const called = clause.match(/^(?:the\s+)?(light|darkness)\s+([A-Z][A-Za-z]+)/i);
      if (called) return { q: "What did " + name + " call the " + called[1].toLowerCase() + suffix + "?", answer: called[2] };
      return { q: "What name did " + name + " give" + suffix + "?", answer: clause };
    }
    const actionQuestions = {
      come: "Where did " + name + " come" + suffix + "?",
      go: "Where did " + name + " go" + suffix + "?",
      enter: "Where did " + name + " enter" + suffix + "?",
      arrive: "Where did " + name + " arrive" + suffix + "?",
      sit: "Where did " + name + " sit" + suffix + "?",
      stand: "Where did " + name + " stand" + suffix + "?",
      bow: "Before whom did " + name + " bow" + suffix + "?",
      hurry: "Where did " + name + " hurry" + suffix + "?",
      run: "Where did " + name + " run" + suffix + "?",
      return: "Where did " + name + " return" + suffix + "?",
      leave: "What did " + name + " leave" + suffix + "?",
      eat: "What did " + name + " eat" + suffix + "?",
      drink: "What did " + name + " drink" + suffix + "?",
      take: "What did " + name + " take" + suffix + "?",
      give: "What did " + name + " give" + suffix + "?",
      bring: "What did " + name + " bring" + suffix + "?",
      offer: "What did " + name + " offer" + suffix + "?",
      prepare: "What did " + name + " prepare" + suffix + "?",
      wash: "What did " + name + " wash" + suffix + "?",
      ask: "What did " + name + " ask" + suffix + "?",
      tell: "What did " + name + " tell" + suffix + "?",
      say: "What did " + name + " say" + suffix + "?",
      speak: "What did " + name + " say" + suffix + "?",
      answer: "What did " + name + " answer" + suffix + "?",
      call: "What did " + name + " call" + suffix + "?",
      look: "What did " + name + " look at" + suffix + "?",
      see: "What did " + name + " see" + suffix + "?",
      hear: "What did " + name + " hear" + suffix + "?",
      bless: "Whom did " + name + " bless" + suffix + "?",
      command: "What did " + name + " command" + suffix + "?",
      instruct: "What did " + name + " instruct" + suffix + "?",
      strike: "What did " + name + " strike" + suffix + "?",
      seize: "Whom did " + name + " seize" + suffix + "?",
      grab: "Whom did " + name + " grab" + suffix + "?",
      hold: "Whom did " + name + " hold" + suffix + "?",
      lead: "Where did " + name + " lead" + suffix + "?",
      follow: "Whom did " + name + " follow" + suffix + "?",
      approach: "Whom did " + name + " approach" + suffix + "?",
      wait: "For whom did " + name + " wait" + suffix + "?",
      remain: "Where did " + name + " remain" + suffix + "?",
      escape: "Where did " + name + " escape" + suffix + "?",
      rescue: "Whom did " + name + " rescue" + suffix + "?",
      warn: "Whom did " + name + " warn" + suffix + "?",
      live: "Where did " + name + " live" + suffix + "?",
      destroy: "What did " + name + " destroy" + suffix + "?",
      rain: "What did Hashem send" + suffix + "?"
    };
    if (!actionQuestions[verbs[verb]]) return null;
    return { q: actionQuestions[verbs[verb]], answer: clause };
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
      const qa = questionAndAnswer(source, topic);
      if (!qa || !qa.q || !qa.answer) {
        skipped.unclear++;
        return;
      }
      if (out.some(item => item.q === qa.q)) {
        skipped.duplicate++;
        return;
      }
      if (mode === "open") {
        out.push({ q: qa.q, ans: qa.answer });
      } else {
        const correctExcerpt = localizeText(shortChoice(qa.answer));
        const optionRows = correctExcerpt ? [{ excerpt: correctExcerpt, ref: source.ref }] : [];
        for (let offset = 1; offset <= choiceSources.length && optionRows.length < 4; offset++) {
          const candidate = choiceSources[(index + offset) % choiceSources.length];
          if (candidate.ref === source.ref) continue;
          const candidateQa = questionAndAnswer(candidate, topic);
          if (!candidateQa || !candidateQa.answer) continue;
          const excerpt = localizeText(shortChoice(candidateQa.answer));
          if (excerpt && !optionRows.some(row => row.excerpt === excerpt)) optionRows.push({ excerpt, ref: candidate.ref });
        }
        // A single question may not have three distinct answer excerpts among
        // the selected sources. Skip that item instead of aborting the batch.
        if (optionRows.length < 4) {
          skipped.choices++;
          return;
        }
        const correctIndex = optionRows.findIndex(row => row.ref === source.ref || row.excerpt === correctExcerpt);
        if (correctIndex < 0) throw new Error("Could not match this question to its verified source. Please try again.");
        const shuffledOptions = shuffleOptions(optionRows);
        out.push({
          q: qa.q,
          ans: qa.answer + " (Source: " + ref + ")",
          choices: shuffledOptions.map(row => row.excerpt),
          correctIndex: shuffledOptions.indexOf(optionRows[correctIndex])
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
  window.FunTorahSefariaGeneratorCore = Object.freeze({ makeItems, questionAndAnswer, questionRecord, shortChoice, phrase, cleanText, localizeText, displayRef, evenlyPick, distribute, repairText });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
  else inject();
})();
