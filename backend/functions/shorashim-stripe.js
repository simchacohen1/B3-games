'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('node:crypto');

if (!admin.apps.length) admin.initializeApp();

const stripeSecret = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const priceId = defineString('STRIPE_SHORASHIM_PRICE_ID');
const region = 'us-central1';
const workspaceId = 'b3-2026';
const origins = ['https://funtorahtools.com', 'https://www.funtorahtools.com', 'https://simchacohen1.github.io'];
const cors = origins;
const db = () => admin.database();
const base = 'https://api.stripe.com/v1/';

function stripeKey() {
  const key = stripeSecret.value();
  if (!key || !key.startsWith('sk_test_')) throw new Error('Sandbox Stripe key is not configured.');
  return key;
}

async function stripeRequest(path, { method = 'GET', form } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + stripeKey(),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    },
    body: form ? form.toString() : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Stripe API request failed', response.status, data?.error?.type || '');
    throw new Error('Stripe could not complete the request.');
  }
  return data;
}

function formData(entries) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) form.set(key, String(value));
  }
  return form;
}

async function identityFromRequest(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!match) throw Object.assign(new Error('Sign in with your teacher Google account.'), { status: 401 });
  let identity;
  try { identity = await admin.auth().verifyIdToken(match[1], true); }
  catch (_) { throw Object.assign(new Error('Please sign in again.'), { status: 401 }); }
  if (!identity.uid || identity.email_verified !== true || identity.firebase?.sign_in_provider !== 'google.com') {
    throw Object.assign(new Error('Use your verified teacher Google account.'), { status: 403 });
  }
  const email = String(identity.email || '').toLowerCase();
  const [ownerAdmin, adminRecord, teacher] = await Promise.all([
    Promise.resolve(email === 'simcha5770@gmail.com'),
    db().ref('b3Games/admins/' + identity.uid).get(),
    db().ref('b3Games/workspaces/' + workspaceId + '/teachers/' + identity.uid).get()
  ]);
  const adminOk = ownerAdmin || (adminRecord.exists() && adminRecord.val()?.active !== false);
  const teacherData = teacher.val() || null;
  if (!adminOk && (!teacherData || teacherData.active === false)) {
    throw Object.assign(new Error('This Google account is not an active Fun Torah Tools teacher.'), { status: 403 });
  }
  return { uid: identity.uid, email, admin: adminOk, teacher: teacherData };
}

async function assignedClass(identity, classId) {
  if (typeof classId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(classId)) {
    throw Object.assign(new Error('Choose a valid class.'), { status: 400 });
  }
  const assigned = identity.admin || identity.teacher?.classIds?.[classId] === true;
  if (!assigned) throw Object.assign(new Error('This class is not assigned to your teacher account.'), { status: 403 });
  const ref = db().ref('b3Games/workspaces/' + workspaceId + '/classes/' + classId);
  const snap = await ref.get();
  const cls = snap.val();
  if (!cls || cls.active === false) throw Object.assign(new Error('This class is unavailable.'), { status: 404 });
  return { ref, cls };
}

function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 503;
  if (status === 503) console.error('Shorashim subscription request failed:', error?.message || error);
  return res.status(status).json({ error: status === 503 ? 'Subscription service is temporarily unavailable. Please try again.' : error.message });
}

function makeIntegrationId() {
  const suffix = crypto.randomBytes(5).toString('hex').slice(0, 8);
  return 'fun-torah-tools-' + suffix;
}

