// Run with Node 22+: node --experimental-strip-types tests/donations-edge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LIVE_PAYMENT_LINK_URL } from '../supabase/functions/stripe-webhook/core.mjs';

test('Edge handlers: verified webhooks, retry responses, and restricted historical import', async () => {
  const env = new Map(Object.entries({ STRIPE_MODE: 'live', STRIPE_DONATION_PAYMENT_LINK_ID: 'plink_example',
    STRIPE_SECRET_KEY: 'synthetic-stripe-key', STRIPE_WEBHOOK_SIGNING_SECRET: 'synthetic-webhook-secret',
    SUPABASE_URL: 'https://supabase.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    SUPABASE_ANON_KEY: 'synthetic-public-key' }));
  let handler, dbFailure = false, admin = true;
  const calls = [], writes = [];
  const session = { id: 'cs_example', payment_link: 'plink_example', livemode: true, mode: 'payment',
    status: 'complete', payment_status: 'paid', amount_total: 2500, currency: 'usd',
    payment_intent: { id: 'pi_example', status: 'succeeded', currency: 'usd', amount_received: 2500,
      latest_charge: { id: 'ch_example', paid: true, status: 'succeeded', currency: 'usd', created: 1700000000 } } };
  const realFetch = globalThis.fetch;
  globalThis.Deno = { env: { get: name => env.get(name) }, serve: fn => { handler = fn; } };
  globalThis.fetch = async (input, options) => {
    const url = new URL(input); calls.push(url.pathname);
    if (url.pathname === '/v1/payment_links/plink_example') return Response.json({ url: LIVE_PAYMENT_LINK_URL, livemode: true });
    if (url.pathname === '/v1/checkout/sessions/cs_example') return Response.json(session);
    if (url.pathname === '/v1/refunds') return Response.json({ data: [], has_more: false });
    if (url.pathname === '/v1/checkout/sessions') {
      assert.equal(url.searchParams.get('payment_link'), 'plink_example');
      return Response.json({ data: [session], has_more: false });
    }
    if (url.pathname === '/rest/v1/rpc/record_stripe_donation') {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-service-key');
      if (dbFailure) return new Response(null, { status: 503 });
      writes.push(JSON.parse(options.body).p_donation); return new Response(null, { status: 204 });
    }
    if (url.pathname === '/auth/v1/user') {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-user-token');
      return Response.json({ id: '11111111-1111-1111-1111-111111111111' });
    }
    if (url.pathname === '/rest/v1/admin_users') return Response.json(admin ? [{ user_id: 'synthetic' }] : []);
    throw new Error(`Unexpected mocked URL ${url.pathname}`);
  };
  try {
    await import('../supabase/functions/stripe-webhook/index.ts');
    const webhook = handler;
    assert.equal((await webhook(new Request('https://example.invalid', { method: 'GET' }))).status, 405);
    assert.equal((await webhook(new Request('https://example.invalid', { method: 'POST', body: '{}' }))).status, 400);
    assert.equal(calls.length, 0);
    const body = JSON.stringify({ type: 'checkout.session.completed', livemode: true, data: { object: { id: 'cs_example' } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', env.get('STRIPE_WEBHOOK_SIGNING_SECRET')).update(`${timestamp}.${body}`).digest('hex');
    const signedRequest = () => new Request('https://example.invalid', { method: 'POST', body,
      headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } });
    assert.equal((await webhook(signedRequest())).status, 200); assert.equal(writes.length, 1);
    dbFailure = true; assert.equal((await webhook(signedRequest())).status, 500); dbFailure = false;
    await import('../supabase/functions/stripe-donation-import/index.ts');
    const backfill = handler;
    const request = (body = {}, authorized = true) => new Request('https://example.invalid', { method: 'POST',
      headers: authorized ? { Authorization: 'Bearer synthetic-user-token' } : {}, body: JSON.stringify(body) });
    assert.equal((await backfill(request())).status, 403);
    env.set('DONATION_IMPORT_ENABLED', 'true');
    assert.equal((await backfill(request({}, false))).status, 401);
    admin = false; assert.equal((await backfill(request())).status, 403); admin = true;
    assert.equal((await backfill(request({ before: -1 }))).status, 400);
    const result = await backfill(request()); assert.equal(result.status, 200);
    assert.equal((await result.json()).recorded, 1);
    assert.equal(writes.length, 2); assert.equal(writes[0].stripe_payment_id, writes[1].stripe_payment_id);
  } finally { globalThis.fetch = realFetch; delete globalThis.Deno; }
});
