'use strict';
/*
 * GM_VECTOR_CLASSIFICATION_BUILD_V004
 *
 * 목적
 * - gm_product_image_vector.vector_image(원본 512차원)만 사용해 재생성 가능한 시각 분류 트리를 만든다.
 * - category_group은 "현재 학습에 포함할 상위 그룹" 선택용이다. 의미 분류 코드가 아니다.
 * - gm_vector_category와 class_id는 파생 데이터이며 언제든 다시 생성할 수 있다.
 *
 * 안전 원칙
 * 1) 기본은 DRY RUN. GM_VECTOR_CLASS_APPLY=1 일 때만 DB 반영.
 * 2) vector_image / candidate_vector / category_group은 절대 수정하지 않는다.
 * 3) APPLY는 트랜잭션 안에서 기존 파생 트리와 class_id를 교체한다.
 * 4) 현재 기본 범위는 FD. 향후 HS 완료 후 GM_VECTOR_CLASS_GROUPS=FD,HS 로 전체 재학습한다.
 *
 * 성능 보완(V004)
 * - V003은 각 노드에서 전체 벡터로 여러 회 k-means를 반복하여 6만~10만 건에서 지나치게 느릴 수 있었다.
 * - V004는 각 노드의 center 학습은 결정론적 표본(TRAIN_SAMPLE_MAX)으로 하고,
 *   최종 소속 배정과 cohesion 계산은 반드시 원본 512차원 전체 벡터로 수행한다.
 * - 즉 candidate_vector/ANN/축소벡터를 사용하지 않는다.
 * - 분류 결과의 각 노드 vector_center 역시 원본 512차원의 실제 평균 중심이다.
 */

const { Pool } = require('pg');

const DIM = 512;
const LEAF_MAX = Math.max(20, Number(process.env.GM_VECTOR_CLASS_LEAF_MAX || 100));
const MAX_DEPTH = Math.max(2, Number(process.env.GM_VECTOR_CLASS_MAX_DEPTH || 12));
const MAX_CHILDREN = Math.max(2, Math.min(1000, Number(process.env.GM_VECTOR_CLASS_MAX_CHILDREN || 1000)));
const ITER = Math.max(2, Math.min(12, Number(process.env.GM_VECTOR_CLASS_ITER || 4)));
const TRAIN_SAMPLE_MAX = Math.max(256, Number(process.env.GM_VECTOR_CLASS_TRAIN_SAMPLE_MAX || 1024));
const MIN_SPLIT_SIZE = Math.max(10, Number(process.env.GM_VECTOR_CLASS_MIN_SPLIT_SIZE || 40));
const COHESION_STOP = Math.max(-1, Math.min(1, Number(process.env.GM_VECTOR_CLASS_COHESION_STOP || 0.82)));
const MIN_SPLIT_GAIN = Math.max(0, Number(process.env.GM_VECTOR_CLASS_MIN_SPLIT_GAIN || 0.015));
const GROUPS = String(process.env.GM_VECTOR_CLASS_GROUPS || 'FD')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const APPLY = String(process.env.GM_VECTOR_CLASS_APPLY || '') === '1';

const pool = new Pool();

function norm(v) {
  let ss = 0;
  for (let i = 0; i < DIM; i++) ss += v[i] * v[i];
  const d = Math.sqrt(ss) || 1;
  const out = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) out[i] = v[i] / d;
  return out;
}

function dot(a, b) {
  let s = 0;
  // 단순 루프가 V8에서 가장 안정적이며 512차원 전체를 사용한다.
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
}

function mean(indices, vecs) {
  const c = new Float32Array(DIM);
  for (const ix of indices) {
    const v = vecs[ix];
    for (let d = 0; d < DIM; d++) c[d] += v[d];
  }
  if (indices.length) {
    const inv = 1 / indices.length;
    for (let d = 0; d < DIM; d++) c[d] *= inv;
  }
  return norm(c);
}

function cohesion(indices, vecs, center) {
  if (!indices.length) return 1;
  let s = 0;
  for (const ix of indices) s += dot(vecs[ix], center);
  return s / indices.length;
}

function splitK(n) {
  return Math.max(2, Math.min(MAX_CHILDREN, Math.ceil(Math.sqrt(Math.max(2, n) / LEAF_MAX))));
}

