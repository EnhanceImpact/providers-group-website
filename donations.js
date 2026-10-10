(() => {
  const config = window.TPG_DONATIONS || {};
  const providers = { paypal: config.paypalUrl, stripe: config.stripeUrl };
  const allowed = {paypal: ['www.paypal.com', 'paypal.com'], stripe: ['donate.stripe.com', 'buy.stripe.com', 'checkout.stripe.com']};
  const safe = (value, provider) => {
    try {const u = new URL(value); return u.protocol === 'https:' && allowed[provider].includes(u.hostname) ? u.href : null;} catch {return null;}
  };
  const active = [];
  for (const provider of Object.keys(providers)) {
    const url = safe(providers[provider], provider);
    const button = document.querySelector(`[data-donation-provider="${provider}"]`);
    const unavailable = document.querySelector(`[data-donation-unavailable="${provider}"]`);
    if (url && button) {button.href = url; button.target = '_blank'; button.rel = 'noopener noreferrer'; button.hidden = false; unavailable?.setAttribute('hidden',''); active.push(url);}
  }
  if (active.length === 1) {document.querySelectorAll('[data-donation-link]').forEach(a => {a.href = active[0]; a.target = '_blank'; a.rel = 'noopener noreferrer';});}
})();
