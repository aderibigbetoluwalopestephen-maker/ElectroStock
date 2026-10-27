-- ElectroStock support tickets and private platform support administration.
-- Run this entire file in Supabase SQL Editor before using Support Centre.
create table if not exists public.platform_support_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  store_owner_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 140),
  category text not null default 'Other',
  priority text not null default 'normal' check (priority in ('normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists support_tickets_store_updated_idx on public.support_tickets(store_owner_id, updated_at desc);
create index if not exists support_ticket_messages_ticket_created_idx on public.support_ticket_messages(ticket_id, created_at);
alter table public.platform_support_admins enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
drop policy if exists "Support admins can read admin registry" on public.platform_support_admins;
create policy "Support admins can read admin registry" on public.platform_support_admins for select to authenticated using (user_id = auth.uid());
drop policy if exists "Store members and support admins can read tickets" on public.support_tickets;
create policy "Store members and support admins can read tickets" on public.support_tickets for select to authenticated using (
  exists (select 1 from public.platform_support_admins a where a.user_id = auth.uid())
  or store_owner_id = auth.uid()
  or exists (select 1 from public.store_members sm where sm.user_id = auth.uid() and sm.owner_id = support_tickets.store_owner_id)
);
drop policy if exists "Store members can create support tickets" on public.support_tickets;
create policy "Store members can create support tickets" on public.support_tickets for insert to authenticated with check (
  created_by = auth.uid() and (
    store_owner_id = auth.uid()
    or exists (select 1 from public.store_members sm where sm.user_id = auth.uid() and sm.owner_id = support_tickets.store_owner_id)
  )
);
drop policy if exists "Support admins can update ticket status" on public.support_tickets;
create policy "Support admins can update ticket status" on public.support_tickets for update to authenticated using (
  exists (select 1 from public.platform_support_admins a where a.user_id = auth.uid())
) with check (exists (select 1 from public.platform_support_admins a where a.user_id = auth.uid()));
drop policy if exists "Ticket participants can read messages" on public.support_ticket_messages;
create policy "Ticket participants can read messages" on public.support_ticket_messages for select to authenticated using (
  exists (select 1 from public.support_tickets t where t.id = ticket_id and (
    t.store_owner_id = auth.uid()
    or exists (select 1 from public.store_members sm where sm.user_id = auth.uid() and sm.owner_id = t.store_owner_id)
    or exists (select 1 from public.platform_support_admins a where a.user_id = auth.uid())
  ))
);
drop policy if exists "Ticket participants can send messages" on public.support_ticket_messages;
create policy "Ticket participants can send messages" on public.support_ticket_messages for insert to authenticated with check (
  sender_id = auth.uid() and exists (
    select 1 from public.support_tickets t where t.id = ticket_id and (
      t.store_owner_id = auth.uid()
      or exists (select 1 from public.store_members sm where sm.user_id = auth.uid() and sm.owner_id = t.store_owner_id)
      or exists (select 1 from public.platform_support_admins a where a.user_id = auth.uid())
    )
  )
);
-- To authorize a support administrator, sign in with that account, copy its UUID
-- from Supabase Authentication > Users, then run:
-- insert into public.platform_support_admins (user_id) values ('PASTE-AUTH-USER-UUID-HERE');
-- Do not put admin UUIDs or service-role keys in frontend config.js.
