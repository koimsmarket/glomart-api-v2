-- 22_gm_network_incentive_final.sql
-- Final direction confirmed in chat:
-- 1) Base member relation is gm_member.member_id + gm_member.recommender_id only.
-- 2) Downline IDs are not stored in member rows.
-- 3) Daily order/return display uses monthly summary tables:
--      gm_network_order_YYYY_MM, gm_network_return_YYYY_MM
--    with member_id + step_no rows and order_01~31 / return_01~31 subtotal columns.
-- 4) Confirmed monthly incentive uses gm_network_YYYY_MM, one row per member, STEP1~5 expanded as columns.
-- 5) Annual order/return and annual network summary use gm_network_order_YYYY, gm_network_return_YYYY, gm_network_YYYY.
-- 6) This migration creates current month, next month, current year, and next year tables by KST date.

ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS sales_confirmed_at TIMESTAMP;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS return_deadline_at TIMESTAMP;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS incentive_calculated_yn VARCHAR(1) NOT NULL DEFAULT 'N';
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS incentive_calculated_at TIMESTAMP;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS incentive_settlement_month VARCHAR(7);
CREATE INDEX IF NOT EXISTS idx_gm_order_item_incentive_calc ON gm_order_item (incentive_calculated_yn, sales_confirmed_at);