exports.createShorashimCheckout = onRequest(
  { region, cors, secrets: [stripeSecret], maxInstances: 5 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    try {
      const identity = await identityFromRequest(req);
      const classId = String(req.body?.classId || '');
      const { ref, cls } = await assignedClass(identity, classId);
      if (cls.toolGrants?.shorashim === true) {
        return res.status(409).json({ error: 'Shorashim is already enabled for this class.' });
      }
      const configuredPrice = String(priceId.value() || '');
      if (!/^price_[A-Za-z0-9]+$/.test(configuredPrice)) throw new Error('Sandbox Shorashim price is not configured.');
      const price = await stripeRequest('prices/' + encodeURIComponent(configuredPrice));
      if (!price.active || price.type !== 'recurring' || price.recurring?.interval !== 'year') {
        throw new Error('The configured Shorashim price is not an active annual recurring price.');
      }
      const pendingRef = db().ref('b3Private/shorashimCheckoutLocks/' + identity.uid + '/' + classId);
      const lock = await pendingRef.transaction(current => {
        if (current?.expiresAt > Date.now()) return;
        return { nonce: crypto.randomUUID(), expiresAt: Date.now() + 30000 };
      });
      if (!lock.committed) return res.status(409).json({ error: 'A checkout is already being prepared. Please wait a moment.' });
      try {
        const metadata = { teacherUid: identity.uid, classId, workspaceId, tool: 'shorashim' };
        const fields = {
          mode: 'subscription',
          success_url: 'https://funtorahtools.com/teacher-subscription.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
          cancel_url: 'https://funtorahtools.com/teacher-subscription.html?checkout=cancelled',
          'line_items[0][price]': configuredPrice,
          'line_items[0][quantity]': 1,
          customer_email: identity.email,
          client_reference_id: identity.uid,
          integration_identifier: makeIntegrationId(),
          allow_promotion_codes: 'true'
        };
        for (const [key, value] of Object.entries(metadata)) {
          fields['metadata[' + key + ']'] = value;
          fields['subscription_data[metadata][' + key + ']'] = value;
        }
        const session = await stripeRequest('checkout/sessions', { method: 'POST', form: formData(fields) });
        await db().ref('b3Private/shorashimCheckoutSessions/' + session.id).set({
          teacherUid: identity.uid, classId, workspaceId, priceId: configuredPrice,
          createdAt: Date.now(), expiresAt: session.expires_at ? session.expires_at * 1000 : null
        });
        return res.json({ url: session.url });
      } finally {
        await pendingRef.transaction(current => current?.nonce === lock.snapshot.val()?.nonce ? null : undefined);
      }
    } catch (error) { return sendError(res, error); }
  }
);

exports.createShorashimBillingPortal = onRequest(
  { region, cors, secrets: [stripeSecret], maxInstances: 5 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    try {
      const identity = await identityFromRequest(req);
      const customer = (await db().ref('b3Private/stripeCustomerByTeacher/' + identity.uid).get()).val();
      if (!customer?.id) return res.status(404).json({ error: 'No Shorashim subscription is connected to this account yet.' });
      const portal = await stripeRequest('billing_portal/sessions', {
        method: 'POST',
        form: formData({ customer: customer.id, return_url: 'https://funtorahtools.com/teacher-subscription.html' })
      });
      return res.json({ url: portal.url });
    } catch (error) { return sendError(res, error); }
  }
);

