-- ElectroStock team features migration
-- Run in Supabase Dashboard > SQL Editor against the existing ElectroStock project.
-- Does not replace existing products, sales, stock_movements, or company_settings tables.

create table if not exists public.store_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  phone text,
  role text not null check (role in ('manager','sales_rep')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, user_id),
  unique (owner_id, email)
);

create index if not exists store_members_owner_idx on public.store_members(owner_id);
create index if not exists store_members_user_idx on public.store_members(user_id);

-- Owner identity is the store's auth user ID. Members can only read their own
-- membership; owners can manage membership rows for their store.
create or replace function public.is_store_owner(p_owner_id uuid)
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select auth.uid() = p_owner_id
$$;

create or replace function public.is_store_member(p_owner_id uuid)
returns boolean language sql stable security definer
set search_path = public, auth
as $$
  select auth.uid() = p_owner_id
     or exists (
       select 1 from public.store_members m
       where m.owner_id = p_owner_id
         and m.user_id = auth.uid()
         and m.active = true
     )
$$;

create or replace function public.store_member_role(p_owner_id uuid)
returns text language sql stable security definer
set search_path = public, auth
as $$
  select case
    when auth.uid() = p_owner_id then 'owner'
    else (
      select m.role from public.store_members m
      where m.owner_id = p_owner_id
        and m.user_id = auth.uid()
        and m.active = true
      limit 1
    )
  end
$$;

