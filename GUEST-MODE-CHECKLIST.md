# Guest Mode: test checklist (do this on your computer BEFORE pushing)

How to open the test copy: ask Claude to start the local test site, then open http://localhost:8123/index.html
Use a private/incognito window so nothing is already signed in. Press Ctrl+Shift+R after any change.

## A. Sign-in screen and tour
1. [ ] The sign-in screen shows an "Explore as Guest" button under "Open Fun Torah Tools".
2. [ ] Click it. No name or passcode asked. The home page opens.
3. [ ] A yellow bar at the top says "Guest Mode – nothing you do here is saved" with "Sign in" and "Exit guest mode".
4. [ ] A 5-step tour starts (Learn & Practice, More Learning, My Class, Tests & Challenges, Teacher Tools). Next, Back and Skip all work.
5. [ ] "Exit guest mode" brings back the normal sign-in screen.

## B. Each tool as a guest (yellow bar must show on every page)
6. [ ] Posuk Practice: 3 different pesukim open; the 4th shows "Sign in to unlock".
7. [ ] Chazara Chart: opens with 3 sample pesukim.
8. [ ] Shorashim: only a few sample words; finishing them shows "Sign in to unlock". Record button shows "Sign in to unlock".
9. [ ] Rashi Letters: first 3 steps work; step 4 shows "Sign in to unlock".
10. [ ] Yiddish: Step 1 only (4 words); Practice works; Steps 2-8 locked. Also try Flashcards, Missing Word, Sound Builder and "Read the illustrated story".
11. [ ] Gematria: 6 practice questions and 1 timed round, then "Sign in to unlock". "Play with Friends" says sign in.
12. [ ] Halacha, Weekly Quiz, Game Show: clicking each shows "Sign in to unlock" and stays on the home page.
13. [ ] Class Gallery: 8 sample posts from "Sample Student A-H", purple DEMO tag, no real student names. "Pin a project" says sign in.
14. [ ] Student Rewards: "Sample Student (DEMO)" with 85 points; Progress, Rewards, Comments tabs work.
15. [ ] Class Dashboard (Teacher Tools card): 8 made-up students, purple DEMO bar, no phone or WhatsApp buttons.

## C. Teacher pages must be blocked for guests
16. [ ] While in guest mode, type each address directly. Each must say "Not available in Guest Mode":
   - /owner-admin.html
   - /admin.html
   - /teacher-home.html
   - /sync-to-nigri/index.html
   - /student-report/index.html
   - /record_pesukim/teacher.html (and the other */teacher.html pages)
17. [ ] On the home page as a guest: no "Owner Admin" or "Approvals" button; no "Sign in as a Student", "Sync to Nigri" or "Student Report" card. Other teacher cards only show a "Sign in to unlock" message.

## D. Nothing reaches the database (most important)
18. [ ] Open the Firebase console for project b3-games > Realtime Database. Note the time.
19. [ ] Do 5 minutes of guest activity in several tools (answer questions, finish a round, try a recording).
20. [ ] Refresh the database console. No new entries named guest, guest_preview, demo_..., or Sample Student appear anywhere (check posukPractice, b3Games, studentRewards, classGallery).
21. [ ] Check Teacher Center, Approvals, Student Rewards teacher page and Class Dashboard: no guest or sample student appears in any list.
22. [ ] Optional: in the browser press F12 > Console while guest. Type `B3Guest.blockedWrites`. A number above 0 after activity means writes were attempted and stopped.

## E. Real logins still work exactly as before
23. [ ] Sign in as a real test student (own passcode). Home page, tools and saving work normally. No yellow bar.
24. [ ] Sign in as the owner/teacher with Google. Teacher Tools, Owner Admin, Approvals, Sync to Nigri all open normally.
25. [ ] While in guest mode, sign in with the teacher Google account: guest mode switches off by itself.

## Before pushing (GitHub Desktop)
Only commit the guest-mode files. Other changed files in GitHub Desktop (backend/, firebase-rules.json, student-tool-controls.js, tests/, e2e/) are NOT part of Guest Mode: leave them unchecked unless you know what they are.
Guest-mode files: guest-mode.js, game-gate.js, index.html, class-gallery/guest-demo.js, GUEST-MODE-CHECKLIST.md, and the tool pages listed in CLAUDE.md under "Guest Mode".
