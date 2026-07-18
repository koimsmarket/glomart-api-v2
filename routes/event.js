// EVENT_ROUTE_V012_DETAIL_QUEUE_SAFE
'use strict';

const express = require('express');
const router = express.Router();

function clean(v){ return v == null ? '' : String(v).trim(); }
function eventType(body){
  return clean(body && (body.event_type || body.eventType || body.type || body.action))
    .toUpperCase()
    .replace(/[.\-\s]+/g, '_');
}

const SEARCH_SIGNAL_TYPES = new Set([
  'SEARCH', 'SEARCH_START', 'SEARCH_BEGIN', 'SEARCH_ROUTE_DONE',
  'SEARCH_REQUEST', 'SEARCH_OPEN', 'SEARCH_COMPLETE'
]);
const DETAIL_TYPES = new Set([
  'DETAIL', 'VIEW', 'DETAIL_VIEW', 'DETAIL_OPEN', 'PRODUCT_DETAIL',
  'PRODUCT_VIEW', 'SEARCH_DETAIL'
]);

router.post('/api/gm/event', async (req, res) => {
  const body = req.body || {};
  const type = eventType(body);
  if (!type) return res.status(400).json({ ok:false, error:'event_type is required' });

  // Search counting remains owned by /api/gm/search/log.
  // Runtime search-start signals are acknowledged only, so one search is never counted twice.
  if (SEARCH_SIGNAL_TYPES.has(type) && type !== 'SEARCH_DETAIL') {
    return res.json({
      ok:true,
      action:'event.search.signal',
      event_type:type,
      counted:false,
      search_counter_owner:'/api/gm/search/log'
    });
  }

  if (DETAIL_TYPES.has(type)) {
    const service = req.app.locals.eventService;
    if (!service || typeof service.applyDetail !== 'function') {
      return res.status(503).json({ ok:false, error:'event detail service is not ready' });
    }
    try {
      const result = await service.applyDetail(body);
      if (!result || !result.updated) {
        const queue = req.app.locals.eventQueue;
        let queued = { queued:false, reason:'event_queue_not_ready' };
        if (queue && typeof queue.enqueueDetailView === 'function') {
          try { queued = await queue.enqueueDetailView(body); }
          catch (queueError) {
            console.error('[EVENT_DETAIL_QUEUE_SKIP]', String(queueError && queueError.message || queueError));
            queued = { queued:false, reason:'queue_error' };
          }
        }
        return res.json({ ok:true, action:'event.detail.deferred', event_type:type, counted:false, result:result || null, queue:queued });
      }
      return res.json({ ok:true, action:'event.detail', event_type:type, counted:true, ...result });
    } catch (error) {
      console.error('[EVENT_DETAIL_ERROR]', String(error && error.message || error));
      return res.status(500).json({ ok:false, error:'detail event failed', detail:String(error && error.message || error) });
    }
  }

  const handlers = req.app.locals.gmEventHandlers || {};
  const handler = handlers[type];
  if (handler) return handler(req, res);

  return res.status(400).json({
    ok:false,
    error:'unsupported event_type',
    event_type:type,
    supported:[...new Set([...Object.keys(handlers), ...SEARCH_SIGNAL_TYPES, ...DETAIL_TYPES])].sort()
  });
});

// Old product-event endpoint remains disabled to prevent duplicate counters.
router.post(['/api/gm/product/event','/api/product/event'], (req, res) => {
  res.json({
    ok:true,
    deprecated:true,
    skipped:true,
    counted:false,
    action:'product.event.disabled',
    event_type:eventType(req.body || {})
  });
});

module.exports = router;
