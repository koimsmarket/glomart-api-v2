-- GM_AI_USAGE_V001
-- Monthly AI/API usage monitoring. Additive only: no DROP/DELETE/TRUNCATE.

CREATE TABLE IF NOT EXISTS gm_ai_usage_task (
  task_type TEXT PRIMARY KEY,
  service_group TEXT NOT NULL,
  task_name_ko TEXT NOT NULL,
  description TEXT,
  active_yn CHAR(1) NOT NULL DEFAULT 'Y',
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


INSERT INTO gm_ai_usage_task(task_type,service_group,task_name_ko,description,active_yn,sort_order)
VALUES
  ('CATEGORY_CLASSIFICATION','CATEGORY','카테고리 분류 작업','미분류 키워드/상품을 기존 gm_category에 AI로 분류','Y',10),
  ('TRANSLATION_CORRECTION','TRANSLATION','언어 오역 교정','번역 결과의 오역 후보를 AI로 검토·교정','Y',20)
ON CONFLICT(task_type) DO UPDATE SET
  service_group=EXCLUDED.service_group,
  task_name_ko=EXCLUDED.task_name_ko,
  description=EXCLUDED.description,
  active_yn=EXCLUDED.active_yn,
  sort_order=EXCLUDED.sort_order,
  updated_at=now();

CREATE TABLE IF NOT EXISTS gm_ai_usage_monthly (
  usage_month DATE NOT NULL,
  task_type TEXT NOT NULL REFERENCES gm_ai_usage_task(task_type),
  provider TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  request_count BIGINT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_month, task_type, provider, model_name, currency)
);

CREATE INDEX IF NOT EXISTS idx_gm_ai_usage_monthly_month
  ON gm_ai_usage_monthly(usage_month, task_type);
