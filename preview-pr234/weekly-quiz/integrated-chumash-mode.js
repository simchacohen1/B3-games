/*
  B3 Weekly Quiz — "Chumash Understanding & Skills" generator mode
  ----------------------------------------------------------------
  Put this file in the same weekly-quiz folder as teacher.html.

  Then add this line immediately before </body> in teacher.html:

    <script src="integrated-chumash-mode.js"></script>

  This patch is deliberately additive:
  - Existing Shoreshim / Words & Phrases / Comprehension / Mixed modes keep working.
  - It adds a fifth generator choice: Chumash Understanding & Skills.
  - The resulting saved quiz stays a normal "mixed" quiz internally so the existing
    Student Progress reports continue to work without changing your Firebase data.
*/

(function () {
  "use strict";

  const INTEGRATED_URL =
    "https://us-central1-b3-games.cloudfunctions.net/generateIntegratedChumashQuiz";

  const MODE_VALUE = "integrated";
  const MODE_LABEL = "Chumash Understanding & Skills";

  function byId(id) {
    return document.getElementById(id);
  }

  function addIntegratedOption() {
    const select = byId("generatorType");
    if (!select || select.querySelector('option[value="' + MODE_VALUE + '"]')) return;

    const option = document.createElement("option");
    option.value = MODE_VALUE;
    option.textContent = MODE_LABEL;

    const mixed = select.querySelector('option[value="mixed"]');
    if (mixed) select.insertBefore(option, mixed);
    else select.appendChild(option);
  }

  function ensureHelpBox() {
    let box = byId("integratedModeHelp");
    if (box) return box;

    const typeSelect = byId("generatorType");
    if (!typeSelect) return null;

    const grid = typeSelect.closest(".generator-grid");
    if (!grid) return null;

    box = document.createElement("div");
    box.id = "integratedModeHelp";
    box.className = "info-box hidden";
    box.style.marginTop = "10px";
    box.innerHTML =
      "<b>Chumash Understanding &amp; Skills</b><br>" +
      "A regular third-grade Chumash quiz with a few easy skill questions mixed in: " +
      "<b>מי אמר אל מי</b>, <b>על מי נאמר</b>, and simple " +
      "<b>prefix / shoresh / suffix</b> word breakdown. " +
      "The new skills are introduced gradually; most questions remain translation and comprehension.";

    grid.insertAdjacentElement("afterend", box);
    return box;
  }

  function setEditorToMixed() {
    const editorSkill = byId("editorSkillType");
    if (!editorSkill) return;

    // Keep the existing data/reporting model. Each generated question still gets
    // one of the existing tracked skills: shorashim, translation, comprehension.
    if (editorSkill.querySelector('option[value="mixed"]')) {
      editorSkill.value = "mixed";
      if (typeof editorSkillChanged === "function") editorSkillChanged();
    }
  }

  const originalGeneratorTypeChanged =
    typeof generatorTypeChanged === "function" ? generatorTypeChanged : null;

  function integratedGeneratorTypeChanged() {
    const typeSelect = byId("generatorType");
    const t = typeSelect ? typeSelect.value : "";

    const help = ensureHelpBox();
    if (help) help.classList.toggle("hidden", t !== MODE_VALUE);

    const mixedCounts = byId("mixedCounts");
    if (mixedCounts && t === MODE_VALUE) mixedCounts.classList.add("hidden");

    if (t === MODE_VALUE) {
      setEditorToMixed();
      return;
    }

    if (originalGeneratorTypeChanged) originalGeneratorTypeChanged();
  }

  const originalGenerateQuizDraft =
    typeof generateQuizDraft === "function" ? generateQuizDraft : null;

  async function generateIntegratedDraft() {
    const sourceEl = byId("generatorSource");
    const typeEl = byId("generatorType");
    const choicesEl = byId("generatorChoices");
    const countEl = byId("generatorCount");
    const status = byId("generatorStatus");
    const btn = byId("generateBtn");

    if (!sourceEl || !typeEl || !choicesEl || !countEl || !status || !btn) {
      alert("The Integrated Chumash mode could not find the quiz generator controls.");
      return;
    }

    const sourceText = sourceEl.value.trim();
    const choiceCount = Number(choicesEl.value) || 3;
    const count = Math.max(1, Math.min(40, Number(countEl.value) || 10));

    if (!sourceText) {
      alert("Paste the pesukim / source text first.");
      return;
    }

    btn.disabled = true;
    status.textContent = "Generating Chumash Understanding & Skills questions…";

    try {
      const resp = await fetch(INTEGRATED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          choiceCount,
          count
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || "Generator service error");

      // generatorCandidates is part of the existing teacher page.
      generatorCandidates = (data.items || []).map((x) => ({
        selected: true,
        skillType: ["shorashim", "translation", "comprehension"].includes(x.skillType)
          ? x.skillType
          : "comprehension",
        focus: x.focus || "",
        q: x.question || "",
        choices: typeof asArray === "function" ? asArray(x.choices) : (Array.isArray(x.choices) ? x.choices : []),
        correctIndex: Number(x.correctIndex) || 0,
        whySelected:
          (x.questionKind ? "[" + x.questionKind.replaceAll("_", " ") + "] " : "") +
          (x.whySelected || "")
      }));

      if (!generatorCandidates.length) {
        throw new Error("No usable questions were returned.");
      }

      const review = byId("generatorReview");
      if (review) review.classList.remove("hidden");
      if (typeof renderCandidates === "function") renderCandidates();

      const warning = data.warning ? " " + data.warning : "";
      status.textContent =
        "Generated " +
        generatorCandidates.length +
        " Chumash Understanding & Skills question(s)." +
        warning;

      const labelEl = byId("generatorSourceLabel");
      const editorSource = byId("editorSourceLabel");
      if (labelEl && editorSource && labelEl.value.trim()) {
        editorSource.value = labelEl.value.trim();
      }

      setEditorToMixed();
    } catch (e) {
      console.error(e);
      status.textContent =
        "Integrated Chumash generator could not run: " +
        e.message +
        " Make sure generateIntegratedChumashQuiz has been deployed.";
    } finally {
      btn.disabled = false;
    }
  }

  function patchedGenerateQuizDraft() {
    const t = byId("generatorType") ? byId("generatorType").value : "";
    if (t === MODE_VALUE) return generateIntegratedDraft();
    if (originalGenerateQuizDraft) return originalGenerateQuizDraft();
  }

  function install() {
    addIntegratedOption();
    ensureHelpBox();

    // Inline onclick/onchange attributes resolve these through window.
    window.generatorTypeChanged = integratedGeneratorTypeChanged;
    window.generateQuizDraft = patchedGenerateQuizDraft;

    integratedGeneratorTypeChanged();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
