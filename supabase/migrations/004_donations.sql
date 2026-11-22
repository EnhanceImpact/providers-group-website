-- Additive donation tracking. Existing tables, records and policies are unchanged.
begin;

create table public.donations (
  id uuid primary key default gen_random_uuid(),
  donor_first_name text,
  donor_last_name text,
  email text,
  zip_code text,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  donated_at timestamptz not null,
  payment_status text not null check (payment_status in ('succeeded','partially_refunded','refunded')),
  refunded_amount_cents bigint not null default 0 check (refunded_amount_cents >= 0 and refunded_amount_cents <= amount_cents),
  stripe_payment_id text not null unique check (stripe_payment_id like 'pi\_%' escape '\'),
  stripe_checkout_session_id text not null unique check (stripe_checkout_session_id like 'cs\_%' escape '\'),
  stripe_customer_id text,
  stripe_payment_link_id text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payment_status = case when refunded_amount_cents = amount_cents then 'refunded'
    when refunded_amount_cents > 0 then 'partially_refunded' else 'succeeded' end)
);
create index donations_date_idx on public.donations (donated_at desc, id);
alter table public.donations enable row level security;
revoke all on public.donations from public, anon, authenticated;
grant select on public.donations to authenticated;
grant all on public.donations to service_role;
create policy "admins read donations" on public.donations for select to authenticated
  using (public.is_tpg_admin());

-- Called only by trusted backend code, in one transaction. Never modifies existing contacts.
create function public.record_stripe_donation(p_donation jsonb) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_email text := nullif(lower(trim(p_donation->>'email')), '');
  v_contact_id uuid;
  v_amount bigint := (p_donation->>'amount_cents')::bigint;
  v_refunded bigint := (p_donation->>'refunded_amount_cents')::bigint;
begin
  if v_email is not null then
    select id into v_contact_id from public.contacts where lower(email) = v_email;
    if v_contact_id is null then
      insert into public.contacts(first_name,last_name,email,zip_code,marketing_opt_in)
      values (p_donation->>'donor_first_name',p_donation->>'donor_last_name',v_email,p_donation->>'zip_code',false)
      on conflict do nothing returning id into v_contact_id;
      if v_contact_id is null then
        select id into v_contact_id from public.contacts where lower(email) = v_email;
      end if;
    end if;
  end if;
  insert into public.donations as d (
    donor_first_name,donor_last_name,email,zip_code,amount_cents,currency,donated_at,
    payment_status,refunded_amount_cents,stripe_payment_id,stripe_checkout_session_id,
    stripe_customer_id,stripe_payment_link_id,contact_id
  ) values (
    p_donation->>'donor_first_name',p_donation->>'donor_last_name',v_email,p_donation->>'zip_code',
    v_amount,p_donation->>'currency',(p_donation->>'donated_at')::timestamptz,
    case when v_refunded = v_amount then 'refunded' when v_refunded > 0 then 'partially_refunded' else 'succeeded' end,
    v_refunded,p_donation->>'stripe_payment_id',p_donation->>'stripe_checkout_session_id',
    p_donation->>'stripe_customer_id',p_donation->>'stripe_payment_link_id',v_contact_id
  ) on conflict (stripe_payment_id) do update set
    refunded_amount_cents = greatest(d.refunded_amount_cents, excluded.refunded_amount_cents),
    payment_status = case
      when greatest(d.refunded_amount_cents, excluded.refunded_amount_cents) = d.amount_cents then 'refunded'
      when greatest(d.refunded_amount_cents, excluded.refunded_amount_cents) > 0 then 'partially_refunded'
      else 'succeeded' end,
    updated_at = now()
  -- A conflicting immutable identity/amount indicates a bug or wrong environment; fail closed.
  where d.stripe_checkout_session_id = excluded.stripe_checkout_session_id
    and d.stripe_payment_link_id = excluded.stripe_payment_link_id
    and d.amount_cents = excluded.amount_cents and d.currency = excluded.currency;
  if not found then raise exception 'Donation identity mismatch'; end if;
end;
$$;
revoke all on function public.record_stripe_donation(jsonb) from public, anon, authenticated;
grant execute on function public.record_stripe_donation(jsonb) to service_role;

-- SECURITY INVOKER keeps the existing admin check/RLS effective for both RPCs.
create function public.donation_summary() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'totals', coalesce((select jsonb_agg(t) from (
      select currency, sum(amount_cents - refunded_amount_cents)::text as net_cents
      from public.donations group by currency order by currency
    ) t), '[]'::jsonb),
    'unique_donors', (select count(distinct coalesce(
      'email:' || nullif(lower(trim(email)), ''),
      'contact:' || contact_id::text,
      'customer:' || stripe_customer_id
    )) from public.donations)
  );
$$;

create function public.donation_history(p_search text default '', p_ascending boolean default false,
  p_offset integer default 0, p_limit integer default 51)
returns table(donor_first_name text,donor_last_name text,email text,zip_code text,
  amount_cents bigint,currency text,donated_at timestamptz,payment_status text,refunded_amount_cents bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select d.donor_first_name,d.donor_last_name,d.email,d.zip_code,d.amount_cents,d.currency,
    d.donated_at,d.payment_status,d.refunded_amount_cents
  from public.donations d
  where strpos(lower(concat_ws(' ',d.donor_first_name,d.donor_last_name,d.email)),lower(coalesce(trim(p_search),''))) > 0
  order by case when p_ascending then d.donated_at end asc,
    case when not p_ascending then d.donated_at end desc, d.id
  limit least(greatest(p_limit,1),101) offset greatest(p_offset,0);
$$;
revoke all on function public.donation_summary() from public, anon;
revoke all on function public.donation_history(text,boolean,integer,integer) from public, anon;
grant execute on function public.donation_summary(), public.donation_history(text,boolean,integer,integer) to authenticated;
commit;
