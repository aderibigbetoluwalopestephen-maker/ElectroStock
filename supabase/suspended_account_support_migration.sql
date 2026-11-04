-- ElectroStock suspended-account support requests.
-- Run this migration in Supabase SQL Editor before using the public form.
create table if not exists public.suspension_support_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) between 5 and 254),
  subject text not null check (char_length(subject) between 1 and 140),
  message text not null check (char_length(message) between 1 and 5000),
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  admin_reply text,
  replied_at timestamptz,
  replied_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists suspension_support_requests_created_idx
  on public.suspension_support_requests(status, created_at desc);
alter table public.suspension_support_requests enable row level security;
revoke all on public.suspension_support_requests from public, anon, authenticated;

create or replace function public.submit_suspension_support_request(
  p_account_id uuid, p_name text, p_email text, p_subject text, p_message text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 then
    raise exception 'Enter your name (maximum 100 characters).';
  end if;
  if p_email is null or char_length(trim(p_email)) not between 5 and 254
     or trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;
  if p_subject is null or char_length(trim(p_subject)) not between 1 and 140 then
    raise exception 'Enter a subject (maximum 140 characters).';
  end if;
  if p_message is null or char_length(trim(p_message)) not between 1 and 5000 then
    raise exception 'Enter a message (maximum 5000 characters).';
  end if;
  if p_account_id is not null and not exists(select 1 from auth.users where id=p_account_id) then
    p_account_id := null;
  end if;
  insert into public.suspension_support_requests(account_id,name,email,subject,message)
  values(p_account_id,trim(p_name),trim(p_email),trim(p_subject),trim(p_message))
  returning id into v_id;
  return jsonb_build_object('success',true,'request_id',v_id);
end;
$$;
revoke all on function public.submit_suspension_support_request(uuid,text,text,text,text) from public;
grant execute on function public.submit_suspension_support_request(uuid,text,text,text,text) to anon, authenticated;

create or replace function public.platform_admin_suspension_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not exists(select 1 from public.platform_admins where user_id=(select auth.uid())) then
    raise exception 'Not authorised' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'account_id',r.account_id,'name',r.name,'email',r.email,
    'subject',r.subject,'message',r.message,'status',r.status,
    'admin_reply',r.admin_reply,'replied_at',r.replied_at,
    'created_at',r.created_at,'updated_at',r.updated_at
  ) order by r.created_at desc),'[]'::jsonb)
  into v from public.suspension_support_requests r;
  return jsonb_build_object('requests',v);
end;
$$;
revoke all on function public.platform_admin_suspension_requests() from public;
grant execute on function public.platform_admin_suspension_requests() to authenticated;

create or replace function public.platform_admin_reply_suspension_request(
  p_request_id uuid, p_reply text, p_status text default 'in_progress'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if not exists(select 1 from public.platform_admins where user_id=(select auth.uid())) then
    raise exception 'Not authorised' using errcode='42501';
  end if;
  if p_reply is null or char_length(trim(p_reply)) not between 1 and 5000 then
    raise exception 'Reply must contain between 1 and 5000 characters.';
  end if;
  if p_status not in ('open','in_progress','resolved') then
    raise exception 'Invalid support request status.';
  end if;
  update public.suspension_support_requests
    set admin_reply=trim(p_reply),replied_at=now(),replied_by=auth.uid(),
        status=p_status,updated_at=now()
    where id=p_request_id returning email into v_email;
  if v_email is null then raise exception 'Support request not found.'; end if;
  insert into public.platform_audit_logs(admin_user_id,action,target_record_id,details)
  values(auth.uid(),'suspension_support_reply',p_request_id::text,
    jsonb_build_object('email',v_email,'status',p_status));
  return jsonb_build_object('success',true,'email',v_email);
end;
$$;
revoke all on function public.platform_admin_reply_suspension_request(uuid,text,text) from public;
grant execute on function public.platform_admin_reply_suspension_request(uuid,text,text) to authenticated;
