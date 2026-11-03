-- ElectroStock full platform administration (run after platform_admin_migration.sql).
-- All privileged reads and writes are performed by SECURITY DEFINER RPCs and require platform_admins membership.
create table if not exists public.platform_account_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','suspended')),
  reason text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.platform_audit_logs (
  id bigserial primary key,
  admin_user_id uuid references auth.users(id),
  action text not null,
  target_user_id uuid,
  target_record_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.platform_account_controls enable row level security;
alter table public.platform_audit_logs enable row level security;
revoke all on public.platform_account_controls, public.platform_audit_logs from anon, authenticated;
grant select on public.platform_account_controls to authenticated;
drop policy if exists "Platform admins read account controls" on public.platform_account_controls;
create policy "Platform admins read account controls" on public.platform_account_controls for select to authenticated
using (exists(select 1 from public.platform_admins a where a.user_id=auth.uid()));
drop policy if exists "Platform admins read audit logs" on public.platform_audit_logs;
create policy "Platform admins read audit logs" on public.platform_audit_logs for select to authenticated
using (exists(select 1 from public.platform_admins a where a.user_id=auth.uid()));

-- The platform admin is also an authorized support operator.
create table if not exists public.platform_support_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.platform_support_admins enable row level security;
grant select on public.platform_support_admins to authenticated;
drop policy if exists "Platform support admins read own record" on public.platform_support_admins;
create policy "Platform support admins read own record" on public.platform_support_admins for select to authenticated using (user_id=auth.uid());
insert into public.platform_support_admins(user_id)
select user_id from public.platform_admins on conflict (user_id) do nothing;

create or replace function public.platform_admin_data(p_section text default 'overview')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_support_count bigint := 0; v_active_subs bigint := 0;
begin
 if not exists(select 1 from public.platform_admins where user_id=(select auth.uid())) then
   raise exception 'Not authorised' using errcode='42501';
 end if;
 if p_section='accounts' then
   select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]'::jsonb) into v from (
     select jsonb_build_object(
       'user_id',u.id,'email',u.email,'created_at',u.created_at,
       'business_name',coalesce(cs.company_name,'Not set'),
       'status',coalesce(ac.status,'active'),'suspension_reason',ac.reason,
       'sales_count',(select count(*) from public.sales s where s.owner_id=u.id),
       'last_sign_in_at',u.last_sign_in_at
     ) x from auth.users u
     left join public.company_settings cs on cs.owner_id=u.id
     left join public.platform_account_controls ac on ac.user_id=u.id
   ) q;
   return jsonb_build_object('accounts',v);
 elsif p_section='subscriptions' then
   if to_regclass('public.logo_subscriptions') is null then return jsonb_build_object('subscriptions','[]'::jsonb); end if;
   execute 'select coalesce(jsonb_agg(jsonb_build_object(''user_id'',u.id,''email'',u.email,''business_name'',coalesce(cs.company_name,''Not set''),''status'',ls.status,''expires_at'',ls.expires_at,''reference'',ls.paystack_reference,''updated_at'',ls.updated_at) order by ls.updated_at desc),''[]''::jsonb) from public.logo_subscriptions ls join auth.users u on u.id=ls.owner_id left join public.company_settings cs on cs.owner_id=u.id' into v;
   return jsonb_build_object('subscriptions',v);
 elsif p_section='support' then
   if to_regclass('public.support_tickets') is null then return jsonb_build_object('tickets','[]'::jsonb); end if;
   execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',t.id,''store_owner_id'',t.store_owner_id,''email'',u.email,''business_name'',coalesce(cs.company_name,''Not set''),''subject'',t.subject,''category'',t.category,''priority'',t.priority,''status'',t.status,''created_at'',t.created_at,''updated_at'',t.updated_at) order by t.updated_at desc),''[]''::jsonb) from public.support_tickets t left join auth.users u on u.id=t.store_owner_id left join public.company_settings cs on cs.owner_id=t.store_owner_id' into v;
   return jsonb_build_object('tickets',v);
 elsif p_section='audit' then
   select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'action',l.action,'admin_email',u.email,'target_user_id',l.target_user_id,'target_record_id',l.target_record_id,'details',l.details,'created_at',l.created_at) order by l.created_at desc),'[]'::jsonb) into v
   from public.platform_audit_logs l left join auth.users u on u.id=l.admin_user_id;
   return jsonb_build_object('logs',v);
 else
   if to_regclass('public.support_tickets') is not null then execute 'select count(*) from public.support_tickets' into v_support_count; end if;
   if to_regclass('public.logo_subscriptions') is not null then execute 'select count(*) from public.logo_subscriptions where status=''active'' and (expires_at is null or expires_at>now())' into v_active_subs; end if;
   select jsonb_build_object(
     'registered_accounts',(select count(*) from auth.users),
     'businesses',(select count(*) from public.company_settings),
     'sales_transactions',(select count(*) from public.sales),
     'sales_volume',(select coalesce(sum(total_amount),0) from public.sales),
     'new_accounts_30d',(select count(*) from auth.users where created_at>=now()-interval '30 days'),
     'active_subscriptions',v_active_subs,
     'suspended_accounts',(select count(*) from public.platform_account_controls where status='suspended'),
     'support_tickets',v_support_count
   ) into v;
   return v;
 end if;
