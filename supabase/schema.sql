-- ElectroStock core schema
-- Run this file first in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  model text,
  category text not null default 'Other',
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  image_url text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_owner_created_idx on public.products(owner_id, created_at desc);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  movement_type text not null check (movement_type in ('purchase','adjustment','sale')),
  quantity_change integer not null check (quantity_change <> 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_owner_created_idx on public.stock_movements(owner_id, created_at desc);

alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
drop policy if exists "Owners manage their products" on public.products;
create policy "Owners manage their products" on public.products for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "Owners manage their stock movements" on public.stock_movements;
create policy "Owners manage their stock movements" on public.stock_movements for all to authenticated
using (owner_id = (select auth.uid())) with check (
  owner_id = (select auth.uid()) and (
    product_id is null or exists (
      select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())
    )
  )
);
