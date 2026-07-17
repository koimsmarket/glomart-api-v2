// GM_EVENT_ROUTE_V001
'use strict';

const express = require('express');
const router = express.Router();

function text(v){
  return v === undefined || v === null ? '' : String(v).trim();
}

function fail(res, status, message, extra){
  return res.status(status).json(Object.assign({ ok:false, error:message }, extra || {}));
}

/*
 * Unified event entry point.
 * Phase 1: external product search only.
 * Existing /api/gm/search/log remains as a compatibility endpoint, but both
 * paths execute the exact same search handler registered by services/search_log.js.
 * This prevents two separate counter implementations from running.
 */
router.post(['/api/gm/event', '/api/event'], async (req, res) => {
  const body = req.body || {};
  const eventType = text(body.event_type || body.eventType || body.type).toUpperCase();

  if (!eventType) {
    return fail(res, 400, 'event_type is required');
  }

  const handlers = req.app.locals.gmEventHandlers || {};
  const handler = handlers[eventType];

  if (!handler) {
    return fail(res, 400, 'unsupported event_type', {
      event_type: eventType,
      supported: Object.keys(handlers).sort()
    });
  }

  req.body = Object.assign({}, body, {
    event_type: eventType,
    event_source: text(body.event_source || body.eventSource || 'GM_EVENT')
  });

  return handler(req, res);
});

module.exports = router;
