-- GM_IMAGE_VECTOR_PENDING_V001
-- Image vector generation is detached from product/category collection.
-- The row itself means "not completed yet". Successful vector save deletes the row.
-- Keep this migration append-only; do not modify older migrations.

CREATE TABLE IF NOT EXISTS gm_image_vector_pending (
  product_uid TEXT PRIMARY KEY,
  image_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_image_vector_pending_updated_at
  ON gm_image_vector_pending(updated_at ASC);

-- Product collection only records work to do. AI/vector conversion is handled later
-- by background/image-vector according to server memory availability.
CREATE OR REPLACE FUNCTION gm_enqueue_image_vector_pending()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(BTRIM(NEW.thumb_origin_url), '') = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR OLD.thumb_origin_url IS DISTINCT FROM NEW.thumb_origin_url THEN
    INSERT INTO gm_image_vector_pending(product_uid, image_url, updated_at)
    VALUES(NEW.product_uid, NEW.thumb_origin_url, now())
    ON CONFLICT (product_uid) DO UPDATE
      SET image_url = EXCLUDED.image_url,
          updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gm_product_image_vector_pending ON gm_product;
CREATE TRIGGER trg_gm_product_image_vector_pending
AFTER INSERT OR UPDATE OF thumb_origin_url ON gm_product
FOR EACH ROW
EXECUTE FUNCTION gm_enqueue_image_vector_pending();

-- Existing historical products are intentionally NOT scanned here.
-- Their pending seed is imported through Builder Safe Update from the
-- product/vector comparison CSV. New/changed products are queued by the trigger above.
