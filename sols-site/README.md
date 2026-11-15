# sols.tools (Shluchim Online School)

The same website is served at two addresses from the same live Firebase project:

| Address | Repository | Branding |
| --- | --- | --- |
| https://funtorahtools.com | `simchacohen1/B3-games` (this one) | Fun Torah Tools |
| https://sols.tools | `simchacohen1/sols-school-site` | Shluchim Online School |

How a release reaches sols.tools:

1. Code is merged to `main` here. funtorahtools.com updates as it always has.
2. The **Sync sols.tools site** workflow (`.github/workflows/sync-sols-site.yml`)
   runs on the same push, copies the release to `sols-school-site`, runs
   `sols-site/build.mjs` on the copy and commits it there. GitHub Pages then
   publishes sols.tools, usually within two minutes. It uses the
   `SOLS_SITE_DEPLOY_KEY` secret, a deploy key that can write to
   `sols-school-site` only.
3. Backup: the **Update from B3-games** workflow in `sols-school-site` can do
   the same copy on demand (Actions > Run workflow) and is a no-op when step 2
   already copied the commit.

Nothing in this folder is loaded by funtorahtools.com. `brand.js` only changes
the visible site name and the browser-tab icon on the sols.tools copy; accounts,
saved work and Firebase paths are identical on both addresses.

## Only Class Pointer for teachers and students

`pointer-only.js` (issue #832) is put at the start of `/sols-brand.js` on the sols.tools copy.
For everyone except a site administrator it:

- sends any page other than the home page, the teacher home page and the Class Pointer
  pages (`/class-pointer-prototype/`) back to the home page;
- hides the other tools on the student home page and the teacher home page.

A site administrator who has signed in on sols.tools keeps the whole site in that browser.
This is display only: accounts, data and rules are unchanged, and the same account still
sees its class's tools on funtorahtools.com. To show another tool on sols.tools, add its
folder to the allowed list in `pointer-only.js`.

Do not edit `sols-school-site` by hand: the next update overwrites it. Change
this repository instead.

When a new backend function or host allow-list is added, include
`https://sols.tools` and `https://www.sols.tools` next to the
funtorahtools.com entries, or that feature will fail on sols.tools.

## Google sign-in domain

The custom-domain cutover is enabled in PR #838 through `auth-domain.json`.
Complete [the sign-in verification and release checks](../docs/SOLS-AUTH-DOMAIN.md)
before merging or deploying it. The website stays on GitHub Pages; Firebase Hosting serves only
the authentication subdomain. Staging keeps its separate Firebase project.
