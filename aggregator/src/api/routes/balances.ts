import { Router } from 'express';
import type Redis from 'ioredis';
import { authMiddleware } from '../middleware/auth.js';
import type { BalancesService } from '../../services/balances-service.js';

const addrSchema = /^0x[0-9a-fA-F]{40}$/;

export function balancesRouter(service: BalancesService, redis: Redis): Router {
  const router = Router();

  router.get('/address/:addr/balances',
    authMiddleware(['read:balance'], redis),
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
        const withPricing = req.query.withPricing === 'true' || req.query.withPricing === '1';
        const result = await service.getBalances(addr, chainIds, withPricing);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