/*
 * 결정론적 균등 표본.
 * 랜덤 샘플링으로 실행마다 트리가 달라지지 않게 한다.
 */
function sampleIndices(indices, maxN) {
  if (indices.length <= maxN) return indices.slice();
  const out = new Array(maxN);
  const step = indices.length / maxN;
  for (let i = 0; i < maxN; i++) {
    out[i] = indices[Math.min(indices.length - 1, Math.floor((i + 0.5) * step))];
  }
  return out;
}

function seededCenters(train, vecs, k, seed) {
  let x = (seed >>> 0) || 1;
  const used = new Set();
  const centers = [];
  while (centers.length < k) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const ix = train[x % train.length];
    if (used.has(ix)) continue;
    used.add(ix);
    centers.push(Float32Array.from(vecs[ix]));
  }
  return centers;
}

/*
 * 표본으로 spherical k-means center를 학습한다.
 * 학습 데이터도 원본 512차원 벡터다.
 */
function trainCenters(indices, vecs, k, seed) {
  const train = sampleIndices(indices, TRAIN_SAMPLE_MAX);
  let centers = seededCenters(train, vecs, k, seed);
  const assign = new Int32Array(train.length);
  assign.fill(-1);

  for (let it = 0; it < ITER; it++) {
    const sums = Array.from({ length: k }, () => new Float32Array(DIM));
    const counts = new Int32Array(k);
    let changed = 0;

    for (let p = 0; p < train.length; p++) {
      const v = vecs[train[p]];
      let best = 0;
      let bestScore = -Infinity;

      for (let c = 0; c < k; c++) {
        const score = dot(v, centers[c]);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }

      if (assign[p] !== best) {
        assign[p] = best;
        changed++;
      }

      counts[best]++;
      const sum = sums[best];
      for (let d = 0; d < DIM; d++) sum[d] += v[d];
    }

    for (let c = 0; c < k; c++) {
      if (!counts[c]) {
        centers[c] = Float32Array.from(vecs[train[(c * 997 + it * 37) % train.length]]);
        continue;
      }
      const inv = 1 / counts[c];
      for (let d = 0; d < DIM; d++) sums[c][d] *= inv;
      centers[c] = norm(sums[c]);
    }

    if (!changed) break;
  }

  return centers;
}

/*
 * 중요한 단계:
 * 표본으로 center를 학습했더라도 모든 상품의 최종 child 선택은
 * 원본 512차원 벡터와 center의 cosine(dot)으로 정확히 수행한다.
 */
