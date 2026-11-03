const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) admin.initializeApp();
const db = admin.database();

function obj(v) {
  return v && typeof v === "object" ? v : {};
}

function entries(v) {
  if (Array.isArray(v)) {
    return v.map((x, i) => [i, x]).filter(([, x]) => x && typeof x === "object");
  }
  if (v && typeof v === "object") {
    return Object.keys(v).map(k => [k, v[k]]).filter(([, x]) => x && typeof x === "object");
  }
  return [];
}

function numberValue(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function readingScore(a) {
  return a ? numberValue(a.hebrewFinalScore ?? a.hebrewScore) : null;
}

function translationScore(a) {
  if (!a) return null;

  const chunks = entries(a.translationChunkResults);
  if (chunks.length) {
    const correct = chunks.filter(([, c]) =>
      String(c.finalVerdict || c.verdict || "").toLowerCase() === "correct"
    ).length;

    const highestIndex =
      Math.max(...chunks.map(([i, c]) =>
        Number.isInteger(c.chunkIndex) ? c.chunkIndex : Number(i) || 0
      )) + 1;

    const total = Math.max(
      Number(a.translationTotal) || 0,
      highestIndex,
      chunks.length
    );

    return total ? Math.round((correct / total) * 100) : null;
  }

  return numberValue(a.translationScore);
}

function comprehensionScore(a) {
  if (!a) return null;

  const questions = entries(a.questionResults);
  if (questions.length) {
    const correct = questions.filter(([, q]) =>
      String(q.finalVerdict || q.verdict || "").toLowerCase() === "correct"
    ).length;

    const highestIndex =
      Math.max(...questions.map(([i, q]) =>
        Number.isInteger(q.questionIndex) ? q.questionIndex : Number(i) || 0
      )) + 1;

    const total = Math.max(
      Number(a.questionTotal) || 0,
      highestIndex,
      questions.length
    );

    return total ? Math.round((correct / total) * 100) : null;
  }

  return numberValue(a.comprehensionScore ?? a.questionScore);
}

function bestScore(attemptMap, reader) {
  let best = null;

  Object.values(obj(attemptMap)).forEach(a => {
    const score = reader(a);
    if (typeof score === "number" && (best === null || score > best)) {
      best = score;
    }
  });

  return best;
}

function summarizePosuk(allAttempts) {
  const result = {};

  Object.entries(obj(allAttempts)).forEach(([studentId, units]) => {
    let attempts = 0;
    let reading100 = 0;
    let translation100 = 0;
    let comprehension100 = 0;

    Object.values(obj(units)).forEach(attemptMap => {
      attempts += Object.keys(obj(attemptMap)).length;

      if (bestScore(attemptMap, readingScore) === 100) reading100++;
      if (bestScore(attemptMap, translationScore) === 100) translation100++;
      if (bestScore(attemptMap, comprehensionScore) === 100) comprehension100++;
    });

    result[studentId] = {
      attemptCount: attempts,
      unitsAttempted: Object.keys(obj(units)).length,
      reading100Units: reading100,
      translation100Units: translation100,
      comprehension100Units: comprehension100
    };
  });

  return result;
}

function summarizeChazara(allStudents) {
  const result = {};

  Object.entries(obj(allStudents)).forEach(([studentId, row]) => {
    const reviews = obj(row.reviews);
    const mastery = obj(row.mastery);

    result[studentId] = {
      learnedCount: Object.keys(obj(row.learned)).length,
      reviewedPesukimCount: Object.keys(reviews).length,
      totalReviews: Object.values(reviews).reduce(
        (sum, r) => sum + Number(r && r.count || 0),
        0
      ),
      masteryReadCount: Object.values(mastery).filter(x => x && x.read === true).length,
      masteryTranslateCount: Object.values(mastery).filter(x => x && x.translate === true).length,
      masteryComprehensionCount: Object.values(mastery).filter(x => x && x.comprehension === true).length
    };
  });

  return result;
}

function summarizeShorashim(allStudents) {
  const result = {};

  Object.entries(obj(allStudents)).forEach(([studentId, row]) => {
    result[studentId] = {
      learnedCards: Object.keys(obj(row.cards)).length,
      gamesPlayed: Number(row.gamesPlayed || 0),
      totalActiveSeconds: Number(row.totalActiveSeconds || 0)
    };
  });

  return result;
}

function summarizeQuizzes(root) {
  const result = {};
  const launches = obj(root.launches);
  const responses = obj(root.responses);
  const completions = obj(root.completions);

  Object.entries(launches).forEach(([launchId, launch]) => {
    const responseGroup = obj(responses[launchId]);

    Object.entries(responseGroup).forEach(([studentId, answerMap]) => {
      const answers = Object.values(obj(answerMap))
        .filter(x => x && typeof x === "object");

      if (!answers.length) return;

      const questions = Array.isArray(launch.quizSnapshot?.questions)
        ? launch.quizSnapshot.questions
        : Object.values(obj(launch.quizSnapshot?.questions));

      const total = questions.length || answers.length;
      const correct = answers.filter(a => a.correct === true).length;
      const completed = !!(completions[launchId] && completions[launchId][studentId]);

      if (!result[studentId]) result[studentId] = [];

      result[studentId].push({
        launchId,
        title: String(launch.quizSnapshot?.title || "Quiz"),
        skillType: String(launch.quizSnapshot?.skillType || ""),
        correctAnswers: correct,
        answeredQuestions: answers.length,
        totalQuestions: total,
        completed,
        percent: completed && total
          ? Math.round((correct / total) * 100)
          : null,
        timestamp: Number(
          launch.startedAt ||
          launch.createdAt ||
          launch.updatedAt ||
          0
        )
      });
    });
  });

  Object.values(result).forEach(rows =>
    rows.sort((a, b) => b.timestamp - a.timestamp)
  );

  return result;
}

function summarizeRewards(students) {
  return Object.entries(obj(students))
    .filter(([, s]) => s && s.active !== false)
    .map(([studentId, s]) => ({
      studentId,
      name: String(s.name || s.displayName || ""),
      currentBalance: Number(s.rewardBalance || s.currentBalance || 0)
    }));
}

function safeEqual(a, b) {
  try {
    const A = Buffer.from(String(a || ""), "utf8");
    const B = Buffer.from(String(b || ""), "utf8");
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

exports.parentDashboardApi = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    secrets: ["PARENT_DASHBOARD_SYNC_SECRET"]
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    const expected = String(process.env.PARENT_DASHBOARD_SYNC_SECRET || "");
    const supplied = String(req.get("X-Parent-Sync-Key") || "");

    if (!expected || !safeEqual(expected, supplied)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const [
        allowedSnap,
        attemptsSnap,
        chazaraSnap,
        shorashimSnap,
        quizSnap,
        rewardsSnap
      ] = await Promise.all([
        db.ref("posukPractice/allowedStudents").get(),
        db.ref("posukPractice/attempts").get(),
        db.ref("posukPractice/chazara/students").get(),
        db.ref("posukPractice/shorashimLearning/students").get(),
        db.ref("b3Quiz").get(),
        db.ref("studentRewards/students").get()
      ]);

      return res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        allowedStudents: obj(allowedSnap.val()),
        posuk: summarizePosuk(attemptsSnap.val()),
        chazara: summarizeChazara(chazaraSnap.val()),
        shorashim: summarizeShorashim(shorashimSnap.val()),
        quizzes: summarizeQuizzes(obj(quizSnap.val())),
        rewards: summarizeRewards(rewardsSnap.val())
      });

    } catch (err) {
      console.error("parentDashboardApi", err);
      return res.status(500).json({
        error: "Could not build Parent Dashboard data."
      });
    }
  }
);
