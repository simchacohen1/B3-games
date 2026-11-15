# SOLS Google sign-in domain

Status: prepared, NOT activated or deployed. External owner setup is required.

## Inspection (2026-11-15)

- Read AGENTS.md, open PR file lists, docs/MIGRATION_AUDIT.md, staging/README.md,
  staging/generate-config.cjs and the merged SOLS migration PRs #826, #830, #831, #833.
- No open PR touches the files changed in this PR.
- B3-games Pages serves funtorahtools.com from main. sols-school-site Pages serves
  sols.tools; B3-games main automatically syncs it through sols-site/build.mjs.
- sols.tools resolves to GitHub Pages; /__/auth/handler returns 404.
  auth.sols.tools has no DNS record. Do not point the apex at Firebase.
- Production public Auth config authorizes sols.tools and www.sols.tools, but
  not auth.sols.tools. SDK authDomain is b3-games.firebaseapp.com.
- Both existing production and staging /__/auth/handler and /__/auth/iframe
  endpoints return 200. This is infrastructure evidence, NOT a successful login.
- Staging SDK project is fun-torah-tools-staging, with its own Auth and RTDB;
  its generator requires the existing staging firebaseapp.com domain. Preserve it.
- No Firebase/Google Cloud/DNS credentials or browser-control tools are available
  in this session. OAuth redirect URI lists, Hosting custom-domain ownership,
  and private account/role state could not be inspected.

## Rabbi Cohen: required external setup

1. Open https://console.firebase.google.com/project/b3-games/hosting . Inspect
   existing sites/releases first. Add custom domain **auth.sols.tools** to the
   **b3-games** Hosting site (not a redirect to sols.tools). Complete ownership
   verification and copy exactly the DNS records Firebase supplies into the
   sols.tools DNS provider. Change only auth and the requested verification TXT;
   leave apex/www GitHub Pages records alone. Wait until Firebase says Connected
   and HTTPS is valid. Do not guess the A/CNAME/TXT values.
2. In https://console.firebase.google.com/project/b3-games/authentication/settings
   → Authorized domains, add **auth.sols.tools**. Keep every existing entry.
3. In Authentication → Sign-in method → Google, identify the configured Web SDK
   OAuth client ID. Open that SAME client in
   https://console.cloud.google.com/apis/credentials?project=b3-games . Add the
   authorized redirect URI **https://auth.sols.tools/__/auth/handler**. Keep the
   existing firebaseapp.com URI, origins, client ID/secret and account audience.
   Do not create a replacement OAuth client. If Google requires domain
   verification/Branding authorized domains, add/verify **sols.tools** there.
4. Confirm HTTPS /__/auth/handler and /__/auth/iframe on auth.sols.tools serve the
   Firebase helpers, not the website, a redirect, or a generic 200/404 page.
   Check the handler's Google request uses the SAME OAuth client and the new
   redirect_uri. Verify the mapping in Firebase Hosting, not just HTTP status.

Firebase supplies reserved /__/auth/* helpers; do not copy an HTML login page to
GitHub Pages as a substitute. firebase.auth-hosting.json is an isolated optional
Hosting-only config, with no functions/database/storage deployment. If the default
site needs its first Hosting release, review its current content before running:

```
npx firebase-tools@15.26.0 deploy --project b3-games --config firebase.auth-hosting.json --only hosting:b3-games
```

This is a live Hosting release and still needs explicit approval. Do not overwrite
an existing Hosting release just to attach the custom domain; attaching it may be
sufficient. Main site hosting must stay on GitHub Pages.

## Controlled cutover and verification

After external setup, change only sols-site/auth-domain.json enabled to true.
The SOLS build changes production authDomain literals in root configuration and
inline fallbacks together, including tools that do not use the root config. It
leaves source funtorahtools.com configuration, staging files, project IDs, RTDB,
Storage, roles, UIDs, account policies and persistence code unchanged. Repeated
builds are idempotent. The switch is currently false; merging this preparation
alone cannot change the live authDomain.

Before requesting a live merge, build an isolated SOLS preview from the task
branch, authorize its exact origin in production Auth, and test ONLY fictional
adult accounts whose assigned classes/roles are known. Do not use staging's
accounts or database as production fixtures. A preview has separate browser
storage and cannot prove that existing live sessions survive; check those after
an approved production release too.

Verify desktop Chrome and a real Android phone: Google account chooser shows
**auth.sols.tools**; teacher lands on teacher-home.html with assigned classes;
owner/admin and principal retain their expected permissions; Pointer and Class
Access use the same session; student passcodes work; refresh, tab reopen, tool
navigation and sign-out/sign-in add no loops or unexpected prompts. Check staging
Google login separately using its existing authorized accounts and Firebase
project; never import production users, claims or data into staging.

site-settings.js uses popup sign-in with a redirect fallback on selected errors.
Firebase documents cross-origin iframe/storage limitations for redirect sign-in.
A sibling auth subdomain is not proof that every browser fallback works. Exercise
popup-blocked and redirect recovery on Android before enabling. If recovery fails,
keep the gate off and address that path separately; do not change authentication
methods blindly or move the main site off Pages.

No real Google login, chooser branding, return URL, permissions, existing-session
continuity, Android flow or authenticated staging flow was verified in this session.

Rollback: set enabled false and rebuild/sync the SOLS copy after an approved
release. Retain old OAuth redirect URIs throughout; no user/data migration occurs.
Allow already-open tabs to finish authentication before changing/removing domain
settings. Do not remove the custom handler during rollback.

## Validation

58 local tests passed across SOLS auth-domain/build, pointer-only branding,
staging isolation/claims, migration access and student authentication. Source tests
prove configuration boundaries, not external OAuth or browser compatibility.

Official references:
- https://firebase.google.com/docs/auth/web/google-signin#customizing-the-redirect-domain-for-google-sign-in
- https://firebase.google.com/docs/hosting/custom-domain
- https://firebase.google.com/docs/auth/web/redirect-best-practices
