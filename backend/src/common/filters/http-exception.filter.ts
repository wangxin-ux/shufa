import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { DomainError, ErrorDetails } from '../errors/domain-error';
import {
  ErrorCode,
  type ErrorCode as ErrorCodeType,
} from '../errors/error-codes';
import {
  REQUEST_ID_HEADER,
  type RequestIdContext,
} from '../request-id/request-id.middleware';

interface ErrorEnvelope {
  code: ErrorCodeType;
  message: string;
  requestId: string;
  details: ErrorDetails;
}

type RequestWithOptionalId = Request & Partial<RequestIdContext>;

const HTTP_STATUS_CODES: Partial<Record<number, ErrorCodeType>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.RESOURCE_NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ErrorCode.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};
const BAD_REQUEST_STATUS: number = HttpStatus.BAD_REQUEST;

function httpStatusErrorCode(statusCode: number): ErrorCodeType {
  const mappedCode = HTTP_STATUS_CODES[statusCode];
  if (mappedCode) {
    return mappedCode;
  }

  return statusCode >= 400 && statusCode < 500
    ? ErrorCode.BAD_REQUEST
    : ErrorCode.INTERNAL_SERVER_ERROR;
}

function exceptionType(exception: unknown): string {
  return exception instanceof Error ? exception.name : typeof exception;
}

function httpExceptionMessage(
  responseBody: string | Record<string, unknown>,
  statusCode: number,
): string {
  if (statusCode >= 500) {
    return 'Internal server error';
  }

  if (typeof responseBody === 'string') {
    return responseBody;
  }

  const message = responseBody.message;
  if (Array.isArray(message)) {
    return 'Validation failed';
  }

  return typeof message === 'string' ? message : 'Request failed';
}

function httpExceptionDetails(
  responseBody: string | Record<string, unknown>,
): ErrorDetails {
  if (typeof responseBody === 'string') {
    return {};
  }

  if (Array.isArray(responseBody.message)) {
    return { errors: responseBody.message };
  }

  return {};
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithOptionalId>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? randomUUID();

    if (!request.requestId) {
      response.setHeader(REQUEST_ID_HEADER, requestId);
    }

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let envelope: ErrorEnvelope = {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      requestId,
      details: {},
    };

    if (exception instanceof DomainError) {
      statusCode = exception.statusCode;
      envelope = {
        code: exception.code,
        message: exception.message,
        requestId,
        details: exception.details,
      };
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const responseBody = exception.getResponse();
      const normalizedBody =
        typeof responseBody === 'string'
          ? responseBody
          : (responseBody as Record<string, unknown>);
      const validationError =
        statusCode === BAD_REQUEST_STATUS &&
        typeof normalizedBody !== 'string' &&
        Array.isArray(normalizedBody.message);

      envelope = {
        code: validationError
          ? ErrorCode.VALIDATION_FAILED
          : httpStatusErrorCode(statusCode),
        message: httpExceptionMessage(normalizedBody, statusCode),
        requestId,
        details: httpExceptionDetails(normalizedBody),
      };
    }

    if (statusCode >= 500) {
      this.logger.error({
        requestId,
        statusCode,
        method: request.method,
        path: request.path,
        exceptionType: exceptionType(exception),
      });
      envelope = {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        requestId,
        details: {},
      };
    }

    response.status(statusCode).json(envelope);
  }
}
