-- GM SmartFit Server Schema V016
-- 기준: source_lang = 작성자 현재 gm_lang. 국적 기준 저장 금지.
-- V015: Space/Template 동시 구축. Template.space_id는 NULL 허용(미분류)이며 나중에 이동 가능.
-- 콘텐츠 원문은 *_source / description / search_source 에 저장하고, ko 보조 검색값만 *_ko / search_ko 로 저장한다.
-- 이미지 URL은 DB에 저장하지 않는다. image_count만 저장하고 R2 경로 규칙으로 자동 생성한다.
-- 링크는 link01~link06만 저장한다. 실제 허용 도메인 검증은 routes/smartfit.js에서 수행한다.
-- 상품/카테고리/빌더/주문/장바구니 테이블은 이 파일에서 수정하지 않는다.

CREATE TABLE IF NOT EXISTS gm_smartfit_space (
  space_id BIGSERIAL PRIMARY KEY,
  creator_member_id VARCHAR(80) NOT NULL,
  owner_member_id VARCHAR(80) NOT NULL DEFAULT '',
  source_lang VARCHAR(10) NOT NULL DEFAULT 'ko',
  space_title_source VARCHAR(200) NOT NULL DEFAULT '',
  space_title_ko VARCHAR(200) NOT NULL DEFAULT '',
  author_nickname VARCHAR(120) NOT NULL DEFAULT '',
  category_no VARCHAR(40) NOT NULL DEFAULT 'ROOT',
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0 AND image_count <= 5),
  link01 TEXT NOT NULL DEFAULT '',
  link02 TEXT NOT NULL DEFAULT '',
  link03 TEXT NOT NULL DEFAULT '',
  link04 TEXT NOT NULL DEFAULT '',
  link05 TEXT NOT NULL DEFAULT '',
  link06 TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  visibility VARCHAR(20) NOT NULL DEFAULT 'private',
  search_visible CHAR(1) NOT NULL DEFAULT 'T',
  favorite_yn CHAR(1) NOT NULL DEFAULT 'F',
  sort_no INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Compatibility from older SmartFit schemas.
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS owner_member_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS source_lang VARCHAR(10) NOT NULL DEFAULT 'ko';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS space_title_source VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS space_title_ko VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS author_nickname VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS category_no VARCHAR(40) NOT NULL DEFAULT 'ROOT';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link01 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link02 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link03 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link04 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link05 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link06 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS search_visible CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS favorite_yn CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS sort_no INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
-- Temporary legacy columns for safe migration, dropped after data copy.
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS space_title VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS space_title_gm_lang VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS space_desc TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS space_desc_gm_lang TEXT NOT NULL DEFAULT '';
UPDATE gm_smartfit_space SET owner_member_id=creator_member_id WHERE COALESCE(owner_member_id,'')='';
UPDATE gm_smartfit_space SET space_title_source=COALESCE(NULLIF(space_title_source,''), NULLIF(space_title,''), NULLIF(space_title_gm_lang,''), NULLIF(space_title_ko,''), '') WHERE COALESCE(space_title_source,'')='';
UPDATE gm_smartfit_space SET space_title_ko=COALESCE(NULLIF(space_title_ko,''), NULLIF(space_title,''), '') WHERE COALESCE(space_title_ko,'')='';
UPDATE gm_smartfit_space SET description=COALESCE(NULLIF(description,''), NULLIF(space_desc,''), NULLIF(space_desc_gm_lang,''), '') WHERE COALESCE(description,'')='';
UPDATE gm_smartfit_space SET image_count=0 WHERE image_count IS NULL OR image_count < 0 OR image_count > 5;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE gm_smartfit_space SET sort_no=sort_order WHERE COALESCE(sort_no,0)=0 AND sort_order IS NOT NULL;

