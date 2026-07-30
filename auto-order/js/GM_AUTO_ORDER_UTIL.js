(function () {
  'use strict';

  const U = {
    VERSION: '002',
    log(...args) { console.log('[GMAO]', ...args); },
    warn(...args) { console.warn('[GMAO]', ...args); },
    err(...args) { console.error('[GMAO]', ...args); },
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
    tinyDelay() {
      const ss = new Date().getSeconds();
      const v = ss > 30 ? Math.floor(ss / 2) : ss;
      return v * 10; // 0~300ms: 사용자 확정 규칙
    },
    async tick() { await U.sleep(U.tinyDelay()); },
    txt(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); },
    norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); },
    digits(s) { return String(s || '').replace(/[^0-9]/g, ''); },
    money(s) { const n = parseInt(U.digits(s), 10); return Number.isFinite(n) ? n : 0; },
    visible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    },
    qsAll(sel, root = document) { return Array.from(root.querySelectorAll(sel)); },
    closest(el, sel) { return el && el.closest ? el.closest(sel) : null; },
    unique(arr) { return Array.from(new Set((arr || []).filter(Boolean))); },
    findByText(selectors, texts, root = document) {
      const nodes = Array.isArray(selectors) ? selectors.flatMap(s => U.qsAll(s, root)) : U.qsAll(selectors, root);
      const pats = Array.isArray(texts) ? texts : [texts];
      return nodes.find(el => U.visible(el) && pats.some(t => U.txt(el).includes(t)));
    },
    findButtonByText(texts, root = document) {
      const pats = Array.isArray(texts) ? texts : [texts];
      const nodes = U.qsAll('button,a,div[role="button"],span', root);
      for (const el of nodes) {
        if (!U.visible(el)) continue;
        if (!pats.some(t => U.txt(el).includes(t))) continue;
        const btn = U.closest(el, 'button,a,[role="button"]') || el;
        if (U.visible(btn)) return btn;
      }
      return null;
    },
    isDisabled(el) {
      if (!el) return true;
      return !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/.test(el.className || ''));
    },
    click(el, label) {
      if (!el) throw new Error('click target missing: ' + label);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.click();
      U.log('clicked', label || U.txt(el));
    },
    input(el, value, label) {
      if (!el) throw new Error('input target missing: ' + label);
      const v = value == null ? '' : String(value);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.focus();
      try {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter ? setter.call(el, '') : (el.value = '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        setter ? setter.call(el, v) : (el.value = v);
      } catch (e) {
        el.value = v;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      U.log('input', label || el.name || el.id, v);
    },
    async waitFor(fn, opt = {}) {
      const timeout = opt.timeout || 10000;
      const interval = opt.interval || 100;
      const label = opt.label || 'condition';
      const start = Date.now();
      let last;
      while (Date.now() - start < timeout) {
        try { last = fn(); if (last) return last; } catch (e) { last = e; }
        await U.sleep(interval);
      }
      throw new Error('wait timeout: ' + label);
    },
    async waitPageText(text, timeout = 10000) {
      return U.waitFor(() => U.txt(document.body).includes(text), { timeout, label: 'text ' + text });
    },
    async withAutoConfirm(work, label) {
      const oldConfirm = window.confirm;
      const oldAlert = window.alert;
      window.confirm = function (msg) { U.warn('auto confirm', label || '', msg); return true; };
      window.alert = function (msg) { U.warn('auto alert ignored', label || '', msg); return true; };
      try { return await work(); }
      finally { window.confirm = oldConfirm; window.alert = oldAlert; }
    },
    goBlank() { location.href = 'about:blank'; }
  };

  window.GMAO_UTIL = U;
})();
