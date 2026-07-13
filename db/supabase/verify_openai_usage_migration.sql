-- Verify openai_usage_events exists (run after migration_openai_usage.sql + policies.sql).
-- Safe to run in Supabase SQL editor.

select exists (
  select 1
  from information_schema.tables
  where table_schema = 'public'
    and table_name = 'openai_usage_events'
) as openai_usage_events_exists;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'extraction_jobs'
  and column_name = 'usage_summary';
