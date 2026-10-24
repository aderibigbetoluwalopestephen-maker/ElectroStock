-- Run after schema.sql, sales_migration.sql and company_settings_migration.sql.
alter table public.company_settings
  add column if not exists paystack_subaccount_code text,
  add column if not exists payment_account_name text not null default '',
  add column if not exists payment_bank_code text not null default '',
  add column if not exists payment_account_last4 text not null default '',
  add column if not exists scan_pay_enabled boolean not null default false;

create table if not exists public.scan_payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_name text not null default '',
  customer_email text not null,
  currency text not null default 'NGN',
  amount_kobo bigint not null check (amount_kobo > 0),
  items jsonb not null,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  paystack_transaction_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists scan_payments_owner_created_idx on public.scan_payments(owner_id, created_at desc);
alter table public.scan_payments enable row level security;
revoke all on public.scan_payments from anon, authenticated;
grant all on public.scan_payments to service_role;

create or replace function public.complete_scan_pay_sale(p_reference text, p_transaction_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.scan_payments%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_line integer := 0;
  v_receipt text;
begin
  select * into v_payment from public.scan_payments where reference = p_reference for update;
  if not found then raise exception 'Payment reference not found.'; end if;
  if v_payment.status = 'paid' then return jsonb_build_object('status','paid','reference',v_payment.reference,'already_processed',true); end if;
  if v_payment.status <> 'pending' then raise exception 'This payment is not pending.'; end if;

  -- Validate and lock every product before changing stock.
  for v_item in select value from jsonb_array_elements(v_payment.items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 then raise exception 'Invalid item quantity.'; end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and owner_id = v_payment.owner_id for update;
    if not found then raise exception 'A product in this order no longer exists.'; end if;
    if v_product.quantity < v_qty then raise exception 'Insufficient stock for a product in this order.'; end if;
  end loop;

  for v_item in select value from jsonb_array_elements(v_payment.items) loop
    v_line := v_line + 1;
    v_qty := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and owner_id = v_payment.owner_id for update;
    update public.products set quantity = quantity - v_qty, updated_at = now() where id = v_product.id and owner_id = v_payment.owner_id;
    v_receipt := v_payment.reference || '-' || v_line::text;
    insert into public.sales (owner_id,product_id,product_name,brand,model,quantity,unit_purchase_price,unit_selling_price,total_amount,gross_profit,customer_name,note,receipt_number)
    values (v_payment.owner_id,v_product.id,v_product.name,v_product.brand,v_product.model,v_qty,v_product.purchase_price,v_product.selling_price,((v_item->>'unit_price_kobo')::numeric/100)*v_qty,(((v_item->>'unit_price_kobo')::numeric/100)-v_product.purchase_price)*v_qty,coalesce(nullif(trim(v_payment.customer_name),''),'Online customer'),'Scan & Pay reference: '||v_payment.reference,v_receipt);
    insert into public.stock_movements(owner_id,product_id,movement_type,quantity_change,note)
    values(v_payment.owner_id,v_product.id,'sale',-v_qty,'Scan & Pay payment '||v_payment.reference||' verified by Paystack');
  end loop;
  update public.scan_payments set status='paid',paystack_transaction_id=p_transaction_id,paid_at=now() where reference=p_reference;
  return jsonb_build_object('status','paid','reference',v_payment.reference,'paid_at',now());
end;
$$;
revoke all on function public.complete_scan_pay_sale(text,text) from public, anon, authenticated;
grant execute on function public.complete_scan_pay_sale(text,text) to service_role;
