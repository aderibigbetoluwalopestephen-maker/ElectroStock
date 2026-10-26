-- ElectroStock: allow assigned managers to view their store's inventory.
-- Run in Supabase Dashboard > SQL Editor.
-- Owners retain their existing policies. Managers can read products for their assigned store.
-- This migration does not expose products belonging to other stores.

drop policy if exists "Store members can view products" on public.products;
create policy "Store members can view products"
on public.products
for select
to authenticated
using (public.store_member_role(owner_id) in ('owner', 'manager'));

-- Managers need to read stock movement rows to see the product history screens
-- and product names joined to movements. Owners keep their existing access.
drop policy if exists "Store members can view stock movements" on public.stock_movements;
create policy "Store members can view stock movements"
on public.stock_movements
for select
to authenticated
using (public.store_member_role(owner_id) in ('owner', 'manager'));
