-- GM_PRODUCT_I18N_DB_V003 - amended migration 139; use in place of V002 for FRESH installs only.
-- For an EXISTING V002 installation use the separate MANUAL_ALTER_139.sql, never rerun CREATE TABLE.
-- No server automatic migration; no old source table alterations.
-- Client/server API must atomically mark U when source product/option name actually changes,
-- compare queue.source_hash before saving, set per-language source and review metadata,
-- prevent OFF overwriting existing current ON, and set Y only for 25 current verified languages.
-- SQL DDL alone does not implement any of those application behaviors.
-- GM_PRODUCT_I18N_DB_V002 / PostgreSQL / manual execution ONLY
-- V001 139_gm_product_option_translation.sql is RETIRED: DO NOT execute.
-- Actual deployment target: DB postgres, schema public (verify current_database() before running).
-- Two translation tables have two key columns + 25 language columns + three metadata columns (30 total).
-- Product: mall_code + product_id. Option: mall_code + pi_vi (PID_VID).
-- Original product/option tables remain untouched; no FK, no product alteration.
-- Translation executed only by clients. Queue holds job state/provenance; NOT an engine.
-- No SQL in this file is run automatically on server start.
-- Source text canonicalization and pi_vi calculation must be defined by later separate client/API modules.
-- Existing gm_product_option has pi_ii_vi, NOT pi_vi. This migration does not modify it.
-- Per-language attribution and QA now live in translation_source/translation_review_status. Queue engine_meta may retain audit details.

BEGIN;
DO $$ BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong database: expected postgres, got %', current_database();
  END IF;
END $$;

CREATE TABLE public.gm_product_translation (
  mall_code TEXT NOT NULL,
  product_id TEXT NOT NULL,
  -- Y=25 current-source languages complete, N=new/incomplete, U=source name changed.
  translation_status CHAR(1) NOT NULL DEFAULT 'N' CHECK (translation_status IN ('Y','N','U')),
  -- Per-language provenance, e.g. {"en":"ON","ja":"OFF"}; never one value for the entire product.
  translation_source JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(translation_source) = 'object'),
  -- Per-language QA, e.g. {"ja":"RETRY"}; unset means not reviewed (not automatically OK).
  translation_review_status JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(translation_review_status) = 'object'),
  ko TEXT,
  en TEXT,
  zh TEXT,
  vi TEXT,
  ja TEXT,
  tw TEXT,
  th TEXT,
  uz TEXT,
  ne TEXT,
  km TEXT,
  id TEXT,
  tl TEXT,
  mn TEXT,
  my TEXT,
  kk TEXT,
  si TEXT,
  ru TEXT,
  bn TEXT,
  ur TEXT,
  lo TEXT,
  hi TEXT,
  tr TEXT,
  fa TEXT,
  es TEXT,
  fr TEXT,
  CONSTRAINT gm_product_translation_pkey PRIMARY KEY (mall_code, product_id)
);

CREATE TABLE public.gm_option_translation (
  mall_code TEXT NOT NULL,
  pi_vi TEXT NOT NULL,
  -- Y=25 current-source languages complete, N=new/incomplete, U=source name changed.
  translation_status CHAR(1) NOT NULL DEFAULT 'N' CHECK (translation_status IN ('Y','N','U')),
  -- Per-language provenance, e.g. {"en":"ON","ja":"OFF"}; never one value for the entire product.
  translation_source JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(translation_source) = 'object'),
  -- Per-language QA, e.g. {"ja":"RETRY"}; unset means not reviewed (not automatically OK).
  translation_review_status JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(translation_review_status) = 'object'),
  ko TEXT,
  en TEXT,
  zh TEXT,
  vi TEXT,
  ja TEXT,
  tw TEXT,
  th TEXT,
  uz TEXT,
  ne TEXT,
  km TEXT,
  id TEXT,
  tl TEXT,
  mn TEXT,
  my TEXT,
  kk TEXT,
  si TEXT,
  ru TEXT,
  bn TEXT,
  ur TEXT,
  lo TEXT,
  hi TEXT,
  tr TEXT,
  fa TEXT,
  es TEXT,
  fr TEXT,
  CONSTRAINT gm_option_translation_pkey PRIMARY KEY (mall_code, pi_vi)
);

CREATE TABLE public.gm_product_translation_queue (
  mall_code TEXT NOT NULL,
  product_id TEXT NOT NULL,
  source_hash CHAR(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_lang VARCHAR(8),
  pending_langs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pending_langs) = 'array'),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLAIMED','RETRY_WAIT','COMPLETED')),
  owner_token TEXT,
  lease_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code TEXT,
  engine_meta JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(engine_meta) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT gm_product_translation_queue_pkey PRIMARY KEY (mall_code, product_id)
);
CREATE INDEX gm_product_translation_queue_ready_idx ON public.gm_product_translation_queue (next_retry_at) WHERE status IN ('PENDING','RETRY_WAIT');
CREATE INDEX gm_product_translation_queue_lease_idx ON public.gm_product_translation_queue (lease_until) WHERE status = 'CLAIMED';

CREATE TABLE public.gm_option_translation_queue (
  mall_code TEXT NOT NULL,
  pi_vi TEXT NOT NULL,
  source_hash CHAR(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_lang VARCHAR(8),
  pending_langs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pending_langs) = 'array'),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLAIMED','RETRY_WAIT','COMPLETED')),
  owner_token TEXT,
  lease_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code TEXT,
  engine_meta JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(engine_meta) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT gm_option_translation_queue_pkey PRIMARY KEY (mall_code, pi_vi)
);
CREATE INDEX gm_option_translation_queue_ready_idx ON public.gm_option_translation_queue (next_retry_at) WHERE status IN ('PENDING','RETRY_WAIT');
CREATE INDEX gm_option_translation_queue_lease_idx ON public.gm_option_translation_queue (lease_until) WHERE status = 'CLAIMED';

COMMIT;
