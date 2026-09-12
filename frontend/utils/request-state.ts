export type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'empty'; data: T }
  | {
      status: 'error';
      message: string;
      statusCode?: number;
      code?: string;
      details?: Record<string, unknown>;
    };

export const idleRequestState = <T>(): RequestState<T> => ({ status: 'idle' });
export const loadingRequestState = <T>(): RequestState<T> => ({ status: 'loading' });

export async function loadRequestState<T>(
  loader: () => Promise<T>,
  isEmpty: (data: T) => boolean = () => false,
): Promise<RequestState<T>> {
  try {
    const data = await loader();
    return isEmpty(data) ? { status: 'empty', data } : { status: 'success', data };
  } catch (error) {
    const failure: Extract<RequestState<T>, { status: 'error' }> = {
      status: 'error',
      message: error instanceof Error ? error.message : '请求失败，请稍后重试',
    };
    if (typeof error === 'object' && error !== null) {
      const metadata = error as {
        statusCode?: unknown;
        code?: unknown;
        details?: unknown;
      };
      if (typeof metadata.statusCode === 'number') {
        failure.statusCode = metadata.statusCode;
      }
      if (typeof metadata.code === 'string') {
        failure.code = metadata.code;
      }
      if (
        typeof metadata.details === 'object' &&
        metadata.details !== null &&
        !Array.isArray(metadata.details)
      ) {
        failure.details = metadata.details as Record<string, unknown>;
      }
    }
    return failure;
  }
}
