# Unattended feature health reporting

Extends #390's existing staging workflow without adding another schedule.
Each smoke/auth/nightly run writes feature-health.md and feature-health.json
as run summaries/artifacts. No website, Firebase, rules or production changes.

The versioned catalog in testing/feature-health.json declares required complete
journeys. Exact Playwright file/title matches are used; a page-open check cannot
satisfy an unmapped journey. New HTML pages automatically appear as unmapped,
unverified entries. Auxiliary pages must be explicitly classified in future
catalog expansion; page inventory is not proof that all controls are covered.

Status: PASSED only when every declared required check passed without retries;
FAILED for failing checks; BLOCKED for skipped checks or runner errors; FLAKY for
retry-only success; UNTESTED for absent results or no complete journey mapping.
Expected-failure tests never prove a working feature. All-clear also requires no
unmapped pages. Smoke-only runs intentionally cannot prove authenticated journeys.

Initial catalog covers the principal tool families, with the existing complete
Homework journey mapped. Other families remain visibly UNTESTED until their
complete workflows are mapped or implemented and executed. This is a reporting
foundation, not a claim of comprehensive end-to-end coverage.

No credentials/error bodies are copied into this report. Existing sanitized
suite evidence remains the source for failure details and screenshots.
The staging tests still require fictional account secrets, deployed services,
and usable fixtures. This change does not provision those or enable disabled
recording/scoring integrations.

Local validation: node --test tests/feature-health-report.test.cjs
Manual report: node scripts/feature-health-report.cjs staging-results/auth.json
