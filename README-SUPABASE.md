# The Providers Group — Supabase Setup

This version keeps the existing website design and adds a client-owned Supabase backend, resource delivery, and a small staff dashboard.

## What is connected

- Contact form → `contacts` + `inquiries`
- Workshop/program request → `contacts` + `program_requests`
- Footer email signup → `contacts` with `marketing_opt_in = true`
- Kidney Health Tracker form → `contacts` + `resource_downloads`
- Kidney Health Tracker PDF → private Supabase Storage, delivered with a 5-minute signed URL
- `/admin/` → staff sign-in and dashboard metrics/tables

## 1. Client creates Supabase

The Providers Group should create and own the Supabase organization/project and its billing. Invite EnhanceImpact as the developer/administrator who will configure it.

## 2. Run the database migration

In Supabase Dashboard → SQL Editor, run:

`supabase/migrations/001_providers_group.sql`

This creates the tables, RLS policies, controlled public RPC functions, and the Kidney Health Tracker resource record.

## 3. Create private Storage bucket

Supabase Dashboard → Storage → New bucket

- Bucket name: `resources`
- Public bucket: OFF

Inside the bucket create/upload to this path:

`kidney-health/The_Providers_Group_Give_Life_Kidney_Health_eBook.pdf`

A copy of the supplied ebook is in `supabase/storage-upload/` for upload.

## 4. Deploy the resource signup Edge Function

Using the Supabase CLI from this project folder:

`supabase functions deploy resource-signup`

The function uses Supabase's server-side service role environment variable and returns only a temporary signed download URL after the visitor submits the form.

## 5. Configure the website

Open `config.js` and replace:

- `https://YOUR_PROJECT_REF.supabase.co`
- `YOUR_SUPABASE_ANON_KEY`

Use the project's public anon/publishable key — never put the service-role key in the website.

## 6. Create the client's admin login

Supabase Dashboard → Authentication → Users → Add user.

Create the staff user, copy that user's UUID, then run in SQL Editor:

`insert into public.admin_users(user_id) values ('PASTE_USER_UUID_HERE');`

The staff dashboard is available at:

`/admin/`

Only authenticated users whose UUID is in `admin_users` can read the operational tables through RLS.

## 7. Test before launch

Test all of these:

1. General contact inquiry creates a contact + inquiry.
2. Workshop request creates a contact + program request.
3. Newsletter signup creates/updates a contact and records marketing consent.
4. Tracker request records the request and produces a working temporary download link.
5. A non-admin authenticated account cannot read dashboard data.
6. Admin account can sign in and see dashboard totals and records.
7. Service-role key does not appear anywhere in the public website or GitHub repository.

## Production hardening

Before a high-traffic launch, add Cloudflare Turnstile (or equivalent) and rate limiting to public submissions. For staff accounts, enable MFA in Supabase Auth. If The Providers Group begins sending newsletters, synchronize contacts with `marketing_opt_in = true` to an email-marketing provider rather than bulk-sending from the database.


## 60-week Give Life Journal
Run `supabase/migrations/002_blog_rotation.sql` after the base migration. It creates `blog_articles`, RLS policies, and 60 draft rotation slots.

Set `blogRotationStart` in `config.js` to the Monday (or other weekly start date) that should be Week 1. The public `blog.html` computes `(weeks elapsed % 60) + 1`; no weekly cron job is required. After Week 60, Week 61 automatically features rotation slot 1 again.

Use `/admin/` → **Blog Articles** to edit each slot and change its status to **Approved**. Draft and archived articles are not public. Every approved article keeps a permanent URL such as `article.html?slug=your-article-slug`, while the featured slot rotates weekly.
