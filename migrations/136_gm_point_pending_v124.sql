-- GM_GPAY_V124: additive G-PAY pending reward snapshot. REVIEW AND APPLY MANUALLY BEFORE CODE.
-- Never overwrite already granted amounts; no backfill/recalculation of older orders.
BEGIN;
ALTER TABLE public.gm_order
  ADD COLUMN IF NOT EXISTS point_reward_pending_amount BIGINT,
  ADD COLUMN IF NOT EXISTS point_reward_status VARCHAR(20);
-- No destructive table, row, or point balance updates.
COMMIT;
