// REPLACEMENT BLOCK for exports.generateShorashimArt in Firebase functions/index.js
// 2026-09-17 — richer direct picture cues + teacher review flags + commonness 1–10.
//
// This block assumes the existing functions/index.js already defines:
//   onRequest, ANTHROPIC_API_KEY, and setCors.
//
// It is backward-compatible with the teacher page. Request items may now also contain
// an `avoid` array. Response rows add `review` and `commonness`.

exports.generateShorashimArt = onRequest(
  {
    secrets: [ANTHROPIC_API_KEY],
    cors: true,
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Use POST" });
      return;
    }

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems
      .slice(0, 40)
      .map((x) => ({
        id: String(x?.id || "").slice(0, 160),
        front: String(x?.front || "").slice(0, 120),
        english: String(x?.english || "").slice(0, 180),
        avoid: Array.isArray(x?.avoid)
          ? [...new Set(x.avoid.map((v) => String(v || "").trim()).filter(Boolean))].slice(0, 30)
          : [],
      }))
      .filter((x) => x.id && x.english);

    if (!items.length) {
      res.status(400).json({ error: "items is required" });
      return;
    }

    const systemPrompt = `You choose visual picture cues and a vocabulary-commonness score for Hebrew vocabulary flashcards used by Chabad-Lubavitch 3rd-grade boys.

For EACH supplied item:
1. Suggest up to 8 DISTINCT Unicode emoji/short emoji combinations that directly help an 8-year-old remember the supplied ENGLISH meaning.
2. Give a commonness score from 1 to 10 for how common/useful the Hebrew word or root family is across Chumash/Biblical Hebrew for an elementary Chumash student.
3. Put any candidate that deserves teacher judgment into "review".

PICTURE RULES:
- The supplied English meaning is authoritative. Do not invent a different translation from the Hebrew.
- Relevance is more important than quantity. NEVER add unrelated filler to reach a target number.
- Prefer a literal object, action, person, relationship, or scene that communicates the meaning at a glance.
- PEOPLE ARE ALLOWED when people are the clearest visual. For example, brother should have direct sibling/boy/man/group possibilities rather than only an abstract handshake.
- For kinship words (brother, father, mother, son, daughter, etc.), person/family cues are encouraged, but put Unicode people/family/couple imagery in "review" so the teacher can approve the exact rendering before students see it.
- Also put any image that could raise a modesty, clothing, head-covering, ambiguity, or age-appropriateness question in "review".
- Never use explicit romance/kissing imagery, crosses/churches/non-Jewish religious imagery, weapons, gore, or frightening content.
- For verbs, depict the actual action whenever possible.
- For abstract/function words, use a symbol only when it truly communicates that exact meaning.
- NEVER use 🧠 or 💡 unless the meaning itself is think/know/understand/idea.
- NEVER use 🔎 unless the meaning is see/look/search/find.
- NEVER use arrows unless the meaning really includes direction, movement, before/after, to/from, up/down, etc.
- NEVER use stars/sparkles merely as decoration.
- Use standard widely-supported Unicode emoji. A short combination such as "👦 👦" is allowed when it is much clearer than a single emoji.
- Each item contains an "avoid" list. Prefer DIFFERENT equally-direct choices when possible. Do not repeat avoided choices merely to fill space. If no additional direct picture exists, return fewer.
- Two excellent direct choices are better than eight weak choices.

COMMONNESS SCALE:
10 = extremely common/core and repeatedly useful throughout Chumash
9 = very common
7–8 = common and broadly useful
5–6 = moderate
3–4 = uncommon
2 = rare/specialized
1 = very rare or highly specialized
Score the Hebrew word/root FAMILY, not merely whether this exact inflected spelling is common.

Return ONLY valid JSON in exactly this shape, one row for every supplied id:
{"items":[{"id":"same id","art":["emoji1","emoji2"],"review":["emoji2"],"commonness":8}]}

"review" must be a subset of "art".`;

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
          max_tokens: 5000,
          temperature: 0.25,
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
      let cleaned = String(textBlock?.text || "")
        .replace(/```json|```/g, "")
        .trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];

      const parsed = JSON.parse(cleaned);
      const requestedIds = new Set(items.map((x) => x.id));
      const seenIds = new Set();
      const safeItems = [];

      const hardBlocked = new Set([
        "💋","💌","💏","💑","✝️","☦️","⛪","🔫","🗡️","⚔️","🩸",
      ]);

      const hardSafe = (raw) => {
        const v = String(raw || "").trim();
        if (!v) return false;
        for (const bad of hardBlocked) if (v.includes(bad)) return false;
        return true;
      };

      for (const row of (Array.isArray(parsed?.items) ? parsed.items : [])) {
        const id = String(row?.id || "");
        if (!requestedIds.has(id) || seenIds.has(id)) continue;
        seenIds.add(id);

        const art = Array.isArray(row?.art)
          ? [...new Set(row.art.map((x) => String(x || "").trim()).filter(hardSafe))].slice(0, 8)
          : [];

        const artSet = new Set(art);
        const review = Array.isArray(row?.review)
          ? [...new Set(row.review.map((x) => String(x || "").trim())
              .filter((x) => artSet.has(x) && hardSafe(x)))].slice(0, 8)
          : [];

        let commonness = Math.round(Number(row?.commonness));
        if (!Number.isFinite(commonness)) commonness = 5;
        commonness = Math.max(1, Math.min(10, commonness));

        safeItems.push({ id, art, review, commonness });
      }

      res.status(200).json({ items: safeItems });
    } catch (err) {
      console.error("generateShorashimArt error:", err);
      res.status(500).json({ error: "Could not generate picture choices" });
    }
  }
);
