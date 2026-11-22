// Temporary, explicitly enabled, administrator-only backfill. Stripe credentials stay in Supabase.
import { donationFromSession, donationStore, stripeClient, validatePaymentLink } from '../stripe-webhook/core.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (Deno.env.get('DONATION_IMPORT_ENABLED') !== 'true') return json({ error: 'Import disabled' }, 403);
  try {
    const url = required('SUPABASE_URL');
    const token = request.headers.get('Authorization') || '';
    if (!token.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const headers = { apikey: required('SUPABASE_ANON_KEY'), Authorization: token };
    // Validate the user token server-side, then check membership using that user's RLS context.
    const userResponse = await fetch(`${url}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10000) });
    if (!userResponse.ok) return json({ error: 'Unauthorized' }, 401);
    const user = await userResponse.json();
    if (!/^[0-9a-f-]{36}$/i.test(user.id || '')) return json({ error: 'Unauthorized' }, 401);
    const adminResponse = await fetch(`${url}/rest/v1/admin_users?select=user_id&user_id=eq.${user.id}`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    if (!adminResponse.ok || (await adminResponse.json()).length !== 1) return json({ error: 'Forbidden' }, 403);
    const body = await request.json();
    const before = body.before ?? Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(before) || before <= 0 || before > Math.floor(Date.now() / 1000) ||
      (body.starting_after && !/^cs_[a-zA-Z0-9_]+$/.test(body.starting_after))) {
      return json({ error: 'Invalid checkpoint' }, 400);
    }
    const mode = required('STRIPE_MODE');
    if (!['live', 'test'].includes(mode)) throw new Error('Invalid mode');
    const config = { live: mode === 'live', paymentLinkId: required('STRIPE_DONATION_PAYMENT_LINK_ID'),
      testPaymentLinkUrl: Deno.env.get('STRIPE_TEST_PAYMENT_LINK_URL') };
    const stripe = stripeClient(required('STRIPE_SECRET_KEY'));
    await validatePaymentLink(stripe, config);
    const page = await stripe('checkout/sessions', {
      payment_link: config.paymentLinkId, 'created[lte]': before, limit: 5,
      ...(body.starting_after ? { starting_after: body.starting_after } : {}),
    });
    const save = donationStore(url, required('SUPABASE_SERVICE_ROLE_KEY'));
    let recorded = 0;
    for (const session of page.data) {
      const donation = await donationFromSession(session.id, { stripe, config });
      if (donation) { await save(donation); recorded++; }
    }
    return json({ scanned: page.data.length, recorded, before,
      next_cursor: page.has_more ? page.data.at(-1).id : null });
  } catch {
    console.error('Donation import batch failed; repeat the last checkpoint.');
    return json({ error: 'Import failed; retry the same checkpoint' }, 500);
  }
});
