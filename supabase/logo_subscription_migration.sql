-- Run after supabase/company_settings_migration.sql.
create table if not exists public.logo_subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive' check (status in ('active','inactive','cancelled','expired')),
  expires_at timestamptz,
  paystack_reference text unique,
  updated_at timestamptz not null default now()
);
alter table public.logo_subscriptions enable row level security;
drop policy if exists "Owners read their logo subscription" on public.logo_subscriptions;
create policy "Owners read their logo subscription" on public.logo_subscriptions for select to authenticated
using (owner_id = (select auth.uid()));
-- Only the server-side Edge Functions should write subscription records.
