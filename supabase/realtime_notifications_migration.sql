-- ElectroStock in-app realtime notifications
-- Run in Supabase Dashboard > SQL Editor.
-- Adds attendance changes to Supabase Realtime when they are not already published.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'staff_attendance'
  ) then
    alter publication supabase_realtime add table public.staff_attendance;
  end if;
end $$;
