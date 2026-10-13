'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('node:crypto');
const Stripe = require('stripe');
const { validClassId, teacherMayManageClass, activeSubscriptionStatus } = require('./shorashim-stripe-core.cjs');

if (!admin.apps.length) admin.initializeApp();

const stripeSecret = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const priceId = defineString('STRIPE_SHORASHIM_PRICE_ID');
const region = 'us-central1';
const workspaceId = 'b3-2026';
const origins = ['https://funtorahtools.com', 'https://www.funtorahtools.com', 'https://simchacohen1.github.io'];
const cors = origins;
const db = () => admin.database();
function stripeClient() {
  const key = stripeSecret.value();
  if (!key || !/^(?:sk|rk)_test_/.test(key)) throw new Error('Sandbox Stripe key is not configured.');
  return new Stripe(key, { apiVersion: '2026-08-26.dahlia', maxNetworkRetries: 2 });
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
  const ownerAdmin = email === 'simcha5770@gmail.com';
  const [adminRecord, teacher] = await Promise.all([
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
  if (!validClassId(classId)) {
    throw Object.assign(new Error('Choose a valid class.'), { status: 400 });
  }
  const assigned = teacherMayManageClass({ admin: identity.admin, classIds: identity.teacher?.classIds }, classId);
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
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const suffix = Array.from(crypto.randomBytes(8), byte => alphabet[byte % alphabet.length]).join('');
  return 'fun-torah-tools-' + suffix;
}

exports.createShorashimCheckout = onRequest(
  { region, cors, secrets: [stripeSecret], maxInstances: 5 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    try {
      const identity = await identityFromRequest(req);
      const classIds = [...new Set(Array.isArray(req.body?.classIds) ? req.body.classIds.map(String) : [])];
      if (!classIds.length || classIds.length > 20 || JSON.stringify(classIds).length > 500) return res.status(400).json({ error: 'Select up to 20 classes with valid class identifiers.' });
      const classes = await Promise.all(classIds.map(id => assignedClass(identity, id)));
      if (classes.some(({ cls }) => cls.toolGrants?.shorashim === true)) return res.status(409).json({ error: 'Shorashim is already enabled for one or more selected classes.' });
      const current = (await db().ref('b3Private/stripeSubscriptions').get()).val() || {};
      if (Object.values(current).some(row => row?.teacherUid === identity.uid && row.active === true)) return res.status(409).json({ error: 'A Shorashim subscription already exists. Use Manage subscription.' });
      const openRef = db().ref('b3Private/shorashimOpenCheckouts/' + identity.uid);
      const open = (await openRef.get()).val();
      if (open?.sessionId && open.expiresAt > Date.now()) {
        try { const existing = await stripeClient().checkout.sessions.retrieve(open.sessionId); if (existing.status === 'open' && existing.url) return res.json({ url: existing.url }); } catch (_) {}
      }
      const configuredPrice = String(priceId.value() || '');
      if (!/^price_[A-Za-z0-9]+$/.test(configuredPrice)) throw new Error('Sandbox Shorashim price is not configured.');
      const price = await stripeClient().prices.retrieve(configuredPrice);
      if (!price.active || price.type !== 'recurring' || price.recurring?.interval !== 'year' || price.unit_amount !== 3900 || price.currency !== 'usd') throw new Error('Price must be the active $39 USD annual teacher subscription.');
      const pendingRef = db().ref('b3Private/shorashimCheckoutLocks/' + identity.uid);
      const lock = await pendingRef.transaction(current => current?.expiresAt > Date.now() ? undefined : { nonce: crypto.randomUUID(), expiresAt: Date.now() + 30000 });
      if (!lock.committed) return res.status(409).json({ error: 'A checkout is already being prepared. Please wait a moment.' });
      try {
        const metadata = { teacherUid: identity.uid, classIds: JSON.stringify(classIds), workspaceId, tool: 'shorashim' };
        const customer = (await db().ref('b3Private/stripeCustomerByTeacher/' + identity.uid).get()).val();
        const session = await stripeClient().checkout.sessions.create({
          mode: 'subscription',
          success_url: 'https://funtorahtools.com/teacher-subscription.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',
          cancel_url: 'https://funtorahtools.com/teacher-subscription.html?checkout=cancelled',
          line_items: [{ price: configuredPrice, quantity: 1 }],
          ...(customer?.id ? { customer: customer.id } : { customer_email: identity.email }),
          client_reference_id: identity.uid,
          integration_identifier: makeIntegrationId(),
          allow_promotion_codes: true,
          metadata,
          subscription_data: { metadata }
        });
        const expiresAt = session.expires_at ? session.expires_at*1000 : Date.now()+86400000;
        await Promise.all([db().ref('b3Private/shorashimCheckoutSessions/'+session.id).set({teacherUid:identity.uid,classIds,workspaceId,priceId:configuredPrice,createdAt:Date.now(),expiresAt}),openRef.set({sessionId:session.id,classIds,expiresAt})]);
        return res.json({url:session.url});
      } finally { await pendingRef.transaction(current => current?.nonce === lock.snapshot.val()?.nonce ? null : undefined); }
    } catch (error) { return sendError(res,error); }
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
      const portal = await stripeClient().billingPortal.sessions.create({ customer: customer.id, return_url: 'https://funtorahtools.com/teacher-subscription.html' });
      return res.json({ url: portal.url });
    } catch (error) { return sendError(res, error); }
  }
);

async function subscriptionForEvent(event, stripeEventObject) {
  if (event.type.startsWith('customer.subscription.')) return stripeClient().subscriptions.retrieve(stripeEventObject.id);
  const session = stripeEventObject;
  if (!session.subscription) return null;
  if (session.mode !== 'subscription' || session.payment_status !== 'paid') return null;
  return stripeClient().subscriptions.retrieve(session.subscription);
}

async function applySubscription(subscription, eventId) {
  const metadata=subscription?.metadata||{}, teacherUid=String(metadata.teacherUid||''); let classIds;
  try { classIds=JSON.parse(metadata.classIds||'[]'); } catch (_) { classIds=[]; }
  if(!teacherUid||!Array.isArray(classIds)||!classIds.length||classIds.length>20||JSON.stringify(classIds).length>500||classIds.some(id=>!validClassId(id))||metadata.workspaceId!==workspaceId||metadata.tool!=='shorashim')return;
  if(subscription.items?.data?.[0]?.price?.id!==String(priceId.value()||''))return;
  const privatePath='b3Private/stripeSubscriptions/'+subscription.id, prev=(await db().ref(privatePath).get()).val()||{};
  const [ts,as,user]=await Promise.all([db().ref('b3Games/workspaces/'+workspaceId+'/teachers/'+teacherUid).get(),db().ref('b3Games/admins/'+teacherUid).get(),admin.auth().getUser(teacherUid).catch(()=>null)]);
  const teacher=ts.val(), adminData=as.val(), owner=String(user?.email||'').toLowerCase()==='simcha5770@gmail.com', adminOk=adminData&&adminData.active!==false;
  const authorized=teacher?.active===true||adminOk||owner;
  const rows=await Promise.all(classIds.map(async id=>({id,ref:db().ref('b3Games/workspaces/'+workspaceId+'/classes/'+id),cls:(await db().ref('b3Games/workspaces/'+workspaceId+'/classes/'+id).get()).val(),assigned:teacher?.classIds?.[id]===true||adminOk||owner})));
  const active=authorized&&rows.every(r=>r.cls&&r.cls.active!==false&&r.assigned)&&activeSubscriptionStatus(subscription.status);
  const previousGrants={...(prev.previousGrants||{})}; for(const r of rows)if(!(r.id in previousGrants)&&r.cls)previousGrants[r.id]=r.cls.toolGrants?.shorashim===true;
  const saved={...prev,subscriptionId:subscription.id,teacherUid,classIds,previousGrants,workspaceId,customerId:subscription.customer||prev.customerId||'',status:active?subscription.status:String(subscription.status||'inactive'),active,cancelAtPeriodEnd:subscription.cancel_at_period_end===true,currentPeriodEnd:subscription.current_period_end||null,priceId:subscription.items?.data?.[0]?.price?.id||prev.priceId||'',updatedAt:Date.now(),lastEventId:eventId,createdAt:prev.createdAt||Date.now()};
  await db().ref(privatePath).set(saved); if(saved.customerId)await db().ref('b3Private/stripeCustomerByTeacher/'+teacherUid).set({id:saved.customerId});
  const all=(await db().ref('b3Private/stripeSubscriptions').get()).val()||{};
  for(const r of rows){if(!r.cls)continue;const other=Object.values(all).some(s=>s?.subscriptionId!==subscription.id&&s?.active===true&&s.teacherUid===teacherUid&&(s.classIds||[]).includes(r.id));if(active)await r.ref.child('toolGrants/shorashim').set(true);else if(!other)await r.ref.child('toolGrants/shorashim').set(previousGrants[r.id]===true);}
}
exports.shorashimStripeWebhook = onRequest(
  { region, secrets: [stripeSecret, stripeWebhookSecret], maxInstances: 10 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).send('Use POST.');
    const raw = req.rawBody;
    if (!Buffer.isBuffer(raw)) return res.status(400).send('Invalid event body.');
    let event;
    try { event = stripeClient().webhooks.constructEvent(raw, req.headers['stripe-signature'], stripeWebhookSecret.value()); }
    catch (_) { return res.status(400).send('Invalid Stripe signature or event body.'); }
    if (event.livemode !== false) return res.status(400).send('Live events are disabled until approved.');
    const eventRef = db().ref('b3Private/stripeWebhookEvents/' + event.id);
    if ((await eventRef.get()).exists()) return res.json({ received: true, duplicate: true });
    try {
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' ||
          event.type === 'checkout.session.expired' || event.type.startsWith('customer.subscription.')) {
        const sessionData = event.data?.object || {};
        if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' || event.type === 'checkout.session.expired') {
          const sessionMeta = sessionData.metadata || {};
          if (sessionMeta.teacherUid) {
            await db().ref('b3Private/shorashimOpenCheckouts/' + sessionMeta.teacherUid).remove();
          }
        }
        if (event.type === 'checkout.session.expired') {
          await eventRef.set({ receivedAt: Date.now(), type: event.type });
          return res.json({ received: true });
        }
        const subscription = await subscriptionForEvent(event, sessionData);
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
