-- Safe to run after the other table migrations.
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.company_settings enable row level security;

drop policy if exists "Owners manage their products" on public.products;
create policy "Owners manage their products" on public.products for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "Owners manage their stock movements" on public.stock_movements;
create policy "Owners manage their stock movements" on public.stock_movements for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and (
 product_id is null or exists (select 1 from public.products p where p.id=product_id and p.owner_id=(select auth.uid()))
));
drop policy if exists "Owners read their sales" on public.sales;
create policy "Owners read their sales" on public.sales for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Owners manage their company settings" on public.company_settings;
create policy "Owners manage their company settings" on public.company_settings for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
