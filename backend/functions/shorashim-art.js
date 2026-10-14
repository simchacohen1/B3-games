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
      avoid: Array.isArray(x?.avoid)
        ? [...new Set(x.avoid.map(v => String(v || "").trim()).filter(Boolean))].slice(0, 40)
        : [],
    })).filter((x) => x.id && x.english);

    if (!items.length) {
      res.status(400).json({ error: "items is required" });
      return;
    }

    // These candidates are visible to teachers only; nothing is published until
    // a teacher explicitly selects it in the Shorashim catalog.
    const systemPrompt = `
Suggest clear Unicode emoji choices for each Hebrew vocabulary term. The ENGLISH
meaning is authoritative. Choose up to four distinct, meaning-specific emoji.
For a word such as "man" you may suggest person/man emoji directly.
Do not apply religious dress, gender, or classroom-picture restrictions to
teacher-only suggestions. The teacher will review every picture before students
can use it. Follow general safety standards for an educational service.
Each item has an "avoid" list: do not repeat those emoji. Aim for fresh visual
alternatives when possible; return fewer than four if none remain. Do not pad
with unrelated symbols. A teacher may retry with different suggestions.
Return ONLY valid JSON: {"items":[{"id":"same id","art":["emoji1","emoji2"]}]}.
`;

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
          temperature: 0.7,
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
        const avoid = new Set(items.find(x => x.id === id)?.avoid || []);
        const art = Array.isArray(row?.art)
          ? [...new Set(row.art.map(x => String(x || "").trim())
            .filter(x => x && !avoid.has(x)))].slice(0, 4)
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
