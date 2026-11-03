/**
 * Private read-only bridge from the B3 Parent Conversation Dashboard to ChatGPT.
 *
 * POST: authenticated with existing X-Parent-Sync-Key header; stores snapshot.
 * GET:  authenticated with ?token=<PARENT_DASHBOARD_READ_TOKEN>; returns snapshot.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const syncSecret = defineSecret("PARENT_DASHBOARD_SYNC_SECRET");
const readToken = defineSecret("PARENT_DASHBOARD_READ_TOKEN");
const SNAPSHOT_PATH = "privateParentDashboard/chatgpt/latest";

function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

exports.parentDashboardChatGPTFeed = onRequest(
  {
    region: "us-central1",
    secrets: [syncSecret, readToken],
    timeoutSeconds: 120,
    memory: "256MiB"
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("X-Content-Type-Options", "nosniff");

    try {
      if (req.method === "POST") {
        const supplied = String(req.get("X-Parent-Sync-Key") || "").trim();

        if (!safeEqual(supplied, syncSecret.value())) {
          res.status(401).json({ ok:false, error:"Unauthorized" });
          return;
        }

        const body = req.body && typeof req.body === "object"
          ? req.body
          : {};

        if (
          body.action !== "storeSnapshot" ||
          !body.snapshot ||
          typeof body.snapshot !== "object" ||
          !Array.isArray(body.snapshot.students)
        ) {
          res.status(400).json({
            ok:false,
            error:"Invalid snapshot payload"
          });
          return;
        }

        const record = {
          ...body.snapshot,
          bridgeStoredAt: admin.database.ServerValue.TIMESTAMP
        };

        await admin.database()
          .ref(SNAPSHOT_PATH)
          .set(record);

        res.json({ ok:true, stored:true });
        return;
      }

      if (req.method === "GET") {
        const supplied = String(
          req.query && req.query.token || ""
        ).trim();

        if (!safeEqual(supplied, readToken.value())) {
          res.status(401).json({ ok:false, error:"Unauthorized" });
          return;
        }

        const snap = await admin.database()
          .ref(SNAPSHOT_PATH)
          .get();

        if (!snap.exists()) {
          res.status(404).json({
            ok:false,
            error:"No dashboard snapshot has been stored yet"
          });
          return;
        }

        res.json({
          ok:true,
          readOnly:true,
          snapshot:snap.val()
        });
        return;
      }

      res.set("Allow", "GET, POST");
      res.status(405).json({ ok:false, error:"Method not allowed" });
    } catch (err) {
      console.error("parentDashboardChatGPTFeed error:", err);
      res.status(500).json({ ok:false, error:"Internal server error" });
    }
  }
);
