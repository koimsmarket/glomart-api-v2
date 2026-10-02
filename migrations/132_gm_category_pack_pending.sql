BEGIN;
CREATE TABLE IF NOT EXISTS gm_category_pack_pending (
  pending_id BIGSERIAL PRIMARY KEY,
  gm_code VARCHAR(64) NOT NULL UNIQUE,
  change_kind VARCHAR(16) NOT NULL DEFAULT 'NEW',
  source_mall VARCHAR(16) NOT NULL DEFAULT '',
  cp_code VARCHAR(128) NOT NULL DEFAULT '',
  parent_gm_code VARCHAR(64) NOT NULL DEFAULT '',
  parent_cp_code VARCHAR(128) NOT NULL DEFAULT '',
  name_ko TEXT NOT NULL DEFAULT '',
  depth INTEGER NOT NULL DEFAULT 0,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gm_category_pack_pending_status_seen
  ON gm_category_pack_pending(status,last_seen_at DESC);
COMMIT;
