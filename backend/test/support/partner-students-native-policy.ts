export interface StudentNativeScope {
  partnerId: string;
  loginCode: string;
  studentIds: string[];
}

interface StudentNativeRequest {
  method: string;
  path: string;
  actorId?: string;
  body?: unknown;
}

export function allowStudentNativeRequest(
  scope: StudentNativeScope,
  { method, path, actorId, body }: StudentNativeRequest,
): boolean {
  if (method === 'POST' && path === '/auth/login') {
    return Boolean(
      scope.loginCode &&
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1 &&
      'code' in body &&
      body.code === scope.loginCode,
    );
  }
  if (!scope.partnerId || actorId !== scope.partnerId || method !== 'GET')
    return false;
  if (
    [
      '/me',
      '/partners/me/profile',
      '/partners/me/subjects',
      '/partners/me/students',
    ].includes(path)
  )
    return true;
  return scope.studentIds.some((id) => path === `/partners/me/students/${id}`);
}
