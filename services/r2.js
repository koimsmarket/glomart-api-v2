'use strict';
const crypto = require('crypto');

/* GM_R2_STORAGE_RULE_V002
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
 * - 파일명 식별번호: 실제 ID 끝 4자리(0000~9999)
 * - 폴더가 ID 구간을 분리하므로 10,000 이후 같은 끝 4자리가 나와도 키 충돌은 없다.
 * - 이미지 순번: 01~10
 * - Space 원본: si0001_01.webp / 축소: ss0001_01.webp
 * - Template 원본: ti0001_01.webp / 축소: ts0001_01.webp
 * - 예: ID 1 -> 0001, ID 1000 -> 1000, ID 10000 -> 0000
 *
 * 이 주석과 계산 함수는 서버/R2/관리자 화면에서 공통 규격으로 유지한다.
 */

const {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');

const MAX_RESOURCE_ID = 100000000000;
const RESERVED_IMAGES_PER_ID = 10;
const CURRENT_UI_IMAGE_LIMIT = 5;

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

function fileIdSuffix(id) {
  // 파일명에는 실제 DB ID의 끝 4자리를 그대로 사용한다.
  // 폴더 경로가 100개 단위로 분리되므로 ID 1과 10001의 suffix가 같아도 전체 R2 key는 다르다.
  return String(normalizeId(id) % 10000).padStart(4, '0');
}

// 기존 호출부/외부 참조 호환용 별칭. 반환 규칙은 V002부터 4자리이다.
function localId(id) {
  return fileIdSuffix(id);
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
  const file = `${first}${second}${fileIdSuffix(id)}_${String(number).padStart(2, '0')}.webp`;
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



function encodeCopySource(bucket, key) {
  return `${bucket}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
}

async function copyObject(sourceKey, targetKey, cacheControl = 'public, max-age=31536000, immutable') {
  const c = config();
  await client().send(new CopyObjectCommand({
    Bucket: c.bucket,
    Key: targetKey,
    CopySource: encodeCopySource(c.bucket, sourceKey),
    ContentType: 'image/webp',
    CacheControl: cacheControl,
    MetadataDirective: 'REPLACE',
  }));
  return { key: targetKey, url: publicUrl(targetKey) };
}

function tempKey(requestId, group, size, imageNo) {
  const safeRequest = clean(requestId).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeRequest) throw new Error('request_id required');
  if (!['stage', 'backup'].includes(group)) throw new Error('temp group invalid');
  if (!['image', 'small'].includes(size)) throw new Error('temp size invalid');
  const number = Number(imageNo);
  if (!Number.isInteger(number) || number < 1 || number > RESERVED_IMAGES_PER_ID) {
    throw new Error(`image_no must be 1~${RESERVED_IMAGES_PER_ID}`);
  }
  return `temp/edit/${safeRequest}/${group}/${size}/${String(number).padStart(2, '0')}.webp`;
}

function normalizeImagePlan(plan, maxFinalImages = CURRENT_UI_IMAGE_LIMIT) {
  if (!Array.isArray(plan)) throw new Error('images manifest must be an array');
  if (plan.length > maxFinalImages) throw new Error(`현재 화면에서는 최대 ${maxFinalImages}장까지 저장할 수 있습니다.`);
  const usedSourceSlots = new Set();
  return plan.map((raw, index) => {
    const row = raw || {};
    const type = clean(row.type).toLowerCase();
    const finalSlot = index + 1;
    if (type === 'existing') {
      const sourceSlot = Number(row.source_slot ?? row.sourceSlot);
      if (!Number.isInteger(sourceSlot) || sourceSlot < 1 || sourceSlot > RESERVED_IMAGES_PER_ID) {
        throw new Error(`existing source_slot must be 1~${RESERVED_IMAGES_PER_ID}`);
      }
      if (usedSourceSlots.has(sourceSlot)) throw new Error('동일한 기존 이미지를 두 번 사용할 수 없습니다.');
      usedSourceSlots.add(sourceSlot);
      return { type, sourceSlot, finalSlot };
    }
    if (type === 'new') {
      const fileIndex = Number(row.file_index ?? row.fileIndex);
      if (!Number.isInteger(fileIndex) || fileIndex < 0) throw new Error('new file_index invalid');
      return { type, fileIndex, finalSlot };
    }
    throw new Error('image type must be existing or new');
  });
}

/*
 * GM_R2_IMAGE_REORDER_V001
 * - 내부 알고리즘은 슬롯 01~10을 영구 지원한다.
 * - 현재 UI/API 제한은 5장이다(CURRENT_UI_IMAGE_LIMIT).
 * - 화면의 최종 배열이 정답이며 중간 빈 슬롯을 허용하지 않는다.
 * - 기존 파일의 이동은 R2 내부 Copy, 새 파일은 stage 업로드 후 Copy한다.
 * - image/small은 항상 한 쌍으로 처리한다.
 * - 실패 시 backup에서 기존 01~oldCount를 복구한다.
 */
async function applyImagePlan({ type, id, oldCount, plan, newFiles, requestId }) {
  const resourceType = normalizeType(type);
  const resourceId = normalizeId(id);
  const previousCount = Math.max(0, Math.min(RESERVED_IMAGES_PER_ID, Number(oldCount) || 0));
  const normalizedPlan = normalizeImagePlan(plan, CURRENT_UI_IMAGE_LIMIT);
  const buffers = Array.isArray(newFiles) ? newFiles : [];
  const tempKeys = [];
  let backupReady = false;

  try {
    // 1) 기존 최종 상태 전체 백업. 이후 어떤 순서 변경/덮어쓰기에도 복구 가능하다.
    for (let slot = 1; slot <= previousCount; slot += 1) {
      for (const size of ['image', 'small']) {
        const source = keyFor(resourceType, resourceId, slot, size);
        const backup = tempKey(requestId, 'backup', size, slot);
        await copyObject(source, backup);
        tempKeys.push(backup);
      }
    }
    backupReady = true;

    // 2) 최종 배열을 stage 01~N으로 만든다.
    for (const item of normalizedPlan) {
      for (const size of ['image', 'small']) {
        const stage = tempKey(requestId, 'stage', size, item.finalSlot);
        if (item.type === 'existing') {
          const source = keyFor(resourceType, resourceId, item.sourceSlot, size);
          await copyObject(source, stage);
        } else {
          const file = buffers[item.fileIndex];
          if (!file || !file[size]) throw new Error(`new image file_index ${item.fileIndex} is missing`);
          await putWebp(stage, file[size], 'private, max-age=0, no-store');
        }
        tempKeys.push(stage);
      }
    }

    // 3) stage를 최종 01~N에 배치한다.
    for (let slot = 1; slot <= normalizedPlan.length; slot += 1) {
      for (const size of ['image', 'small']) {
        await copyObject(tempKey(requestId, 'stage', size, slot), keyFor(resourceType, resourceId, slot, size));
      }
    }

    // 4) N+1~10을 모두 정리하여 항상 01~image_count 연속 규칙을 보장한다.
    const stale = [];
    for (let slot = normalizedPlan.length + 1; slot <= RESERVED_IMAGES_PER_ID; slot += 1) {
      stale.push(keyFor(resourceType, resourceId, slot, 'image'));
      stale.push(keyFor(resourceType, resourceId, slot, 'small'));
    }
    await deleteKeys(stale);

    return {
      image_count: normalizedPlan.length,
      images: imageFiles(resourceType, resourceId, normalizedPlan.length),
      operations: normalizedPlan.map(item => ({
        final_slot: item.finalSlot,
        action: item.type === 'existing' ? (item.sourceSlot === item.finalSlot ? 'keep' : 'copy') : 'upload',
        source_slot: item.type === 'existing' ? item.sourceSlot : null,
      })),
    };
  } catch (error) {
    // 최종 배치 중 실패했다면 기존 상태로 복구한다.
    if (backupReady) {
      try {
        for (let slot = 1; slot <= previousCount; slot += 1) {
          for (const size of ['image', 'small']) {
            await copyObject(tempKey(requestId, 'backup', size, slot), keyFor(resourceType, resourceId, slot, size));
          }
        }
        const removeNew = [];
        for (let slot = previousCount + 1; slot <= RESERVED_IMAGES_PER_ID; slot += 1) {
          removeNew.push(keyFor(resourceType, resourceId, slot, 'image'));
          removeNew.push(keyFor(resourceType, resourceId, slot, 'small'));
        }
        await deleteKeys(removeNew);
      } catch (restoreError) {
        error.restore_error = String(restoreError && restoreError.message || restoreError);
      }
    }
    throw error;
  } finally {
    try { await deleteKeys(tempKeys); } catch (_) { /* temp는 lifecycle 정리도 가능 */ }
  }
}


function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}
function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}
function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
function presignedPutUrl(key, expiresSeconds = 600) {
  const c = config();
  const endpoint = new URL(c.endpoint);
  // R2 S3 presigned URLs use virtual-hosted style: <bucket>.<account>.r2.cloudflarestorage.com/<key>.
  // This keeps the signed host/path identical to Cloudflare's documented S3 endpoint behavior.
  const signedHost = `${c.bucket}.${endpoint.host}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const canonicalUri = '/' + String(key).split('/').map(awsEncode).join('/');
  const signedHeaders = 'content-type;host';
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.max(60, Math.min(3600, Number(expiresSeconds) || 600))),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(params).sort().map(k => `${awsEncode(k)}=${awsEncode(params[k])}`).join('&');
  const canonicalHeaders = `content-type:image/webp\nhost:${signedHost}\n`;
  const canonicalRequest = ['PUT', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(Buffer.from('AWS4' + c.secretAccessKey, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  return `${endpoint.protocol}//${signedHost}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function headObject(key) {
  const c = config();
  const out = await client().send(new HeadObjectCommand({ Bucket: c.bucket, Key: key }));
  return {
    key,
    content_length: Number(out.ContentLength || 0),
    content_type: String(out.ContentType || ''),
    etag: String(out.ETag || '').replace(/\"/g, ''),
  };
}

function prepareDirectUpload({ type, id, plan, requestId, expiresSeconds = 600 }) {
  normalizeType(type); normalizeId(id);
  const normalizedPlan = normalizeImagePlan(plan, CURRENT_UI_IMAGE_LIMIT);
  const uploads = [];
  for (const item of normalizedPlan) {
    if (item.type !== 'new') continue;
    for (const size of ['image', 'small']) {
      const key = tempKey(requestId, 'stage', size, item.finalSlot);
      uploads.push({
        final_slot: item.finalSlot,
        file_index: item.fileIndex,
        size,
        key,
        put_url: presignedPutUrl(key, expiresSeconds),
        content_type: 'image/webp',
        signed_headers: 'content-type;host',
      });
    }
  }
  return { request_id: requestId, expires_in: expiresSeconds, plan: normalizedPlan, uploads };
}

async function applyPreparedImagePlan({ type, id, oldCount, plan, requestId }) {
  const resourceType = normalizeType(type);
  const resourceId = normalizeId(id);
  const previousCount = Math.max(0, Math.min(RESERVED_IMAGES_PER_ID, Number(oldCount) || 0));
  const normalizedPlan = normalizeImagePlan(plan, CURRENT_UI_IMAGE_LIMIT);
  const tempKeys = [];
  const totalStartedAt = Date.now();
  const timings = {};

  // Only slots whose final contents actually change need backup/stage/final copy.
  // This makes the common "append one image" path touch only the new slot.
  const changedItems = normalizedPlan.filter(item =>
    item.type === 'new' || item.sourceSlot !== item.finalSlot
  );
  const changedFinalSlots = new Set(changedItems.map(item => item.finalSlot));
  const backupSlots = Array.from(changedFinalSlots)
    .filter(slot => slot <= previousCount)
    .sort((a, b) => a - b);

  let backupReady = false;
  try {
    let phaseAt = Date.now();
    const newItems = normalizedPlan.filter(item => item.type === 'new');
    await Promise.all(newItems.flatMap(item => ['image', 'small'].map(async size => {
      const meta = await headObject(tempKey(requestId, 'stage', size, item.finalSlot));
      const isImage = size === 'image';
      const maxBytes = isImage ? 320 * 1024 : 120 * 1024;
      const limitText = isImage ? '300KB' : '100KB';
      const label = isImage ? '원본용' : '목록용';
      if (meta.content_length < 1 || meta.content_length > maxBytes) {
        throw new Error(`이미지 ${item.finalSlot} ${label} 파일은 ${limitText} 이하여야 합니다.`);
      }
      if (meta.content_type && !/^image\/webp/i.test(meta.content_type)) {
        throw new Error(`이미지 ${item.finalSlot} ${label} 파일이 WebP가 아닙니다.`);
      }
      tempKeys.push(meta.key);
    })));
    timings.verify_ms = Date.now() - phaseAt;

    phaseAt = Date.now();
    await Promise.all(backupSlots.flatMap(slot => ['image', 'small'].map(async size => {
      const backup = tempKey(requestId, 'backup', size, slot);
      await copyObject(keyFor(resourceType, resourceId, slot, size), backup);
      tempKeys.push(backup);
    })));
    backupReady = true;
    timings.backup_ms = Date.now() - phaseAt;

    // Copy changed existing sources to temporary stage before any final slot is overwritten.
    phaseAt = Date.now();
    const movedExisting = changedItems.filter(item => item.type === 'existing');
    await Promise.all(movedExisting.flatMap(item => ['image', 'small'].map(async size => {
      const stage = tempKey(requestId, 'stage', size, item.finalSlot);
      await copyObject(
        keyFor(resourceType, resourceId, item.sourceSlot, size),
        stage,
        'private, max-age=0, no-store'
      );
      tempKeys.push(stage);
    })));
    timings.stage_existing_ms = Date.now() - phaseAt;

    // Commit only changed/new slots. Unchanged existing slots remain in place.
    phaseAt = Date.now();
    await Promise.all(changedItems.flatMap(item => ['image', 'small'].map(size =>
      copyObject(
        tempKey(requestId, 'stage', size, item.finalSlot),
        keyFor(resourceType, resourceId, item.finalSlot, size)
      )
    )));
    timings.commit_changed_ms = Date.now() - phaseAt;

    phaseAt = Date.now();
    const stale = [];
    for (let slot = normalizedPlan.length + 1; slot <= RESERVED_IMAGES_PER_ID; slot += 1) {
      stale.push(
        keyFor(resourceType, resourceId, slot, 'image'),
        keyFor(resourceType, resourceId, slot, 'small')
      );
    }
    await deleteKeys(stale);
    timings.delete_stale_ms = Date.now() - phaseAt;
    timings.total_ms = Date.now() - totalStartedAt;

    console.log('[SMARTFIT_IMAGE_COMMIT_TIMING_V046]', {
      resource_type: resourceType,
      resource_id: resourceId,
      previous_count: previousCount,
      final_count: normalizedPlan.length,
      changed_slots: Array.from(changedFinalSlots).sort((a, b) => a - b),
      backup_slots: backupSlots,
      ...timings,
    });

    return {
      image_count: normalizedPlan.length,
      images: imageFiles(resourceType, resourceId, normalizedPlan.length),
      operations: normalizedPlan.map(item => ({
        final_slot: item.finalSlot,
        action: item.type === 'existing'
          ? (item.sourceSlot === item.finalSlot ? 'keep' : 'copy')
          : 'direct_upload',
        source_slot: item.type === 'existing' ? item.sourceSlot : null,
      })),
      timings,
    };
  } catch (error) {
    if (backupReady && backupSlots.length) {
      try {
        await Promise.all(backupSlots.flatMap(slot => ['image', 'small'].map(size =>
          copyObject(
            tempKey(requestId, 'backup', size, slot),
            keyFor(resourceType, resourceId, slot, size)
          )
        )));
      } catch (restoreError) {
        error.restore_error = String(restoreError && restoreError.message || restoreError);
      }
    }
    throw error;
  } finally {
    // Temp cleanup does not affect the committed result, so do not block the user response.
    if (tempKeys.length) {
      void deleteKeys(tempKeys).catch(error => {
        console.warn('[SMARTFIT_IMAGE_TEMP_CLEANUP_ERROR_V046]', {
          resource_type: resourceType,
          resource_id: resourceId,
          request_id: requestId,
          count: tempKeys.length,
          error: String(error && error.message || error),
        });
      });
    }
  }
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
  CURRENT_UI_IMAGE_LIMIT,
  config,
  client,
  normalizeType,
  normalizeId,
  folderParts,
  fileIdSuffix,
  localId,
  keyFor,
  publicUrl,
  putWebp,
  copyObject,
  deleteKeys,
  tempKey,
  normalizeImagePlan,
  applyImagePlan,
  health,
  imageFiles,
  presignedPutUrl,
  headObject,
  prepareDirectUpload,
  applyPreparedImagePlan,
};
