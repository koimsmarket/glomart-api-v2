-- 02_gm_cart.sql
-- Source sheet: glomart_basket_db_minimal_revis
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_cart (
  member_id TEXT,
  guest_key TEXT,
  pi_ii_vi TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT,
  option_value TEXT,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  amount_type TEXT,
  delivery_type TEXT,
  delivery_fee INTEGER,
  added_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP
);
