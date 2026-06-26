import { Router } from 'express';
import type Redis from 'ioredis';
import { authMiddleware } from '../middleware/auth.js';
import type { NftsService } from '../../services/nfts-service.js';

const addrSchema = /^0x[0-9a-fA-F]{40}$/;

export function nftsRouter(service: NftsService, redis: Redis): Router {
  const router = Router();

  router.get('/address/:addr/nfts',
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
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
        const result = await service.getNfts(addr, { chainIds, limit, cursor });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
