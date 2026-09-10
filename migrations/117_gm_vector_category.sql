-- GM_VECTOR_CATEGORY_V002
-- Integrated first-time migration for vector-image classification.
-- Includes:
--   1) vector classification tree
--   2) gm_product_image_vector.class_id
--   3) gm_product_image_vector.category_group (FD, HS, KW ...)
-- Additive / preserve-only migration: no DROP, DELETE, TRUNCATE, or vector rewrite.

CREATE TABLE IF NOT EXISTS gm_vector_category (
  id BIGSERIAL PRIMARY KEY,
  parent_id BIGINT NULL,
  child_no INTEGER NOT NULL CHECK (child_no > 0),
  vector_center REAL[] NOT NULL,
  is_leaf BOOLEAN NOT NULL DEFAULT TRUE,
  product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),

  CONSTRAINT fk_gm_vector_category_parent
    FOREIGN KEY (parent_id)
    REFERENCES gm_vector_category(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,

  CONSTRAINT chk_gm_vector_category_center_512
    CHECK (array_length(vector_center, 1) = 512)
);

-- Root and child numbers are unique within their own parent scope.
-- child_no is INTEGER and is not fixed-width: 1, 100, 1000, ... are valid.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_vector_category_root_child_no
  ON gm_vector_category(child_no)
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_vector_category_parent_child_no
  ON gm_vector_category(parent_id, child_no)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_vector_category_parent_id
  ON gm_vector_category(parent_id);

ALTER TABLE gm_product_image_vector
  ADD COLUMN IF NOT EXISTS category_group CHAR(2),
  ADD COLUMN IF NOT EXISTS class_id BIGINT NULL;

-- category_group selects completed top-level Glomart category scope such as FD/HS/KW.
CREATE INDEX IF NOT EXISTS idx_gm_product_image_vector_category_group
  ON gm_product_image_vector(category_group);

-- class_id points to the final visual-vector classification node.
CREATE INDEX IF NOT EXISTS idx_gm_product_image_vector_class_id
  ON gm_product_image_vector(class_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'fk_gm_product_image_vector_class'
       AND conrelid = 'gm_product_image_vector'::regclass
  ) THEN
    ALTER TABLE gm_product_image_vector
      ADD CONSTRAINT fk_gm_product_image_vector_class
      FOREIGN KEY (class_id)
      REFERENCES gm_vector_category(id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END
$$;
