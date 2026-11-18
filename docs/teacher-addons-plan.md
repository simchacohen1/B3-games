# Teacher Add-ons: plan (approved by the owner)

Teachers at SOLS build their own web apps (for example on Netlify). They should be able to add them to the site
themselves, without the owner.

## What the teacher does
Teacher Tools → **My add-ons** → **Add new**: upload the app as a zip, give it a name and an icon, pick their classes.
Save, and a tile appears for those students. Upload a new zip to update. Edit or remove it any time.

## What students and teachers see
- The add-on opens **inside our site**, under our top bar with our Back button. Students are never sent to another website.
- A teacher can share an add-on school-wide. Sharing school-wide needs approval from an admin or principal.
  Using it in the teacher's own classes goes live right away. Other teachers switch a shared add-on on for their own classes.

## Upload and hosting
- The zip is checked (allowed file types, size limits, no server code) and stored under its own folder.
- It is served from a **separate address (`apps.sols.tools`)**, never from `sols.tools`, in a **sandboxed iframe** with no access
  to our site, cookies or logins. Uploaded code must never run on `sols.tools` itself.
- Replacing an add-on is uploading a new zip into the same folder (the version number goes up).

## Permissions
- A teacher manages only their own add-ons and only for classes they teach.
- School-wide sharing: request, then an admin or principal approves or rejects.
- The **owner (and active admins) can switch any add-on off instantly**.
- Students can only open add-ons switched on for their class. They never see names, logins or data from other places.

## Score connector (optional)
A small script we provide, for example `sols-score.js`. The add-on calls `solsScore.send(score, max)`. Our page checks the message
came from that add-on and records the score through our own server function into marks and reports (Nigri later).
Add-ons get **no student names, logins or data**, only an anonymous session code. Scores are labelled "from an add-on".

## Risks and how they are handled
- **Isolation:** the separate origin plus the sandbox, strict headers, no cookies.
- **Abuse:** upload size and count limits, an audit log, the kill switch.
- **Fake scores:** a student can fake a score from an add-on, so they are labelled and never treated as teacher-graded work.
- **Cost:** storage and bandwidth are paid, so quotas per teacher and per school.

## Steps, in small pull requests
1. **Records, permissions and rules (no upload yet).** ← this step
2. The separate host `apps.sols.tools` with strict headers and a sandboxed viewer page.
3. Zip upload and checks (a function), and the My add-ons list and edit page.
4. Student tiles and opening inside our page.
5. School-wide sharing and approval.
6. Score connector and marks reports.
7. Owner kill switch screen and quotas, then Nigri.

Every step that touches database rules, Storage rules, functions or a new origin is HIGH RISK: the owner reads the change
in plain words and approves it before anything goes live.

---

## Step 1: what is in it

New private database node **`teacherAddons`** (added to both `firebase-rules.json`, the live rules, and `firebase-rules.hardened.json`).
Nothing that exists today changes. No student can read or write it. There is no upload and no page yet.

| Path | What it holds | Who can read | Who can write |
| --- | --- | --- | --- |
| `teacherAddons/owners/<addonId>` | the owning teacher's id | that teacher, the owner, active admins | a teacher can claim a free id for themselves and release their own; the owner/admin can do either |
| `teacherAddons/profile/<addonId>` | name, icon, description, classes, version | the add-on's teacher, owner, admins | the add-on's teacher (only for classes they teach), owner, admins |
| `teacherAddons/admin/<addonId>` | the off switch (`disabled`, who, when, why) | the add-on's teacher (to see "switched off"), owner, admins | **only the owner and admins** |

### The rule changes in plain words
1. A new top-level section `teacherAddons` is added. Everything else in the rules file is unchanged (a test proves it).
2. **Who may use it:** only signed-in, active teachers (and the owner / active admins). Students and signed-out visitors can read nothing and write nothing.
3. **Add-on ids** must look like `ad_` followed by 8 to 40 lowercase letters or digits. A teacher can only claim an id nobody has, and only for themselves.
4. **Only the owning teacher** (or the owner or an admin) can read or change an add-on's record. Another teacher cannot even read it.
5. **Classes:** a teacher can only tick classes they teach. The owner or an admin can pick any class.
6. **Size and type checks:** name 1–60 characters, icon 1–16, description up to 300, version 0–100000; unknown fields are refused.
7. **The off switch** (`admin/<addonId>/disabled`) can only be set by the owner or an admin. A teacher can see it but never clear it.
8. **Removing** an add-on removes the owner link and the record together; only that teacher, the owner or an admin can do it.

