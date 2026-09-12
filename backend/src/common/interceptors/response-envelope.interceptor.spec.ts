import { StreamableFile } from '@nestjs/common';
import { createResponseEnvelope } from './response-envelope.interceptor';

describe('createResponseEnvelope', () => {
  it('wraps a regular response with its request ID', () => {
    expect(createResponseEnvelope({ status: 'ok' }, 'request-1')).toEqual({
      data: { status: 'ok' },
      requestId: 'request-1',
    });
  });

  it('preserves a file response without wrapping it', () => {
    const file = new StreamableFile(Buffer.from('download'));

    expect(createResponseEnvelope(file, 'request-file')).toBe(file);
  });

  it('promotes pagination metadata from a paginated result', () => {
    const meta = {
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    };

    expect(
      createResponseEnvelope(
        { data: [{ id: 'student-1' }], meta },
        'request-2',
      ),
    ).toEqual({
      data: [{ id: 'student-1' }],
      meta,
      requestId: 'request-2',
    });
  });

  it.each([
    {
      label: 'an extra top-level field',
      payload: {
        data: [],
        meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        summary: 'must not be dropped',
      },
    },
    {
      label: 'an extra metadata field',
      payload: {
        data: [],
        meta: {
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
          cursor: 'unexpected',
        },
      },
    },
    {
      label: 'a page size above the contract maximum',
      payload: {
        data: [],
        meta: { page: 1, pageSize: 101, total: 0, totalPages: 0 },
      },
    },
  ])('preserves a regular payload with $label', ({ payload }) => {
    expect(createResponseEnvelope(payload, 'request-3')).toEqual({
      data: payload,
      requestId: 'request-3',
    });
  });
});
