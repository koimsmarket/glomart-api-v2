(function () {
  'use strict';

  const U = {
    log(...args) { console.log('[GMAO]', ...args); },
    warn(...args) { console.warn('[GMAO]', ...args); },
    err(...args) { console.error('[GMAO]', ...args); },
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
    tinyDelay() {
      const ss = new Date().getSeconds();
      const v = ss > 30 ? Math.floor(ss / 2) : ss;
      return v * 10;
    },
    async tick() { await U.sleep(U.tinyDelay()); },
    txt(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); },
    norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); },
    digits(s) { return String(s || '').replace(/[^0-9]/g, ''); },
    money(s) { const n = parseInt(U.digits(s), 10); return Number.isFinite(n) ? n : 0; },
    visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden';
    },
    click(el, label) {
      if (!el) throw new Error('click target missing: ' + label);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.click();
      U.log('clicked', label || U.txt(el));
    },
    input(el, value, label) {
      if (!el) throw new Error('input target missing: ' + label);
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = value == null ? '' : String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      U.log('input', label || el.name || el.id, value);
    },
    async waitFor(fn, opt = {}) {
      const timeout = opt.timeout || 10000;
      const interval = opt.interval || 120;
      const label = opt.label || 'condition';
      const start = Date.now();
      let last;
      while (Date.now() - start < timeout) {
        try {
          last = fn();
          if (last) return last;
        } catch (e) { last = e; }
        await U.sleep(interval);
      }
      throw new Error('wait timeout: ' + label);
    },
    qsAll(sel, root = document) { return Array.from(root.querySelectorAll(sel)); },
    findByText(selectors, texts, root = document) {
      const arr = Array.isArray(selectors) ? selectors.flatMap(s => U.qsAll(s, root)) : U.qsAll(selectors, root);
      const pats = Array.isArray(texts) ? texts : [texts];
      return arr.find(el => U.visible(el) && pats.some(t => U.txt(el).includes(t)));
    },
    goBlank() { location.href = 'about:blank'; }
  };

  window.GMAO_UTIL = U;
})();
