# Donation tracking deployment and verification

This is an additive backend/admin integration on `donation-page-updates`. Nothing in this implementation changes the public Donate button, its Payment Link, checkout, public pages, existing records, or existing RLS policies. No deployment, live payment, historical import, or change to `main` has been performed.

## How it works

1. Stripe sends a signed webhook to the new `stripe-webhook` Supabase Edge Function. The function verifies HMAC-SHA256 against the untouched request body with a five-minute timestamp tolerance before parsing JSON or accessing Stripe/Supabase.
2. The backend checks the configured Stripe Payment Link's API ID against its actual public URL and environment. In live mode that URL must be exactly `https://buy.stripe.com/fZuaEXbFhgDs9RsedpdIA00`. The short public URL token is **not** the `plink_...` API ID.
3. It retrieves the current Checkout Session, expanded PaymentIntent and successful charge. Only completed, paid, one-time sessions for the configured Payment Link are eligible. Failed, unpaid, processing, other-link, and wrong-environment payments never become successful donation records. Delayed payments are recorded when they succeed.
4. It reads **all** refund pages and counts only refunds whose current status is `succeeded`. Pending, failed, and canceled refunds do not reduce totals. Refund notifications find the original session through its PaymentIntent, including when the refund arrives before the original payment notification.
5. A service-role-only PostgreSQL function saves the donation and contact association in one transaction. Unique payment/session IDs prevent duplicates across concurrent/retried webhooks and imports. Stored succeeded-refund totals can only increase, so older notifications or in-flight API snapshots cannot erase a later refund.
6. The Donations tab and two new metric cards use the existing authenticated Supabase client. Both new read RPCs run with invoker privileges and therefore enforce the donations table's admin-only RLS. Administrators have SELECT access, not direct donor-record write access. The backend write function is unavailable to browser roles.

The function deliberately saves only selected donor/accounting fields. It never stores payment methods, card numbers, security codes, bank details, whole Stripe objects, event bodies, or secrets. Errors/logs do not include donor payloads or provider response bodies.

## Accounting and identity definitions

- All amounts are integer **cents** of the recorded currency. Two-decimal Stripe amounts are already cents; supported zero-decimal currencies are converted to whole-currency cents. Stripe's special ISK/UGX API conventions are preserved. Sub-cent (three-decimal) currencies fail closed and need a separately agreed accounting policy before use; the current USD donation link is supported.
- **Total Donations** sums successful amounts minus succeeded refunds over the entire table, regardless of history pagination/search. Fees are neither added nor subtracted. Different currencies are shown separately without inventing an exchange rate. Fully refunded donations contribute zero. Decimal formatting preserves integer-cent precision.
- **Unique Donors** counts normalized email addresses, falling back to associated contact ID and then Stripe customer ID when available. Anonymous payments with no stable identifier are excluded. Repeat payments with the same email count once. Fully refunded donors remain identifiable donors. One person using different emails may count more than once; names alone are not treated as reliable identity.
- `donated_at` is the successful charge's Stripe `created` timestamp in UTC; the dashboard displays it in the administrator's local time. For delayed methods this is the charge's creation date, not bank settlement date.
- Stripe's full name is split into the first word and remaining words. This is a display convenience, not a verified legal-name parser. Missing details stay null/dashes; ZIP/postal codes remain text so leading zeroes are preserved.
- Contacts are matched by the existing case-insensitive email uniqueness rule. A missing contact is created only when an email exists, with `marketing_opt_in=false`. Existing contact fields, consent, and timestamps are never updated by this integration. Donation history retains its own snapshot of Stripe-provided donor details.
- Payment statuses stored here are `succeeded`, `partially_refunded`, and `refunded`. Unsuccessful attempts are not donation history. Disputes/chargebacks and recurring/subscription payments are outside this one-time Payment Link integration; they need a separate accounting policy rather than being silently treated as refunds.

## Required backend configuration

