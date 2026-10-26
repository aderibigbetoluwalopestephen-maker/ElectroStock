-- ElectroStock: only store owners and managers can add, edit, or delete products
-- and make manual stock movements. Sales reps can still read inventory and sell
-- through the approved checkout flow.
-- Run in Supabase Dashboard > SQL Editor after team_features_migration.sql.

drop policy if exists "Store owners and managers manage products" on public.products;
create policy "Store owners and managers manage products"
on public.products
for all
to authenticated
using (public.store_member_role(owner_id) in ('owner', 'manager'))
with check (public.store_member_role(owner_id) in ('owner', 'manager'));

drop policy if exists "Store owners and managers manage stock movements" on public.stock_movements;
create policy "Store owners and managers manage stock movements"
on public.stock_movements
for all
to authenticated
using (public.store_member_role(owner_id) in ('owner', 'manager'))
with check (
  public.store_member_role(owner_id) in ('owner', 'manager')
  and (
    product_id is null
    or exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.owner_id = stock_movements.owner_id
    )
  )
);
