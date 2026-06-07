-- GM_ORDER_V045: prevent duplicate sales aggregation per order item
CREATE TABLE IF NOT EXISTS gm_sales_aggregate_event (
  id BIGSERIAL PRIMARY KEY,
  order_no TEXT NOT NULL,
  item_key TEXT NOT NULL,
  pi_ii_vi TEXT DEFAULT '',
  product_uid TEXT DEFAULT '',
  sales_qty INTEGER DEFAULT 0,
  sales_amount NUMERIC(18,2) DEFAULT 0,
  purchase_amount NUMERIC(18,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(order_no, item_key)
);

CREATE INDEX IF NOT EXISTS idx_gm_sales_aggregate_event_order_no ON gm_sales_aggregate_event(order_no);
CREATE INDEX IF NOT EXISTS idx_gm_sales_aggregate_event_product_uid ON gm_sales_aggregate_event(product_uid);
