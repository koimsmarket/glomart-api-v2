'use strict';

/* GM_R2_STORAGE_RULE_V001
 * SmartFit Cloudflare R2 공통 저장 규칙
 *
 * [DB 원칙]
 * - DB의 space_id/template_id는 BIGINT 숫자 그대로 사용한다.
 * - DB에는 이미지 URL/경로/파일명을 저장하지 않는다.
 * - 각 레코드에는 image_count만 저장한다.
 *
 * [표시 ID]
 * - Space    : S + 숫자 12자리 (예: S000000000001)
 * - Template : T + 숫자 12자리 (예: T000000000001)
 * - 표시용 Prefix는 테이블이 다르므로 DB 기본키에는 포함하지 않는다.
 *
 * [R2 폴더]
 * - 버킷 최상위: space/ 또는 template/
 * - 각 최종 폴더는 ID 100개를 담당한다.
 * - 블록 번호 floor((id - 1) / 100)를 000~999의 3단계로 분해한다.
 * - 최대: 1000 × 1000 × 1000 × 100 = 100,000,000,000 ID
 *
 * 예:
 *   ID 1~100       -> space/000/000/000/
 *   ID 101~200     -> space/000/000/001/
 *   ID 100001~100100 -> space/000/001/000/
 *
 * [파일명]
 * - 한 ID당 10장까지 번호 공간을 영구 예약한다. 현재 UI는 5장까지만 허용한다.
 * - 최종 폴더 안 상대 ID: 001~100
 * - 이미지 순번: 01~10
 * - Space 원본: si001_01.webp / 축소: ss001_01.webp
 * - Template 원본: ti001_01.webp / 축소: ts001_01.webp
 *
 * 이 주석과 계산 함수는 서버/R2/관리자 화면에서 공통 규격으로 유지한다.
 */

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');

const MAX_RESOURCE_ID = 100000000000;
const RESERVED_IMAGES_PER_ID = 10;

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function requiredEnv(name, fallbackNames = []) {
  const names = [name].concat(fallbackNames);
  for (const key of names) {
    const value = clean(process.env[key]);
    if (value) return value;
  }
  throw new Error(`missing environment variable: ${name}`);
}

function config() {
  return {
    accountId: requiredEnv('R2_ACCOUNT_ID'),
    accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requiredEnv('R2_BUCKET_NAME'),
    endpoint: clean(process.env.R2_ENDPOINT) || `https://${requiredEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    publicBase: clean(process.env.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE || process.env.GM_R2_PUBLIC_BASE),
  };
}

let cachedClient = null;
let cachedSignature = '';

function client() {
  const c = config();
  const signature = [c.endpoint, c.accessKeyId].join('|');
  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: c.endpoint,
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
    });
    cachedSignature = signature;
  }
  return cachedClient;
}

function normalizeType(type) {
  const value = clean(type).toLowerCase();
  if (value === 'space' || value === 'template') return value;
  throw new Error('resource_type must be space or template');
}

function normalizeId(id) {
  const value = Number(id);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESOURCE_ID) {
    throw new Error(`resource_id must be 1~${MAX_RESOURCE_ID}`);
  }
  return value;
}

function folderParts(id) {
  const value = normalizeId(id);
  const block = Math.floor((value - 1) / 100);
  const level1 = Math.floor(block / 1000000);
  const level2 = Math.floor(block / 1000) % 1000;
  const level3 = block % 1000;
  return [level1, level2, level3].map(v => String(v).padStart(3, '0'));
}

function localId(id) {
  return String(((normalizeId(id) - 1) % 100) + 1).padStart(3, '0');
}

function keyFor(type, id, imageNo, size = 'image') {
  const resourceType = normalizeType(type);
  const number = Number(imageNo);
  if (!Number.isInteger(number) || number < 1 || number > RESERVED_IMAGES_PER_ID) {
    throw new Error(`image_no must be 1~${RESERVED_IMAGES_PER_ID}`);
  }
  if (size !== 'image' && size !== 'small') throw new Error('size must be image or small');

  const root = resourceType;
  const first = resourceType === 'space' ? 's' : 't';
  const second = size === 'image' ? 'i' : 's';
  const file = `${first}${second}${localId(id)}_${String(number).padStart(2, '0')}.webp`;
  return `${root}/${folderParts(id).join('/')}/${file}`;
}

function publicUrl(key) {
  const base = config().publicBase;
  return base ? `${base.replace(/\/$/, '')}/${key}` : '';
}

async function putWebp(key, body, cacheControl = 'public, max-age=31536000, immutable') {
  const c = config();
  await client().send(new PutObjectCommand({
    Bucket: c.bucket,
    Key: key,
    Body: body,
    ContentType: 'image/webp',
    CacheControl: cacheControl,
  }));
  return { key, url: publicUrl(key) };
}

async function deleteKeys(keys) {
  const list = Array.from(new Set((keys || []).filter(Boolean)));
  if (!list.length) return 0;
  const c = config();
  await client().send(new DeleteObjectsCommand({
    Bucket: c.bucket,
    Delete: { Objects: list.map(Key => ({ Key })), Quiet: true },
  }));
  return list.length;
}

async function health() {
  const c = config();
  await client().send(new HeadBucketCommand({ Bucket: c.bucket }));
  return { ok: true, bucket: c.bucket, endpoint: c.endpoint, public_base_configured: !!c.publicBase };
}

function imageFiles(type, id, count) {
  const safeCount = Math.max(0, Math.min(RESERVED_IMAGES_PER_ID, Number(count) || 0));
  const files = [];
  for (let imageNo = 1; imageNo <= safeCount; imageNo += 1) {
    const imageKey = keyFor(type, id, imageNo, 'image');
    const smallKey = keyFor(type, id, imageNo, 'small');
    files.push({
      image_no: imageNo,
      path: imageKey,
      small_path: smallKey,
      url: publicUrl(imageKey),
      small_url: publicUrl(smallKey),
    });
  }
  return files;
}

module.exports = {
  MAX_RESOURCE_ID,
  RESERVED_IMAGES_PER_ID,
  config,
  client,
  normalizeType,
  normalizeId,
  folderParts,
  localId,
  keyFor,
  publicUrl,
  putWebp,
  deleteKeys,
  health,
  imageFiles,
};
