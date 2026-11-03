/* Game Show text repair. Repairs UTF-8 decoded as Windows-1252 without stripping valid Unicode. */
(function (root) {
  "use strict";
  const replacements = [
    ["Ã¢â‚¬Å“", "“"], ["Ã¢â‚¬Å", "”"],
    ["â€œ", "“"], ["â€œ", "“"], ["â€˜", "‘"],
    ["â€", "”"], ["â€", "”"], ["â€™", "’"],
    ["â€¦", "…"], ["â€“", "–"], ["â€”", "—"],
    ["Â ", "\u00a0"], ["Â·", "·"]
  ];
  function repairText(value) {
    let text = String(value == null ? "" : value);
    for (let pass = 0; pass < 3; pass++) {
      const before = text;
      for (const [broken, fixed] of replacements) text = text.split(broken).join(fixed);
      text = text.replace(/â€(?=\u009d|[\s.,!?;:]|$)/g, "”").replace(/\u009d/g, "");
      if (before === text) break;
    }
    return text;
  }
  function repairQuestions(questions) {
    if (!Array.isArray(questions)) return { questions, changed: false };
    const repaired = questions.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const copy = { ...item };
      for (const key of Object.keys(copy)) {
        if (typeof copy[key] === "string") copy[key] = repairText(copy[key]);
        else if (Array.isArray(copy[key])) copy[key] = copy[key].map(v => typeof v === "string" ? repairText(v) : v);
      }
      return copy;
    });
    return { questions: repaired, changed: JSON.stringify(repaired) !== JSON.stringify(questions) };
  }
  root.GameShowTextEncoding = Object.freeze({ repairText, repairQuestions });
})(window);
