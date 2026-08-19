'use strict';

const express = require('express');
const router = express.Router();
const clients = require('../services/runtime_client_registry');
const works = require('../services/runtime_work_service');
const accounts = require('../services/account_service');

const VERSION = 'GM_AUTO_ORDER_CLIENT_RUNTIME_API_V014_ACCOUNT_VAULT';

function pool(req) {
  return req.app.locals.pool || req.app.locals.db;
}
function ok(res, data) {
  return res.json({ ok: true, version: VERSION, ...(data || {}) });
}
function fail(res, status, error, cause) {
  return res.status(status).json({
    ok: false,
    version: VERSION,
    error,
    detail: cause ? String(cause.message || cause) : undefined
  });
}

router.post('/api/auto-order/runtime/register', (req, res) => {
  try {
    return ok(res, {
      item: clients.register(
        req.body || {},
        req.headers['user-agent'] || ''
      )
    });
  } catch (error) {
    return fail(res, 400, 'register_failed', error);
  }
});

router.post('/api/auto-order/runtime/heartbeat', (req, res) => {
  try {
    return ok(res, {
      item: clients.heartbeat(req.body || {})
    });
  } catch (error) {
    return fail(res, 400, 'heartbeat_failed', error);
  }
});

router.get('/api/auto-order/runtime/ready', async (req, res) => {
  try {
    return ok(res, {
      items: await works.readyList(pool(req), req.query || {})
    });
  } catch (error) {
    return fail(res, 500, 'ready_list_failed', error);
  }
});

router.post('/api/auto-order/runtime/claim', async (req, res) => {
  try {
    const client = clients.get(req.body && req.body.client_id);

    if (!client || !client.online) {
      return ok(res, { job: null, reason: 'client_offline' });
    }
    if (!req.body.cpkr_ready) {
      return ok(res, { job: null, reason: 'client_not_ready' });
    }

    return ok(res, await works.claim(pool(req), req.body || {}));
  } catch (error) {
    return fail(res, 409, 'claim_failed', error);
  }
});

router.post(
  '/api/auto-order/runtime/work/:work_id/heartbeat',
  async (req, res) => {
    try {
      return ok(res, {
        item: await works.heartbeat(
          pool(req),
          req.params.work_id,
          req.body || {}
        )
      });
    } catch (error) {
      return fail(res, 409, 'work_heartbeat_failed', error);
    }
  }
);

router.post(
  '/api/auto-order/runtime/work/:work_id/release',
  async (req, res) => {
    try {
      return ok(res, {
        item: await works.release(
          pool(req),
          req.params.work_id,
          req.body || {}
        )
      });
    } catch (error) {
      return fail(res, 409, 'release_failed', error);
    }
  }
);

router.post(
  '/api/auto-order/runtime/work/:work_id/state',
  async (req, res) => {
    try {
      return ok(res, {
        item: await works.updateState(
          pool(req),
          req.params.work_id,
          req.body || {}
        )
      });
    } catch (error) {
      return fail(res, 409, 'state_update_failed', error);
    }
  }
);


/*
 * [STEP-UP AUTH CREDENTIAL]
 * 현재 RUNNING 작업의 lock_token/admin/mall_account가 모두 일치할 때만
 * 해당 실행계정의 복호화된 비밀번호를 Runner에 1회 응답한다.
 * 비밀번호는 로그에 절대 기록하지 않는다.
 */
router.post('/api/auto-order/runtime/work/:work_id/credential', async (req,res)=>{
  try{
    const credential=await accounts.credentialForLockedWork(pool(req),req.params.work_id,req.body||{});
    return ok(res,{credential});
  }catch(error){
    const m=String(error&&error.message||error);
    const status=(m==='work_not_found')?404:409;
    return fail(res,status,'credential_access_failed',error);
  }
});

router.get('/api/auto-order/runtime/status', async (req, res) => {
  try {
    return ok(res, {
      clients: clients.list(),
      ...(await works.status(pool(req)))
    });
  } catch (error) {
    return fail(res, 500, 'status_failed', error);
  }
});

console.log('[GM_AUTO_ORDER_CLIENT_RUNTIME_API_V014_ACCOUNT_VAULT] route loaded');
module.exports = router;
