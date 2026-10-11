# Fun Torah Tools — Stripe teacher subscriptions (DRAFT)

**Status: not deployed / not enabled.** The independent review branch contains
`teacher-registration-preview.html` (no-network demo) and
`teacher-registration.html` (calls a disabled-by-default Stripe Checkout backend).
Never turn on live billing by merging this PR.

## Intended customer experience

A teacher chooses learning tools, enters his class size (1–300), provides his
verified-Google teacher email, school and class name, accepts the annual terms,
and clicks secure checkout. The **school pays by credit card** through hosted
Stripe Checkout. No child ever registers for billing, enters card details, or
gets access to Stripe.

Pricing currently proposed:
- Base: **$100/year**, includes teacher and first five student seats.
- Each additional student: **$10/year**.
- Shorashim Lab: **$39/year** (user-approved).
- All other tool prices in the page/catalog are **provisional**.
- Initial purchase: seven-day **full money-back guarantee**;
  define refund contact/process and exclusions before launch.

Annual auto-renewal is planned; notify buyers of the renewal terms and support
cancellation. Taxes and compliance must be reviewed separately.

## Server-side design

- `billing-catalog.cjs`: server-authoritative USD cent prices, tool IDs,
  seat validation and Stripe recurring line items. Browser totals are estimates.
- `billing-stripe-client.cjs`: Stripe form-encoded REST client using Node 22,
  plus HMAC-SHA256 signature/timestamp verification for Stripe webhooks. No new
  npm dependency and no client-side API keys.
- `billing-stripe.js`: creates hosted Checkout sessions and a webhook endpoint.
  Both refuse requests while `FTT_BILLING_ENABLED` is not exactly `true`.
- `billing-fulfillment.cjs`: paid class IDs are unique (`paid_<order UUID>`)
  and do not overwrite the owner’s B3 ET/WT classes. The private order is
  stored under `b3Private/billing`. Only a verified paid, active Stripe
  subscription creates a teacher invitation and per-class tool entitlements.
  Subsequent subscription events reconcile only to **paid annual Stripe line items**\
  with matching server-side price, tool ID and seat-count metadata; revoked\
  purchases are explicitly locked.
- A teacher claims a paid invitation by signing in with the matching, verified
  Google email via the existing teacher-claim endpoint.
- Student seat admission now uses a Firebase transaction on each paid
  class's `billing.seatAllocations` map. Creates, adds and reactivations
  reserve before writing and removals/deactivations release afterward.
  Renewals only update specific `billing` fields and preserve allocations.
  Unit tests cover concurrent requests. **End-to-end emulator checks are
  still needed for failed writes, races with subscription cancellation, and
  capacity reconciliation.**

## Secrets and deployment (only after launch blockers are resolved)

Use a **separate staging Firebase project** with a Stripe sandbox test secret
and webhook signing secret. Avoid using production deployment for test cards.

Required Cloud Function secrets:
- `FTT_STRIPE_SECRET_KEY` — secret `sk_test_...` in staging;
  live `sk_live_...` only on approved live deployment.
- `FTT_STRIPE_WEBHOOK_SECRET` — endpoint-specific `whsec_...`.

Configure them securely through Firebase CLI Secret Manager; never paste
keys into HTML, GitHub, screenshots or chat.

Keep `FTT_BILLING_ENABLED` **unset** or `false` in production.
A separate staging deployment may set it to `true` when ready for end-to-end
sandbox checkout tests. **No unreviewed production activation.**

Webhook endpoint: `funTorahStripeWebhook`; register events:
`checkout.session.completed`, `invoice.paid`,
`invoice.payment_failed`, `customer.subscription.updated`,
`customer.subscription.deleted`.

Checkout function: `funTorahCreateCheckout`. Checkout always recomputes price
on the server and returns only a Stripe-hosted URL.

Verified paid teachers can click **Manage Billing** for their own classroom,
which calls `funTorahBillingPortal` and creates a short-lived Stripe customer
portal session. Stripe Dashboard configuration must be reviewed before enabling
cancellations. The portal handles billing details and subscription cancellation;
**tool removals and seat upgrades remain planned**. The teacher dashboard
now has a **Shorashim Lab add-on** flow, which previews the actual prorated
amount with Stripe, asks for explicit teacher confirmation, and only grants
access after a verified payment. The quote expires after five minutes and
uses a Stripe idempotency key. The webhook preserves already paid tools
while an upgrade charge is outstanding and limits access to the verified
paid-through date. All of this remains disabled/unproven in a sandbox
end-to-end test.

