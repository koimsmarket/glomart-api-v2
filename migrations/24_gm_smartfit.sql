-- GM SmartFit Server Schema V004
-- 기준: GM_SMARTFIT_SERVER_DESIGN_V003
-- SmartFit 전용 테이블/API만 구성한다. gm_products/gm_category/gm_basket/gm_orders/빌더 테이블은 수정하지 않는다.
-- 콘텐츠 저장 기준: 작성자 선택 gm_lang 원문(source_lang) + ko 보조 검색값(title_ko/search_ko)만 저장한다.
-- 이미지 URL은 DB에 저장하지 않고 image_count만 저장한다. URL은 R2 폴더/파일명 규칙으로 생성한다.

CREATE TABLE IF NOT EXISTS gm_smartfit_space (
  space_id BIGSERIAL PRIMARY KEY,
  owner_member_id VARCHAR(80) NOT NULL DEFAULT '',
  creator_member_id VARCHAR(80) NOT NULL DEFAULT '',
  source_lang VARCHAR(10) NOT NULL DEFAULT 'ko',
  space_title_source VARCHAR(200) NOT NULL DEFAULT '',
  space_title_ko VARCHAR(200) NOT NULL DEFAULT '',
  author_nickname VARCHAR(120) NOT NULL DEFAULT '',
  category_no VARCHAR(80) NOT NULL DEFAULT 'ROOT',
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0 AND image_count <= 5),
  link01 TEXT NOT NULL DEFAULT '',
  link02 TEXT NOT NULL DEFAULT '',
  link03 TEXT NOT NULL DEFAULT '',
  link04 TEXT NOT NULL DEFAULT '',
  link05 TEXT NOT NULL DEFAULT '',
  link06 TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_public CHAR(1) NOT NULL DEFAULT 'F',
  search_visible CHAR(1) NOT NULL DEFAULT 'F',
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP NULL,
  deleted_by VARCHAR(80) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS owner_member_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS creator_member_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS source_lang VARCHAR(10) NOT NULL DEFAULT 'ko';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS space_title_source VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS space_title_ko VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS author_nickname VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS category_no VARCHAR(80) NOT NULL DEFAULT 'ROOT';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link01 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link02 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link03 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link04 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link05 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link06 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS is_public CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS search_visible CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_owner ON gm_smartfit_space(owner_member_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_public ON gm_smartfit_space(is_public, search_visible, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_category ON gm_smartfit_space(category_no, is_deleted, updated_at DESC);

CREATE TABLE IF NOT EXISTS gm_smartfit_template (
  template_id BIGSERIAL PRIMARY KEY,
  owner_member_id VARCHAR(80) NOT NULL DEFAULT '',
  creator_member_id VARCHAR(80) NOT NULL DEFAULT '',
  space_id BIGINT NULL,
  source_lang VARCHAR(10) NOT NULL DEFAULT 'ko',
  template_title_source VARCHAR(240) NOT NULL DEFAULT '',
  template_title_ko VARCHAR(240) NOT NULL DEFAULT '',
  category_no VARCHAR(80) NOT NULL DEFAULT 'ROOT',
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0 AND image_count <= 5),
  link01 TEXT NOT NULL DEFAULT '',
  link02 TEXT NOT NULL DEFAULT '',
  link03 TEXT NOT NULL DEFAULT '',
  link04 TEXT NOT NULL DEFAULT '',
  link05 TEXT NOT NULL DEFAULT '',
  link06 TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  search_source TEXT NOT NULL DEFAULT '',
  search_ko TEXT NOT NULL DEFAULT '',
  keyword_count INTEGER NOT NULL DEFAULT 0,
  is_public CHAR(1) NOT NULL DEFAULT 'F',
  search_visible CHAR(1) NOT NULL DEFAULT 'F',
  use_count BIGINT NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  view_count BIGINT NOT NULL DEFAULT 0,
  visit_count BIGINT NOT NULL DEFAULT 0,
  collection_count BIGINT NOT NULL DEFAULT 0,
  reuse_count BIGINT NOT NULL DEFAULT 0,
  build_cart_count BIGINT NOT NULL DEFAULT 0,
  item_add_count BIGINT NOT NULL DEFAULT 0,
  review_count BIGINT NOT NULL DEFAULT 0,
  rating_sum NUMERIC(18,2) NOT NULL DEFAULT 0,
  rating_avg NUMERIC(8,3) NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP NULL,
  deleted_by VARCHAR(80) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS owner_member_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS creator_member_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS space_id BIGINT NULL;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS source_lang VARCHAR(10) NOT NULL DEFAULT 'ko';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS template_title_source VARCHAR(240) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS template_title_ko VARCHAR(240) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS category_no VARCHAR(80) NOT NULL DEFAULT 'ROOT';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link01 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link02 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link03 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link04 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link05 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link06 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS search_source TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS search_ko TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS keyword_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS is_public CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS search_visible CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS use_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS item_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS visit_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS collection_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS reuse_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS build_cart_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS item_add_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS review_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS rating_sum NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(8,3) NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_owner ON gm_smartfit_template(owner_member_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_space ON gm_smartfit_template(space_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_public ON gm_smartfit_template(is_public, search_visible, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_category ON gm_smartfit_template(category_no, is_deleted, updated_at DESC);

CREATE TABLE IF NOT EXISTS gm_smartfit_item (
  item_id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL,
  mall_code VARCHAR(20) NOT NULL DEFAULT '',
  product_uid VARCHAR(160) NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  sort_no INTEGER NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP NULL,
  deleted_by VARCHAR(80) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(template_id, mall_code, product_uid)
);

ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS template_id BIGINT;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS mall_code VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS product_uid VARCHAR(160) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS qty INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS sort_no INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_smartfit_item_tpl_product ON gm_smartfit_item(template_id, mall_code, product_uid);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_template ON gm_smartfit_item(template_id, is_deleted, sort_no);

CREATE TABLE IF NOT EXISTS gm_smartfit_collection (
  member_id VARCHAR(80) NOT NULL,
  template_id BIGINT NOT NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  use_count BIGINT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP NULL,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP NULL,
  deleted_by VARCHAR(80) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(member_id, template_id)
);

CREATE TABLE IF NOT EXISTS gm_smartfit_category (
  category_no VARCHAR(80) PRIMARY KEY,
  parent_category_no VARCHAR(80) NOT NULL DEFAULT '',
  category_name VARCHAR(160) NOT NULL DEFAULT '',
  depth INTEGER NOT NULL DEFAULT 1,
  sort_no INTEGER NOT NULL DEFAULT 0,
  space_count BIGINT NOT NULL DEFAULT 0,
  template_count BIGINT NOT NULL DEFAULT 0,
  public_template_count BIGINT NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO gm_smartfit_category(category_no,parent_category_no,category_name,depth,sort_no,is_active) VALUES
('ROOT','','ROOT',0,0,'T'),
('HOME','ROOT','집',1,10,'T'),
('WORK','ROOT','회사',1,20,'T'),
('COOK','ROOT','요리',1,30,'T'),
('HOBBY','ROOT','취미',1,40,'T'),
('ETC','ROOT','기타',1,90,'T')
ON CONFLICT(category_no) DO UPDATE SET category_name=EXCLUDED.category_name, parent_category_no=EXCLUDED.parent_category_no, depth=EXCLUDED.depth, sort_no=EXCLUDED.sort_no, is_active='T', updated_at=CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS gm_smartfit_event (
  event_id BIGSERIAL PRIMARY KEY,
  space_id BIGINT NULL,
  template_id BIGINT NULL,
  category_no VARCHAR(80) NOT NULL DEFAULT '',
  creator_member_id VARCHAR(80) NOT NULL DEFAULT '',
  member_id VARCHAR(80) NOT NULL DEFAULT '',
  stat_type VARCHAR(40) NOT NULL DEFAULT '',
  amount NUMERIC(18,2) NOT NULL DEFAULT 1,
  lang_code VARCHAR(10) NOT NULL DEFAULT 'ot',
  order_id VARCHAR(80) NOT NULL DEFAULT '',
  source VARCHAR(80) NOT NULL DEFAULT '',
  meta_json JSONB NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_event_template ON gm_smartfit_event(template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_event_category ON gm_smartfit_event(category_no, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_smartfit_comment (
  comment_id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL,
  member_id VARCHAR(80) NOT NULL DEFAULT '',
  parent_id BIGINT NULL,
  rating NUMERIC(4,2) NULL,
  source_lang VARCHAR(10) NOT NULL DEFAULT 'ko',
  body TEXT NOT NULL DEFAULT '',
  is_creator_reply CHAR(1) NOT NULL DEFAULT 'F',
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_comment_template ON gm_smartfit_comment(template_id, is_deleted, created_at DESC);
