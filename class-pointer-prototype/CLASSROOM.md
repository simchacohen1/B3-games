# Class Pointer classroom pilot

## Dashboard entry

Teachers open **Teacher Tools → Class Pointer — Start a lesson**, choose their class, click **Open teacher classroom**, then **Start class** and **Share teaching screen**. Students already signed in to Fun Torah Tools click **Class Pointer** beside their name. The entry page verifies their existing passcode, reads their account name and active class membership, and waits for that class's lesson. Students join automatically using their account name; the teacher controls pointing/highlighting permissions and can remove students. No passcode is included in a classroom URL or sent to another participant. For other classes, the owner must grant the Class Pointer tool first.

Dashboard lesson discovery stores only temporary room metadata under `b3Games/workspaces/<workspace>/classes/<class>/classPointerSessions/<room>`, using existing authenticated class teacher rules. Disconnect cleanup and End class remove only that room, avoiding interference with another teacher's session. Discovery ignores rooms older than four hours. Screen video, pointers and highlights still travel through PeerJS/WebRTC; no lesson recording is saved. This live-lesson entry is separate from ordinary games' recess schedules; emergency master/class disabling still blocks entry. Direct join links remain available for manual-name pilot use.

Open `classroom.html` as the teacher. Keep Zoom open for voices and webcams.

1. Click **Start class** and **Copy join link**.
2. Give the link to one student on another computer. The student enters a name and clicks **Join class**.
3. The student appears in the teacher roster automatically. Click **Share teaching screen** and choose the teaching window or tab.
4. Check that the student receives the live picture. Students do not grant camera or microphone access.
5. Choose **Selected students**, then check **Allow [name] to point**. Moving the student's mouse over the lesson must show their pointer in both views without clicking. Moving out of the picture hides it.
6. Uncheck the student or choose **Nobody**. The student cannot place a new pointer, and their existing pointer disappears. The teacher can still point.
7. Add a second student. Allow either one, both, or **Everyone admitted**. Each pointer is independent and labeled.
8. Choose Target, Arrow, or Star and a color using **Teacher tool / Teacher color** or **My pointer / My color**. Check that the style appears in everyone’s view. Enable **Spotlight the teacher's pointer** to dim the lesson around the teacher’s pointer; the spotlight hides when the teacher leaves the picture.
9. Choose **Highlighter**, **Underline**, or **Highlight box**, a color, and **Highlight size**, then drag on the lesson. The teacher and permitted students can draw simultaneously. All browsers should show the marks. Underline draws a horizontal line; Highlight box fills the dragged rectangle.
10. Draw across another person's highlight: the earlier mark stays visible at overlaps. **Undo my highlight** removes only your latest mark; **Clear my highlights** removes only yours. Only the teacher has **Clear all highlights**. Revoking permission prevents new highlights while preserving completed marks. Removing a student clears that student's marks.
11. Test resizing, Clear teacher pointer, Clear all pointers, Stop sharing, sharing again, Remove student, and End class. Pointer clear buttons do not erase highlights. Stopping sharing clears highlights so they cannot carry over onto different teaching material.

The existing `index.html` practice simulation remains separate.

Teacher and student pages have **Full-screen lesson** above the picture. This expands the entire lesson stage, including pointers, highlights, and spotlight, while hiding the surrounding controls. Click **Exit full screen** in the top-right corner, or press **Escape**, to return. Each person controls their own view. If native browser fullscreen is unavailable, the lesson fills the browser viewport instead. Letterboxing and normalized overlay coordinates update through the existing resize observers. The exit button does not create a pointer or highlight.

While sharing, the teacher also gets **Choose shared area**, **Share full screen**, **Zoom −**, **Zoom +**, and **Move view**. **Choose shared area** opens the original capture and lets the teacher drag a rectangle around the part students should see; the selection keeps the capture's aspect ratio so text is not stretched. The browser renders that selected/zoomed viewport into a new canvas-backed video stream, and that processed stream is what admitted students receive. **Zoom +** moves closer inside the selected area; turn on **Move view** and drag the lesson to pan without placing a teacher pointer or highlight. Changing crop/zoom resets existing pointers and highlights so old marks cannot drift onto different content.

## Connection design

PeerJS 1.5.5 uses its public signaling service to establish WebRTC data and one-way video connections. Video is sent from the teacher directly to each admitted student. No lesson recording, student camera or student microphone is used. Direct-link names are self-entered; dashboard entry uses the account name. Students with a valid name join automatically while the class is open, up to the 12-student pilot limit. A random join link identifies a temporary session. Refreshing or closing the teacher page ends it.

The teacher is authoritative: admission and pointing permission are checked on receipt, not only in student controls. Student identities derive from the connection and use a separate namespace from the teacher. Untrusted names render as text. Coordinates are finite values between 0 and 1, relative to the contained video picture. Shapes and colors use fixed allowlists. Only the teacher controls the spotlight. Hover updates are coalesced with a trailing update to retain the final position. Mouse leave, revoking access, disconnecting, stopping capture, or ending class cancels queued updates and removes the appropriate pointer state.

Highlight strokes use the same normalized coordinates and permission policy. Each person's marks are stored independently with connection-derived ownership. SVG masks protect earlier marks from other people's overlapping strokes. Students may undo or clear only their own marks; the teacher may clear the whole lesson. Strokes are limited to 256 points, 40 marks per person, and 240 marks per class to bound browser and network work. Completed marks persist until their owner clears them, the teacher clears all, the student leaves, or screen sharing stops. Highlights stay attached to screen positions; scrolling the captured teaching material does not track document text.

This is a first-device pilot, with a maximum of 12 students per teacher session. Teacher upload bandwidth grows with each student. School filtering, blocked signaling, and restrictive networks can prevent connections. A school-device test is required before classroom use. A managed relay or broadcast service may be needed for dependable connections across school networks or larger classes; that infrastructure is not provisioned by this change.

References: [PeerJS getting started](https://peerjs.com/client/getting-started), [PeerJS API](https://peerjs.com/docs/#api), [PeerJS release 1.5.5](https://github.com/peers/peerjs/releases/tag/v1.5.5).

## Validation

Run `node --test tests/class-pointer.test.cjs tests/class-pointer-viewport.test.cjs`. Tests cover admission, allow-one/several/everyone/nobody policy, malformed coordinates, letterboxing and resize math, connection-bound identity, forged teacher identity, revocation, disconnect cleanup, bounded highlight payloads, and owner-only undo/clear.

Browser verification uses separate teacher and student tabs, the real PeerJS signaling service, real WebRTC media/data connections, and a synthetic animated teaching-screen stream instead of capturing private desktop content. Same-computer tabs do not prove connectivity from a student's school network.
