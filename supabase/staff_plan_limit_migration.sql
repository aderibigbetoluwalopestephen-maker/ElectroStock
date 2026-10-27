-- ElectroStock staff plan enforcement
-- Free stores may have at most 2 staff members. An active Premium/logo subscription
-- removes the cap. Run this file in Supabase Dashboard > SQL Editor.
create or replace function public.enforce_store_staff_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_count integer;
  premium_active boolean;
begin
  -- A currently active subscription is the existing ElectroStock Premium/logo plan.
  select exists (
    select 1
    from public.logo_subscriptions s
    where s.owner_id = new.owner_id
      and s.status = 'active'
      and s.expires_at is not null
      and s.expires_at > now()
  ) into premium_active;

  if premium_active then
    return new;
  end if;

  select count(*) into staff_count
  from public.store_members m
  where m.owner_id = new.owner_id;

  if staff_count >= 2 then
    raise exception 'FREE_STAFF_LIMIT: Free plan allows up to 2 staff members. Subscribe to Premium to add more.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_store_staff_plan_limit_before_insert on public.store_members;

create trigger enforce_store_staff_plan_limit_before_insert
before insert on public.store_members
for each row
execute function public.enforce_store_staff_plan_limit();