end; $$;
revoke all on function public.platform_admin_data(text) from public;
grant execute on function public.platform_admin_data(text) to authenticated;

create or replace function public.platform_admin_action(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_ticket uuid; v_status text; v_reason text; v_expiry timestamptz; v_message text;
begin
 if not exists(select 1 from public.platform_admins where user_id=(select auth.uid())) then
   raise exception 'Not authorised' using errcode='42501';
 end if;
 if p_action in ('suspend_account','reactivate_account') then
   v_target := (p_payload->>'user_id')::uuid;
   if v_target is null or v_target=(select auth.uid()) then raise exception 'Invalid account target.'; end if;
   if not exists(select 1 from auth.users where id=v_target) then raise exception 'Account not found.'; end if;
   v_status := case when p_action='suspend_account' then 'suspended' else 'active' end;
   v_reason := nullif(left(trim(coalesce(p_payload->>'reason','')),500),'');
   insert into public.platform_account_controls(user_id,status,reason,updated_by,updated_at)
   values(v_target,v_status,v_reason,auth.uid(),now())
   on conflict(user_id) do update set status=excluded.status,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
   insert into public.platform_audit_logs(admin_user_id,action,target_user_id,details)
   values(auth.uid(),p_action,v_target,jsonb_build_object('reason',v_reason));
   return jsonb_build_object('success',true,'status',v_status);
 elsif p_action='update_subscription' then
   v_target := (p_payload->>'user_id')::uuid;
   v_status := p_payload->>'status';
   if v_status not in ('active','inactive','cancelled','expired') then raise exception 'Invalid subscription status.'; end if;
   v_expiry := nullif(p_payload->>'expires_at','')::timestamptz;
   insert into public.logo_subscriptions(owner_id,status,expires_at,updated_at)
   values(v_target,v_status,v_expiry,now())
   on conflict(owner_id) do update set status=excluded.status,expires_at=excluded.expires_at,updated_at=now();
   insert into public.platform_audit_logs(admin_user_id,action,target_user_id,details)
   values(auth.uid(),'update_subscription',v_target,jsonb_build_object('status',v_status,'expires_at',v_expiry));
   return jsonb_build_object('success',true);
 elsif p_action='support_reply' then
   v_ticket := (p_payload->>'ticket_id')::uuid;
   v_message := left(trim(coalesce(p_payload->>'message','')),5000);
   if v_message='' then raise exception 'Reply cannot be empty.'; end if;
   if to_regclass('public.support_tickets') is null or not exists(select 1 from public.support_tickets where id=v_ticket) then raise exception 'Ticket not found.'; end if;
   insert into public.support_ticket_messages(ticket_id,sender_id,message) values(v_ticket,auth.uid(),v_message);
   v_status := coalesce(nullif(p_payload->>'status',''),'in_progress');
   if v_status not in ('open','in_progress','resolved') then raise exception 'Invalid ticket status.'; end if;
   update public.support_tickets set status=v_status,updated_at=now() where id=v_ticket;
   insert into public.platform_audit_logs(admin_user_id,action,target_record_id,details)
   values(auth.uid(),'support_reply',v_ticket::text,jsonb_build_object('status',v_status));
   return jsonb_build_object('success',true);
 else
   raise exception 'Unknown platform administration action.';
 end if;
end; $$;
revoke all on function public.platform_admin_action(text,jsonb) from public;
grant execute on function public.platform_admin_action(text,jsonb) to authenticated;

create or replace function public.platform_admin_is_suspended()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(
   select 1 from public.platform_account_controls c
   where c.user_id=coalesce(
     (select sm.owner_id from public.store_members sm where sm.user_id=auth.uid() limit 1),
     auth.uid()
   ) and c.status='suspended'
 );
$$;
revoke all on function public.platform_admin_is_suspended() from public;
grant execute on function public.platform_admin_is_suspended() to authenticated;
notify pgrst,'reload schema';
