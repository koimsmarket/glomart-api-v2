-- GM SmartFit Phase1 Server Schema V012
-- Template is a shared measuring template. Users reference template_id; template items are not copied per user.
-- Template stats are usage/copy/review metrics only. Actual purchase/order quantities belong to basket/order tables.
-- Delete = trash move. Permanent delete is allowed only when there is no other-user reference.

CREATE TABLE IF NOT EXISTS gm_smartfit_space (
  space_id BIGSERIAL PRIMARY KEY,
  creator_member_id VARCHAR(80) NOT NULL,
  owner_member_id VARCHAR(80) NOT NULL DEFAULT '',
  author_nickname VARCHAR(120) NOT NULL DEFAULT '',
  real_name_public CHAR(1) NOT NULL DEFAULT 'F',
  space_title VARCHAR(200) NOT NULL DEFAULT '',
  space_title_en VARCHAR(200) NOT NULL DEFAULT '',
  space_title_gm_lang VARCHAR(200) NOT NULL DEFAULT '',
  space_desc TEXT NOT NULL DEFAULT '',
  space_desc_en TEXT NOT NULL DEFAULT '',
  space_desc_gm_lang TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  visibility VARCHAR(20) NOT NULL DEFAULT 'private', -- draft/private/public
  search_visible CHAR(1) NOT NULL DEFAULT 'T',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Compatibility ALTERs must run before indexes because existing V004/V007 tables may lack new columns.
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS owner_member_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS author_nickname VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS real_name_public CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS search_visible CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS youtube_url TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
UPDATE gm_smartfit_space SET owner_member_id=creator_member_id WHERE COALESCE(owner_member_id,'')='';

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_creator ON gm_smartfit_space (creator_member_id);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_owner ON gm_smartfit_space (owner_member_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_public ON gm_smartfit_space (visibility, search_visible, is_deleted, updated_at DESC);

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
  search_ko TEXT NOT NULL DEFAULT '',
  search_en TEXT NOT NULL DEFAULT '',
  search_gm_lang TEXT NOT NULL DEFAULT '',
  search_ru TEXT NOT NULL DEFAULT '',
  search_hi TEXT NOT NULL DEFAULT '',
  search_fr TEXT NOT NULL DEFAULT '',
  search_es TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  banner_url TEXT NOT NULL DEFAULT '',
  is_hot CHAR(1) NOT NULL DEFAULT 'F',
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_category_parent ON gm_smartfit_category (parent_code, display_order);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_category_depth ON gm_smartfit_category (depth, display_order);

CREATE TABLE IF NOT EXISTS gm_smartfit_template (
  template_id BIGSERIAL PRIMARY KEY,
  space_id BIGINT,
  creator_member_id VARCHAR(80) NOT NULL,
  category_code VARCHAR(30) NOT NULL DEFAULT '',
  template_title_ko VARCHAR(240) NOT NULL DEFAULT '',
  template_title_en VARCHAR(240) NOT NULL DEFAULT '',
  template_title_gm_lang VARCHAR(240) NOT NULL DEFAULT '',
  template_desc_ko TEXT NOT NULL DEFAULT '',
  template_desc_en TEXT NOT NULL DEFAULT '',
  template_desc_gm_lang TEXT NOT NULL DEFAULT '',
  creator_intro_ko TEXT NOT NULL DEFAULT '',
  creator_intro_en TEXT NOT NULL DEFAULT '',
  creator_intro_gm_lang TEXT NOT NULL DEFAULT '',
  search_ko TEXT NOT NULL DEFAULT '',
  search_en TEXT NOT NULL DEFAULT '',
  search_gm_lang TEXT NOT NULL DEFAULT '',
  search_ru TEXT NOT NULL DEFAULT '',
  search_hi TEXT NOT NULL DEFAULT '',
  search_fr TEXT NOT NULL DEFAULT '',
  search_es TEXT NOT NULL DEFAULT '',
  visibility VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft/private/public
  search_visible CHAR(1) NOT NULL DEFAULT 'T',
  view_count BIGINT NOT NULL DEFAULT 0,
  visit_count BIGINT NOT NULL DEFAULT 0,
  collection_count BIGINT NOT NULL DEFAULT 0,
  use_count BIGINT NOT NULL DEFAULT 0,
  reuse_count BIGINT NOT NULL DEFAULT 0,
  build_cart_count BIGINT NOT NULL DEFAULT 0,
  item_add_count BIGINT NOT NULL DEFAULT 0,
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
-- Compatibility ALTERs must run before template indexes because existing V004/V007 tables may lack new columns.
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS search_visible CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS build_cart_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS item_add_count BIGINT NOT NULL DEFAULT 0;
-- Actual purchase/order/sales stats are not stored on templates. Template is only a measuring/reference tool.
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS purchase_count;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS order_count;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS sales_amount;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS cancel_count;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS cancel_amount;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS return_count;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS return_amount;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS incentive_confirm_amount;
ALTER TABLE gm_smartfit_template DROP COLUMN IF EXISTS incentive_cancel_amount;
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_creator ON gm_smartfit_template (creator_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_category ON gm_smartfit_template (category_code, visibility, is_active);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_visibility ON gm_smartfit_template (visibility, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_public_v009 ON gm_smartfit_template (visibility, search_visible, is_deleted, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_template_trash ON gm_smartfit_template (creator_member_id, is_deleted, deleted_at DESC);

CREATE TABLE IF NOT EXISTS gm_smartfit_item (
  item_id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL,
  item_role VARCHAR(40) NOT NULL DEFAULT 'ETC', -- MAIN/SUB/SAUCE/TOOL/ETC
  mall_code VARCHAR(20) NOT NULL DEFAULT '',
  product_uid VARCHAR(160) NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  default_checked CHAR(1) NOT NULL DEFAULT 'T',
  required_yn CHAR(1) NOT NULL DEFAULT 'F',
  creator_tip TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  use_count BIGINT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Compatibility ALTERs must run before item indexes.
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS use_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_smartfit_item_template_product ON gm_smartfit_item (template_id, mall_code, product_uid);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_template ON gm_smartfit_item (template_id, sort_order, item_id);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_product ON gm_smartfit_item (mall_code, product_uid);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_trash ON gm_smartfit_item (template_id, is_deleted, deleted_at DESC);

CREATE TABLE IF NOT EXISTS gm_smartfit_collection (
  member_id VARCHAR(80) NOT NULL,
  template_id BIGINT NOT NULL,
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
-- Compatibility ALTERs must run before collection indexes.
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_collection_template ON gm_smartfit_collection (template_id);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_collection_ref_v009 ON gm_smartfit_collection (template_id, member_id, is_active, is_deleted);

CREATE TABLE IF NOT EXISTS gm_smartfit_media (
  media_id BIGSERIAL PRIMARY KEY,
  target_type VARCHAR(40) NOT NULL, -- space/template/member/category/comment
  target_id VARCHAR(80) NOT NULL,
  media_type VARCHAR(40) NOT NULL DEFAULT 'image', -- image/youtube/video/link
  url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  title VARCHAR(240) NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_media_target ON gm_smartfit_media (target_type, target_id, sort_order);

CREATE TABLE IF NOT EXISTS gm_smartfit_comment (
  comment_id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL,
  member_id VARCHAR(80) NOT NULL DEFAULT '',
  parent_id BIGINT,
  rating NUMERIC(3,1),
  body TEXT NOT NULL DEFAULT '',
  is_creator_reply CHAR(1) NOT NULL DEFAULT 'F',
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  deleted_at TIMESTAMP,
  deleted_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_comment_template ON gm_smartfit_comment (template_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_smartfit_event (
  event_id BIGSERIAL PRIMARY KEY,
  space_id BIGINT,
  template_id BIGINT,
  item_id BIGINT,
  category_code VARCHAR(30) NOT NULL DEFAULT '',
  creator_member_id VARCHAR(80) NOT NULL DEFAULT '',
  member_id VARCHAR(80) NOT NULL DEFAULT '',
  stat_type VARCHAR(40) NOT NULL,
  amount NUMERIC(18,2) NOT NULL DEFAULT 1,
  lang_code VARCHAR(10) NOT NULL DEFAULT 'ko',
  order_id VARCHAR(120) NOT NULL DEFAULT '',
  source VARCHAR(40) NOT NULL DEFAULT '',
  meta_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Compatibility ALTERs must run before event indexes.
ALTER TABLE gm_smartfit_event ADD COLUMN IF NOT EXISTS item_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_event_template ON gm_smartfit_event (template_id, stat_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_event_category ON gm_smartfit_event (category_code, stat_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_event_member ON gm_smartfit_event (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_event_creator ON gm_smartfit_event (creator_member_id, created_at DESC);

ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS member_nickname VARCHAR(120);
-- Safety ALTERs for older deployments that already created V002/V004/V007 tables.
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS owner_member_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS author_nickname VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS real_name_public CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS search_visible CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS youtube_url TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
UPDATE gm_smartfit_space SET owner_member_id=creator_member_id WHERE COALESCE(owner_member_id,'')='';

ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS search_visible CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);

ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS use_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;

ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS is_active CHAR(1) NOT NULL DEFAULT 'T';
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS is_deleted CHAR(1) NOT NULL DEFAULT 'F';
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE gm_smartfit_collection ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(80);

ALTER TABLE gm_smartfit_event ADD COLUMN IF NOT EXISTS item_id BIGINT;

-- Basic seed. Detailed category CSV can overwrite these later.
INSERT INTO gm_smartfit_category (category_code,parent_code,depth,leaf_yn,display_order,category_name_ko,category_name_en,search_ko,search_en)
VALUES
('SF-01-000-0000-0000','',1,'F',1,'음식','Food','음식|요리|레시피','food|recipe|cooking'),
('SF-01-001-0000-0000','SF-01-000-0000-0000',2,'T',1,'한식','Korean Food','한식|한국요리|K푸드','korean food|korean cuisine|k-food'),
('SF-01-002-0000-0000','SF-01-000-0000-0000',2,'T',2,'중식','Chinese Food','중식|중국요리','chinese food|chinese cuisine'),
('SF-01-003-0000-0000','SF-01-000-0000-0000',2,'T',3,'일식','Japanese Food','일식|일본요리','japanese food|japanese cuisine'),
('SF-01-004-0000-0000','SF-01-000-0000-0000',2,'T',4,'양식','Western Food','양식|서양요리','western food|western cuisine'),
('SF-01-005-0000-0000','SF-01-000-0000-0000',2,'T',5,'분식','Korean Street Food','분식|떡볶이|김밥','street food|tteokbokki|gimbap'),
('SF-01-006-0000-0000','SF-01-000-0000-0000',2,'T',6,'세계요리','World Food','세계요리|외국요리','world food|global cuisine'),
('SF-01-007-0000-0000','SF-01-000-0000-0000',2,'T',7,'건강식','Healthy Food','건강식|식단','healthy food|diet meal'),
('SF-01-008-0000-0000','SF-01-000-0000-0000',2,'T',8,'디저트','Dessert','디저트|간식','dessert|snack'),
('SF-01-009-0000-0000','SF-01-000-0000-0000',2,'T',9,'차/커피','Tea/Coffee','차|커피|음료','tea|coffee|beverage'),
('SF-01-999-0000-0000','SF-01-000-0000-0000',2,'T',999,'기타','Other','기타','other'),
('SF-02-000-0000-0000','',1,'F',2,'생활','Life','생활|자취|신혼|이사','life|living'),
('SF-03-000-0000-0000','',1,'F',3,'비즈니스','Business','비즈니스|창업|농업|수산업|공장|사무실','business|startup|office|factory'),
('SF-04-000-0000-0000','',1,'F',4,'국가별','Country/Culture','국가별|외국인|문화','country|culture|foreigner'),
('SF-05-000-0000-0000','',1,'F',5,'반려동물','Pet','반려동물|강아지|고양이','pet|dog|cat'),
('SF-05-001-0000-0000','SF-05-000-0000-0000',2,'T',1,'강아지','Dog','강아지|개','dog|puppy'),
('SF-05-002-0000-0000','SF-05-000-0000-0000',2,'T',2,'고양이','Cat','고양이','cat|kitten'),
('SF-05-003-0000-0000','SF-05-000-0000-0000',2,'T',3,'물고기/수족관','Fish/Aquarium','물고기|수족관|어항','fish|aquarium'),
('SF-05-004-0000-0000','SF-05-000-0000-0000',2,'T',4,'새','Bird','새|조류','bird'),
('SF-05-005-0000-0000','SF-05-000-0000-0000',2,'T',5,'소동물','Small Animal','햄스터|토끼|소동물','hamster|rabbit|small animal'),
('SF-05-006-0000-0000','SF-05-000-0000-0000',2,'T',6,'파충류','Reptile','파충류','reptile'),
('SF-05-999-0000-0000','SF-05-000-0000-0000',2,'T',999,'기타','Other','기타','other')
ON CONFLICT (category_code) DO NOTHING;
