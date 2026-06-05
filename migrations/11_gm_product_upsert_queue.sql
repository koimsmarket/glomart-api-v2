-- 11_gm_product_upsert_queue.sql
-- Purpose: Queue search-result product upserts so search UI is not blocked by DB writes.

CREATE TABLE IF NOT EXISTS gm_product_upsert_queue (
  queue_id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  mall_code TEXT,
  keyword TEXT,
  items_json JSONB NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMP,
  processed_at TIMESTAMP,
  error_message TEXT,
  result_json JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_product_upsert_queue_request
  ON gm_product_upsert_queue (request_id);

CREATE INDEX IF NOT EXISTS idx_gm_product_upsert_queue_status_created
  ON gm_product_upsert_queue (status, created_at);

CREATE INDEX IF NOT EXISTS idx_gm_product_upsert_queue_mall_keyword
  ON gm_product_upsert_queue (mall_code, keyword);
