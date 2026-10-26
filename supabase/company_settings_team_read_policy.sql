-- Allow active store members to read the store's branding/receipt settings.
-- Only the store owner may insert, update, or delete settings.
-- Run after team_features_migration.sql and company_settings_migration.sql.

alter table public.company_settings enable row level security;

drop policy if exists "Owners manage their company settings" on public.company_settings;
drop policy if exists "Store members can read company settings" on public.company_settings;
drop policy if exists "Store owners insert company settings" on public.company_settings;
drop policy if exists "Store owners update company settings" on public.company_settings;
drop policy if exists "Store owners delete company settings" on public.company_settings;

create policy "Store members can read company settings"
on public.company_settings for select to authenticated
using (public.is_store_member(owner_id));

create policy "Store owners insert company settings"
on public.company_settings for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy "Store owners update company settings"
on public.company_settings for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "Store owners delete company settings"
on public.company_settings for delete to authenticated
using (owner_id = (select auth.uid()));
