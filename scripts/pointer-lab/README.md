# Pointer Lab (isolated test copy of Fun Torah Tools)

Runs entirely on this computer: Firebase **Auth + Realtime Database emulators** (with this checkout's `firebase-rules.json`), the real backend handlers (`student-auth`, `class-pointer-share-auth`) against them, and this checkout's website on `http://localhost:8787`. It never talks to the real Firebase project and holds only made-up data: class "Pointer Test", "Pointer Test Student A" (lab passcode 1111) and "Pointer Test Student B" (2222), teacher `teacher@pointer.lab`, owner-admin test account `simcha5770@gmail.com` (lab only). PeerJS signaling and WebRTC use the normal internet, so screen sharing works in a real browser.

## Start (what was run by hand on 2026-10-16)
1. Java 21 on the PATH (Temurin 21 is installed under `%LOCALAPPDATA%\Programs\Temurin-21`), then from a folder with a `firebase.json` that points `database.rules` at this checkout's `firebase-rules.json` and enables the `auth` (9099) and `database` (9000) emulators: `firebase emulators:start --only auth,database --project demo-pointer-lab`
2. A folder with `npm install firebase-admin@12 firebase-functions@5 express@4`; set `LAB_DEPS` to it.
3. `node scripts/pointer-lab/seed.cjs` (creates the made-up class, students, teacher) then `node scripts/pointer-lab/server.cjs`.
4. Open `http://localhost:8787/_lab/login` (teacher one-click sign-in) and `http://localhost:8787/` (students).

The emulator forgets everything when it stops; run the seed again after a restart.

## Why it exists
The new teacher page writes private permission rows and session records that only the new database rules allow, and the join tickets only exist in the new backend, so none of it can be tried against production without deploying. The lab lets the owner try the whole Pointer flow by hand with no deploy. It found a real bug the unit tests missed: Realtime Database runs a transaction function first on an empty local copy, so `verify` aborted (a valid ticket looked expired); fixed in `class-pointer-share-auth.js` (`if(row===null)return row;`) for both `joinVerify` and the existing share-ticket `verify`.