function assignAll(indices, vecs, centers) {
  const groups = Array.from({ length: centers.length }, () => []);
  for (const ix of indices) {
    const v = vecs[ix];
    let best = 0;
    let bestScore = -Infinity;
    for (let c = 0; c < centers.length; c++) {
      const score = dot(v, centers[c]);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    groups[best].push(ix);
  }
  return groups.filter(g => g.length);
}

function buildNode(indices, vecs, parent, childNo, depth, tree) {
  const id = ++tree.value;
  const started = Date.now();

  const center = mean(indices, vecs);
  const coh = cohesion(indices, vecs, center);

  const node = {
    tmp_id: id,
    parent_tmp_id: parent ? parent.tmp_id : null,
    child_no: childNo,
    depth,
    count: indices.length,
    center,
    cohesion: coh,
    leaf: false,
    indices: null
  };
  tree.nodes.push(node);

  const stopByDepth = depth >= MAX_DEPTH;
  const stopBySmall = indices.length < MIN_SPLIT_SIZE;
  const stopByGoodLeaf = indices.length <= LEAF_MAX && coh >= COHESION_STOP;

  if (stopByDepth || stopBySmall || stopByGoodLeaf) {
    node.leaf = true;
    node.indices = indices;
    tree.leafAssigned += indices.length;
    console.log('[GM_VECTOR_CLASS_NODE]', {
      id, depth, count: indices.length, cohesion: Number(coh.toFixed(4)),
      leaf: true, reason: stopByDepth ? 'MAX_DEPTH' : stopBySmall ? 'MIN_SPLIT_SIZE' : 'COHESION_STOP',
      elapsed_ms: Date.now() - started
    });
    return node;
  }

  const k = splitK(indices.length);
  const centers = trainCenters(indices, vecs, k, (id * 2654435761) >>> 0);
  const groups = assignAll(indices, vecs, centers);

  if (groups.length <= 1) {
    node.leaf = true;
    node.indices = indices;
    tree.leafAssigned += indices.length;
    console.log('[GM_VECTOR_CLASS_NODE]', {
      id, depth, count: indices.length, cohesion: Number(coh.toFixed(4)),
      leaf: true, reason: 'NO_EFFECTIVE_SPLIT', elapsed_ms: Date.now() - started
    });
    return node;
  }

  let childWeighted = 0;
  const groupStats = [];
  for (const g of groups) {
    const cc = mean(g, vecs);
    const gc = cohesion(g, vecs, cc);
    childWeighted += gc * g.length;
    groupStats.push({ group: g, cohesion: gc });
  }
  childWeighted /= indices.length;

  const gain = childWeighted - coh;
  if (indices.length <= LEAF_MAX && gain < MIN_SPLIT_GAIN) {
    node.leaf = true;
    node.indices = indices;
    tree.leafAssigned += indices.length;
    console.log('[GM_VECTOR_CLASS_NODE]', {
      id, depth, count: indices.length, cohesion: Number(coh.toFixed(4)),
      leaf: true, reason: 'LOW_SPLIT_GAIN', split_gain: Number(gain.toFixed(4)),
      elapsed_ms: Date.now() - started
    });
    return node;
  }

  groupStats.sort((a, b) => b.group.length - a.group.length);

  console.log('[GM_VECTOR_CLASS_NODE]', {
    id, depth, count: indices.length, cohesion: Number(coh.toFixed(4)),
    leaf: false, children: groupStats.length, split_gain: Number(gain.toFixed(4)),
    elapsed_ms: Date.now() - started
  });

  for (let i = 0; i < groupStats.length; i++) {
    buildNode(groupStats[i].group, vecs, node, i + 1, depth + 1, tree);
  }

  return node;
}

function pgArray(v) {
  return '{' + Array.from(v, x => Number(x).toPrecision(9)).join(',') + '}';
}

async function validateScope() {
  const q = await pool.query(`
    SELECT category_group, COUNT(*)::int AS n
      FROM gm_product_image_vector
     WHERE category_group = ANY($1::text[])
     GROUP BY category_group
     ORDER BY category_group
  `, [GROUPS]);
  return q.rows;
}

async function load() {
  const q = await pool.query(`
    SELECT product_uid, vector_image, category_group
      FROM gm_product_image_vector
     WHERE category_group = ANY($1::text[])
       AND vector_image IS NOT NULL
       AND array_length(vector_image,1) = 512
     ORDER BY product_uid
  `, [GROUPS]);

  const uids = [];
  const vecs = [];

  for (const r of q.rows) {
    const a = Array.isArray(r.vector_image) ? r.vector_image.map(Number) : null;
    if (!a || a.length !== DIM || a.some(x => !Number.isFinite(x))) continue;
    uids.push(r.product_uid);
    vecs.push(norm(a));
  }

  return { uids, vecs };
}

async function applyTree(tree, uids) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    /*
     * gm_vector_category/class_id는 파생 데이터이므로 전체 교체한다.
     * 원본 vector_image/category_group/candidate_vector에는 손대지 않는다.
     */
    await c.query(`UPDATE gm_product_image_vector SET class_id = NULL WHERE class_id IS NOT NULL`);
    await c.query(`DELETE FROM gm_vector_category`);

    const realId = new Map();

    // parent_id가 실제 DB id를 참조하므로 부모→자식 순서로 삽입한다.
    for (const n of tree.nodes) {
      const parent = n.parent_tmp_id ? realId.get(n.parent_tmp_id) : null;
      const r = await c.query(`
        INSERT INTO gm_vector_category
          (parent_id, child_no, vector_center, is_leaf, product_count)
        VALUES ($1, $2, $3::real[], $4, $5)
        RETURNING id
      `, [parent, n.child_no, pgArray(n.center), n.leaf, n.count]);

      realId.set(n.tmp_id, Number(r.rows[0].id));
    }

    const pairs = [];
    for (const n of tree.nodes) {
      if (!n.leaf || !n.indices) continue;
      const classId = realId.get(n.tmp_id);
      for (const ix of n.indices) pairs.push([uids[ix], classId]);
    }

    // class_id 연결은 set-based UNNEST batch.
    const BATCH = 10000;
    for (let i = 0; i < pairs.length; i += BATCH) {
      const p = pairs.slice(i, i + BATCH);
      await c.query(`
        UPDATE gm_product_image_vector v
           SET class_id = x.class_id
          FROM (
            SELECT *
              FROM UNNEST($1::text[], $2::bigint[])
                   AS t(product_uid, class_id)
          ) x
         WHERE v.product_uid = x.product_uid
      `, [p.map(x => x[0]), p.map(x => x[1])]);

      console.log('[GM_VECTOR_CLASS_APPLY_BATCH]', {
        done: Math.min(i + p.length, pairs.length),
        total: pairs.length
      });
    }

    await c.query('COMMIT');
    return { assigned: pairs.length, nodes: tree.nodes.length };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

(async () => {
  const totalStarted = Date.now();

  try {
    console.log('[GM_VECTOR_CLASS_BUILD_V004] START', {
      scope: GROUPS.join(','),
      apply: APPLY,
      leaf_max: LEAF_MAX,
      max_depth: MAX_DEPTH,
      min_split_size: MIN_SPLIT_SIZE,
      cohesion_stop: COHESION_STOP,
      min_split_gain: MIN_SPLIT_GAIN,
      iter: ITER,
      train_sample_max: TRAIN_SAMPLE_MAX
    });

    const scope = await validateScope();
    console.log('[GM_VECTOR_CLASS_BUILD_V004] PRODUCT_SCOPE', scope);

    const loadStarted = Date.now();
    const { uids, vecs } = await load();
    console.log('[GM_VECTOR_CLASS_BUILD_V004] LOADED', {
      vectors: vecs.length,
      elapsed_ms: Date.now() - loadStarted
    });

    if (!vecs.length) {
      throw new Error(
        'NO_VECTORS_IN_SCOPE: gm_product_image_vector.category_group must contain selected top-level codes, e.g. FD'
      );
    }

    const all = Array.from({ length: vecs.length }, (_, i) => i);
    const tree = { nodes: [], value: 0, leafAssigned: 0 };

    const buildStarted = Date.now();
    buildNode(all, vecs, null, 1, 0, tree);

    const leaves = tree.nodes.filter(n => n.leaf);
    const depths = leaves.map(n => n.depth);
    const sizes = leaves.map(n => n.count);

    const result = {
      vectors: vecs.length,
      nodes: tree.nodes.length,
      leaves: leaves.length,
      max_depth: Math.max(...depths),
      avg_leaf: Number((sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(2)),
      min_leaf: Math.min(...sizes),
      max_leaf: Math.max(...sizes),
      avg_leaf_cohesion: Number(
        (leaves.reduce((a, n) => a + n.cohesion, 0) / leaves.length).toFixed(4)
      ),
      assigned_check: tree.leafAssigned,
      build_elapsed_ms: Date.now() - buildStarted,
      total_elapsed_ms: Date.now() - totalStarted
    };

    if (tree.leafAssigned !== vecs.length) {
      throw new Error(`LEAF_ASSIGN_COUNT_MISMATCH: expected=${vecs.length} actual=${tree.leafAssigned}`);
    }

    console.log('[GM_VECTOR_CLASS_BUILD_V004] RESULT', result);

    if (!APPLY) {
      console.log(
        '[GM_VECTOR_CLASS_BUILD_V004] DRY_RUN_ONLY: review RESULT, then set GM_VECTOR_CLASS_APPLY=1'
      );
      return;
    }

    const applied = await applyTree(tree, uids);
    console.log('[GM_VECTOR_CLASS_BUILD_V004] APPLIED', applied);
    console.log('[GM_VECTOR_CLASS_BUILD_V004] COMPLETE', {
      total_elapsed_ms: Date.now() - totalStarted
    });
  } catch (e) {
    console.error('[GM_VECTOR_CLASS_BUILD_V004] FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