A shared Gallery/Tag purchase is blocked in the checkout handler and
subscription parser until app permissions are separated. They may still appear
in the visual registration preview, and must be removed or disabled before
publishing real registration.

## Prorated add-on setup (sandbox only)

A school/teacher keeps one annual renewal date. In the new draft Teacher Center,
a paid teacher lacking Shorashim Lab can click **Add Shorashim**.

The first signed-in request previews Stripe's proration using the subscription's
current item IDs, unchanged billing anchor and a saved proration timestamp.
The teacher is shown **the actual Stripe-generated amount due** before
confirmation. Confirmation repeats the preview at the same timestamp and
requires the displayed charge to match exactly. A short-lived quote,
transactional upgrade lock and idempotency key prevent accidental duplicate
changes. Stripe is asked to invoice immediately using
`proration_behavior=always_invoice` and
`payment_behavior=pending_if_incomplete`. Unpaid upgrades should not
unlock additional tools or revoke tools already purchased.

Set `FTT_STRIPE_UPGRADE_PRICES_JSON` on the **staging Cloud Function environment**
to a JSON mapping from catalog tool ID to an account-specific **active annual
Stripe Price ID**, e.g. `{"shorashim":"price_TEST_ACCOUNT_VALUE"}`.
This mapping is server-only; never accept arbitrary price IDs from browsers.
Prices require an active Product with metadata `fttKind=tool` and
`fttToolId=shorashim`, price USD 3900 cents, annual interval. The
previously created **inactive** sandbox Shorashim price/product needs metadata
and activation reviewed before end-to-end testing. For other tools, first
confirm their owner-approved annual prices and separate entitlements.

**Important:** The current proration quote and upgrade flow has **unit tests
only**. A true sandbox test must verify the Stripe invoice preview,
payment methods requiring customer action, Stripe invoice paid/failed events,
and exact grant updates through Firebase. Keep billing disabled until then.

## Tests

`node --test backend/functions/billing.test.cjs`

GitHub Actions job: `Stripe Billing Tests`. These are unit tests for pricing,
signature checking and deterministic class entitlements, NOT proof of a live
Firebase/Stripe integration.

## Required before inviting paying schools

1. Finalize and confirm **every other tool price** and the exact base/seat
   model. Avoid collecting real payments for provisional prices.
2. Fully isolate **Class Gallery** and **Tag Game** permissions — existing
   `student-tool-policy.js` treats them as aliases, so separately purchased
   entitlements are not safe yet.
3. Complete **multi-tenant data isolation and Firebase database rules audit**;
   existing legacy roots contain public read/write permissions. Ensure every
   teacher/student API uses authenticated per-class access and that B3 legacy
   data isn't exposed cross-school.
4. Verify the new transactional seat limits end-to-end in Firebase
   emulator with concurrent requests, update failures and reconciliation.
5. Integration-test sandbox card success, failed payment, expired/canceled
   checkout, duplicate and reordered webhooks, renewal, nonpayment,
   cancellations, refunds within seven days and renewal terms.
6. Configure and verify Stripe's hosted Billing Portal for billing details
   and end-of-period cancellations; add an authenticated tool-change purchase
   flow and document refunds. Review applicable sales taxes.
7. Confirm authorization for the teacher after payment, email ownership,
   teacher invite claiming, and class/student access after cancellation.
8. Add rate limiting/abuse controls for unauthenticated checkout, and
   verify webhook event replay handling in production.
9. Prefer stable Stripe catalog products/prices rather than creating new
   inline Price/Product objects for every checkout.
10. Expand the Shorashim-only prorated tool-addition draft to other
    owner-approved product prices, and implement tool removal and seat changes
    with agreed renewal/proration behavior. Current subscription additions
    are untested against real Stripe sandbox checkout and invoice events.
11. Implement refund workflows: refunding an initial purchase must also
    cancel the subscription, revoke paid access and avoid later renewal charges.
12. Obtain final owner approval before configuring live secrets, publishing
    the registration entry point or turning on billing.

The owner’s existing teacher login and B3 classes are intentionally unchanged
in this draft.
