# Class Pointer classroom pilot

Open `classroom.html` as the teacher. Keep Zoom open for voices and webcams.

1. Click **Start class** and **Copy join link**.
2. Give the link to one student on another computer. The student enters a name and clicks **Join class**.
3. Click **Admit [name]** in the teacher roster, then **Share teaching screen** and choose the teaching window or tab.
4. Check that the student receives the live picture. Students do not grant camera or microphone access.
5. Choose **Selected students**, then check **Allow [name] to point**. Moving the student's mouse over the lesson must show their pointer in both views without clicking. Moving out of the picture hides it.
6. Uncheck the student or choose **Nobody**. The student cannot place a new pointer, and their existing pointer disappears. The teacher can still point.
7. Add a second student. Allow either one, both, or **Everyone admitted**. Each pointer is independent and labeled.
8. Choose Target, Arrow, Star, or Yad and a color using **Teacher tool / Teacher color** or **My pointer / My color**. Check that the style appears in everyone’s view. Enable **Spotlight the teacher's pointer** to dim the lesson around the teacher’s pointer; the spotlight hides when the teacher leaves the picture.
9. Test resizing, Clear teacher pointer, Clear all pointers, Stop sharing, sharing again, Remove student, and End class.

The existing `index.html` practice simulation remains separate.

## Connection design

PeerJS 1.5.5 uses its public signaling service to establish WebRTC data and one-way video connections. Video is sent from the teacher directly to each admitted student. There is no recording, database write, student camera, or student microphone. Names are self-entered; teacher admission is required. A random join link identifies a temporary session. Refreshing or closing the teacher page ends it.

The teacher is authoritative: admission and pointing permission are checked on receipt, not only in student controls. Student identities derive from the connection and use a separate namespace from the teacher. Untrusted names render as text. Coordinates are finite values between 0 and 1, relative to the contained video picture. Shapes and colors use fixed allowlists. Only the teacher controls the spotlight. Hover updates are coalesced with a trailing update to retain the final position. Mouse leave, revoking access, disconnecting, stopping capture, or ending class cancels queued updates and removes the appropriate pointer state.

This is a first-device pilot, with a maximum of 12 students per teacher session. Teacher upload bandwidth grows with each student. School filtering, blocked signaling, and restrictive networks can prevent connections. A school-device test is required before classroom use. A managed relay or broadcast service may be needed for dependable connections across school networks or larger classes; that infrastructure is not provisioned by this change.

References: [PeerJS getting started](https://peerjs.com/client/getting-started), [PeerJS API](https://peerjs.com/docs/#api), [PeerJS release 1.5.5](https://github.com/peers/peerjs/releases/tag/v1.5.5).

## Validation

Run `node --test tests/class-pointer.test.cjs`. Tests cover admission, allow-one/several/everyone/nobody policy, malformed coordinates, letterboxing and resize math, connection-bound identity, forged teacher identity, revocation, and disconnect cleanup.

Browser verification uses separate teacher and student tabs, the real PeerJS signaling service, real WebRTC media/data connections, and a synthetic animated teaching-screen stream instead of capturing private desktop content. Same-computer tabs do not prove connectivity from a student's school network.
