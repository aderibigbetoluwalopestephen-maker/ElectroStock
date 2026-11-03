-- Restore store-team read access to existing products and staff records.
-- Run once in Supabase SQL Editor. These policies do not expose data across stores.
grant select on public.store_members to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.stock_movements to authenticated;

drop policy if exists "Store owners and members can read store membership" on public.store_members;
create policy "Store owners and members can read store membership"
on public.store_members for select to authenticated
using (user_id = (select auth.uid()) or owner_id = (select auth.uid()));

drop policy if exists "Store teams can read their products" on public.products;
create policy "Store teams can read their products"
on public.products for select to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = products.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
  )
);

drop policy if exists "Store managers can add products" on public.products;
create policy "Store managers can add products"
on public.products for insert to authenticated
with check (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = products.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
      and lower(sm.role) in ('owner','manager')
  )
);

drop policy if exists "Store managers can update products" on public.products;
create policy "Store managers can update products"
on public.products for update to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = products.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
      and lower(sm.role) in ('owner','manager')
  )
)
with check (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = products.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
      and lower(sm.role) in ('owner','manager')
  )
);

drop policy if exists "Store managers can delete products" on public.products;
create policy "Store managers can delete products"
on public.products for delete to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = products.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
      and lower(sm.role) in ('owner','manager')
  )
);

drop policy if exists "Store teams can read stock movements" on public.stock_movements;
create policy "Store teams can read stock movements"
on public.stock_movements for select to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = stock_movements.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
  )
);

drop policy if exists "Store managers can add stock movements" on public.stock_movements;
create policy "Store managers can add stock movements"
on public.stock_movements for insert to authenticated
with check (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = stock_movements.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
      and lower(sm.role) in ('owner','manager')
  )
);

drop policy if exists "Store managers can update stock movements" on public.stock_movements;
create policy "Store managers can update stock movements"
on public.stock_movements for update to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = stock_movements.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
      and lower(sm.role) in ('owner','manager')
  )
)
with check (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.store_members sm
    where sm.owner_id = stock_movements.owner_id
      and sm.user_id = (select auth.uid())
      and coalesce(sm.active,true) = true
      and lower(sm.role) in ('owner','manager')
  )
);

notify pgrst, 'reload schema';
