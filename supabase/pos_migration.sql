-- ElectroStock multi-item POS checkout migration
-- Run this file in Supabase SQL Editor after sales_migration.sql.
alter table public.sales add column if not exists transaction_ref text;
alter table public.sales add column if not exists payment_method text not null default 'cash';
alter table public.sales drop constraint if exists sales_receipt_number_key;
create index if not exists sales_owner_transaction_idx on public.sales(owner_id, transaction_ref);

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
  v_owner uuid := auth.uid();
  v_item jsonb;
  v_product public.products%rowtype;
  v_sale public.sales%rowtype;
  v_qty integer;
  v_product_id uuid;
  v_receipt text;
  v_total numeric(12,2) := 0;
  v_profit numeric(12,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_customer text := coalesce(nullif(trim(p_customer_name), ''), 'Walk-in customer');
begin
  if v_owner is null then raise exception 'You must sign in to record a sale.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the cart.';
  end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'A sale cannot contain more than 100 cart lines.'; end if;

  -- Validate and lock every product before changing any stock.
  for v_item in
    select jsonb_build_object('product_id', x.product_id, 'quantity', sum(x.quantity)) as value
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
  loop
    v_product_id := (v_item.value->>'product_id')::uuid;
    v_qty := (v_item.value->>'quantity')::integer;
    if v_product_id is null then raise exception 'Each cart item must include a valid product.'; end if;
    if v_qty is null or v_qty < 1 then raise exception 'Each item quantity must be at least 1.'; end if;
    select * into v_product from public.products
      where id = v_product_id and owner_id = v_owner for update;
    if not found then raise exception 'A cart product was not found in your inventory.'; end if;
    if v_product.quantity < v_qty then
      raise exception 'Insufficient stock for %. Available: %, requested: %.', v_product.name, v_product.quantity, v_qty;
    end if;
  end loop;

  v_receipt := 'ES-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id=v_product_id and owner_id=v_owner for update;

    update public.products set quantity=quantity-v_qty, updated_at=now()
      where id=v_product_id and owner_id=v_owner;

    insert into public.sales (
      owner_id, product_id, product_name, brand, model, quantity,
      unit_purchase_price, unit_selling_price, total_amount, gross_profit,
      customer_name, note, receipt_number, transaction_ref, payment_method
    ) values (
      v_owner, v_product.id, v_product.name, v_product.brand, v_product.model, v_qty,
      v_product.purchase_price, v_product.selling_price,
      v_product.selling_price*v_qty,
      (v_product.selling_price-v_product.purchase_price)*v_qty,
      v_customer, nullif(trim(p_note), ''), v_receipt, v_receipt,
      case when lower(coalesce(p_payment_method,'cash')) in ('cash','bank transfer','card / pos terminal','other') then lower(coalesce(p_payment_method,'cash')) else 'cash' end
    ) returning * into v_sale;

    insert into public.stock_movements(owner_id, product_id, movement_type, quantity_change, note)
    values (v_owner, v_product.id, 'sale', -v_qty,
      concat('Receipt: ',v_receipt,' | Customer: ',v_customer,
        case when nullif(trim(p_note),'') is not null then ' | '||trim(p_note) else '' end));

    v_total := v_total + v_sale.total_amount;
    v_profit := v_profit + v_sale.gross_profit;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id',v_sale.id,'product_id',v_sale.product_id,'product_name',v_sale.product_name,
      'brand',v_sale.brand,'model',v_sale.model,'quantity',v_sale.quantity,
      'unit_purchase_price',v_sale.unit_purchase_price,'unit_selling_price',v_sale.unit_selling_price,
      'total_amount',v_sale.total_amount,'gross_profit',v_sale.gross_profit,
      'customer_name',v_sale.customer_name,'note',v_sale.note,'receipt_number',v_receipt,
      'transaction_ref',v_receipt,'payment_method',v_sale.payment_method,'created_at',v_sale.created_at
    ));
  end loop;

  return jsonb_build_object('receipt_number',v_receipt,'transaction_ref',v_receipt,
    'customer_name',v_customer,'created_at',now(),'total_amount',v_total,
    'gross_profit',v_profit,'payment_method',case when lower(coalesce(p_payment_method,'cash')) in ('cash','bank transfer','card / pos terminal','other') then lower(coalesce(p_payment_method,'cash')) else 'cash' end,'items',v_lines);
end;
$$;
revoke all on function public.record_sale_cart(jsonb, text, text, text) from public;
grant execute on function public.record_sale_cart(jsonb, text, text, text) to authenticated;
