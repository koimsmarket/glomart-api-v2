-- Persistent event queue for non-blocking counters/aggregates.
CREATE TABLE IF NOT EXISTS gm_event_queue (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(40) NOT NULL,
  event_key VARCHAR(220) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  processed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_gm_event_queue_event_key UNIQUE (event_key),
  CONSTRAINT ck_gm_event_queue_status CHECK (status IN ('PENDING','PROCESSING','DONE','FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_gm_event_queue_pending
  ON gm_event_queue (status, next_retry_at, id)
  WHERE status IN ('PENDING','PROCESSING');
