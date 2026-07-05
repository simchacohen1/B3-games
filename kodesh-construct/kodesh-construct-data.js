window.KODESH_CONSTRUCT_DECKS = [
  {
    id: "prep",
    title: "Prepositional Prefixes",
    hebrew: "והמבלנכש",
    colorClass: "brown",
    icon: "🪚 ⚒️ 📐",
    affixType: "prefix",
    grammarCategory: "preposition",
    instruction: "Add the right prefix to match the meaning.",
    cards: [
      { id: "prep-be-sefer", root: "ספר", rootMeaning: "book", meaning: "in a book", answer: ["ב", "ספר"], bank: ["ב", "ל", "מ", "כ", "ספר"], difficulty: 1, tags: ["location"], person: null, tense: null },
      { id: "prep-mi-ir", root: "עיר", rootMeaning: "city", meaning: "from a city", answer: ["מ", "עיר"], bank: ["מ", "ב", "ה", "עיר"], difficulty: 1, tags: ["source"], person: null, tense: null },
      { id: "prep-le-melech", root: "מלך", rootMeaning: "king", meaning: "to a king", answer: ["ל", "מלך"], bank: ["ל", "מ", "ו", "מלך"], difficulty: 1, tags: ["direction"], person: null, tense: null },
      { id: "prep-ke-even", root: "אבן", rootMeaning: "stone", meaning: "like a stone", answer: ["כ", "אבן"], bank: ["כ", "ל", "מ", "אבן"], difficulty: 2, tags: ["comparison"], person: null, tense: null },
      { id: "prep-ve-bayit", root: "בית", rootMeaning: "house", meaning: "and a house", answer: ["ו", "בית"], bank: ["ו", "ב", "ל", "בית"], difficulty: 1, tags: ["connector"], person: null, tense: null },
      { id: "prep-ha-har", root: "הר", rootMeaning: "mountain", meaning: "the mountain", answer: ["ה", "הר"], bank: ["ה", "ו", "מ", "הר"], difficulty: 2, tags: ["article"], person: null, tense: null },
      { id: "prep-uva-bayit", root: "בית", rootMeaning: "house", meaning: "and in a house", answer: ["וב", "בית"], bank: ["וב", "ו", "ב", "ל", "בית"], difficulty: 3, tags: ["connector", "location", "combo"], person: null, tense: null },
      { id: "prep-veha-har", root: "הר", rootMeaning: "mountain", meaning: "and the mountain", answer: ["וה", "הר"], bank: ["וה", "ו", "ה", "מ", "הר"], difficulty: 3, tags: ["connector", "article", "combo"], person: null, tense: null },
      { id: "prep-ulamelech", root: "מלך", rootMeaning: "king", meaning: "and to a king", answer: ["ול", "מלך"], bank: ["ול", "ו", "ל", "כ", "מלך"], difficulty: 3, tags: ["connector", "direction", "combo"], person: null, tense: null }
    ]
  },
  {
    id: "poss",
    title: "Possessive Suffixes",
    hebrew: "ינורסווה",
    colorClass: "yellow",
    icon: "📏 🧱 🔩",
    affixType: "suffix",
    grammarCategory: "possessive",
    instruction: "Attach the suffix that shows ownership.",
    cards: [
      { id: "poss-sifri", root: "ספר", rootMeaning: "book", meaning: "my book", answer: ["ספר", "י"], bank: ["ספר", "י", "ך", "ו", "ם"], difficulty: 1, tags: ["first-person"], person: "first-singular", tense: null },
      { id: "poss-malko", root: "מלך", rootMeaning: "king", meaning: "his king", answer: ["מלך", "ו"], bank: ["מלך", "י", "ו", "ה"], difficulty: 1, tags: ["third-person"], person: "third-masculine-singular", tense: null },
      { id: "poss-bayitkha", root: "בית", rootMeaning: "house", meaning: "your house", answer: ["בית", "ך"], bank: ["בית", "ך", "ו", "ם"], difficulty: 2, tags: ["second-person"], person: "second-masculine-singular", tense: null },
      { id: "poss-susam", root: "סוס", rootMeaning: "horse", meaning: "their horse", answer: ["סוס", "ם"], bank: ["סוס", "י", "ן", "ם"], difficulty: 2, tags: ["plural"], person: "third-masculine-plural", tense: null },
      { id: "poss-irah", root: "עיר", rootMeaning: "city", meaning: "her city", answer: ["עיר", "ה"], bank: ["עיר", "ה", "ו", "י"], difficulty: 1, tags: ["third-person"], person: "third-feminine-singular", tense: null },
      { id: "poss-darkenu", root: "דרך", rootMeaning: "road", meaning: "our road", answer: ["דרך", "נו"], bank: ["דרך", "נו", "ם", "י"], difficulty: 2, tags: ["first-person", "plural"], person: "first-plural", tense: null },
      { id: "poss-sifrkhem", root: "ספר", rootMeaning: "book", meaning: "your book (plural)", answer: ["ספר", "כם"], bank: ["ספר", "כם", "כן", "נו", "ם"], difficulty: 3, tags: ["second-person", "plural"], person: "second-masculine-plural", tense: null },
      { id: "poss-irenu", root: "עיר", rootMeaning: "city", meaning: "our city", answer: ["עיר", "נו"], bank: ["עיר", "נו", "ה", "ם", "י"], difficulty: 3, tags: ["first-person", "plural"], person: "first-plural", tense: null },
      { id: "poss-suskhen", root: "סוס", rootMeaning: "horse", meaning: "your horse (plural)", answer: ["סוס", "כן"], bank: ["סוס", "כן", "כם", "נו", "ם"], difficulty: 3, tags: ["second-person", "plural"], person: "second-feminine-plural", tense: null }
    ]
  },
  {
    id: "future",
    title: "Future Prefixes",
    hebrew: "עתיד",
    colorClass: "red",
    icon: "🚧 🔧 🪛",
    affixType: "prefix",
    grammarCategory: "future-tense",
    instruction: "Use the future tense prefix that matches the subject.",
    cards: [
      { id: "future-ekhtov", root: "כתב", rootMeaning: "write", meaning: "I will write", answer: ["א", "כתב"], bank: ["א", "ת", "י", "כתב"], difficulty: 1, tags: ["first-person"], person: "first-singular", tense: "future" },
      { id: "future-tishmor", root: "שמר", rootMeaning: "guard", meaning: "you will guard", answer: ["ת", "שמר"], bank: ["ת", "י", "נ", "שמר"], difficulty: 1, tags: ["second-person"], person: "second-masculine-singular", tense: "future" },
      { id: "future-yilmad", root: "למד", rootMeaning: "learn", meaning: "he will learn", answer: ["י", "למד"], bank: ["א", "י", "ת", "למד"], difficulty: 1, tags: ["third-person"], person: "third-masculine-singular", tense: "future" },
      { id: "future-nivneh", root: "בנה", rootMeaning: "build", meaning: "we will build", answer: ["נ", "בנה"], bank: ["נ", "י", "ת", "בנה"], difficulty: 2, tags: ["first-person", "plural"], person: "first-plural", tense: "future" },
      { id: "future-tispor", root: "ספר", rootMeaning: "count", meaning: "she will count", answer: ["ת", "ספר"], bank: ["ת", "י", "א", "ספר"], difficulty: 2, tags: ["third-person"], person: "third-feminine-singular", tense: "future" },
      { id: "future-yikra", root: "קרא", rootMeaning: "call", meaning: "they will call", answer: ["י", "קרא"], bank: ["י", "נ", "ת", "קרא"], difficulty: 3, tags: ["plural"], person: "third-masculine-plural", tense: "future" },
      { id: "future-tivneh", root: "בנה", rootMeaning: "build", meaning: "she will build", answer: ["ת", "בנה"], bank: ["ת", "נ", "י", "בנה"], difficulty: 2, tags: ["third-person"], person: "third-feminine-singular", tense: "future" },
      { id: "future-nishmor", root: "שמר", rootMeaning: "guard", meaning: "we will guard", answer: ["נ", "שמר"], bank: ["נ", "י", "ת", "שמר"], difficulty: 2, tags: ["first-person", "plural"], person: "first-plural", tense: "future" },
      { id: "future-ekra", root: "קרא", rootMeaning: "call", meaning: "I will call", answer: ["א", "קרא"], bank: ["א", "י", "ת", "קרא"], difficulty: 3, tags: ["first-person"], person: "first-singular", tense: "future" },
      { id: "future-nispor", root: "ספר", rootMeaning: "count", meaning: "we will count", answer: ["נ", "ספר"], bank: ["נ", "ת", "י", "ספר"], difficulty: 3, tags: ["first-person", "plural"], person: "first-plural", tense: "future" },
      { id: "future-vayikra", root: "קרא", rootMeaning: "call", meaning: "and he called", answer: ["וי", "קרא"], bank: ["וי", "י", "ו", "ת", "קרא"], difficulty: 3, tags: ["vav-hahipuch", "combo", "narrative"], person: "third-masculine-singular", tense: "future-inverted" },
      { id: "future-vatispor", root: "ספר", rootMeaning: "count", meaning: "and she counted", answer: ["ות", "ספר"], bank: ["ות", "ת", "ו", "י", "ספר"], difficulty: 3, tags: ["vav-hahipuch", "combo", "narrative"], person: "third-feminine-singular", tense: "future-inverted" },
      { id: "future-vanivneh", root: "בנה", rootMeaning: "build", meaning: "and we built", answer: ["ונ", "בנה"], bank: ["ונ", "נ", "ו", "י", "בנה"], difficulty: 3, tags: ["vav-hahipuch", "combo", "narrative"], person: "first-plural", tense: "future-inverted" }
    ]
  },
  {
    id: "past",
    title: "Past Suffixes",
    hebrew: "עבר",
    colorClass: "blue",
    icon: "🏗️ 📎 🪜",
    affixType: "suffix",
    grammarCategory: "past-tense",
    instruction: "Add the past tense ending that matches the subject.",
    cards: [
      { id: "past-katavti", root: "כתב", rootMeaning: "write", meaning: "I wrote", answer: ["כתב", "תי"], bank: ["כתב", "תי", "ת", "ו"], difficulty: 1, tags: ["first-person"], person: "first-singular", tense: "past" },
      { id: "past-shamrah", root: "שמר", rootMeaning: "guard", meaning: "she guarded", answer: ["שמר", "ה"], bank: ["שמר", "ה", "ו", "ת"], difficulty: 1, tags: ["third-person"], person: "third-feminine-singular", tense: "past" },
      { id: "past-lamadta", root: "למד", rootMeaning: "learn", meaning: "you learned", answer: ["למד", "ת"], bank: ["למד", "ת", "תי", "נו"], difficulty: 1, tags: ["second-person"], person: "second-masculine-singular", tense: "past" },
      { id: "past-banu", root: "בנה", rootMeaning: "build", meaning: "they built", answer: ["בנה", "ו"], bank: ["בנה", "ו", "תי", "ה"], difficulty: 2, tags: ["plural"], person: "third-masculine-plural", tense: "past" },
      { id: "past-halakhnu", root: "הלך", rootMeaning: "walk", meaning: "we walked", answer: ["הלך", "נו"], bank: ["הלך", "נו", "ת", "ה"], difficulty: 2, tags: ["first-person", "plural"], person: "first-plural", tense: "past" },
      { id: "past-amar", root: "אמר", rootMeaning: "say", meaning: "he said", answer: ["אמר"], bank: ["אמר", "תי", "ו", "ת"], difficulty: 3, tags: ["zero-suffix"], person: "third-masculine-singular", tense: "past" },
      { id: "past-amarnu", root: "אמר", rootMeaning: "say", meaning: "we said", answer: ["אמר", "נו"], bank: ["אמר", "נו", "תם", "תי"], difficulty: 2, tags: ["first-person", "plural"], person: "first-plural", tense: "past" },
      { id: "past-katavtem", root: "כתב", rootMeaning: "write", meaning: "you wrote (plural)", answer: ["כתב", "תם"], bank: ["כתב", "תם", "תי", "נו"], difficulty: 3, tags: ["second-person", "plural"], person: "second-masculine-plural", tense: "past" },
      { id: "past-shamarten", root: "שמר", rootMeaning: "guard", meaning: "you guarded (plural)", answer: ["שמר", "תן"], bank: ["שמר", "תן", "תם", "נו"], difficulty: 3, tags: ["second-person", "plural"], person: "second-feminine-plural", tense: "past" },
      { id: "past-lamad", root: "למד", rootMeaning: "learn", meaning: "he learned", answer: ["למד"], bank: ["למד", "תי", "נו", "תם"], difficulty: 3, tags: ["zero-suffix"], person: "third-masculine-singular", tense: "past" }
    ]
  }
];
