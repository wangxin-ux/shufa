export interface SubjectNativeScope {
  adminId: string;
  partnerId: string;
  campusId: string;
  subjectId: string;
  packageId: string;
  adminLogin: string;
  partnerLogin: string;
  renamedSubject: string;
  bindingReason: string;
}

export interface SubjectNativeRequest {
  method: string;
  path: string;
  actorId?: string;
  body?: unknown;
}

export function allowSubjectNativeRequest(
  scope: SubjectNativeScope,
  request: SubjectNativeRequest,
): boolean {
  const { method, path, actorId, body } = request;
  const exact = (expected: Record<string, unknown>) =>
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, value]) => (body as Record<string, unknown>)[key] === value,
    );
  if (method === 'POST' && path === '/auth/login')
    return (
      exact({ code: scope.adminLogin }) || exact({ code: scope.partnerLogin })
    );
  const root = `/management/campuses/${scope.campusId}`;
  if (actorId === scope.adminId) {
    if (method === 'GET')
      return [root, `${root}/subjects`, `${root}/subjects/links`].includes(
        path,
      );
    if (method === 'PATCH') {
      if (path === `${root}/subjects/${scope.subjectId}`)
        return exact({
          name: scope.renamedSubject,
          isActive: true,
          expectedVersion: 1,
        });
      if (path === `${root}/subjects/links/PACKAGE/${scope.packageId}`)
        return exact({
          subjectId: scope.subjectId,
          expectedVersion: 1,
          reason: scope.bindingReason,
        });
    }
  }
  if (actorId === scope.partnerId && method === 'GET')
    return [
      'profile',
      'subjects',
      'lesson-account',
      'earnings',
      'earnings/summary',
    ].some((suffix) => path === `/partners/me/${suffix}`);
  return false;
}
