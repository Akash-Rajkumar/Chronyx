import type { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './error.js';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new AppError('BAD_REQUEST', 'Validation failed', 400, error.errors));
      } else {
        next(error);
      }
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as unknown as Request['query'];
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new AppError('BAD_REQUEST', 'Query validation failed', 400, error.errors));
      } else {
        next(error);
      }
    }
  };
}
