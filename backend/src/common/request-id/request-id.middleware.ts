import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface RequestIdContext {
  requestId: string;
}

type RequestWithId = Request & RequestIdContext;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction) {
    const suppliedRequestId = request.header(REQUEST_ID_HEADER)?.trim();
    const requestId =
      suppliedRequestId && REQUEST_ID_PATTERN.test(suppliedRequestId)
        ? suppliedRequestId
        : randomUUID();

    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
