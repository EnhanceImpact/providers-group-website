(() => {
  const config = window.TPG_DONATIONS || {};
  const allowed = ['donate.stripe.com', 'buy.stripe.com', 'checkout.stripe.com'];
  const safe = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && allowed.includes(url.hostname) &&
        !url.username && !url.password && !url.port && url.pathname !== '/'
        ? url.href : null;
    } catch {
      return null;
    }
  };
  const url = safe(config.stripeUrl);
  const link = document.querySelector('[data-donation-link]');
  const fallback = document.querySelector('[data-donation-disabled]');
  if (!url || !link || !fallback) return;

  link.href = url;
  link.hidden = false;
  fallback.hidden = true;
})();
