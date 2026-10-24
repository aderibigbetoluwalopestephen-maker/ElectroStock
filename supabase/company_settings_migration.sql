-- Run after supabase/schema.sql and supabase/sales_migration.sql.
create table if not exists public.company_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null default 'ElectroStock',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  currency text not null default 'NGN' check (currency in ('NGN','USD','GBP','GHS','KES','ZAR')),
  logo_url text not null default '',
  receipt_footer text not null default 'Thank you for your patronage!',
  updated_at timestamptz not null default now()
);
alter table public.company_settings enable row level security;
grant select, insert, update, delete on public.company_settings to authenticated;
drop policy if exists "Owners manage their company settings" on public.company_settings;
create policy "Owners manage their company settings" on public.company_settings for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos','company-logos',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists "Company logos are publicly readable" on storage.objects;
create policy "Company logos are publicly readable" on storage.objects for select to public
using (bucket_id = 'company-logos');
drop policy if exists "Owners upload company logos to own folder" on storage.objects;
create policy "Owners upload company logos to own folder" on storage.objects for insert to authenticated
with check (bucket_id = 'company-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Owners update company logos in own folder" on storage.objects;
create policy "Owners update company logos in own folder" on storage.objects for update to authenticated
using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'company-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Owners delete company logos in own folder" on storage.objects;
create policy "Owners delete company logos in own folder" on storage.objects for delete to authenticated
using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
