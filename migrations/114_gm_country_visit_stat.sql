-- GM_COUNTRY_VISIT_STAT_V001
-- Country is an independent axis from language.
-- signup_country_code is the country resolved from the signup request IP and is not overwritten later.

ALTER TABLE gm_member
  ADD COLUMN IF NOT EXISTS signup_country_code VARCHAR(2);

COMMENT ON COLUMN gm_member.signup_country_code IS
  'ISO-3166 alpha-2 signup access country resolved from request IP. Fixed after initial signup.';

CREATE TABLE IF NOT EXISTS gm_country_stat (
  country_code              VARCHAR(2) PRIMARY KEY,
  member_count              BIGINT NOT NULL DEFAULT 0,
  visit_day_count           BIGINT NOT NULL DEFAULT 0,
  visit_yesterday_count     BIGINT NOT NULL DEFAULT 0,
  visit_month_count         BIGINT NOT NULL DEFAULT 0,
  visit_last_month_count    BIGINT NOT NULL DEFAULT 0,
  visit_year_count          BIGINT NOT NULL DEFAULT 0,
  visit_last_year_count     BIGINT NOT NULL DEFAULT 0,
  visit_total_count         BIGINT NOT NULL DEFAULT 0,
  first_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gm_country_stat_code_chk CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT gm_country_stat_counter_chk CHECK (
    member_count >= 0 AND visit_day_count >= 0 AND visit_yesterday_count >= 0 AND
    visit_month_count >= 0 AND visit_last_month_count >= 0 AND
    visit_year_count >= 0 AND visit_last_year_count >= 0 AND visit_total_count >= 0
  )
);

-- One global rollover cursor. This avoids per-language/per-country count_date/count_month/count_year columns.
CREATE TABLE IF NOT EXISTS gm_visit_rollover_state (
  state_id        SMALLINT PRIMARY KEY DEFAULT 1 CHECK (state_id = 1),
  last_day        DATE NOT NULL,
  last_month      DATE NOT NULL,
  last_year       INTEGER NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO gm_visit_rollover_state(state_id,last_day,last_month,last_year)
VALUES (
  1,
  (now() AT TIME ZONE 'Asia/Seoul')::date,
  date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date,
  EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Seoul')::int
)
ON CONFLICT (state_id) DO NOTHING;
