-- Enforce the paid logo subscription in the database as well as the browser.
-- Run in Supabase SQL Editor after company_settings_migration.sql and logo_subscription_migration.sql.

create or replace function public.enforce_active_logo_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.logo_url is distinct from old.logo_url
     and coalesce(new.logo_url, '') <> ''
     and not exists (
       select 1
       from public.logo_subscriptions s
       where s.owner_id = new.owner_id
         and s.status = 'active'
         and s.expires_at > now()
     ) then
    raise exception 'An active ₦1,500/month logo subscription is required to change the company logo.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists require_active_logo_subscription on public.company_settings;
create trigger require_active_logo_subscription
before update on public.company_settings
for each row execute function public.enforce_active_logo_subscription();

-- Prevent direct uploads to the public logo bucket unless the signed-in owner has an active subscription.
drop policy if exists "Owners upload company logos to own folder" on storage.objects;
create policy "Active subscribers upload company logos to own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-logos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.logo_subscriptions s
    where s.owner_id = (select auth.uid())
      and s.status = 'active'
      and s.expires_at > now()
  )
);

drop policy if exists "Owners update company logos in own folder" on storage.objects;
create policy "Active subscribers update company logos in own folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'company-logos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.logo_subscriptions s
    where s.owner_id = (select auth.uid())
      and s.status = 'active'
      and s.expires_at > now()
  )
)
with check (
  bucket_id = 'company-logos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.logo_subscriptions s
    where s.owner_id = (select auth.uid())
      and s.status = 'active'
      and s.expires_at > now()
  )
);
