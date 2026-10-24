-- Run after supabase/schema.sql.
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  brand text,
  model text,
  quantity integer not null check (quantity > 0),
  unit_purchase_price numeric(12,2) not null default 0,
  unit_selling_price numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  gross_profit numeric(12,2) not null default 0,
  customer_name text,
  note text,
  receipt_number text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists sales_owner_created_idx on public.sales(owner_id, created_at desc);
alter table public.sales enable row level security;
drop policy if exists "Owners read their sales" on public.sales;
create policy "Owners read their sales" on public.sales for select to authenticated using (owner_id = (select auth.uid()));
-- Direct inserts/updates/deletes are intentionally not granted; record_sale is the controlled write path.

create or replace function public.record_sale(
  p_product_id uuid,
  p_quantity integer,
  p_customer_name text default null,
  p_note text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_product public.products%rowtype;
  v_sale public.sales%rowtype;
  v_receipt text;
begin
  if v_owner is null then raise exception 'You must sign in to record a sale.'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Sale quantity must be at least 1.'; end if;

  select * into v_product
  from public.products
  where id = p_product_id and owner_id = v_owner
  for update;
  if not found then raise exception 'Product not found in your inventory.'; end if;
  if v_product.quantity < p_quantity then raise exception 'Sale quantity cannot exceed available stock.'; end if;

  update public.products set quantity = quantity - p_quantity, updated_at = now()
  where id = p_product_id and owner_id = v_owner;

  v_receipt := 'ES-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.sales (
    owner_id, product_id, product_name, brand, model, quantity,
    unit_purchase_price, unit_selling_price, total_amount, gross_profit,
    customer_name, note, receipt_number
  ) values (
    v_owner, v_product.id, v_product.name, v_product.brand, v_product.model, p_quantity,
    v_product.purchase_price, v_product.selling_price,
    v_product.selling_price * p_quantity,
    (v_product.selling_price - v_product.purchase_price) * p_quantity,
    coalesce(nullif(trim(p_customer_name), ''), 'Walk-in customer'), nullif(trim(p_note), ''), v_receipt
  ) returning * into v_sale;

  insert into public.stock_movements(owner_id, product_id, movement_type, quantity_change, note)
  values (v_owner, v_product.id, 'sale', -p_quantity,
    concat('Receipt: ', v_receipt, ' | Customer: ', coalesce(nullif(trim(p_customer_name), ''), 'Walk-in customer'),
      case when nullif(trim(p_note), '') is not null then ' | ' || trim(p_note) else '' end));

  return jsonb_build_object(
    'id', v_sale.id, 'receipt_number', v_sale.receipt_number, 'created_at', v_sale.created_at,
    'total_amount', v_sale.total_amount, 'gross_profit', v_sale.gross_profit,
    'unit_selling_price', v_sale.unit_selling_price, 'quantity', v_sale.quantity,
    'customer_name', v_sale.customer_name, 'product_name', v_sale.product_name
  );
end;
$$;
revoke all on function public.record_sale(uuid, integer, text, text) from public;
grant execute on function public.record_sale(uuid, integer, text, text) to authenticated;
