import { donationStore, handleEvent, stripeClient, validatePaymentLink, verifySignature } from './core.mjs';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const raw = await request.text(); // Never parse/re-serialize before signature verification.
    try {
      await verifySignature(raw, request.headers.get('stripe-signature'), required('STRIPE_WEBHOOK_SIGNING_SECRET'));
    } catch {
      return new Response('Invalid webhook signature', { status: 400 });
    }
    const mode = required('STRIPE_MODE');
    if (!['live', 'test'].includes(mode)) throw new Error('Invalid STRIPE_MODE');
    const config = {
      live: mode === 'live', paymentLinkId: required('STRIPE_DONATION_PAYMENT_LINK_ID'),
      testPaymentLinkUrl: Deno.env.get('STRIPE_TEST_PAYMENT_LINK_URL'),
    };
    const stripe = stripeClient(required('STRIPE_SECRET_KEY'));
    // Verifies the actual Stripe plink_ ID against the unchanged public URL, not untrusted metadata.
    await validatePaymentLink(stripe, config);
    const result = await handleEvent(JSON.parse(raw), {
      config, stripe,
      save: donationStore(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY')),
    });
    return Response.json(result);
  } catch {
    // No payloads, donor information, credentials, or provider response bodies in logs/responses.
    console.error('Donation webhook processing failed; retry required.');
    return new Response('Webhook processing failed', { status: 500 });
  }
});
