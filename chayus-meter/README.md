# Chayus Meter — isolated prototype (#802)

**Status: not connected to live davening, student login, teacher data, or rewards. Do not merge/deploy this as a finished feature.**

This feature is **separate** from “I Want to Be Chazzan” (#799, PR #800). Any boy who opts in may get private, periodic encouragement during teacher-led davening; Chazzan assignment and speed control have no bearing on it.

## Current preview

- \`chayus-meter/index.html\` — student opt-in microphone demo. Calls \`getUserMedia\` **only on button press**, locally computes RMS/activity, gives gentle encouragement approximately every 2.5 *measured* minutes, pauses on hidden tab, and stops all audio tracks on pause/finish/leave. Nothing is recorded or transmitted.
- \`chayus-meter/teacher-preview.html\` — teacher-summary layout using visibly **fictional** names and aggregates; never implies real submissions. No automatic points.
- \`core.js\` — deterministic engine for ambient calibration, binary sound activity (not loudness-based scoring), pauses, aggregate snapshots, and future teacher report rows.
- \`tests/chayus-meter.test.cjs\` — focused tests, runnable with \`node --test tests/chayus-meter.test.cjs\`.

Microphone volume **cannot measure kavana, words read, correct pronunciation, or enthusiasm reliably**; speakers playing davening, peers, room sounds, device mic gain and echo cancellation can all change activity estimates. These aggregates are *not grades*. Missing/denied mic is “No data,” **not zero participation**. Raising voice volume is **never rewarded** by the metric. It is particularly important not to shame quiet boys.

## Required class integration before staging release

Existing claims to coordinate before touching shared files:

- #799 / draft #800: ET/WT session, Chazzan, student microphone + teacher playback UI.
- #659: ET/WT remembered per-track playback speeds.
- #779 / #782: student/teacher class identity and Davening routing.
- Backend auth, Firebase database rules, Rewards: high-risk and must be reviewed separately.

Build a **server-verified** per-class, per-track (ET/WT) davening session:

1. Teacher creates and ends a Chayus session (independent of Chazzan). Restrict teacher actions to assigned classes; verify ET/WT; use existing authentication and class grants, not URL parameters alone.
2. A student enters via **Student Login**, gets an active server session associated with the actual student identity and assigned class, and explicitly opts in to local mic analysis. Start only after mic permission and the teacher's active session. Students may pause/stop at any time.
3. During the session, keep raw audio and transcripts on-device only, and show local feedback every ~150 seconds of actual measurement. **Do not send voice samples or audio buffers to Firebase.**
4. On teacher session end (or student finish), deliver *bounded aggregate metrics only*: \`measuredSeconds\`, \`activeSeconds\`, \`feedbackCount\`, \`hasMeasuredActivity\`; optionally a session timestamp. Backend must bind the authenticated user ID, class ID and server session ID, validate ranges and duration, limit update frequency, reject unauthorized reads and stale/replayed writes, and avoid trusting arbitrary student IDs sent by clients. Client metrics are not tamper-proof and should **not** be used for automatic awards.
5. Teacher sees each class's summary, with **No data** for nonparticipants or denied/absent microphones, and controls for manual point awarding via the existing Student Rewards flow. **Never credit, recommend, or deduct points automatically.** Do not allow a teacher in another class to read these reports. Keep ET/WT class data separate and decide a short retention/clearout policy.
6. Test with isolated **fictional** teacher/boys in database/auth emulators, including cross-class denial, duplicate/replay reports, teacher end, simultaneous submissions, reconnection, mic denied, silent tab, ET/WT mix-up and Rewards idempotency if the award tool is integrated. Then verify signed-in browser flow on staging before considering a release.

**Not yet implemented:** Student Login route, teacher-authorized start/end, secure session transport, ET/WT in-player UI, actual teacher report delivery, Firebase security rules, authenticated emulator/browser tests, rewards manual-action UI wiring. No production merge or deployment authorized by the development request.
