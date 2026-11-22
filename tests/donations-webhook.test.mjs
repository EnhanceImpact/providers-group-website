import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { cents, donationFromSession, donationStore, handleEvent, LIVE_PAYMENT_LINK_URL,
  stripeClient, stripePages, validatePaymentLink, verifySignature } from '../supabase/functions/stripe-webhook/core.mjs';

const config = { live: true, paymentLinkId: 'plink_donation' };
function fixture() {
  const session = { id: 'cs_example', livemode: true, payment_link: 'plink_donation', mode: 'payment',
    payment_status: 'paid', status: 'complete', amount_total: 5000, currency: 'usd', customer: 'cus_example',
    customer_details: { name: 'Ada Example Person', email: 'ADA@example.invalid', address: { postal_code: '00501' } },
    payment_intent: { id: 'pi_example', status: 'succeeded', amount_received: 5000, currency: 'usd',
      latest_charge: { id: 'ch_example', paid: true, status: 'succeeded', currency: 'usd', created: 1700000000 } } };
  const refunds = [];
  const saved = [];
  const stripe = async (path, params) => {
    if (path === 'checkout/sessions/cs_example') return structuredClone(session);
    if (path === 'checkout/sessions') { assert.equal(params.payment_intent, 'pi_example'); return { data: [session], has_more: false }; }
    if (path === 'refunds') return { data: refunds, has_more: false };
    if (path === 'payment_links/plink_donation') return { id: config.paymentLinkId, url: LIVE_PAYMENT_LINK_URL, livemode: true };
    throw new Error(`Unexpected test request ${path}`);
  };
  return { session, refunds, saved, deps: { stripe, config, save: async row => saved.push(row) } };
}
const event = (type = 'checkout.session.completed', object = { id: 'cs_example' }) => ({ livemode: true, type, data: { object } });

test('raw-body HMAC verification: valid, rotated signatures, tampered/expired/future/missing rejected', async () => {
  const body = '{"value": 1}', timestamp = 1700000000, secret = 'synthetic-signing-secret';
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const header = `t=${timestamp},v1=${'0'.repeat(64)},v1=${signature}`;
  await verifySignature(body, header, secret, timestamp * 1000);
  for (const [raw, h, now] of [[body + ' ', header, timestamp * 1000], [body, null, timestamp * 1000],
    [body, header, (timestamp + 301) * 1000], [body, header, (timestamp - 301) * 1000],
    [body, `t=${timestamp},t=${timestamp},v1=${signature}`, timestamp * 1000]]) {
    await assert.rejects(verifySignature(raw, h, secret, now));
  }
});

test('only the exact configured Payment Link and Stripe mode pass configuration validation', async () => {
  const { deps } = fixture();
  await validatePaymentLink(deps.stripe, config);
  await assert.rejects(validatePaymentLink(deps.stripe, { ...config, live: false }));
  await assert.rejects(validatePaymentLink(async () => ({ url: 'https://buy.stripe.com/other', livemode: true }), config));
});

test('success/delayed success normalize donor data and save only the selected fields', async () => {
  const { deps, saved } = fixture();
  await handleEvent(event(), deps);
  await handleEvent(event('checkout.session.async_payment_succeeded'), deps);
  assert.equal(saved.length, 2); // SQL handles idempotency, tested separately.
  assert.deepEqual(saved[0], {
    donor_first_name: 'Ada', donor_last_name: 'Example Person', email: 'ada@example.invalid', zip_code: '00501',
    amount_cents: 5000, currency: 'usd', donated_at: '2023-11-14T22:13:20.000Z', refunded_amount_cents: 0,
    stripe_payment_id: 'pi_example', stripe_checkout_session_id: 'cs_example', stripe_customer_id: 'cus_example', stripe_payment_link_id: 'plink_donation',
  });
  assert.ok(!JSON.stringify(saved).includes('card'));
});