Use the organization's Supabase and Stripe accounts. Keep all Stripe secrets and signing secrets **in Supabase Function Secrets only**. Do not put them in `config.js`, `donation-config.js`, JavaScript served by GitHub Pages, command-line arguments, Git, or browser code. No frontend `.env` file is needed.

| Name | Location / value |
| --- | --- |
| `SUPABASE_URL` | Built-in Supabase Edge Function environment. |
| `SUPABASE_SERVICE_ROLE_KEY` | Built-in Supabase backend environment; required for the atomic write RPC. Never use it in the administrator frontend. |
| `SUPABASE_ANON_KEY` | Built-in backend environment; used with the caller's user JWT to validate import administrator membership. |
| `STRIPE_SECRET_KEY` | Supabase Function Secret: secret API key for the correct Stripe account/environment. A restricted key with the necessary read permissions can be used. Only read operations are performed against Stripe. |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Supabase Function Secret: endpoint-specific `whsec_...` from the destination created below. This is separate from the API key. |
| `STRIPE_DONATION_PAYMENT_LINK_ID` | Supabase Function Secret: actual `plink_...` API ID of the existing donation Payment Link. Retrieve it from Stripe's Dashboard/API; do not derive it from the public short URL or invent it. |
| `STRIPE_MODE` | Supabase Function Secret: exactly `live` for production, or `test` for isolated staging. Required; no permissive default. |
| `STRIPE_TEST_PAYMENT_LINK_URL` | Test/staging only: actual HTTPS URL of the test-mode counterpart. It is compared to Stripe's retrieved Payment Link. Never change the live website's checkout for testing. |
| `DONATION_IMPORT_ENABLED` | Temporary Supabase Function Secret: `true` only while an authorized administrator runs the backfill. Omit it or set `false` otherwise. |

Use a **separate staging Supabase project and Stripe sandbox/test environment** for test payments. Do not point test-mode keys at the production database. Use the existing live Payment Link in production; no new live checkout link or metadata changes are required.

## Deployment steps

1. Confirm the checkout branch is `donation-page-updates` and review the diff. Back up the database using the project's normal backup procedure. Confirm migrations 001–003 are already present; **do not rerun/reset old migrations** on the existing database.
2. In the selected Supabase project's SQL Editor, execute **only** `supabase/migrations/004_donations.sql`. It creates the new table, its indexes/RLS, and three new functions inside a transaction. Existing tables/policies are not altered. If your migration history is already managed by the Supabase CLI, apply this as the next migration through that established workflow; do not run a blind `db push` against an unbaselined remote.
3. In Supabase Dashboard → Edge Functions → Secrets, set the new secret names above for the selected environment. Find the existing Payment Link in Stripe and verify that the `plink_...` ID returns the expected public URL. A disabled old link is still readable for backfill; no active-link change is made by code.
4. Deploy only the webhook function using a current Supabase CLI, authenticated to the correct account. Replace `PROJECT_REF` with the selected project reference:

   ```powershell
   supabase functions deploy stripe-webhook --project-ref PROJECT_REF --no-verify-jwt
   ```

   `supabase/config.toml` disables JWT verification **only** for this signed webhook. Do not disable JWT verification for existing functions or the import. Stripe cannot send a Supabase user JWT; its signature is the mandatory authentication at this endpoint.
5. In Stripe Workbench → Webhooks / Event destinations, create a destination for events from **this account** with endpoint:

   ```text
   https://PROJECT_REF.supabase.co/functions/v1/stripe-webhook
   ```

   Subscribe to:

   ```text
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   charge.refunded
   refund.created
   refund.updated
   refund.failed
   charge.refund.updated
   ```

   Choose snapshot events (not thin events). The handler uses event type and object IDs and retrieves canonical resources with Stripe API version `2024-06-20`, so it does not depend on expanded webhook payload fields. The async failure event is acknowledged without creating a donation. If a legacy account's event selector does not list a legacy refund event, select the modern `refund.*` events plus `charge.refunded`.
