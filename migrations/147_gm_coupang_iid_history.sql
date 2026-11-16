-- GM_CPKR_IID_HISTORY_V001
-- Execute manually on production. Never DELETE or overwrite a historic PID+VID+IID.
CREATE TABLE IF NOT EXISTS gm_coupang_iid_history (
  product_id TEXT NOT NULL,
  vendor_item_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT now(),
  seen_count BIGINT NOT NULL DEFAULT 1,
  last_source TEXT NOT NULL DEFAULT 'unknown',
  CONSTRAINT gm_coupang_iid_history_pkey PRIMARY KEY(product_id,vendor_item_id,item_id)
);
CREATE INDEX IF NOT EXISTS idx_gm_coupang_iid_history_pid_vid_seen
  ON gm_coupang_iid_history(product_id,vendor_item_id,last_seen_at DESC);

-- Backfill only identities still present in product/option tables.
-- Historical identities already overwritten before this migration cannot be recovered.
INSERT INTO gm_coupang_iid_history
  (product_id,vendor_item_id,item_id,first_seen_at,last_seen_at,seen_count,last_source)
SELECT product_id,vendor_item_id,item_id,
       MIN(first_seen_at),MAX(last_seen_at),1,'existing_db'
FROM (
  SELECT product_id,vendor_item_id,item_id,
         COALESCE(created_at,now()) AS first_seen_at,
         COALESCE(last_seen_at,created_at,now()) AS last_seen_at
  FROM gm_product
  WHERE mall_code='CPKR' AND product_id ~ '^[0-9]+$'
    AND vendor_item_id ~ '^[0-9]+$' AND item_id ~ '^[0-9]+$'
  UNION ALL
  SELECT product_id,vendor_item_id,item_id,
         COALESCE(created_at,now()), COALESCE(last_seen_at,created_at,now())
  FROM gm_product_option
  WHERE mall_code='CPKR' AND product_id ~ '^[0-9]+$'
    AND vendor_item_id ~ '^[0-9]+$' AND item_id ~ '^[0-9]+$'
) identities
GROUP BY product_id,vendor_item_id,item_id
ON CONFLICT (product_id,vendor_item_id,item_id) DO NOTHING;
