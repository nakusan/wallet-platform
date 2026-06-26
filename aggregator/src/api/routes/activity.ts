import { Router } from 'express';
import type Redis from 'ioredis';
import { authMiddleware } from '../middleware/auth.js';
import type { ActivityService } from '../../services/activity-service.js';

const addrSchema = /^0x[0-9a-fA-F]{40}$/;

export function activityRouter(service: ActivityService, redis: Redis): Router {
  const router = Router();

  router.get('/address/:addr/activity',
    authMiddleware(['read:tx'], redis),
    async (req, res, next) => {
      try {
        const addr = String(req.params.addr);
        if (!addrSchema.test(addr)) {
          res.status(400).json({ error: 'invalid_address' });
          return;
        }
        const chainIds = req.query.chainIds
          ? String(req.query.chainIds).split(',').map(Number).filter((n) => !Number.isNaN(n))
          : undefined;
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
        const types = req.query.types
          ? String(req.query.types).split(',').filter(Boolean)
          : undefined;
        const result = await service.getActivity(addr, { chainIds, limit, cursor, types });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