6. Copy **that destination's signing secret** into `STRIPE_WEBHOOK_SIGNING_SECRET`. Until configured correctly, Stripe delivery fails and must be retried; configure this before testing donations. Use the matching CLI-listener signing secret only for local testing, never in place of the deployed endpoint secret.
7. Complete the staging/manual checks below. A generic `stripe trigger checkout.session.completed` fixture is intentionally ignored if it is not an actual session for the configured Payment Link. Complete the sandbox Payment Link to produce a relevant event instead.
8. After approval, release the admin changes (`admin/index.html`, `admin/admin.js`, `admin/donations.js`) through the existing GitHub Pages release process. Deploy the schema/functions before the admin update. No public-page source files need changing. Do not merge into `main` or publish this branch until the owner has tested and approved it.

## Secure one-time import of existing donations

This import reads historical sessions for the **same configured Payment Link**, re-retrieves current payment/refund state, and calls the exact same transactional write path. It cannot accept arbitrary donor records or amounts from the browser. Repeating a batch, restarting the entire import, or overlapping live webhooks is safe and cannot create duplicate donation records.

1. Deploy the new schema/webhook first and configure live backend secrets correctly. Live webhooks can remain enabled during import. Test the import in staging before production.
2. Temporarily set `DONATION_IMPORT_ENABLED=true` in Supabase Function Secrets, and deploy:

   ```powershell
   supabase functions deploy stripe-donation-import --project-ref PROJECT_REF
   ```

   Leave JWT verification enabled. The function separately validates the JWT with Supabase Auth and checks `admin_users` using the user's own RLS context before making any Stripe request.
3. Sign in normally to the existing admin dashboard, open browser Developer Tools → Console on that trusted page, and run the following. It uses the existing `sb` client/session; **no Stripe or service-role secret is entered in the browser**. Each request scans at most five Stripe sessions and returns only counts/checkpoints, not donor payloads.

   ```javascript
   async function importExistingDonations() {
     const storageKey = 'tpgDonationImportCheckpoint';
     let checkpoint = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
     if (checkpoint.done) throw new Error('This import already completed.');
     for (;;) {
       const { data, error } = await sb.functions.invoke('stripe-donation-import', {
         body: { before: checkpoint.before, starting_after: checkpoint.starting_after }
       });
       if (error || data.error) throw new Error('Batch failed. Resolve the issue and run again at the saved checkpoint.');
       checkpoint = { before: data.before, starting_after: data.next_cursor, done: !data.next_cursor };
       sessionStorage.setItem(storageKey, JSON.stringify(checkpoint));
       console.log({ scanned: data.scanned, recordedOrRefreshed: data.recorded, done: checkpoint.done });
       if (checkpoint.done) break;
     }
   }
   await importExistingDonations();
   ```

   The initial server-generated `before` timestamp stays fixed across batches. It scopes **session creation time**, not payment date. Unpaid/failed/incomplete sessions are scanned and skipped; already refunded successful sessions import with their refunds. Errors stop the loop; retry after fixing the cause. If the browser loses the checkpoint, restart from the beginning—duplicates are still prevented. To deliberately reconcile all records again, remove only this session-storage key, then rerun while the import is enabled. Counts include refreshed existing rows, not just new rows.
4. Reconcile the Donations tab and totals by currency against Stripe's successful payments and succeeded refunds for that link. Log out/in or reopen Donations to refresh the metrics. Investigate any mismatch before signing off. No existing Stripe payments are refunded, charged, or modified by the import.
5. Set `DONATION_IMPORT_ENABLED=false` (or remove it) immediately after verification. Optionally delete the temporary deployed `stripe-donation-import` function through Supabase Dashboard; leave the webhook active. Clear the checkpoint with `sessionStorage.removeItem('tpgDonationImportCheckpoint')` on the admin page. There is no cron job or permanently enabled public import route.

## Automated checks

No frontend runtime dependency was added. The portable tests use synthetic data only:

```powershell
node tests/donations-webhook.test.mjs
node tests/donations-admin.test.mjs
node --experimental-strip-types tests/donations-edge.test.mjs
node --check admin/admin.js
node --check admin/donations.js
git diff --check
```

