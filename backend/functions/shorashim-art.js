// Restored from the deployed function source on 2026-10-08; behavior retained.
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { paidHandler, ALLOWED_ORIGINS } = require("./paid-api");
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

exports.generateShorashimArt = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: ALLOWED_ORIGINS, maxInstances: 5, minInstances: 0, region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  paidHandler("generateShorashimArt", "generation", async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Use POST" });
      return;
    }

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems.slice(0, 40).map((x) => ({
      id: String(x?.id || "").slice(0, 160),
      front: String(x?.front || "").slice(0, 120),
      english: String(x?.english || "").slice(0, 180),
    })).filter((x) => x.id && x.english);

    if (!items.length) {
      res.status(400).json({ error: "items is required" });
      return;
    }

    const systemPrompt = `
IMPORTANT CLASSROOM IMAGE RULES:
- This is for a Chabad-Lubavitch third-grade BOYS' class.
- If a picture contains people, use boys or men only. Do not suggest women, girls, male-female couples, or mixed-gender groups.
- Boys and men must be modestly dressed and wear an appropriate Jewish head covering (kippah/yarmulke).
- Never suggest romantic imagery, couples, hand-holding, hugging, kissing, or other public affection.
- Prefer neutral objects, actions, symbols, animals, or scenery when they communicate the vocabulary clearly.
- Every suggestion must be directly relevant to the English meaning. Never add unrelated filler merely to reach a certain number of choices.
- Return fewer choices when fewer suitable choices exist.

You choose visual picture cues for Hebrew vocabulary flashcards used by Chabad-Lubavitch 3rd-grade boys.

For EACH supplied vocabulary item, choose exactly 4 Unicode emoji that help an 8-year-old remember the supplied ENGLISH meaning.

STRICT RULES:
- The English meaning is authoritative. Do not guess a different translation from the Hebrew.
- Every emoji must have a clear, direct connection to that exact meaning. Never add filler merely to reach four.
- Prefer concrete objects/actions/people/scenes over abstract symbols.
- For verb phrases such as "and he ran", represent the core action (running) and, when helpful, the subject/person.
- For pronouns and function words, direct symbolic cues are allowed (person, group, pointing hand, direction arrow), but they must actually match the meaning.
- NEVER use 🧠 or 💡 unless the meaning itself is think/know/understand/idea.
- NEVER use 🔎 unless the meaning is see/look/search/find.
- NEVER use ➡️/⬅️/⬆️/⬇️ unless the meaning truly includes direction, movement, before/after, to/from, up/down, etc.
- NEVER use ⭐/✨ merely as decoration.
- Do not use crosses, churches, non-Jewish religious symbols, immodest imagery, weapons, frightening gore, or inappropriate content.
- Use standard widely-supported Unicode emoji.
- Return four DISTINCT emoji when reasonably possible. If a precise meaning genuinely has fewer useful direct cues, return 2 or 3 rather than irrelevant filler.

Return ONLY valid JSON in this exact shape, with one result for every supplied id:
{"items":[{"id":"same id","art":["emoji1","emoji2","emoji3","emoji4"]}]}`;

    const userPrompt = JSON.stringify({ items });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY.value(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2500,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Anthropic shorashim-art error:", response.status, errText);
        res.status(502).json({ error: "Picture-choice service error" });
        return;
      }

      const data = await response.json();
      const textBlock = (data.content || []).find((b) => b.type === "text");
      let cleaned = String(textBlock?.text || "").replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
      const parsed = JSON.parse(cleaned);

      const requestedIds = new Set(items.map((x) => x.id));
      const seenIds = new Set();
      const safeItems = [];
      for (const row of (Array.isArray(parsed?.items) ? parsed.items : [])) {
        const id = String(row?.id || "");
        if (!requestedIds.has(id) || seenIds.has(id)) continue;
        seenIds.add(id);
        const art = Array.isArray(row?.art)
          ? [...new Set(row.art.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 4)
          : [];
        if (art.length) safeItems.push({ id, art });
      }

      res.status(200).json({ items: safeItems });
    } catch (err) {
      console.error("generateShorashimArt error:", err);
      res.status(500).json({ error: "Could not generate picture choices" });
    }
  })
);
