import type { Request, Response, NextFunction } from 'express';
import type { Env } from '../../config/env.js';

export function internalAuthMiddleware(env: Env) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.header('x-internal-api-key');
    if (!key || key !== env.INTERNAL_API_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
