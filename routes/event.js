// GM_EVENT_ROUTE_V001_SEARCH_FIRST
'use strict';

const express = require('express');
const router = express.Router();

function clean(v){ return v == null ? '' : String(v).trim(); }
function eventType(body){ return clean(body && (body.event_type || body.eventType || body.type)).toUpperCase(); }

router.post('/api/gm/event', async (req, res) => {
  const type = eventType(req.body || {});
  if (!type) return res.status(400).json({ ok:false, error:'event_type is required' });

  const handlers = req.app.locals.gmEventHandlers || {};
  const handler = handlers[type];
  if (!handler) {
    return res.status(400).json({
      ok:false,
      error:'unsupported event_type',
      event_type:type,
      supported:Object.keys(handlers).sort()
    });
  }
  return handler(req, res);
});

// Deprecated compatibility endpoint. No product counter is updated here.
// Existing mobile callers can remain temporarily without causing duplicate counts.
router.post(['/api/gm/product/event','/api/product/event'], (req, res) => {
  res.json({
    ok:true,
    deprecated:true,
    skipped:true,
    action:'product.event.disabled',
    event_type:eventType(req.body || {}),
    message:'Product event counters are disabled and will be migrated into /api/gm/event.'
  });
});

module.exports = router;