### Known limits of step 1 (handled in later steps)
- Rules cannot count, so the "how many add-ons per teacher" limit is enforced by the upload function in step 3.
- A teacher with the owner's "whole workspace" write access today can still write under `b3Games/workspaces/...`; `teacherAddons`
  is a separate node on purpose, so it does not inherit that broad write.
- Students get no read access yet. Step 4 adds a narrow, server-written "tile" list for them.

---

## Step 2: the separate add-ons host and the sandboxed viewer (staging only so far)

**What is in it**
- `_apps-host/`: the content of the separate add-ons address, deployed on its own and never served by the main site
  (the folder starts with an underscore, so GitHub Pages skips it, and the staging package skips it too).
  It holds a neutral home page and one sample add-on, `a/ad_selftest01/`, that tries eight forbidden things.
- `firebase.apps-staging.json` (deployed) and `firebase.apps-live.json` (written, NOT deployed): the hosting settings for that address.
  Every file is served with a strict policy: scripts only from the add-on itself, no connections to other sites
  (`connect-src 'self'`), no frames, no forms to other sites, no camera/microphone/location, no cookies, never cached
  (so an update or a switched-off add-on shows at once), and **only our own pages may frame it** (`frame-ancestors`).
- `addon-view.html` / `addon-view.js` on the main site: our top bar with a **Back** button, and the add-on in a sandboxed frame.
  The frame address is built only from the site's own setting and a well-formed add-on id, never from a link.
  Sandbox: `allow-scripts allow-forms allow-modals` and nothing else. No `allow-same-origin` (the add-on gets no origin,
  so no cookies, storage or access to our page), no `allow-top-navigation` (it cannot move our page), no `allow-popups`.

**What was checked in real browsers on staging** (desktop and phone width): the sample add-on, running in the viewer, could not
read our page, use storage or cookies, send data to another site, load a script from another site, open a pop-up, or move our page.
All eight checks say "blocked". A link with a bad add-on id shows a friendly message and no frame.

**Honest limits (to be handled in later steps)**
- A link inside an add-on can still move *the add-on's own frame* to another site. The student's page and our top bar stay,
  and the Back button works, but the frame itself can show another website. Blocking this completely is not possible with
  browser settings alone. Step 3's upload check refuses zips that contain external links in obvious places, and the owner can switch an add-on off.
- Add-ons must be fully self-contained (no scripts, fonts or APIs loaded from other websites). Teachers bundle everything in the zip.
- Step 2 serves files straight from the host. The instant owner kill switch needs the serving function of step 3
  (it checks the add-on's off switch on every request).
- The viewer takes the name and icon from the link and shows them as plain text; step 4 reads them from the database and checks the off switch.

**What you have to do for live (nothing is done on live yet)**
1. **Firebase site (you, or I can do it after your OK):** create a second Hosting site in the live project:
   `firebase hosting:sites:create b3-games-apps --project b3-games`. (For staging I already created
   `fun-torah-tools-staging-apps`.)
2. **Custom domain:** in the Firebase console, Hosting → site `b3-games-apps` → Add custom domain → `apps.sols.tools`.
   Firebase shows the DNS records to add.
3. **DNS record (you, in Cloudflare):** add exactly the records Firebase shows (a TXT record to prove ownership, then the A/AAAA records),
   as **DNS only (grey cloud)** until Firebase says the certificate is ready. This is the same process as `auth.sols.tools`.
4. **Deploy (after your OK):** `firebase deploy --only hosting --config firebase.apps-live.json --project b3-games`.
5. `apps.sols.tools` needs **no** sign-in settings: add-ons never sign in, so it must NOT be added to Firebase Authentication's authorized domains.
