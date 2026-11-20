import type { Request, Response, NextFunction } from 'express';
import type { ApiError } from '@chronyx/contracts';
import { logger } from '../logger.js';

export class AppError extends Error {
  public code: ApiError['error']['code'];
  public statusCode: number;
  public details?: unknown;

  constructor(
    code: ApiError['error']['code'],
    message: string,
    statusCode = 400,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function apiErrorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  logger.error(err, 'Unhandled error in request');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: err instanceof Error ? err.message : 'Internal Server Error',
    },
  });
}

