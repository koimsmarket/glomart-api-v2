/* GM_SEARCH_RANKER_V002 | Search-only ranking and keyword exposure rotation.
 * NEVER use this module in collector, upsert, queue or image OCR paths.
 * rankResults remains a pure compatibility helper; recordShown is DB-backed. */
'use strict';
const VERSION = 'GM_SEARCH_RANKER_V002_KEYWORD_ROTATION';
function tokens(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}
function folded(s) { return tokens(s).join(''); }
function getTitle(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.product_name ?? item.productName ?? item.name ?? item.title ?? item.goods_name ?? '');
}
function relevance(query, title) {
  const q = tokens(query), t = tokens(title);
  if (!q.length || !t.length) return 0;
  const tq = q.join(''), tt = t.join('');
  if (tq === tt) return 100;
  if (tt.includes(tq)) return 92;
  // Match tokens in original order; each target token may be used only once.
  // Joined-form also recognizes spacing differences e.g. 옛날통닭 / 옛날 통닭.
  const used = new Set(); let hits=0, ordered=0, streak=0, best=0, prev=-1;
  for (const part of q) {
    let at=-1;
    for (let i=0;i<t.length;i++) {
      if (!used.has(i) && (t[i]===part || t[i].includes(part) || part.includes(t[i]))) { at=i;break; }
    }
    if(at>=0){used.add(at);hits++;if(at>prev){ordered++;streak=at===prev+1?streak+1:1;best=Math.max(best,streak);}else{streak=0;}prev=at;}
    else {streak=0;}
  }
  const coverage = hits/q.length;
  const order = hits>0?ordered/hits:0;
  const consecutive= best/q.length;
  const prefix=tt.startsWith(q[0])?1:0;
  const score=40*coverage+30*order*coverage+20*consecutive+10*prefix;
  return Math.max(0,Math.min(99,Math.round(score*100)/100));
}
function rankResults(keyword, items, options={}) {
  if (!Array.isArray(items)) return items;
  const sort = String(options.sort ?? 'relevance').toLowerCase();
  if (sort!=='relevance' && sort!=='default') return items;
  if (!keyword || items.length < 2) return items;
  try {
    return items.map((item,index)=>({item,index,score:relevance(keyword,getTitle(item))}))
      .sort((a,b)=>b.score-a.score || a.index-b.index).map(x=>x.item);
  } catch (_) { return items; }
}
// GM_PRODUCT_KEYWORD_INDEX_V003: one row per product+keyword; no keyword-only UNIQUE.
// The keyword is matched exactly to the separately indexed MAIN/SUB tokens.
// Only this ranking module chooses exposure order. Search routes merely execute its query.
function keywordRotationQuery(productCols, activeWhere) {
  return `SELECT ${productCols.split(',').map(c => 'p.' + c.trim()).join(',')}
` +
    `FROM gm_product_keyword_index k
` +
    `JOIN gm_product p ON p.product_uid = k.product_uid
` +
    `WHERE k.keyword=$1 AND p.mall_code=$2 AND ${activeWhere}
` +
    `  AND NOT (k.product_uid = ANY($4::text[]))\n` +
    `ORDER BY k.showed_at ASC NULLS FIRST, k.product_uid ASC
` +
    `LIMIT $3`;
}
// No implicit impression on search or pagination. Call only after a client has
// actually rendered the product cards, and only for the requested keyword.
async function recordShown(pool, searchKeyword, productUids) {
  const keyword=String(searchKeyword||'').trim();
  const uids=[...new Set((Array.isArray(productUids)?productUids:[])
    .map(v=>String(v||'').trim()).filter(Boolean))].slice(0,200);
  if(!keyword || !uids.length) return 0;
  const result=await pool.query(`UPDATE gm_product_keyword_index k
     SET showed_at=NOW()
     FROM gm_product p
     WHERE k.keyword=$1 AND k.product_uid=ANY($2::text[])
       AND p.product_uid=k.product_uid
       AND p.mall_code IN ('CPKR','ALKR')
       AND COALESCE(p.sale_status,'active')='active'
       AND COALESCE(p.soldout_yn,'N')<>'Y'`,[keyword,uids]);
  return result.rowCount||0;
}
module.exports={VERSION,rankResults,relevance,tokens,keywordRotationQuery,recordShown};
