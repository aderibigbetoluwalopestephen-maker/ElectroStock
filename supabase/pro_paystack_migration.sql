-- ElectroStock Pro Paystack billing support.
-- Run once in Supabase SQL Editor after the existing Pro subscription migration.
alter table public.pro_subscriptions
  add column if not exists paystack_customer_code text,
  add column if not exists paystack_subscription_code text,
  add column if not exists last_payment_reference text;

create table if not exists public.pro_subscription_payments (
  reference text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  currency text not null default 'NGN',
  source text not null default 'verification',
  created_at timestamptz not null default now()
);
alter table public.pro_subscription_payments enable row level security;
revoke all on public.pro_subscription_payments from anon, authenticated;