alter table public.store_members enable row level security;
drop policy if exists "store_members_owner_select" on public.store_members;
create policy "store_members_owner_select" on public.store_members
for select to authenticated using (owner_id = auth.uid());
drop policy if exists "store_members_owner_insert" on public.store_members;
create policy "store_members_owner_insert" on public.store_members
for insert to authenticated with check (owner_id = auth.uid() and role in ('manager','sales_rep'));
drop policy if exists "store_members_owner_update" on public.store_members;
create policy "store_members_owner_update" on public.store_members
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "store_members_owner_delete" on public.store_members;
create policy "store_members_owner_delete" on public.store_members
for delete to authenticated using (owner_id = auth.uid());
drop policy if exists "store_members_member_read_self" on public.store_members;
create policy "store_members_member_read_self" on public.store_members
for select to authenticated using (user_id = auth.uid());

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete set null,
  message text not null check (length(trim(message)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists team_messages_owner_created_idx
  on public.team_messages(owner_id, created_at desc);
create index if not exists team_messages_recipient_idx
  on public.team_messages(recipient_id, created_at desc);
alter table public.team_messages enable row level security;
drop policy if exists "team_messages_member_read" on public.team_messages;
create policy "team_messages_member_read" on public.team_messages
for select to authenticated using (
  public.is_store_member(owner_id)
  and (recipient_id is null or recipient_id = auth.uid() or sender_id = auth.uid()
       or public.is_store_owner(owner_id))
);
drop policy if exists "team_messages_member_send" on public.team_messages;
create policy "team_messages_member_send" on public.team_messages
for insert to authenticated with check (
  public.is_store_member(owner_id)
  and sender_id = auth.uid()
  and (public.store_member_role(owner_id) in ('owner','manager','sales_rep'))
  and (recipient_id is null or exists (
    select 1 from public.store_members m
    where m.owner_id = team_messages.owner_id
      and m.user_id = team_messages.recipient_id and m.active = true
  ) or recipient_id = owner_id)
);
drop policy if exists "team_messages_sender_or_recipient_update" on public.team_messages;
create policy "team_messages_sender_or_recipient_update" on public.team_messages
for update to authenticated using (
  public.is_store_member(owner_id)
  and (sender_id = auth.uid() or recipient_id = auth.uid() or public.is_store_owner(owner_id))
) with check (public.is_store_member(owner_id));

create table if not exists public.store_announcements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 180),
  body text not null check (length(trim(body)) between 1 and 10000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists store_announcements_owner_created_idx
  on public.store_announcements(owner_id, created_at desc);
alter table public.store_announcements enable row level security;
drop policy if exists "announcements_member_read" on public.store_announcements;
create policy "announcements_member_read" on public.store_announcements
for select to authenticated using (public.is_store_member(owner_id));
drop policy if exists "announcements_owner_manager_create" on public.store_announcements;
create policy "announcements_owner_manager_create" on public.store_announcements
for insert to authenticated with check (
  author_id = auth.uid()
  and public.store_member_role(owner_id) in ('owner','manager')
);
drop policy if exists "announcements_owner_manager_update" on public.store_announcements;
create policy "announcements_owner_manager_update" on public.store_announcements
for update to authenticated using (
  public.store_member_role(owner_id) in ('owner','manager')
) with check (public.store_member_role(owner_id) in ('owner','manager'));
drop policy if exists "announcements_owner_delete" on public.store_announcements;
create policy "announcements_owner_delete" on public.store_announcements
for delete to authenticated using (owner_id = auth.uid());

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.store_announcements(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);
create index if not exists announcement_reads_owner_user_idx
  on public.announcement_reads(owner_id, user_id);
alter table public.announcement_reads enable row level security;
drop policy if exists "announcement_reads_member_select" on public.announcement_reads;
create policy "announcement_reads_member_select" on public.announcement_reads
for select to authenticated using (
  public.is_store_member(owner_id)
  and (user_id = auth.uid() or public.is_store_owner(owner_id))
);
drop policy if exists "announcement_reads_member_insert" on public.announcement_reads;
create policy "announcement_reads_member_insert" on public.announcement_reads
for insert to authenticated with check (
  user_id = auth.uid()
  and public.is_store_member(owner_id)
  and exists (
    select 1 from public.store_announcements a
    where a.id = announcement_id and a.owner_id = announcement_reads.owner_id
  )
);
drop policy if exists "announcement_reads_member_update" on public.announcement_reads;
create policy "announcement_reads_member_update" on public.announcement_reads
for update to authenticated using (user_id = auth.uid())
with check (user_id = auth.uid());

create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint staff_attendance_clock_order check (clock_out is null or clock_out >= clock_in)
);
create index if not exists staff_attendance_owner_clock_idx
  on public.staff_attendance(owner_id, clock_in desc);
create index if not exists staff_attendance_user_clock_idx
  on public.staff_attendance(user_id, clock_in desc);
create unique index if not exists staff_attendance_one_open_shift
  on public.staff_attendance(user_id) where clock_out is null;
alter table public.staff_attendance enable row level security;
drop policy if exists "attendance_member_select" on public.staff_attendance;
create policy "attendance_member_select" on public.staff_attendance
for select to authenticated using (
  public.is_store_member(owner_id)
  and (user_id = auth.uid() or public.store_member_role(owner_id) in ('owner','manager'))
);
drop policy if exists "attendance_member_clock_in" on public.staff_attendance;
create policy "attendance_member_clock_in" on public.staff_attendance
for insert to authenticated with check (
  user_id = auth.uid() and public.is_store_member(owner_id)
);
drop policy if exists "attendance_member_clock_out" on public.staff_attendance;
create policy "attendance_member_clock_out" on public.staff_attendance
for update to authenticated using (
  user_id = auth.uid() or public.store_member_role(owner_id) in ('owner','manager')
) with check (
  public.is_store_member(owner_id)
);
drop policy if exists "attendance_owner_delete" on public.staff_attendance;
create policy "attendance_owner_delete" on public.staff_attendance
for delete to authenticated using (owner_id = auth.uid());

grant select, insert, update, delete on public.store_members to authenticated;
grant select, insert, update on public.team_messages to authenticated;
grant select, insert, update, delete on public.store_announcements to authenticated;
grant select, insert, update on public.announcement_reads to authenticated;
grant select, insert, update, delete on public.staff_attendance to authenticated;

-- IMPORTANT: This migration creates the team data tables and RLS policies.
-- Staff account invitations still need a trusted Supabase Edge Function using
-- SUPABASE_SERVICE_ROLE_KEY; never put that service-role key in config.js or browser code.
