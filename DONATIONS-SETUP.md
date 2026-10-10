# Donations setup (PayPal and/or Stripe)

The Providers Group must own the payment account, its bank connection, and all funds. The website does not process card details.

1. **PayPal:** Client creates a Donate button at https://www.paypal.com/donate/buttons and copies the LIVE hosted donation URL.
2. **Stripe:** Client creates a donation Payment Link in its Stripe Dashboard (prefer customer-chosen donation amount, and choose recurring options only if configured). Copy the LIVE payment link.
3. Edit `donation-config.js`, entering one or both HTTPS URLs. Do not put API keys in this file.
4. Deploy the updated static site to GitHub Pages. Test each link and confirm the payment destination shows the correct organization before taking real donations.
5. Until URLs are configured, the page displays 'not yet enabled' and links to the Contact page; it will not pretend donations work.

When one provider is configured, primary Donate Now buttons open its hosted payment page in a new tab. When both are configured, primary Donate Now buttons scroll to the two-provider selection.

**Supabase dashboard:** Payment links alone do NOT create verified donation rows in Supabase. To report completed donations in the admin dashboard, implement verified Stripe/PayPal webhooks in a Supabase Edge Function with idempotent transaction storage. Do not trust browser redirects as proof of payment.

**Receipts and eligibility:** Configure donation acknowledgements/receipts in the payment provider. Confirm the client's legal charitable/tax status before claiming gifts are tax-deductible.
