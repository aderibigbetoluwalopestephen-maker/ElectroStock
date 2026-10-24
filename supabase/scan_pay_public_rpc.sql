-- Run after supabase/scan_pay_migration.sql.
-- This exposes only shops that explicitly enabled Scan & Pay.
create or replace function public.get_scan_pay_shop(p_owner_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.company_settings%rowtype; p jsonb;
begin
  select * into s from public.company_settings
    where owner_id=p_owner_id and scan_pay_enabled=true and paystack_subaccount_code is not null;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'name',x.name,'brand',x.brand,'model',x.model,'category',x.category,
    'selling_price',x.selling_price,'quantity',x.quantity,'image_url',x.image_url,'description',x.description
  ) order by x.name),'[]'::jsonb)
  into p from public.products x where x.owner_id=p_owner_id and x.quantity>0;
  return jsonb_build_object('shop',jsonb_build_object(
    'owner_id',s.owner_id,'company_name',s.company_name,'phone',s.phone,'currency',s.currency
  ),'products',p);
end;
$$;
revoke all on function public.get_scan_pay_shop(uuid) from public;
grant execute on function public.get_scan_pay_shop(uuid) to anon, authenticated;

-- The database validates products and calculates the amount; clients cannot set prices.
create or replace function public.create_scan_pay_order(
  p_owner_id uuid, p_customer_email text, p_customer_name text, p_requested_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.company_settings%rowtype;
  item jsonb; p public.products%rowtype; qty integer;
  total_kobo bigint := 0; saved_items jsonb := '[]'::jsonb; ref text;
begin
  if lower(trim(p_customer_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid customer email.'; end if;
  if jsonb_typeof(p_requested_items) <> 'array' or jsonb_array_length(p_requested_items) < 1 or jsonb_array_length(p_requested_items) > 30 then raise exception 'Choose between 1 and 30 products.'; end if;
  if jsonb_array_length(p_requested_items) <> (select count(distinct value->>'product_id') from jsonb_array_elements(p_requested_items)) then raise exception 'Choose each product only once and adjust its quantity.'; end if;
  select * into s from public.company_settings where owner_id=p_owner_id and scan_pay_enabled=true and paystack_subaccount_code is not null;
  if not found then raise exception 'This shop has not connected Paystack.'; end if;
  if s.currency <> 'NGN' then raise exception 'Scan & Pay currently supports NGN shops only.'; end if;
  for item in select value from jsonb_array_elements(p_requested_items) loop
    qty := (item->>'quantity')::integer;
    if qty < 1 or qty > 99 then raise exception 'Invalid product quantity.'; end if;
    select * into p from public.products where id=(item->>'product_id')::uuid and owner_id=p_owner_id for update;
    if not found or p.quantity < qty then raise exception 'A selected product is unavailable or has insufficient stock.'; end if;
    total_kobo := total_kobo + round(p.selling_price*100)::bigint*qty;
    saved_items := saved_items || jsonb_build_array(jsonb_build_object(
      'product_id',p.id,'product_name',p.name,'quantity',qty,'unit_price_kobo',round(p.selling_price*100)::bigint
    ));
  end loop;
  if total_kobo < 100 then raise exception 'Order total must be at least ₦1.00.'; end if;
  ref := 'ESQR-' || replace(gen_random_uuid()::text,'-','');
  insert into public.scan_payments(reference,owner_id,customer_name,customer_email,currency,amount_kobo,items)
    values(ref,p_owner_id,left(trim(coalesce(p_customer_name,'')),120),lower(trim(p_customer_email)),'NGN',total_kobo,saved_items);
  return jsonb_build_object('reference',ref,'amount_kobo',total_kobo,'currency','NGN','shop_name',s.company_name,'subaccount_code',s.paystack_subaccount_code);
end;
$$;
revoke all on function public.create_scan_pay_order(uuid,text,text,jsonb) from public;
grant execute on function public.create_scan_pay_order(uuid,text,text,jsonb) to anon, authenticated;
