-- Existing delivery term normalization: min/max -> min|max
-- Safe to run repeatedly. Only exact numeric term strings are changed.

UPDATE gm_product
SET delivery_eta_text = regexp_replace(
  BTRIM(delivery_eta_text),
  '^([0-9]{1,3})[[:space:]]*/[[:space:]]*([0-9]{1,3})$',
  '\1|\2'
)
WHERE delivery_eta_text ~ '^[0-9]{1,3}[[:space:]]*/[[:space:]]*[0-9]{1,3}$';

UPDATE gm_product_option
SET delivery_eta_text = regexp_replace(
  BTRIM(delivery_eta_text),
  '^([0-9]{1,3})[[:space:]]*/[[:space:]]*([0-9]{1,3})$',
  '\1|\2'
)
WHERE delivery_eta_text ~ '^[0-9]{1,3}[[:space:]]*/[[:space:]]*[0-9]{1,3}$';
