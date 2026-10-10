-- 60-week evergreen blog rotation
-- Run after 001_providers_group.sql.

create table if not exists public.blog_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text,
  content text not null default '',
  featured_image_url text,
  category text,
  author text default 'The Providers Group',
  rotation_order integer unique check (rotation_order between 1 and 60),
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  original_publish_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.blog_articles enable row level security;
create policy "public reads approved blog articles" on public.blog_articles for select to anon, authenticated using (status='approved');
create policy "admins insert blog articles" on public.blog_articles for insert to authenticated with check (public.is_tpg_admin());
create policy "admins update blog articles" on public.blog_articles for update to authenticated using (public.is_tpg_admin()) with check (public.is_tpg_admin());
create policy "admins delete blog articles" on public.blog_articles for delete to authenticated using (public.is_tpg_admin());

-- Creates 60 draft slots. Replace each title/slug/content in the admin dashboard, then approve it.
insert into public.blog_articles(title,slug,rotation_order,status)
select 'Article '||n, 'article-'||n, n, 'draft' from generate_series(1,60) n
on conflict (rotation_order) do nothing;
