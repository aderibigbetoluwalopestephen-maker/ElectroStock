-- ElectroStock manager/staff checkout fix.
-- Run this file in Supabase Dashboard > SQL Editor after team_features_migration.sql
-- and sales_migration.sql. It preserves store isolation by resolving the signed-in
-- member to their assigned store owner before touching inventory.

alter table public.sales add column if not exists transaction_ref text;
alter table public.sales add column if not exists payment_method text not null default 'cash';

create index if not exists sales_owner_transaction_idx
  on public.sales(owner_id, transaction_ref);

drop policy if exists "Store members can view products" on public.products;
create policy "Store members can view products"
on public.products for select to authenticated
using (public.store_member_role(owner_id) in ('owner', 'manager', 'sales_rep'));

drop policy if exists "Store members can view stock movements" on public.stock_movements;
create policy "Store members can view stock movements"
on public.stock_movements for select to authenticated
using (public.store_member_role(owner_id) in ('owner', 'manager', 'sales_rep'));

drop policy if exists "Store members can view store sales" on public.sales;
create policy "Store members can view store sales"
on public.sales for select to authenticated
using (public.is_store_member(owner_id));

create or replace function public.record_sale_cart(
  p_items jsonb,
  p_customer_name text default null,
  p_note text default null,
  p_payment_method text default 'cash'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_role text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_sale public.sales%rowtype;
  v_receipt text;
  v_line_receipt text;
  v_customer text := coalesce(nullif(trim(p_customer_name), ''), 'Walk-in customer');
  v_payment text := coalesce(nullif(trim(p_payment_method), ''), 'cash');
  v_quantity integer;
  v_index integer := 0;
  v_total numeric(12,2) := 0;
  v_profit numeric(12,2) := 0;
  v_items jsonb := '[]'::jsonb;
  v_created_at timestamptz := now();
begin
  if v_user is null then
    raise exception 'You must sign in to record a sale.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the cart.';
  end if;

  if exists (select 1 from public.store_members m where m.user_id = v_user) then
    select m.owner_id, m.role into v_owner, v_role
    from public.store_members m
    where m.user_id = v_user and m.active = true
    order by m.created_at asc
    limit 1;
    if v_owner is null then
      raise exception 'Your staff access has been disabled. Contact the store owner.';
    end if;
  else
    v_owner := v_user;
    v_role := 'owner';
  end if;

  if v_role not in ('owner', 'manager', 'sales_rep') then
    raise exception 'Your account is not allowed to record sales for this store.';
  end if;

  v_receipt := 'ES-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    begin
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Each cart quantity must be a whole number.';
    end;

    if v_quantity is null or v_quantity < 1 then
      raise exception 'Each cart quantity must be at least 1.';
    end if;

    select p.* into v_product
    from public.products p
    where p.id = (v_item->>'product_id')::uuid
      and p.owner_id = v_owner
    for update;

    if not found then
      raise exception 'A cart product was not found in your store inventory. Refresh the cart and try again.';
    end if;

    if v_product.quantity < v_quantity then
      raise exception 'Not enough stock for %. Available: %, requested: %.',
        v_product.name, v_product.quantity, v_quantity;
    end if;

    update public.products
      set quantity = quantity - v_quantity, updated_at = now()
      where id = v_product.id and owner_id = v_owner;

    v_line_receipt := v_receipt || '-' || lpad(v_index::text, 2, '0');

    insert into public.sales (
      owner_id, product_id, product_name, brand, model, quantity,
      unit_purchase_price, unit_selling_price, total_amount, gross_profit,
      customer_name, note, receipt_number, transaction_ref, payment_method, created_at
    ) values (
      v_owner, v_product.id, v_product.name, v_product.brand, v_product.model, v_quantity,
      v_product.purchase_price, v_product.selling_price,
      v_product.selling_price * v_quantity,
      (v_product.selling_price - v_product.purchase_price) * v_quantity,
      v_customer, nullif(trim(p_note), ''), v_line_receipt, v_receipt, v_payment, v_created_at
    ) returning * into v_sale;

    insert into public.stock_movements (
      owner_id, product_id, movement_type, quantity_change, note, created_at
    ) values (
      v_owner, v_product.id, 'sale', -v_quantity,
      concat('Receipt: ', v_receipt, ' | ', v_payment, ' | Customer: ', v_customer),
      v_created_at
    );

    v_total := v_total + v_sale.total_amount;
    v_profit := v_profit + v_sale.gross_profit;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', v_sale.id,
      'product_id', v_sale.product_id,
      'product_name', v_sale.product_name,
      'brand', v_sale.brand,
      'model', v_sale.model,
      'quantity', v_sale.quantity,
      'unit_purchase_price', v_sale.unit_purchase_price,
      'unit_selling_price', v_sale.unit_selling_price,
      'total_amount', v_sale.total_amount,
      'gross_profit', v_sale.gross_profit,
      'customer_name', v_sale.customer_name,
      'note', v_sale.note,
      'receipt_number', v_receipt,
      'transaction_ref', v_receipt,
      'payment_method', v_payment,
      'created_at', v_created_at
    ));
  end loop;

  return jsonb_build_object(
    'id', v_receipt,
    'receipt_number', v_receipt,
    'transaction_ref', v_receipt,
    'customer_name', v_customer,
    'payment_method', v_payment,
    'created_at', v_created_at,
    'total_amount', v_total,
    'gross_profit', v_profit,
    'quantity', (select coalesce(sum((item->>'quantity')::integer), 0) from jsonb_array_elements(v_items) as e(item)),
    'items', v_items
  );
end;
$$;

revoke all on function public.record_sale_cart(jsonb, text, text, text) from public;
grant execute on function public.record_sale_cart(jsonb, text, text, text) to authenticated;
