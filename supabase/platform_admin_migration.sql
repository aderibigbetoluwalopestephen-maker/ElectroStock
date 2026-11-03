-- ElectroStock Super Admin foundation
-- Run once in Supabase SQL Editor. This grants admin only to the exact account email below,
-- if that account already exists in Supabase Auth. No frontend user can self-promote.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;
drop policy if exists "Admins can view own platform admin record" on public.platform_admins;
create policy "Admins can view own platform admin record"
  on public.platform_admins for select to authenticated
  using (user_id = auth.uid());
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;
create or replace function public.get_platform_admin_overview()
returns jsonb language plpgsql stable security definer
set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.platform_admins where user_id = (select auth.uid())) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  execute 'select jsonb_build_object(''registered_accounts'', (select count(*) from auth.users), ''businesses'', (select count(*) from public.company_settings), ''sales_transactions'', (select count(*) from public.sales), ''support_tickets'', case when to_regclass(''public.support_tickets'') is null then null else (select count(*) from public.support_tickets) end)'
    into result;
  return result;
end;
$$;
revoke all on function public.get_platform_admin_overview() from public;
grant execute on function public.get_platform_admin_overview() to authenticated;
-- Bootstrap the named platform administrator only if this Auth account already exists.
insert into public.platform_admins(user_id)
select id from auth.users where lower(email) = lower('electrostock.zyx@gmail.com')
on conflict (user_id) do nothing;
-- Verify bootstrap: this should return 1 after the account exists.
select count(*) as super_admin_accounts from public.platform_admins;
