import { parseDirectory, parseCampusSummary, parseTotalSummary, validateQuery, validUuid, HeadquartersError } from './codec';
import type { DirectoryQuery } from './types';

export class HeadquartersService {
  constructor(private readonly get: (path: string) => Promise<unknown>) {}
  async listCampuses(query: DirectoryQuery) {
    validateQuery(query);
    const search = `?page=${query.page}&pageSize=${query.pageSize}` +
      (query.query ? `&query=${encodeURIComponent(query.query)}` : '');
    return parseDirectory(await this.get(`/operators/me/headquarters/campuses${search}`), query);
  }
  async campusSummary(id: string) {
    if (!validUuid(id)) throw new HeadquartersError(400, 'HEADQUARTERS_QUERY_INVALID');
    return parseCampusSummary(await this.get(`/operators/me/headquarters/campuses/${encodeURIComponent(id)}/summary`), id);
  }
  async totalSummary() { return parseTotalSummary(await this.get('/operators/me/headquarters/summary')); }
}
