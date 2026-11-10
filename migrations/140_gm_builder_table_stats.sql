-- GM_BUILDER_STATS_V008: create-only, idempotent migration; run MANUALLY in the existing Glomart postgres database.
-- Never run db reset/init or apply this automatically on deployment.
BEGIN;
CREATE TABLE IF NOT EXISTS public.gm_builder_table_stats (
  service_code text NOT NULL,
  major_category text NOT NULL,
  sub_category text NOT NULL,
  table_name text NOT NULL,
  row_count bigint,
  data_bytes bigint,
  index_bytes bigint,
  count_type text NOT NULL,
  calculated_at timestamptz NOT NULL,
  CONSTRAINT gm_builder_table_stats_pk PRIMARY KEY (service_code,table_name)
);
COMMIT;
