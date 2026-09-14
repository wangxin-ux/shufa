import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { RequestIdContext } from '../request-id/request-id.middleware';

export interface ResponseEnvelope<T> {
  data: T;
  requestId: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T;
  meta: PaginationMeta;
}

export interface PaginatedResponseEnvelope<T> extends ResponseEnvelope<T> {
  meta: PaginationMeta;
}

type RequestWithId = Request & RequestIdContext;
const PAGINATION_META_KEYS = [
  'page',
  'pageSize',
  'total',
  'totalPages',
] as const;

function isPaginationMeta(value: unknown): value is PaginationMeta {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== PAGINATION_META_KEYS.length ||
    !PAGINATION_META_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return false;
  }

  const meta = value as Partial<PaginationMeta>;
  return (
    Number.isInteger(meta.page) &&
    Number.isInteger(meta.pageSize) &&
    Number.isInteger(meta.total) &&
    Number.isInteger(meta.totalPages) &&
    (meta.page ?? 0) >= 1 &&
    (meta.pageSize ?? 0) >= 1 &&
    (meta.pageSize ?? 101) <= 100 &&
    (meta.total ?? -1) >= 0 &&
    (meta.totalPages ?? -1) >= 0
  );
}

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'data') ||
    !Object.hasOwn(value, 'meta')
  ) {
    return false;
  }

  const result = value as Partial<PaginatedResult<unknown>>;
  return isPaginationMeta(result.meta);
}

export function createResponseEnvelope<T>(
  payload: T,
  requestId: string,
): ResponseEnvelope<T> | PaginatedResponseEnvelope<unknown> | StreamableFile {
  if (payload instanceof StreamableFile) {
    return payload;
  }

  if (isPaginatedResult(payload)) {
    return {
      data: payload.data,
      meta: payload.meta,
      requestId,
    };
  }

  return { data: payload, requestId };
}

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ResponseEnvelope<T> | PaginatedResponseEnvelope<unknown> | StreamableFile
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<
    ResponseEnvelope<T> | PaginatedResponseEnvelope<unknown> | StreamableFile
  > {
    const request = context.switchToHttp().getRequest<RequestWithId>();

    return next
      .handle()
      .pipe(map((data) => createResponseEnvelope(data, request.requestId)));
  }
}