The Edge handler test needs Node 22.6+ for TypeScript stripping. It mocks Deno globals and external requests; it does not replace deployment testing in Supabase's Deno runtime.

To execute the actual SQL/RLS tests without Docker or a live Supabase project, install an **isolated test-only** PostgreSQL WASM runtime in the OS temporary directory (no project dependency or tracked lock file):

```powershell
npm.cmd install --prefix "$env:TEMP\tpg-donation-test-runtime" --no-package-lock --no-save --ignore-scripts @electric-sql/pglite@0.3.14
$env:PGLITE_MODULE = Join-Path $env:TEMP 'tpg-donation-test-runtime\node_modules\@electric-sql\pglite\dist\index.js'
node tests/donations-database.test.mjs
```

That test bootstraps local Supabase-like roles/Auth, applies the existing schema and new migration, checks transactions/deduplication/refunds, unchanged existing contacts and policies, exact metric totals, literal search/pagination, and administrator/non-admin/anonymous read/write restrictions. Without `PGLITE_MODULE` it reports an explicit skip, not a database-test pass.

Implementation validation also covered headless Chrome at desktop/mobile widths using synthetic authenticated responses: all five pre-existing tabs and four original metrics matched the original implementation, while donation search/date sorting/net totals and responsive table scrolling passed with zero JavaScript exceptions.

## Remaining staging/live verification

- Apply the migration to staging and deploy both Edge Functions. Confirm the selected project's existing admin membership/policies and deployed Deno runtime behave correctly.
- Complete a payment through the **staging test Payment Link**. Confirm one matching donation, optional fields and text ZIP, correct amount/currency/date, contact matching, unchanged marketing consent, and dashboard display.
- Resend the same Stripe delivery and import the same session twice. Confirm one donation and one case-insensitive email contact. Test parallel notifications where possible.
- Exercise a delayed test payment through its unpaid, succeeded, and failed outcomes. Only successful payments should appear or count. Confirm no unrelated Payment Link payments appear.
- Issue partial and full **test refunds**. Verify only succeeded refunds reduce totals; pending/failed refunds do not. Resend an older completion event after refund and confirm it cannot restore the old total.
- Check name/email search, date sorting, next/previous paging, and optional/missing donor details with real authenticated test administrators.
- Use actual signed-out and signed-in non-admin test sessions to attempt table SELECT, both read RPCs, the write RPC, and import. Verify no private records or write access. The SQL tests prove these role restrictions locally; deployed roles/policies still require this check.
- Confirm total donations per currency (gross minus refunds, with no fee adjustment) and unique-donor rules against Stripe. Unknown identifiers stay excluded from donor count.
- Verify Stripe delivery responses are 2xx after committed writes, invalid signatures get 400, and a deliberately unavailable staging backend produces a retriable 500 without leaking payloads. Fix causes and resend failed deliveries; monitor Stripe's delivery log and generic Supabase error logs.
- Recheck existing tabs, login/logout, public checkout and resource download flow. No live charge/refund has been submitted by the implementation tests.

## Operations and scope

Stripe retries failed deliveries. Database/API failures return 500 and are not acknowledged as successful writes. For an outage beyond Stripe's retry window, re-enable the same safe import to reconcile current Stripe state. No scheduled reconciliation is added. Existing rows are never deleted by this integration; the new donation `contact_id` becomes null if that contact is separately deleted through an authorized process.

To stop new tracking, disable the Stripe event destination; do not delete records or alter existing policies. Keep the original checkout active. A broader accounting integration for chargebacks, recurring gifts, or sub-cent currencies should be scoped separately.

Reference documentation: [Stripe webhook delivery/signatures](https://docs.stripe.com/events/manage-webhook-endpoints), [Stripe Checkout session API](https://docs.stripe.com/api/checkout/sessions/list), [Stripe refund objects](https://docs.stripe.com/api/refunds/object), [Stripe currency conventions](https://docs.stripe.com/currencies), and [Supabase per-function JWT settings](https://supabase.com/docs/guides/functions/function-configuration).
