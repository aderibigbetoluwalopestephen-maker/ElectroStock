-- ElectroStock: secure authorization for private Realtime call signaling.
-- Run this file in Supabase Dashboard -> SQL Editor as the project owner.
-- This does not create or modify inventory, sales, authentication, or team-chat tables.

drop policy if exists "ElectroStock team call inbox read" on realtime.messages;
drop policy if exists "ElectroStock team call inbox send" on realtime.messages;
drop policy if exists "ElectroStock team call room read" on realtime.messages;
drop policy if exists "ElectroStock team call room send" on realtime.messages;

create policy "ElectroStock team call inbox read"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() like 'electrostock-call-user:%'
  and split_part(realtime.topic(), ':', 3) = auth.uid()::text
  and (
    split_part(realtime.topic(), ':', 2)::uuid = auth.uid()
    or exists (
      select 1 from public.store_members sm
      where sm.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and sm.user_id = auth.uid()
        and coalesce(sm.active, true) = true
    )
  )
);

create policy "ElectroStock team call inbox send"
on realtime.messages
for insert
to authenticated
with check (
  realtime.topic() like 'electrostock-call-user:%'
  and (
    split_part(realtime.topic(), ':', 2)::uuid = auth.uid()
    or exists (
      select 1 from public.store_members sender
      where sender.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and sender.user_id = auth.uid()
        and coalesce(sender.active, true) = true
    )
  )
  and (
    split_part(realtime.topic(), ':', 3)::uuid = split_part(realtime.topic(), ':', 2)::uuid
    or exists (
      select 1 from public.store_members target
      where target.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and target.user_id = split_part(realtime.topic(), ':', 3)::uuid
        and coalesce(target.active, true) = true
    )
  )
);

create policy "ElectroStock team call room read"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() like 'electrostock-call:%'
  and (
    split_part(realtime.topic(), ':', 3) = auth.uid()::text
    or split_part(realtime.topic(), ':', 4) = auth.uid()::text
  )
  and (
    split_part(realtime.topic(), ':', 2)::uuid = auth.uid()
    or exists (
      select 1 from public.store_members sm
      where sm.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and sm.user_id = auth.uid()
        and coalesce(sm.active, true) = true
    )
  )
  and (
    split_part(realtime.topic(), ':', 3)::uuid = split_part(realtime.topic(), ':', 2)::uuid
    or exists (
      select 1 from public.store_members first_user
      where first_user.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and first_user.user_id = split_part(realtime.topic(), ':', 3)::uuid
        and coalesce(first_user.active, true) = true
    )
  )
  and (
    split_part(realtime.topic(), ':', 4)::uuid = split_part(realtime.topic(), ':', 2)::uuid
    or exists (
      select 1 from public.store_members second_user
      where second_user.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and second_user.user_id = split_part(realtime.topic(), ':', 4)::uuid
        and coalesce(second_user.active, true) = true
    )
  )
);

create policy "ElectroStock team call room send"
on realtime.messages
for insert
to authenticated
with check (
  realtime.topic() like 'electrostock-call:%'
  and (
    split_part(realtime.topic(), ':', 3) = auth.uid()::text
    or split_part(realtime.topic(), ':', 4) = auth.uid()::text
  )
  and (
    split_part(realtime.topic(), ':', 2)::uuid = auth.uid()
    or exists (
      select 1 from public.store_members sm
      where sm.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and sm.user_id = auth.uid()
        and coalesce(sm.active, true) = true
    )
  )
  and (
    split_part(realtime.topic(), ':', 3)::uuid = split_part(realtime.topic(), ':', 2)::uuid
    or exists (
      select 1 from public.store_members first_user
      where first_user.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and first_user.user_id = split_part(realtime.topic(), ':', 3)::uuid
        and coalesce(first_user.active, true) = true
    )
  )
  and (
    split_part(realtime.topic(), ':', 4)::uuid = split_part(realtime.topic(), ':', 2)::uuid
    or exists (
      select 1 from public.store_members second_user
      where second_user.owner_id = split_part(realtime.topic(), ':', 2)::uuid
        and second_user.user_id = split_part(realtime.topic(), ':', 4)::uuid
        and coalesce(second_user.active, true) = true
    )
  )
);
