// Optional isolated PostgreSQL runtime: set PGLITE_MODULE to its installed dist/index.js.
// No live credentials or records are used. See DONATIONS-TRACKING.md for setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test('SQL migration, atomic/idempotent writes, refunds, metrics, search and RLS', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    const original = (await readFile(new URL('../supabase/migrations/001_providers_group.sql', import.meta.url), 'utf8'))
      .replace('create extension if not exists pgcrypto;', ''); // gen_random_uuid is built into PostgreSQL.
    await db.exec(original);
    await db.exec(`grant select on public.admin_users to authenticated;
      grant all on public.contacts to service_role;
      insert into auth.users values ('11111111-1111-1111-1111-111111111111');
      insert into public.admin_users values ('11111111-1111-1111-1111-111111111111',now());
      insert into public.contacts(email,first_name,marketing_opt_in) values ('EXISTING@example.invalid','Original',true);`);
    const existing = (await db.query('select * from contacts')).rows;
    const policies = (await db.query('select * from pg_policies order by tablename,policyname')).rows;
    await db.exec(await readFile(new URL('../supabase/migrations/004_donations.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select * from contacts')).rows, existing);
    assert.deepEqual((await db.query("select * from pg_policies where tablename <> 'donations' order by tablename,policyname")).rows, policies);
    const base = { donor_first_name: 'Ada', donor_last_name: 'Example', email: 'existing@EXAMPLE.invalid', zip_code: '00501', amount_cents: 5000,
      currency: 'usd', donated_at: '2026-11-01T12:00:00Z', refunded_amount_cents: 0,
      stripe_payment_id: 'pi_one', stripe_checkout_session_id: 'cs_one', stripe_customer_id: 'cus_one', stripe_payment_link_id: 'plink_donation' };
    const save = async row => { await db.query('select public.record_stripe_donation($1::jsonb)', [JSON.stringify(row)]); };
    await db.exec('set role service_role');
    await save(base); await save(base);
    assert.equal((await db.query('select count(*)::int as n from donations')).rows[0].n, 1);
    await save({ ...base, refunded_amount_cents: 1250 }); await save(base);
    assert.equal((await db.query('select refunded_amount_cents from donations')).rows[0].refunded_amount_cents, 1250);
    await save({ ...base, refunded_amount_cents: 5000 });
    await save({ ...base, refunded_amount_cents: 1250 });
    assert.equal((await db.query('select payment_status from donations')).rows[0].payment_status, 'refunded');
    await save({ ...base, stripe_payment_id: 'pi_two', stripe_checkout_session_id: 'cs_two', amount_cents: 2500,
      email: 'new@example.invalid', donated_at: '2026-11-02T12:00:00Z' });
    await save({ ...base, stripe_payment_id: 'pi_three', stripe_checkout_session_id: 'cs_three', email: null,
      stripe_customer_id: null, amount_cents: 1000, donated_at: '2026-11-03T12:00:00Z' });
    await save({ ...base, stripe_payment_id: 'pi_four', stripe_checkout_session_id: 'cs_four', email: null,
      stripe_customer_id: 'cus_two', amount_cents: 3000, currency: 'cad', donated_at: '2026-11-04T12:00:00Z' });
    await assert.rejects(save({ ...base, stripe_payment_id: 'pi_conflict', email: 'rollback@example.invalid' }));
    await assert.rejects(save({ ...base, amount_cents: 100, email: 'rollback@example.invalid' }));
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int as n from contacts where email='rollback@example.invalid'")).rows[0].n, 0);
    assert.deepEqual((await db.query("select * from contacts where lower(email)='existing@example.invalid'")).rows, existing);
    assert.equal((await db.query("select marketing_opt_in from contacts where email='new@example.invalid'")).rows[0].marketing_opt_in, false);
    assert.equal((await db.query('select count(*)::int as n from contacts')).rows[0].n, 2);
    await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';`);
    const summary = (await db.query('select donation_summary() as result')).rows[0].result;
    assert.deepEqual(summary.totals, [{ currency: 'cad', net_cents: '3000' }, { currency: 'usd', net_cents: '3500' }]);
    assert.equal(summary.unique_donors, 3);
    const history = (await db.query("select * from donation_history('NEW@example',false,0,51)")).rows;
    assert.equal(history.length, 1); assert.equal(history[0].email, 'new@example.invalid');
    assert.equal((await db.query("select * from donation_history('%',false,0,51)")).rows.length, 0);
    assert.equal((await db.query("select * from donation_history('',true,1,1)")).rows[0].email, 'new@example.invalid');
    await assert.rejects(db.query("update donations set email='bad'"));
    await assert.rejects(save(base));
    await db.exec(`set "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';`);
    assert.equal((await db.query('select * from donations')).rows.length, 0);
    assert.deepEqual((await db.query('select donation_summary() as result')).rows[0].result, { totals: [], unique_donors: 0 });
    assert.equal((await db.query('select * from donation_history()')).rows.length, 0);
    await assert.rejects(save(base));
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from donations'));
    await assert.rejects(db.query('select donation_summary()'));
    await assert.rejects(db.query('select * from donation_history()'));
    await assert.rejects(save(base));
  } finally { await db.close(); }
});