function verifySignature(rawBody, header, secret) {
  const values = Object.fromEntries(String(header || '').split(',').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
  const timestamp = Number(values.t);
  const signatures = String(header || '').split(',').filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !signatures.length) return false;
  const expected = crypto.createHmac('sha256', secret).update(String(timestamp) + '.').update(rawBody).digest();
  return signatures.some(value => {
    if (!/^[a-f0-9]{64}$/i.test(value)) return false;
    const actual = Buffer.from(value, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

async function subscriptionForEvent(event, stripeEventObject) {
  if (event.type.startsWith('customer.subscription.')) return stripeEventObject;
  const session = stripeEventObject;
  if (!session.subscription) return null;
  if (session.mode !== 'subscription' || session.payment_status !== 'paid') return null;
  return stripeRequest('subscriptions/' + encodeURIComponent(session.subscription));
}

async function applySubscription(subscription, eventId) {
  const metadata = subscription?.metadata || {};
  const teacherUid = String(metadata.teacherUid || '');
  const classId = String(metadata.classId || '');
  if (!teacherUid || !classId || metadata.workspaceId !== workspaceId || metadata.tool !== 'shorashim') return;
  const privatePath = 'b3Private/stripeSubscriptions/' + subscription.id;
  const savedSnap = await db().ref(privatePath).get();
  let saved = savedSnap.val() || {};
  const teacherSnap = await db().ref('b3Games/workspaces/' + workspaceId + '/teachers/' + teacherUid).get();
  const teacher = teacherSnap.val();
  const adminSnap = await db().ref('b3Games/admins/' + teacherUid).get();
  const authorized = teacher?.active === true || adminSnap.exists() || teacherUid === 'owner';
  const clsRef = db().ref('b3Games/workspaces/' + workspaceId + '/classes/' + classId);
  const clsSnap = await clsRef.get();
  const cls = clsSnap.val();
  const stillAssigned = authorized && !!cls && cls.active !== false &&
    (teacher?.classIds?.[classId] === true || adminSnap.exists());
  const isActive = stillAssigned && ['active', 'trialing'].includes(subscription.status);
  if (!saved.previousGrant && !saved.createdAt && cls) {
    saved.previousGrant = cls.toolGrants?.shorashim === true;
  }
  saved = {
    ...saved, subscriptionId: subscription.id, teacherUid, classId, workspaceId,
    customerId: subscription.customer || saved.customerId || '',
    status: isActive ? subscription.status : String(subscription.status || 'inactive'),
    active: isActive, cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    currentPeriodEnd: subscription.current_period_end || null,
    priceId: subscription.items?.data?.[0]?.price?.id || saved.priceId || '',
    updatedAt: Date.now(), lastEventId: eventId,
    createdAt: saved.createdAt || Date.now()
  };
  await db().ref(privatePath).set(saved);
  if (saved.customerId) await db().ref('b3Private/stripeCustomerByTeacher/' + teacherUid).set({ id: saved.customerId });
  if (!cls) return;
  const activeSubs = await db().ref('b3Private/stripeSubscriptions').get();
  const hasActiveForClass = Object.values(activeSubs.val() || {}).some(row =>
    row?.active === true && row.teacherUid === teacherUid && row.classId === classId
  );
  if (isActive) {
    await clsRef.child('toolGrants/shorashim').set(true);
    await clsRef.child('subscriptionOriginalShorashimGrant').set(saved.previousGrant === true);
  } else if (!hasActiveForClass) {
    await clsRef.child('toolGrants/shorashim').set(saved.previousGrant === true);
    await clsRef.child('subscriptionOriginalShorashimGrant').remove();
  }
}

exports.shorashimStripeWebhook = onRequest(
  { region, secrets: [stripeSecret, stripeWebhookSecret], maxInstances: 10 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).send('Use POST.');
    const raw = req.rawBody;
    if (!Buffer.isBuffer(raw) || !verifySignature(raw, req.headers['stripe-signature'], stripeWebhookSecret.value())) {
      return res.status(400).send('Invalid Stripe signature.');
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); }
    catch (_) { return res.status(400).send('Invalid event body.'); }
    if (event.livemode !== false) return res.status(400).send('Live events are disabled until approved.');
    const eventRef = db().ref('b3Private/stripeWebhookEvents/' + event.id);
    if ((await eventRef.get()).exists()) return res.json({ received: true, duplicate: true });
    try {
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' ||
          event.type.startsWith('customer.subscription.')) {
        const subscription = await subscriptionForEvent(event, event.data?.object || {});
        if (subscription) await applySubscription(subscription, event.id);
      }
      await eventRef.set({ receivedAt: Date.now(), type: event.type });
      return res.json({ received: true });
    } catch (error) {
      console.error('Shorashim Stripe webhook failed:', error?.message || error);
      return res.status(500).send('Webhook processing failed; Stripe may retry.');
    }
  }
);
