# Donation checkout setup

The Providers Group must own the Stripe account, its bank connection, and all funds. This static GitHub Pages website links directly to hosted checkout; it never collects or stores card details and needs no backend or API keys.

## Configure the payment link

1. In the organization's Stripe Dashboard, create a Payment Link using **Customers choose what to pay**. Select the currency and any suggested or minimum amount appropriate for donations. Confirm donors can enter their own amount on hosted checkout. The website does not set the amount.
2. Configure the organization's identity, branding, payment methods, receipt emails, and checkout confirmation in Stripe. Keep required checkout disclosures. Confirm legal charitable/tax status before claiming gifts are tax-deductible.
3. First create and verify a link in Stripe's test environment. Confirm the organization, currency, amount selection, successful and declined test payments, receipt settings, and confirmation behavior. Use Stripe's test payment details only in test mode; do not enter real card details there.
4. Create and verify the corresponding live Payment Link before accepting donations. Copy the full organization-owned HTTPS link from the Dashboard into `stripeUrl` in `donation-config.js`. Leave it blank until verified. Never put secret or publishable API keys in this file; only the public payment URL belongs here.
5. Review and test the changes on `donation-page-updates`. Publishing to GitHub Pages is a separate, approved release step; this task does not publish or change `main`. Do not release a test-mode link as the live donation destination.

Stripe instructions: [Accept donations with Payment Links](https://support.stripe.com/questions/how-to-accept-donations-through-stripe?locale=en-US) and [test payment details](https://docs.stripe.com/testing).

## Website behavior and checks

- There is one visible **Donate Now** control in the donation section. When configured, it opens hosted checkout in the same tab. Donors choose their amount there and can use the browser Back button to return.
- `donations.js` reuses HTTPS hostname validation. Only `donate.stripe.com`, `buy.stripe.com`, and `checkout.stripe.com` are accepted, with a non-root path and no embedded credentials or nonstandard port. Prefer a reusable Payment Link; individual Checkout Session URLs may expire.
- URL validation is a safety filter, not proof that a link is active, belongs to the organization, or permits a donor-chosen amount. An administrator must verify those properties in Stripe and on checkout before release, and replace or clear deactivated links.
- With missing or rejected configuration, JavaScript disabled, or scripts unavailable, **Donate Now** remains a native disabled button. It has no checkout destination. Visitors see the usual donation copy and contact link, without provider names or setup messages.
- Test a valid test-mode link, then clear it and test blank, malformed, HTTP, and unrelated-domain values. Check that only the approved HTTPS link enables checkout. Confirm desktop/mobile layout, keyboard navigation, and existing navigation/footer links.

## Current configuration and limitations

`stripeUrl` is configured with the organization-supplied Payment Link: `https://buy.stripe.com/fZuaEXbFhgDs9RsedpdIA00`. Clicking **Donate Now** was verified to open checkout titled **The Providers' Group Inc.**, with a visible, editable donor-chosen amount field that accepted a test amount. No personal information or card details were entered, and no payment was submitted. Successful/declined payments and receipts still require separate verification in Stripe's test environment.

Payment Links alone do not create donation records. The backend integration in [DONATIONS-TRACKING.md](DONATIONS-TRACKING.md) adds verified Stripe webhooks, idempotent Supabase storage, administrator reporting, and an optional historical import. It must be configured and deployed separately; the public checkout remains unchanged. Browser redirects are never treated as proof of payment.
