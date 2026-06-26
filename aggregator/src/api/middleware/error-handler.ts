import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../infrastructure/logger/logger.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_error', details: err.flatten() });
    return;
  }

  logger.error({ err }, 'request error');
  res.status(500).json({ error: 'internal_error' });
}
