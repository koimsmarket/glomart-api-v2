(function () {
  'use strict';

  const API_BASE = 'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';
  const VERSION = 'glomart_detail_viewer_v1_0';

  function getKey() {
    const qs = new URLSearchParams(location.search);
    const fromQuery = qs.get('gm_key') || qs.get('key') || qs.get('coupangKey');
    if (fromQuery) return fromQuery.trim();

    const el = document.querySelector('[data-glomart-key], [data-coupang-key], #glomart-coupang-key');
    if (el) return (el.dataset.glomartKey || el.dataset.coupangKey || el.textContent || '').trim();

    const text = document.body.innerText || '';
    const m = text.match(/\b(\d{6,})_(\d{6,})_(\d{6,})\b/);
    return m ? m[0] : '';
  }

  function css() {
    if (document.getElementById('glomart-detail-viewer-style')) return;
    const style = document.createElement('style');
    style.id = 'glomart-detail-viewer-style';
    style.textContent = `
      #glomart-detail-viewer { margin:20px 0; padding:16px; border:1px solid #ddd; background:#fff; font-family:Arial,'Noto Sans KR',sans-serif; }
      #glomart-detail-viewer h3 { margin:0 0 12px; font-size:18px; }
      .gm-section { margin-top:18px; }
      .gm-section h4 { margin:0 0 8px; font-size:15px; }
      .gm-option { padding:8px 10px; border:1px solid #eee; margin:5px 0; background:#fafafa; }
      .gm-img-list { display:flex; flex-wrap:wrap; gap:8px; }
      .gm-img-list img { max-width:120px; max-height:120px; object-fit:cover; border:1px solid #eee; }
      .gm-detail-imgs img { display:block; max-width:100%; margin:8px auto; }
      .gm-muted { color:#777; font-size:13px; }
      .gm-warning { color:#b35b00; font-size:13px; }
    `;
    document.head.appendChild(style);
  }

  function makeBox() {
    let box = document.getElementById('glomart-detail-viewer');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'glomart-detail-viewer';

    const target = document.querySelector('.xans-product-detail, #contents, #content, .detailArea') || document.body;
    target.appendChild(box);
    return box;
  }

  function imgList(images, className) {
    if (!images || !images.length) return '<div class="gm-muted">등록된 이미지 없음</div>';
    return `<div class="${className}">` + images.map(src => `<img src="${escapeHtml(src)}" loading="lazy">`).join('') + '</div>';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  }

  function render(data) {
    const box = makeBox();
    const p = data.product || {};
    const opts = Array.isArray(p.options) ? p.options : [];
    const productImages = Array.isArray(p.productImages) ? p.productImages : [];
    const detailImages = Array.isArray(p.detailImages) ? p.detailImages : [];

    box.innerHTML = `
      <h3>Glomart 상세 정보</h3>
      <div class="gm-muted">${escapeHtml(data.key || '')}</div>
      ${data.found ? '' : '<div class="gm-warning">서버에 등록된 상세 데이터가 아직 없습니다. 기존 상품정보만 표시됩니다.</div>'}

      <div class="gm-section">
        <h4>옵션</h4>
        ${opts.length ? opts.map(o => `<div class="gm-option">${escapeHtml(o.name || '')} ${escapeHtml(o.value || '')} ${o.price != null ? ' / ' + escapeHtml(o.price) : ''} ${o.stock ? ' / ' + escapeHtml(o.stock) : ''}</div>`).join('') : '<div class="gm-muted">등록된 옵션 없음</div>'}
      </div>

      <div class="gm-section">
        <h4>추가 이미지</h4>
        ${imgList(productImages, 'gm-img-list')}
      </div>

      <div class="gm-section">
        <h4>상세 이미지</h4>
        ${imgList(detailImages, 'gm-detail-imgs')}
      </div>
    `;
  }

  async function run() {
    css();
    const key = getKey();
    if (!key) return;

    const box = makeBox();
    box.innerHTML = '<h3>Glomart 상세 정보</h3><div class="gm-muted">상세정보 불러오는 중...</div>';

    try {
      const res = await fetch(`${API_BASE}/product-detail?key=${encodeURIComponent(key)}`, { credentials: 'omit' });
      const data = await res.json();
      render(data);
    } catch (e) {
      box.innerHTML = '<h3>Glomart 상세 정보</h3><div class="gm-warning">상세정보를 불러오지 못했습니다.</div>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

