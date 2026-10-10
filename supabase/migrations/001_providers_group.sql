-- The Providers Group website database
-- Run in Supabase SQL Editor on a NEW client-owned project.

create extension if not exists pgcrypto;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text not null,
  phone text,
  zip_code text,
  city_state text,
  marketing_opt_in boolean not null default false,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contacts_email_lower_idx on public.contacts (lower(email));

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  organization text,
  reason text not null,
  message text not null,
  referral_source text,
  status text not null default 'new' check (status in ('new','in_progress','completed','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.program_requests (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  organization text,
  organization_type text,
  preferred_date date,
  alternate_date date,
  estimated_attendance integer check (estimated_attendance is null or estimated_attendance > 0),
  audience_age_group text,
  delivery_preference text,
  accessibility_needs text,
  message text,
  status text not null default 'new' check (status in ('new','in_progress','completed','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  storage_path text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_downloads (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  resource_id uuid not null references public.resources(id),
  requested_at timestamptz not null default now(),
  downloaded_at timestamptz
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.contacts enable row level security;
alter table public.inquiries enable row level security;
alter table public.program_requests enable row level security;
alter table public.resources enable row level security;
alter table public.resource_downloads enable row level security;
alter table public.admin_users enable row level security;

-- No anonymous SELECT policies. Public writes happen through controlled RPCs / Edge Function.
create or replace function public.is_tpg_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users where user_id = auth.uid());
$$;

-- Admin policies
create policy "admins read contacts" on public.contacts for select to authenticated using (public.is_tpg_admin());
create policy "admins update contacts" on public.contacts for update to authenticated using (public.is_tpg_admin()) with check (public.is_tpg_admin());
create policy "admins read inquiries" on public.inquiries for select to authenticated using (public.is_tpg_admin());
create policy "admins update inquiries" on public.inquiries for update to authenticated using (public.is_tpg_admin()) with check (public.is_tpg_admin());
create policy "admins read programs" on public.program_requests for select to authenticated using (public.is_tpg_admin());
create policy "admins update programs" on public.program_requests for update to authenticated using (public.is_tpg_admin()) with check (public.is_tpg_admin());
create policy "admins read resources" on public.resources for select to authenticated using (public.is_tpg_admin());
create policy "admins read downloads" on public.resource_downloads for select to authenticated using (public.is_tpg_admin());
create policy "admins read admin membership" on public.admin_users for select to authenticated using (user_id = auth.uid());

create or replace function public.submit_contact_inquiry(
  p_first_name text, p_last_name text, p_email text, p_phone text,
  p_city_state text, p_organization text, p_reason text, p_message text,
  p_referral_source text, p_marketing_opt_in boolean default false,
  p_preferred_date date default null, p_alternate_date date default null,
  p_estimated_attendance integer default null, p_audience_age_group text default null,
  p_delivery_preference text default null, p_organization_type text default null,
  p_accessibility_needs text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_contact uuid; v_id uuid; v_email text := lower(trim(p_email));
begin
  if v_email = '' or p_first_name is null or trim(p_first_name) = '' or p_last_name is null or trim(p_last_name) = '' then
    raise exception 'Required contact fields are missing';
  end if;
  insert into contacts(first_name,last_name,email,phone,city_state,marketing_opt_in,marketing_consent_at)
  values(trim(p_first_name),trim(p_last_name),v_email,nullif(trim(p_phone),''),nullif(trim(p_city_state),''),coalesce(p_marketing_opt_in,false),case when p_marketing_opt_in then now() end)
  on conflict ((lower(email))) do update set
    first_name=excluded.first_name,last_name=excluded.last_name,
    phone=coalesce(excluded.phone,contacts.phone),city_state=coalesce(excluded.city_state,contacts.city_state),
    marketing_opt_in=contacts.marketing_opt_in or excluded.marketing_opt_in,
    marketing_consent_at=case when contacts.marketing_opt_in or not excluded.marketing_opt_in then contacts.marketing_consent_at else now() end,
    updated_at=now()
  returning id into v_contact;

  if p_reason = 'workshop' then
    insert into program_requests(contact_id,organization,organization_type,preferred_date,alternate_date,estimated_attendance,audience_age_group,delivery_preference,accessibility_needs,message)
    values(v_contact,nullif(trim(p_organization),''),nullif(trim(p_organization_type),''),p_preferred_date,p_alternate_date,p_estimated_attendance,nullif(trim(p_audience_age_group),''),nullif(trim(p_delivery_preference),''),nullif(trim(p_accessibility_needs),''),nullif(trim(p_message),'')) returning id into v_id;
  else
    insert into inquiries(contact_id,organization,reason,message,referral_source)
    values(v_contact,nullif(trim(p_organization),''),p_reason,p_message,nullif(trim(p_referral_source),'')) returning id into v_id;
  end if;
  return v_id;
end $$;

grant execute on function public.submit_contact_inquiry(text,text,text,text,text,text,text,text,text,boolean,date,date,integer,text,text,text,text) to anon, authenticated;

create or replace function public.subscribe_email(p_email text, p_zip_code text default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_email text := lower(trim(p_email));
begin
  if v_email = '' then raise exception 'Email is required'; end if;
  insert into contacts(email,zip_code,marketing_opt_in,marketing_consent_at)
  values(v_email,nullif(trim(p_zip_code),''),true,now())
  on conflict ((lower(email))) do update set zip_code=coalesce(excluded.zip_code,contacts.zip_code),marketing_opt_in=true,marketing_consent_at=coalesce(contacts.marketing_consent_at,now()),updated_at=now()
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.subscribe_email(text,text) to anon, authenticated;

insert into public.resources(slug,title,storage_path)
values('kidney-health-tracker','Give Life Kidney Health Tracker','kidney-health/The_Providers_Group_Give_Life_Kidney_Health_eBook.pdf')
on conflict (slug) do update set title=excluded.title,storage_path=excluded.storage_path,is_active=true;

-- Create a PRIVATE Storage bucket named "resources" in the Supabase dashboard,
-- then upload the ebook to:
-- kidney-health/The_Providers_Group_Give_Life_Kidney_Health_eBook.pdf
--
-- After creating the client's first Auth user, make that user an admin:
-- insert into public.admin_users(user_id) values ('AUTH_USER_UUID_HERE');
