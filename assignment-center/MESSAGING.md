# Assignment Center — Messaging (core phase 1)

## Product requirements (approved October 15, 2026)

- **Ongoing private conversation**, WhatsApp-style, between a teacher and one student. Messages are *not* attached to individual assignments; the conversation is continuous.
- Both sides can send **short text and recorded voice messages**. Show messages chronologically, sender, time, read/unread indication where supportable, and a visible notification for new messages.
- Use **existing Fun Torah Tools authentication** with no second student sign-in.
- Keep assignment reminders separate from message notifications. Neither blocks freely available activities.
- Conversation and voice recordings must persist across sessions/devices in protected storage. Do not store real voice files in browser localStorage.
- Multiple teachers/classes: only a teacher currently authorized for the student's class can read or send in that class conversation. A student sees only their own conversations, appropriately class scoped.
- **Parent viewer accounts are explicitly deferred.** Later, a parent may get read-only access for an explicitly linked child, only after teacher authorization; access for different children is independently granted and revocable. Parents cannot send or edit messages.

## Security / safeguarding gates before deployment

1. Determine teacher-student thread identity by workspace + class + student, not user-provided names; validate server side against current memberships and class assignments on **every** read and write.
2. Deny unauthenticated access; deny cross-student/cross-class reads; allow only the message author to create messages as themselves. Block client-side impersonation and editing other authors' records.
3. Retain audit timestamps and immutable sender IDs; paginate history. Define an administrator safeguarding/audit access policy rather than representing threads as secret from the school.
4. Validate/limit text length, MIME/content type, audio size and duration; use authenticated storage URLs, never public voice blobs. Rate limit send/upload; reject unsupported uploads gracefully.
5. Test permission revocation, class transfers, teacher changes, multi-class student, disabled account, direct database requests, and two simultaneous sessions.
6. Decide retention and deletion rules with school policy before live use; support inappropriate-content reporting/escalation and avoid automatic deletion of conversations by students.
7. Show microphone permission errors clearly; recording consent/guardian/school policy must be resolved before use by children.
8. Add message unread indicators and teacher inbox list, with simple class/student filters. Preserve read/unread state per recipient.
9. Keep messages independent from assignment submission/approval. Optional linking to an assignment may be added later, but should never change the timeline model.
10. Keep this phase behind a feature flag until server rules, end-to-end tests and school approvals have passed.

## Implementation sequence

A. Draft a standalone two-sided **messaging UI preview** with mock data (no real audio recording or transmission).
B. Introduce scoped database models and hardened backend/auth rules.
C. Add authenticated text send/read, pagination, read state and inbox.
D. Add voice recorder and protected audio upload/playback with limits.
E. Integrate the student badge and teacher inbox; test before publishing.
F. Add read-only parent accounts in a **later phase**, by explicit teacher approval.

---
## Build status (2026-10-16, branch `feature/messaging-20261016`, NOT deployed)

Steps A-E are built; F (parents) is still deferred. Every item above is kept; this section records what now exists.

- **Server:** `backend/functions/messages-core.cjs` (rules), `messages.js` (function `messagesPortal`, registered in `index.js`), `messages-policy.cjs` (tested copy of `message-policy.js`). The `assignmentCenter` tree has no browser rules, so browsers cannot read or write messages or voice files directly.
- **Pages:** `messages-student.html`, `messages-teacher.html` (inbox with unread counts, class picker), shared `messages-ui.js` + `messages.css`. The earlier mock-data design preview is kept as `messages-preview.html`.
- **Links:** "Messages" tool in Teacher Home and Owner Admin (per class switch `toolGrants.messages`, OFF by default); "Messages (n new)" button in the student home bar (count only, no text on the home page).
- **Who can see what:** a student sees only their own thread (own passcode); a teacher sees threads of students in classes assigned to them; co-teachers of a class share a thread; the owner/admin can read any class thread for safeguarding but cannot send and does not clear anyone's unread. Teachers removed from a class, removed students, classes switched off: refused immediately.
- **Messages:** 1000 characters; reply-to; Sent / Seen; unread per side; failed sends show "Not sent - Try again" and a retry or double-tap never duplicates (client message id). Chat history is never kept in the browser, so shared computers keep nothing. Report button stores a report under the class for the owner (no owner screen yet).
- **Voice:** record in the browser (up to 60 s, about 24 kbps), listen before sending; types webm/ogg/m4a only; 512 KB max, file header checked; 20 voice notes per sender per conversation per day; 60 messages per sender per hour; 25 MB total voice per conversation. Files go to Cloud Storage under `assignmentCenter/voice/...` (never public) and are played back only through the function after the same checks. Voice is deleted one year after sending (the text message stays, marked "removed after one year"). The function deletes expired files when the chat is opened; an optional bucket rule (below) is the backstop.
- **Notifications:** unread badge on the student home bar and teacher inbox, refreshed every 30 s / 60 s while the page is open and visible. No push or email (needs extra services and consent).

