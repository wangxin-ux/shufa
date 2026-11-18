export interface RankingNativeScope {
  partnerId: string;
  loginCode: string;
}

interface RankingNativeRequest {
  method: string;
  path: string;
  actorId?: string;
  body?: unknown;
}

export function allowRankingNativeRequest(
  scope: RankingNativeScope,
  { method, path, actorId, body }: RankingNativeRequest,
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
  return Boolean(
    scope.partnerId &&
    actorId === scope.partnerId &&
    method === 'GET' &&
    [
      '/me',
      '/partners/me/profile',
      '/partners/me/subjects',
      '/partners/me/lesson-account',
      '/partners/me/earnings',
      '/partners/me/earnings/summary',
      '/partners/me/rankings',
    ].includes(path),
  );
}
