/* Game Show paste importer. Spreadsheet paste stays in the teacher's browser
 * until the teacher presses Save. No external data is sent from this parser.
 */
(function (root) {
  "use strict";
  const colors = ["red", "blue", "green", "yellow"];
  const key = text => String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  function splitGrid(text, delimiter) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    const data = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (ch === '"') {
        if (quoted && data[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted || !cell.trim()) quoted = !quoted;
        else cell += ch;
      } else if (ch === delimiter && !quoted) {
        row.push(cell.trim()); cell = "";
      } else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && data[i + 1] === "\n") i++;
        row.push(cell.trim()); cell = "";
        if (row.some(value => value !== "")) rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
    if (quoted) throw new Error("Unclosed quote in pasted spreadsheet text.");
    row.push(cell.trim());
    if (row.some(value => value !== "")) rows.push(row);
    return rows;
  }
  function isHeader(row) {
    return key(row[0]) === "question" && (
      ["answer", "correct answer"].includes(key(row[1])) ||
      (key(row[1]) === "red" && key(row[2]) === "blue" &&
       key(row[3]) === "green" && key(row[4]) === "yellow"));
  }
  function findCorrect(value, choices) {
    const answer = key(value);
    let index = colors.indexOf(answer);
    if (index >= 0) return index;
    if (/^[1-4]$/.test(answer)) return Number(answer) - 1;
    if (/^[a-d]$/.test(answer)) return answer.charCodeAt(0) - 97;
    index = choices.findIndex(c => key(c) === answer);
    return index;
  }
  function parsePastedText(input) {
    const text = String(input || "");
    const delimiter = text.includes("\t") ? "\t" : ",";
    const raw = splitGrid(text, delimiter);
    const rows = [];
    const errors = [];
    for (let i = 0; i < raw.length; i++) {
      const cells = raw[i];
      if (isHeader(cells)) continue;
      // Legacy text with no comma or tab was a question with an empty answer.
      if (cells.length === 1) {
        if (cells[0]) rows.push({ q: cells[0], ans: "" });
        continue;
      }
      if (cells.length === 2) {
        if (!cells[0]) errors.push("Row " + (i + 1) + ": missing question.");
        else rows.push({ q: cells[0], ans: cells[1] });
        continue;
      }
      if (cells.length !== 6) {
        // Preserve legacy unquoted comma answers like "question,one, two".
        if (delimiter === "," && cells.length >= 3 && cells.length < 6) {
          if (cells[0]) rows.push({ q: cells[0], ans: cells.slice(1).join(",") });
          else errors.push("Row " + (i + 1) + ": missing question.");
        } else {
          errors.push("Row " + (i + 1) + ": expected 2 or 6 columns, found " + cells.length + ".");
        }
        continue;
      }
      const [question, ...rest] = cells;
      const choices = rest.slice(0, 4);
      const correct = rest[4];
      if (!question || choices.some(c => !c)) {
        errors.push("Row " + (i + 1) + ": add a question and all four colored choices.");
        continue;
      }
      if (new Set(choices.map(key)).size !== 4) {
        errors.push("Row " + (i + 1) + ": answer choices must be different.");
        continue;
      }
      const correctIndex = findCorrect(correct, choices);
      if (correctIndex < 0) {
        errors.push("Row " + (i + 1) + ": Correct must be Red, Blue, Green, Yellow, 1–4, A–D, or the exact answer text.");
        continue;
      }
      rows.push({ q: question, ans: choices[correctIndex], choices, correctIndex });
    }
    return { rows, errors };
  }
  root.GameShowPasteImport = Object.freeze({ parsePastedText, findCorrect, splitGrid });
})(typeof window !== "undefined" ? window : globalThis);
