-- GM_GPAY_REWARD_POLICY_V002. Apply manually on the operations DB; do not auto-run.
-- Existing gm_runtime_config table is created in migration 112.
INSERT INTO gm_runtime_config
 (config_key,config_value,value_type,category,mode,enabled,description,updated_at)
VALUES ('gpay_reward_rate_pct','2.5','NUMBER','GPAY','FIXED',TRUE,
 'G-PAY 구매확정 적립률(%) · 순상품 실결제금액 · 10원 미만 절사',NOW())
ON CONFLICT (config_key) DO NOTHING;
