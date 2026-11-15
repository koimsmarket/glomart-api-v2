-- 145_gm_detail_collector_claim.sql; run MANUALLY. No migration auto-run.
-- Multi-PC atomic PID leases; collection happens exclusively on administrator PCs.
CREATE TABLE IF NOT EXISTS public.gm_detail_collector_claim (
  product_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'leased' CHECK (state IN ('leased','released','completed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gm_detail_collector_claim_state_lease_idx
  ON public.gm_detail_collector_claim(state,lease_until);
