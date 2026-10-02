-- GM_UI_DICTIONARY_V001
-- New canonical 25-language UI dictionary.
-- Legacy gm_ui_dictionary_source is intentionally left untouched for rollback/history.

CREATE TABLE IF NOT EXISTS gm_ui_dictionary (
  gm_code    VARCHAR(30) PRIMARY KEY,
  page_name  TEXT NOT NULL DEFAULT '',
  kr         TEXT NOT NULL,
  en         TEXT NOT NULL DEFAULT '',
  zh         TEXT NOT NULL DEFAULT '',
  vi         TEXT NOT NULL DEFAULT '',
  ja         TEXT NOT NULL DEFAULT '',
  tw         TEXT NOT NULL DEFAULT '',
  th         TEXT NOT NULL DEFAULT '',
  uz         TEXT NOT NULL DEFAULT '',
  ne         TEXT NOT NULL DEFAULT '',
  km         TEXT NOT NULL DEFAULT '',
  id         TEXT NOT NULL DEFAULT '',
  tl         TEXT NOT NULL DEFAULT '',
  mn         TEXT NOT NULL DEFAULT '',
  my         TEXT NOT NULL DEFAULT '',
  kk         TEXT NOT NULL DEFAULT '',
  si         TEXT NOT NULL DEFAULT '',
  ru         TEXT NOT NULL DEFAULT '',
  bn         TEXT NOT NULL DEFAULT '',
  ur         TEXT NOT NULL DEFAULT '',
  lo         TEXT NOT NULL DEFAULT '',
  hi         TEXT NOT NULL DEFAULT '',
  tr         TEXT NOT NULL DEFAULT '',
  fa         TEXT NOT NULL DEFAULT '',
  es         TEXT NOT NULL DEFAULT '',
  fr         TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_page_name
  ON gm_ui_dictionary(page_name);
