-- ElectroStock secure store attendance QR code
-- Run in Supabase Dashboard > SQL Editor after team_features_migration.sql.
-- The QR contains only a random store token. Staff must be signed in and be an active store member.
create table if not exists public.store_attendance_qr (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.store_attendance_qr enable row level security;
drop policy if exists "attendance_qr_member_read" on public.store_attendance_qr;
create policy "attendance_qr_member_read" on public.store_attendance_qr
for select to authenticated using (public.is_store_member(owner_id));
drop policy if exists "attendance_qr_owner_insert" on public.store_attendance_qr;
create policy "attendance_qr_owner_insert" on public.store_attendance_qr
for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "attendance_qr_owner_update" on public.store_attendance_qr;
create policy "attendance_qr_owner_update" on public.store_attendance_qr
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update on public.store_attendance_qr to authenticated;
