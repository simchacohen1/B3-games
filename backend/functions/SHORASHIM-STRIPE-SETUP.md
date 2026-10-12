# Shorashim Lab subscription deployment notes

This code intentionally accepts only Stripe Sandbox keys and rejects live webhook events. No real charge can be initiated until the owner explicitly approves a separate live-mode change.

## Sandbox configuration

From `backend/functions` in the Firebase project:

1. Set `STRIPE_SECRET_KEY` to a restricted Stripe Sandbox secret key with access to Checkout Sessions, Prices, Subscriptions, Customers, and Billing Portal sessions.
2. Set `STRIPE_WEBHOOK_SECRET` to the signing secret for the Sandbox webhook endpoint.
3. Add `STRIPE_SHORASHIM_PRICE_ID=price_1UPRSd2QdJ1keBzqxOe9kxtL` to the functions `.env` file (Sandbox Shorashim Lab annual price).
4. Deploy only `createShorashimCheckout`, `createShorashimBillingPortal`, and `shorashimStripeWebhook`.
5. Register the deployed `shorashimStripeWebhook` URL in Stripe Sandbox for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`, and `customer.subscription.deleted`.
6. Run a test card through the teacher subscription page. Confirm class access is added only after a signed, paid Sandbox webhook. Cancel the test subscription from the portal and confirm access is removed.

Never put Stripe secrets in HTML, Firebase Realtime Database, GitHub, or a chat message. Keep test and live keys, price IDs, and webhook signing secrets separate.

The current connected Stripe tool context is Sandbox only. The repository change must not be merged/deployed until the webhook is configured, the Firebase functions are tested, and the owner approves any live-mode configuration.
