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