test('unpaid, failed, unrelated-link, wrong-mode and unrelated events never record donations', async () => {
  for (const change of [{ payment_status: 'unpaid' }, { status: 'open' }, { mode: 'subscription' },
    { payment_link: 'plink_other' }, { livemode: false }]) {
    const { session, deps, saved } = fixture(); Object.assign(session, change);
    assert.deepEqual(await handleEvent(event(), deps), { ignored: true }); assert.equal(saved.length, 0);
  }
  const { deps, saved, session } = fixture(); session.payment_intent.status = 'processing';
  await handleEvent(event(), deps);
  await handleEvent(event('checkout.session.async_payment_failed'), deps);
  await handleEvent(event('payment_intent.payment_failed'), deps);
  assert.equal(saved.length, 0);
});

test('refund events resolve the donation session and count only succeeded refunds', async () => {
  const { deps, refunds, saved } = fixture();
  refunds.push({ amount: 1250, currency: 'usd', status: 'succeeded' },
    { amount: 900, currency: 'usd', status: 'pending' }, { amount: 800, currency: 'usd', status: 'failed' });
  await handleEvent(event('refund.updated', { payment_intent: 'pi_example' }), deps);
  assert.equal(saved[0].refunded_amount_cents, 1250);
  refunds.push({ amount: 3750, currency: 'usd', status: 'succeeded' });
  await handleEvent(event('charge.refunded', { payment_intent: 'pi_example' }), deps);
  assert.equal(saved[1].refunded_amount_cents, 5000);
});

test('optional information, mononyms and billing/shipping fallbacks are safe', async () => {
  const { session, deps } = fixture(); session.customer_details = null; session.customer = null;
  let row = await donationFromSession(session.id, deps);
  for (const field of ['donor_first_name', 'donor_last_name', 'email', 'zip_code', 'stripe_customer_id']) assert.equal(row[field], null);
  session.payment_intent.latest_charge.billing_details = { name: 'Cher', email: 'billing@example.invalid' };
  session.shipping_details = { address: { postal_code: '53202' } };
  row = await donationFromSession(session.id, deps);
  assert.equal(row.donor_first_name, 'Cher'); assert.equal(row.donor_last_name, null); assert.equal(row.zip_code, '53202');
});

test('invalid amounts/currencies fail instead of writing inaccurate donation totals', async () => {
  const { session, deps, refunds } = fixture(); session.payment_intent.amount_received = 4000;
  await assert.rejects(donationFromSession(session.id, deps));
  session.payment_intent.amount_received = 5000; refunds.push({ amount: 5001, currency: 'usd', status: 'succeeded' });
  await assert.rejects(donationFromSession(session.id, deps));
  assert.equal(cents(500, 'jpy'), 50000); assert.equal(cents(500, 'isk'), 500); assert.equal(cents(500, 'usd'), 500);
  assert.throws(() => cents(1.1, 'usd')); assert.throws(() => cents(100, 'kwd'));
});

test('all Stripe pages are read, and malformed cursors fail safely', async () => {
  let calls = 0; const items = [];
  for await (const item of stripePages(async (_path, params) => {
    calls++; return params.starting_after ? { data: [{ id: 'two' }], has_more: false } : { data: [{ id: 'one' }], has_more: true };
  }, 'refunds')) items.push(item.id);
  assert.deepEqual(items, ['one', 'two']); assert.equal(calls, 2);
  await assert.rejects(async () => { for await (const _ of stripePages(async () => ({ data: [], has_more: true }), 'refunds')) {} });
});

test('backend persistence is one RPC and failed API/storage operations propagate for Stripe retries', async () => {
  let sent;
  await donationStore('https://example.invalid', 'synthetic-service-key', async (url, options) => {
    sent = { url, options }; return new Response(null, { status: 204 });
  })({ stripe_payment_id: 'pi_example' });
  assert.ok(sent.url.endsWith('/rpc/record_stripe_donation'));
  assert.deepEqual(JSON.parse(sent.options.body), { p_donation: { stripe_payment_id: 'pi_example' } });
  await assert.rejects(donationStore('https://example.invalid', 'synthetic', async () => new Response(null, { status: 500 }))({}));
  await assert.rejects(stripeClient('synthetic', async () => new Response(null, { status: 429 }))('refunds'));
  const { deps } = fixture(); deps.save = async () => { throw new Error('database failure'); };
  await assert.rejects(handleEvent(event(), deps));
});
