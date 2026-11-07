-- GM_PRODUCT_I18N V055: fresh-install schema, no server-side queues.
-- Run manually only on a newly initialized database. For existing installations
-- run 140_gm_i18n_remove_server_queues.sql after the updated server is deployed.
-- Source versions are computed from authoritative product/option source text.
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
  source_hash CHAR(64),
  source_lang VARCHAR(8),
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
  source_hash CHAR(64),
  source_lang VARCHAR(8),
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

COMMIT;
