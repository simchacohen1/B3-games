# sols.tools (Shluchim Online School)

The same website is served at two addresses from the same live Firebase project:

| Address | Repository | Branding |
| --- | --- | --- |
| https://funtorahtools.com | `simchacohen1/B3-games` (this one) | Fun Torah Tools |
| https://sols.tools | `simchacohen1/sols-school-site` | Shluchim Online School |

How a release reaches sols.tools:

1. Code is merged to `main` here. funtorahtools.com updates as it always has.
2. Within about 15 minutes the **Update from B3-games** workflow in
   `sols-school-site` notices the new commit, copies it, runs
   `sols-site/build.mjs` on the copy and commits the result there.
   GitHub Pages then publishes sols.tools.

Nothing in this folder is loaded by funtorahtools.com. `brand.js` only changes
the visible site name and the browser-tab icon on the sols.tools copy; accounts,
saved work and Firebase paths are identical on both addresses.

Do not edit `sols-school-site` by hand: the next update overwrites it. Change
this repository instead.

When a new backend function or host allow-list is added, include
`https://sols.tools` and `https://www.sols.tools` next to the
funtorahtools.com entries, or that feature will fail on sols.tools.
