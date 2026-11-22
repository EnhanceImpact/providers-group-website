// Shared by the signed webhook and the operator-only historical import. No card data is persisted.
export const STRIPE_API_VERSION = '2024-06-20';
export const LIVE_PAYMENT_LINK_URL = 'https://buy.stripe.com/fZuaEXbFhgDs9RsedpdIA00';
const idOf = value => typeof value === 'string' ? value : value?.id;
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

export async function verifySignature(raw, header, secret, now = Date.now()) {
  const parts = (header || '').split(',').map(p => p.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 't');
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0][1])) throw new Error('Invalid signature');
  const timestamp = Number(timestamps[0][1]);
  if (Math.abs(now / 1000 - timestamp) > 300) throw new Error('Expired signature');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const payload = new TextEncoder().encode(`${timestamps[0][1]}.${raw}`);
  for (const [kind, hex] of parts) {
    if (kind !== 'v1' || !/^[a-f0-9]{64}$/i.test(hex)) continue;
    const bytes = Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, payload)) return;
  }
  throw new Error('Invalid signature');
}

export function stripeClient(secret, fetcher = fetch) {
  return async (path, params = {}) => {
    const url = new URL(`https://api.stripe.com/v1/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await fetcher(url, { headers: {
      Authorization: `Bearer ${secret}`, 'Stripe-Version': STRIPE_API_VERSION,
    }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Stripe API request failed (${response.status})`);
    return response.json();
  };
}

export async function* stripePages(stripe, path, params = {}) {
  let cursor;
  do {
    const page = await stripe(path, { ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    if (!Array.isArray(page.data)) throw new Error('Invalid Stripe list');
    for (const item of page.data) yield item;
    if (!page.has_more) return;
    const next = page.data.at(-1)?.id;
    if (!next || next === cursor) throw new Error('Invalid Stripe pagination');
    cursor = next;
  } while (true);
}

export async function validatePaymentLink(stripe, config) {
  if (!/^plink_[a-zA-Z0-9]+$/.test(config.paymentLinkId)) throw new Error('Missing Payment Link ID');
  const link = await stripe(`payment_links/${config.paymentLinkId}`);
  const expected = config.live ? LIVE_PAYMENT_LINK_URL : config.testPaymentLinkUrl;
  if (!expected || link.url !== expected || link.livemode !== config.live) throw new Error('Payment Link/environment mismatch');
}

// Stripe charges use cents except its zero-decimal currencies; ISK/UGX are special two-decimal API amounts.
const zeroDecimal = new Set('bif clp djf gnf jpy kmf krw mga pyg rwf vnd vuv xaf xof xpf'.split(' '));
export function cents(amount, currency) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  if (digits > 2) throw new Error('Sub-cent currencies require a separate accounting policy');
  const result = amount * (zeroDecimal.has(currency) ? 100 : 1);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid monetary amount');
  return result;
}

export async function donationFromSession(sessionId, { stripe, config }) {
  const session = await stripe(`checkout/sessions/${sessionId}`, { 'expand[]': 'payment_intent.latest_charge' });
  if (idOf(session.payment_link) !== config.paymentLinkId || session.livemode !== config.live) return null;
  if (session.mode !== 'payment' || session.payment_status !== 'paid' || session.status !== 'complete') return null;
  const payment = session.payment_intent;
  if (!payment || typeof payment === 'string' || payment.status !== 'succeeded') return null;
  const charge = payment.latest_charge;
  if (!charge || typeof charge === 'string' || !charge.paid || charge.status !== 'succeeded') throw new Error('Successful charge unavailable');
  if (payment.currency !== session.currency || charge.currency !== session.currency || payment.amount_received !== session.amount_total) {
    throw new Error('Donation amount/currency mismatch');
  }
  let refunded = 0;
  for await (const refund of stripePages(stripe, 'refunds', { payment_intent: payment.id })) {
    if (refund.status === 'succeeded') {
      if (refund.currency !== session.currency) throw new Error('Refund currency mismatch');
      refunded += cents(refund.amount, session.currency);
    }
  }
  const amount = cents(payment.amount_received, session.currency);
  if (!amount || refunded > amount || !Number.isSafeInteger(refunded)) throw new Error('Invalid donation/refund amount');
  const details = session.customer_details || {};
  const billing = charge.billing_details || {};
  const name = text(details.name) || text(billing.name);
  const parts = name?.split(/\s+/) || [];
  const first = parts.shift() || null;
  return {
    donor_first_name: first, donor_last_name: parts.join(' ') || null,
    email: (text(details.email) || text(session.customer_email) || text(billing.email))?.toLowerCase() || null,
    zip_code: text(details.address?.postal_code) || text(billing.address?.postal_code) || text(session.shipping_details?.address?.postal_code),
    amount_cents: amount, currency: session.currency,
    donated_at: new Date(charge.created * 1000).toISOString(),
    refunded_amount_cents: refunded, stripe_payment_id: payment.id,
    stripe_checkout_session_id: session.id, stripe_customer_id: idOf(session.customer) || null,
    stripe_payment_link_id: config.paymentLinkId,
  };
}

export async function handleEvent(event, dependencies) {
  const { stripe, config, save } = dependencies;
  if (event.livemode !== config.live) return { ignored: true };
  const object = event.data?.object;
  let sessionId;
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    sessionId = object?.id;
  } else if (['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.refund.updated'].includes(event.type)) {
    let paymentId = idOf(object?.payment_intent);
    if (!paymentId && idOf(object?.charge)) {
      paymentId = idOf((await stripe(`charges/${idOf(object.charge)}`)).payment_intent);
    }
    if (!paymentId) return { ignored: true };
    for await (const session of stripePages(stripe, 'checkout/sessions', { payment_intent: paymentId })) {
      if (idOf(session.payment_link) === config.paymentLinkId) { sessionId = session.id; break; }
    }
    if (!sessionId) return { ignored: true };
  } else return { ignored: true };
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId || '')) throw new Error('Missing Checkout Session');
  const donation = await donationFromSession(sessionId, dependencies);
  if (!donation) return { ignored: true };
  await save(donation);
  return { recorded: true };
}

export function donationStore(url, key, fetcher = fetch) {
  return async donation => {
    const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/rpc/record_stripe_donation`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_donation: donation }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Donation transaction failed (${response.status})`);
  };
}