CREATE TABLE IF NOT EXISTS gm_network_incentive_rate (
  step_no INTEGER NOT NULL,
  rate_percent NUMERIC(7,4) NOT NULL DEFAULT 0,
  cash_ratio NUMERIC(7,3) NOT NULL DEFAULT 80,
  point_ratio NUMERIC(7,3) NOT NULL DEFAULT 20,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  active_yn VARCHAR(1) NOT NULL DEFAULT 'Y',
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (step_no, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_gm_network_incentive_rate_active ON gm_network_incentive_rate (active_yn, step_no, effective_from, effective_to);

INSERT INTO gm_network_incentive_rate (step_no, rate_percent, effective_from, active_yn, note)
VALUES
  (1, 0.5000, CURRENT_DATE, 'Y', 'default step1 0.5%'),
  (2, 0.4000, CURRENT_DATE, 'Y', 'default step2 0.4%'),
  (3, 0.3000, CURRENT_DATE, 'Y', 'default step3 0.3%'),
  (4, 0.2000, CURRENT_DATE, 'Y', 'default step4 0.2%'),
  (5, 0.1000, CURRENT_DATE, 'Y', 'default step5 0.1%')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS gm_member_payment_info (
  member_id VARCHAR(80) NOT NULL,
  country_name VARCHAR(120),
  country_code VARCHAR(20),
  country_phone_code VARCHAR(20),
  visa_type VARCHAR(40),
  tax_type VARCHAR(60),
  tax_rate NUMERIC(7,3) NOT NULL DEFAULT 0,
  payment_method VARCHAR(40) NOT NULL DEFAULT 'BANK',
  payment_currency VARCHAR(10) NOT NULL DEFAULT 'KRW',
  bank_name VARCHAR(120),
  bank_swift VARCHAR(40),
  bank_address TEXT,
  account_holder VARCHAR(160),
  account_number VARCHAR(160),
  recipient_address TEXT,
  recipient_phone VARCHAR(60),
  mobile_phone VARCHAR(60),
  fax_number VARCHAR(60),
  email VARCHAR(180),
  recipient_id_type VARCHAR(60),
  recipient_id_no VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (member_id)
);
CREATE INDEX IF NOT EXISTS idx_gm_member_payment_info_method ON gm_member_payment_info (payment_method, payment_currency);

CREATE TABLE IF NOT EXISTS gm_network_payment_snapshot (
  snapshot_id VARCHAR(40) NOT NULL,
  member_id VARCHAR(80) NOT NULL,
  settlement_month VARCHAR(7) NOT NULL,
  payment_method VARCHAR(40) NOT NULL DEFAULT 'BANK',
  base_currency VARCHAR(10) NOT NULL DEFAULT 'KRW',
  base_cash_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  payment_currency VARCHAR(10) NOT NULL DEFAULT 'KRW',
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  transfer_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  transfer_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual_received_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  transfer_day DATE,
  recipient_id_type VARCHAR(60),
  recipient_id_no VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_gm_network_payment_snapshot_member_month ON gm_network_payment_snapshot (member_id, settlement_month);

-- Create dynamic period tables for KST current/next month and current/next year.
DO $$
DECLARE
  kst_today DATE := ((NOW() AT TIME ZONE 'Asia/Seoul')::date);
  m0 DATE := date_trunc('month', ((NOW() AT TIME ZONE 'Asia/Seoul')::date))::date;
  m1 DATE := (date_trunc('month', ((NOW() AT TIME ZONE 'Asia/Seoul')::date)) + INTERVAL '1 month')::date;
  y0 DATE := date_trunc('year', ((NOW() AT TIME ZONE 'Asia/Seoul')::date))::date;
  y1 DATE := (date_trunc('year', ((NOW() AT TIME ZONE 'Asia/Seoul')::date)) + INTERVAL '1 year')::date;
  ym TEXT;
  yy TEXT;
BEGIN
  FOREACH ym IN ARRAY ARRAY[to_char(m0,'YYYY_MM'), to_char(m1,'YYYY_MM')]
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        member_id VARCHAR(80) NOT NULL,
        step_no INTEGER NOT NULL,
        order_01 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_02 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_03 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_04 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_05 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_06 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_07 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_08 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_09 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_10 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_11 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_12 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_13 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_14 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_15 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_16 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_17 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_18 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_19 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_20 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_21 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_22 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_23 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_24 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_25 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_26 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_27 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_28 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_29 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_30 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_31 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (member_id, step_no)
      )$f$, 'gm_network_order_' || ym);

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        member_id VARCHAR(80) NOT NULL,
        step_no INTEGER NOT NULL,
        return_01 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_02 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_03 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_04 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_05 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_06 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_07 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_08 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_09 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_10 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_11 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_12 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_13 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_14 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_15 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_16 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_17 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_18 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_19 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_20 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_21 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_22 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_23 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_24 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_25 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_26 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_27 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_28 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_29 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_30 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_31 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (member_id, step_no)
      )$f$, 'gm_network_return_' || ym);

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        member_id VARCHAR(80) NOT NULL,
        self_purchase_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step1_member_count INTEGER NOT NULL DEFAULT 0,
        step1_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step1_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
        step1_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step2_member_count INTEGER NOT NULL DEFAULT 0,
        step2_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step2_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
        step2_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step3_member_count INTEGER NOT NULL DEFAULT 0,
        step3_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step3_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
        step3_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step4_member_count INTEGER NOT NULL DEFAULT 0,
        step4_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step4_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
        step4_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step5_member_count INTEGER NOT NULL DEFAULT 0,
        step5_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        step5_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
        step5_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        total_member_count INTEGER NOT NULL DEFAULT 0,
        total_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        gross_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        qualification_target_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        qualification_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
        qualified_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        cash_ratio NUMERIC(7,3) NOT NULL DEFAULT 80,
        cash_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        point_ratio NUMERIC(7,3) NOT NULL DEFAULT 20,
        point_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        tax_rate NUMERIC(7,3) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        net_cash_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        unpaid_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        carry_forward_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        lifetime_unpaid_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
        hold_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (member_id)
      )$f$, 'gm_network_' || ym);
  END LOOP;

  FOREACH yy IN ARRAY ARRAY[to_char(y0,'YYYY'), to_char(y1,'YYYY')]
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        member_id VARCHAR(80) NOT NULL,
        step_no INTEGER NOT NULL,
        order_01 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_02 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_03 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_04 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_05 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_06 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_07 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_08 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_09 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_10 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_11 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_12 NUMERIC(14,0) NOT NULL DEFAULT 0,
        order_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (member_id, step_no)
      )$f$, 'gm_network_order_' || yy);

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        member_id VARCHAR(80) NOT NULL,
        step_no INTEGER NOT NULL,
        return_01 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_02 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_03 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_04 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_05 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_06 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_07 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_08 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_09 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_10 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_11 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_12 NUMERIC(14,0) NOT NULL DEFAULT 0,
        return_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (member_id, step_no)
      )$f$, 'gm_network_return_' || yy);

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        member_id VARCHAR(80) NOT NULL,
        sales_01 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_02 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_03 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_04 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_05 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_06 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_07 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_08 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_09 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_10 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_11 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_12 NUMERIC(14,0) NOT NULL DEFAULT 0,
        sales_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_01 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_02 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_03 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_04 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_05 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_06 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_07 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_08 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_09 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_10 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_11 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_12 NUMERIC(14,0) NOT NULL DEFAULT 0,
        incentive_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        cash_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        point_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        unpaid_total NUMERIC(14,0) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (member_id)
      )$f$, 'gm_network_' || yy);
  END LOOP;
END $$;