### Tests (synthetic data only)
`node --test tests/messages-portal.test.cjs` (14 tests): isolation between students, classes, teachers; revoked teacher; removed student; class transfer; unverified/email-login accounts; owner read-only; impersonation; duplicates and retries; paging; text/voice size, type, format limits; failed upload frees quota; storage cap; daily/hourly caps; one-year expiry. Screenshots on synthetic accounts: `screenshots/`. Real microphone recording was NOT tested (no microphone here); real Google sign-in, real Storage and real student devices are untested.

### Cost assessment (estimates; confirm in the Firebase console)
- No AI, speech-to-text or paid third party. Uses the existing project: one more Cloud Function, Realtime Database text, and the existing Storage bucket (`b3-games.firebasestorage.app`, already used by Class Gallery), so no new plan or bucket is needed.
- Storage: a 10-second voice note is about 30 KB; a 60-second one about 180 KB. Hard cap 25 MB per conversation, so a class of 25 can never exceed about 625 MB, and typical use is a few MB. Cloud Storage costs a few cents per GB-month beyond the free allowance; realistic extra cost is $0 to pennies.
- Function calls: roughly 2 per minute per open chat. A class using chat 20 minutes a day is a few thousand calls a day, far below the free monthly allowance.
- Main cost watch-point: the existing student sign-in check (shared with every tool) reads the whole student list on each call. If chats stay open all day on many devices this can add Realtime Database download. Mitigations built in: 30 s polling only while the tab is visible; follow-up option: a lighter sign-in check. Review Firebase Usage after the first week on a test class.
- Do not turn on without owner approval: nothing in this PR creates a bucket, enables an API, or changes billing.

### Before a safe test release (all need owner approval)
1. Merge order: Homework PR #133 first (this PR is stacked on it), then this PR; both add one export at the end of `backend/functions/index.js`.
2. Deploy only `messagesPortal`; turn Messages on for ONE test class with test students.
3. Check with real devices: microphone permission prompt, recording and playback on Chrome (Windows/Chromebook) and iPad Safari (m4a), real Google teacher sign-in, a teacher of another class cannot open the thread.
4. Optional backstop for retention (owner-run, after the bucket is confirmed): a Storage lifecycle rule deleting objects under `assignmentCenter/voice/` older than 366 days.
5. School policy items still open: recording consent for children, who may read threads (safeguarding), what to do with reports, parent access (later phase).
6. Rollback: untick Messages for the class (instant; the function refuses it). To remove entirely: `firebase functions:delete messagesPortal --project b3-games`. Voice files can be deleted from the Storage console under `assignmentCenter/voice/`.

### Testing done without deployment (2026-10-16 update) - synthetic data only
- Synthetic class fixture `tests/fixtures/synthetic-class.cjs` (made-up students, passcodes, teachers; two classes plus a switched-off one). No real ET/WT data.
- `tests/synthetic-class-privacy.test.cjs`: only the student and teachers of the class can read a thread or play its voice; other students, other classes, other teachers, the switched-off class and anonymous callers are refused; responses hold no passcodes, sender ids or storage paths; about 400 hostile-input calls (`__proto__`, `../`, objects/arrays as ids, 5000-character values) all end in a clean 4xx and change nothing; simultaneous sends of the same message id create exactly one message (fixed: the id is now claimed atomically).
- `e2e/messages-voice-simulated.spec.ts` (Playwright, Chromium with its built-in fake microphone, a real recording): record, listen, send, teacher fetches identical audio; throw-away sends nothing; blocked / missing microphone and unsupported-browser messages; auto-stop at 60 s; failed upload shows "Not sent" and the retry saves exactly one message; nothing from the chat is left in local/session storage, cookies, IndexedDB or caches. Run: `npx playwright test e2e/messages-voice-simulated.spec.ts --project=chromium` (8 pass).
- Still needs real devices: a human microphone, iPad Safari (m4a), real Google sign-in, real Storage (needs approval).

---
## Independent review (2026-10-16) - fixed and still open
**Fixed in PR #135:** the same wrong-passcode limiter as Homework now protects Messages; the voice-per-day cap no longer resets hourly; deleting an expired voice file now frees its quota; a failed save deletes the uploaded file; a crash can no longer leave a message "still sending" forever (claims expire after a minute); a conversation is capped at 3000 messages; ids like `__proto__` are not accepted as students; the chat no longer rebuilds itself every 30 s, so a playing voice clip is not cut off; the recorder stops at about 480 KB as well as 60 s and says so clearly instead of failing at send (the iPad may ignore the bitrate request).

**Release blockers:** none in the new code. Before real children use voice: (1) test on a real iPad and a real microphone, (2) confirm Storage rules deny browsers `assignmentCenter/**`, (3) school decisions on consent, who reads threads, and reports.

**Still open (follow-ups):** voice files of chats nobody opens are only deleted by the optional Storage lifecycle rule (a scheduled clean-up function would add a Scheduler job and cost); teacher home shows no unread badge (teachers see counts inside the Messages tool); the student home badge refreshes only on page load; shared sign-in cost/limiter and the 5770 default (see RELEASE-PLAN in PR #133); scroll position after "Show older messages".
