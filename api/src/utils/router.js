import { Router } from 'express';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

function forwardRejections(handler) {
  // Error middleware (4 args) and non-function args (paths) pass through untouched.
  if (typeof handler !== 'function' || handler.length === 4) return handler;
  return function asyncSafeHandler(req, res, next) {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(next);
      return result;
    } catch (err) {
      return next(err);
    }
  };
}

/** Express 4 does not catch rejected async handlers; this router forwards them to `next`. */
export function createRouter() {
  const router = Router();
  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(forwardRejections));
  }
  return router;
}
