-- GM_DEVICE_LANG_V003
-- Language-pack management + language usage counters in one table.
-- Built-in 25 languages and organically discovered extension languages share this table.

CREATE TABLE IF NOT EXISTS gm_device_language (
  lang_code                 VARCHAR(20) PRIMARY KEY,
  status                    VARCHAR(20) NOT NULL DEFAULT 'NEW',
  pack_version              INTEGER NOT NULL DEFAULT 1,
  pack_url                  TEXT,
  pack_data                 JSONB,
  download_count            BIGINT NOT NULL DEFAULT 0,
  visit_day_count           BIGINT NOT NULL DEFAULT 0,
  visit_yesterday_count     BIGINT NOT NULL DEFAULT 0,
  visit_month_count         BIGINT NOT NULL DEFAULT 0,
  visit_last_month_count    BIGINT NOT NULL DEFAULT 0,
  visit_year_count          BIGINT NOT NULL DEFAULT 0,
  visit_last_year_count     BIGINT NOT NULL DEFAULT 0,
  visit_total_count         BIGINT NOT NULL DEFAULT 0,
  first_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gm_device_language_status_chk
    CHECK (status IN ('BUILTIN','NEW','GENERATING','GENERATED','APPROVED','FAILED')),
  CONSTRAINT gm_device_language_pack_version_chk CHECK (pack_version >= 1),
  CONSTRAINT gm_device_language_counter_chk CHECK (
    download_count >= 0 AND visit_day_count >= 0 AND visit_yesterday_count >= 0 AND
    visit_month_count >= 0 AND visit_last_month_count >= 0 AND
    visit_year_count >= 0 AND visit_last_year_count >= 0 AND visit_total_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_gm_device_language_status
  ON gm_device_language(status, updated_at);

-- Canonical Korean UI source used to generate extension language packs.
CREATE TABLE IF NOT EXISTS gm_ui_dictionary_source (
  dict_key        VARCHAR(30) PRIMARY KEY,
  source_text     TEXT NOT NULL,
  source_value    TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing 25 languages remain built-in and keep their present Cafe24 dictionaries.
INSERT INTO gm_device_language (lang_code,status,pack_version,pack_url)
VALUES
  ('kr','BUILTIN',1,'/module/data_ui/Patch_Dic_kr.js'),
  ('en','BUILTIN',1,'/module/data_ui/Patch_Dic_en.js'),
  ('vi','BUILTIN',1,'/module/data_ui/Patch_Dic_vi.js'),
  ('zh','BUILTIN',1,'/module/data_ui/Patch_Dic_zh.js'),
  ('ja','BUILTIN',1,'/module/data_ui/Patch_Dic_ja.js'),
  ('tw','BUILTIN',1,'/module/data_ui/Patch_Dic_tw.js'),
  ('th','BUILTIN',1,'/module/data_ui/Patch_Dic_th.js'),
  ('uz','BUILTIN',1,'/module/data_ui/Patch_Dic_uz.js'),
  ('ne','BUILTIN',1,'/module/data_ui/Patch_Dic_ne.js'),
  ('km','BUILTIN',1,'/module/data_ui/Patch_Dic_km.js'),
  ('id','BUILTIN',1,'/module/data_ui/Patch_Dic_id.js'),
  ('tl','BUILTIN',1,'/module/data_ui/Patch_Dic_tl.js'),
  ('mn','BUILTIN',1,'/module/data_ui/Patch_Dic_mn.js'),
  ('my','BUILTIN',1,'/module/data_ui/Patch_Dic_my.js'),
  ('kk','BUILTIN',1,'/module/data_ui/Patch_Dic_kk.js'),
  ('si','BUILTIN',1,'/module/data_ui/Patch_Dic_si.js'),
  ('ru','BUILTIN',1,'/module/data_ui/Patch_Dic_ru.js'),
  ('bn','BUILTIN',1,'/module/data_ui/Patch_Dic_bn.js'),
  ('ur','BUILTIN',1,'/module/data_ui/Patch_Dic_ur.js'),
  ('lo','BUILTIN',1,'/module/data_ui/Patch_Dic_lo.js'),
  ('hi','BUILTIN',1,'/module/data_ui/Patch_Dic_hi.js'),
  ('tr','BUILTIN',1,'/module/data_ui/Patch_Dic_tr.js'),
  ('fa','BUILTIN',1,'/module/data_ui/Patch_Dic_fa.js'),
  ('es','BUILTIN',1,'/module/data_ui/Patch_Dic_es.js'),
  ('fr','BUILTIN',1,'/module/data_ui/Patch_Dic_fr.js')
ON CONFLICT (lang_code) DO NOTHING;

-- Korean UI dictionary DATA is intentionally deployed separately.
-- This migration creates schema and seeds only the built-in language master rows.
