-- Migrate from the old shared schema (no owner_id) to per-user tenancy.
--
-- WARNING: Deletes all teaching data in Postgres. Re-upload materials after migrating.
-- Old storage objects (paths without a user-id prefix) are not removed automatically.
--
-- Steps:
--   1. Run this file in the SQL editor.
--   2. Run schema.sql (recreates tables with owner_id).
--   3. Run policies.sql (per-user RLS + storage rules).

drop table if exists public.questions cascade;
drop table if exists public.materials cascade;
drop table if exists public.chapters cascade;
drop table if exists public.units cascade;
drop table if exists public.classes cascade;

-- Next: paste and run the full contents of schema.sql, then policies.sql.