ALTER TABLE gm_smartfit_space DROP COLUMN IF EXISTS space_title;
ALTER TABLE gm_smartfit_space DROP COLUMN IF EXISTS space_title_gm_lang;
ALTER TABLE gm_smartfit_space DROP COLUMN IF EXISTS space_desc;
ALTER TABLE gm_smartfit_space DROP COLUMN IF EXISTS space_desc_gm_lang;
ALTER TABLE gm_smartfit_space DROP COLUMN IF EXISTS youtube_url;
ALTER TABLE gm_smartfit_space DROP COLUMN IF EXISTS image_url;

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_owner_v014 ON gm_smartfit_space (owner_member_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_favorite_v014 ON gm_smartfit_space (owner_member_id, favorite_yn, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_public_v013 ON gm_smartfit_space (visibility, search_visible, is_deleted, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_category_v013 ON gm_smartfit_space (category_no, visibility, is_active);

CREATE TABLE IF NOT EXISTS gm_smartfit_category (
  category_code VARCHAR(30) PRIMARY KEY,
  parent_code VARCHAR(30) NOT NULL DEFAULT '',
  depth INTEGER NOT NULL DEFAULT 1,
  leaf_yn CHAR(1) NOT NULL DEFAULT 'F',
  display_order INTEGER NOT NULL DEFAULT 0,
  category_name_ko VARCHAR(200) NOT NULL DEFAULT '',
  category_name_en VARCHAR(200) NOT NULL DEFAULT '',
  category_name_gm_lang VARCHAR(200) NOT NULL DEFAULT '',
  category_desc_ko TEXT NOT NULL DEFAULT '',
  category_desc_en TEXT NOT NULL DEFAULT '',
  category_desc_gm_lang TEXT NOT NULL DEFAULT '',
  search_source TEXT NOT NULL DEFAULT '',
  search_ko TEXT NOT NULL DEFAULT '',
  search_en TEXT NOT NULL DEFAULT '',
  search_gm_lang TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  banner_url TEXT NOT NULL DEFAULT '',
  is_hot CHAR(1) NOT NULL DEFAULT 'F',
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE gm_smartfit_category ADD COLUMN IF NOT EXISTS search_source TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_category_parent ON gm_smartfit_category (parent_code, display_order);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_category_depth ON gm_smartfit_category (depth, display_order);

INSERT INTO gm_smartfit_category (category_code, parent_code, depth, leaf_yn, display_order, category_name_ko, category_name_en, category_name_gm_lang, search_ko, search_en, search_gm_lang)
VALUES
('ROOT','',1,'F',0,'ROOT','ROOT','ROOT','ROOT','ROOT','ROOT'),
('HOME','ROOT',2,'T',10,'집','Home','Home','집,가정,생활','home,house,living','home'),
('WORK','ROOT',2,'T',20,'회사','Work','Work','회사,업무,사무','work,office','work'),
('COOK','ROOT',2,'T',30,'요리','Cooking','Cooking','요리,식단,식재료','cooking,meal,food','cooking'),
('HOBBY','ROOT',2,'T',40,'취미','Hobby','Hobby','취미,생활','hobby,life','hobby'),
('ETC','ROOT',2,'T',90,'기타','Etc','Etc','기타','etc','etc')
ON CONFLICT (category_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS gm_smartfit_template (
  template_id BIGSERIAL PRIMARY KEY,
  space_id BIGINT,
  creator_member_id VARCHAR(80) NOT NULL,
  source_lang VARCHAR(10) NOT NULL DEFAULT 'ko',
  template_title_source VARCHAR(240) NOT NULL DEFAULT '',
  template_title_ko VARCHAR(240) NOT NULL DEFAULT '',
  category_no VARCHAR(40) NOT NULL DEFAULT 'ROOT',
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
  visibility VARCHAR(20) NOT NULL DEFAULT 'private',
  search_visible CHAR(1) NOT NULL DEFAULT 'T',
  favorite_yn CHAR(1) NOT NULL DEFAULT 'F',
  sort_no INTEGER NOT NULL DEFAULT 0,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  use_count BIGINT NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  view_count BIGINT NOT NULL DEFAULT 0,
  visit_count BIGINT NOT NULL DEFAULT 0,
  collection_count BIGINT NOT NULL DEFAULT 0,
  reuse_count BIGINT NOT NULL DEFAULT 0,
  build_cart_count BIGINT NOT NULL DEFAULT 0,
  item_add_count BIGINT NOT NULL DEFAULT 0,
  purchase_count BIGINT NOT NULL DEFAULT 0,
  ranking_score NUMERIC(20,6) NOT NULL DEFAULT 0,
  review_count BIGINT NOT NULL DEFAULT 0,
  rating_sum NUMERIC(18,2) NOT NULL DEFAULT 0,
  rating_avg NUMERIC(8,4) NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS source_lang VARCHAR(10) NOT NULL DEFAULT 'ko';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS template_title_source VARCHAR(240) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS template_title_ko VARCHAR(240) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS category_no VARCHAR(40) NOT NULL DEFAULT 'ROOT';
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
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS search_visible CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS favorite_yn CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS sort_no INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS content_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS use_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS item_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
-- Temporary legacy columns for safe migration, dropped after data copy.
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS template_title_gm_lang VARCHAR(240) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS template_desc_gm_lang TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS template_desc_ko TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS search_gm_lang TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS category_code VARCHAR(30) NOT NULL DEFAULT '';
UPDATE gm_smartfit_template SET template_title_source=COALESCE(NULLIF(template_title_source,''), NULLIF(template_title_gm_lang,''), NULLIF(template_title_ko,''), '') WHERE COALESCE(template_title_source,'')='';
UPDATE gm_smartfit_template SET description=COALESCE(NULLIF(description,''), NULLIF(template_desc_gm_lang,''), NULLIF(template_desc_ko,''), '') WHERE COALESCE(description,'')='';
UPDATE gm_smartfit_template SET search_source=COALESCE(NULLIF(search_source,''), NULLIF(search_gm_lang,''), NULLIF(search_ko,''), '') WHERE COALESCE(search_source,'')='';
UPDATE gm_smartfit_template SET category_no=COALESCE(NULLIF(category_no,''), NULLIF(category_code,''), 'ROOT') WHERE COALESCE(category_no,'')='';
UPDATE gm_smartfit_template SET image_count=0 WHERE image_count IS NULL OR image_count < 0 OR image_count > 5;

ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS template_title_en;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS template_title_gm_lang;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS template_desc_ko;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS template_desc_en;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS template_desc_gm_lang;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS creator_intro_ko;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS creator_intro_en;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS creator_intro_gm_lang;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS search_en;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS search_gm_lang;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS search_ru;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS search_hi;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS search_fr;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS search_es;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS category_code;

-- V016 확정: 기존 테이블에도 최소 집계 컬럼만 추가한다.
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS purchase_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS ranking_score NUMERIC(20,6) NOT NULL DEFAULT 0;

-- purchase_count 유지: Template 경유 구매 수 집계
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS order_count;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS sales_amount;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS cancel_count;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS cancel_amount;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS return_count;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS return_amount;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS incentive_confirm_amount;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS incentive_cancel_amount;

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_creator_v014 ON gm_smartfit_template (creator_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_space_v014 ON gm_smartfit_template (creator_member_id, space_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_favorite_v014 ON gm_smartfit_template (creator_member_id, favorite_yn, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_category_v013 ON gm_smartfit_template (category_no, visibility, is_active);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_rank_v016 ON gm_smartfit_template (ranking_score DESC, updated_at DESC) WHERE visibility='public' AND search_visible='T' AND is_active='T' AND is_deleted='F';
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_public_v013 ON gm_smartfit_template (visibility, search_visible, is_deleted, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_trash_v013 ON gm_smartfit_template (creator_member_id, is_deleted, deleted_at DESC);

CREATE TABLE IF NOT EXISTS gm_smartfit_item (
  item_id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL,
  item_role VARCHAR(40) NOT NULL DEFAULT 'ETC',
  mall_code VARCHAR(20) NOT NULL DEFAULT '',
  product_uid VARCHAR(160) NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  sort_no INTEGER NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS sort_no INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS jeju_delivery_yn TEXT;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS jeju_extra_delivery_fee INTEGER;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS island_delivery_yn TEXT;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS island_extra_delivery_fee INTEGER;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE gm_smartfit_item SET sort_no=sort_order WHERE COALESCE(sort_no,0)=0 AND sort_order IS NOT NULL;
ALTER TABLE gm_smartfit_item DROP COLUMN IF EXISTS sort_order;
ALTER TABLE gm_smartfit_item DROP COLUMN IF EXISTS default_checked;
ALTER TABLE gm_smartfit_item DROP COLUMN IF EXISTS required_yn;
ALTER TABLE gm_smartfit_item DROP COLUMN IF EXISTS creator_tip;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_smartfit_item_template_product_v013 ON gm_smartfit_item (template_id, mall_code, product_uid);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_template_v013 ON gm_smartfit_item (template_id, sort_no, item_id);

CREATE TABLE IF NOT EXISTS gm_smartfit_collection (
  member_id VARCHAR(80) NOT NULL,
  template_id BIGINT NOT NULL,
  collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  use_count BIGINT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(member_id, template_id)
);
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);

ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS member_nickname VARCHAR(120);
