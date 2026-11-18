import { createPartnerRuntimeEnv, PartnerRuntimeEnv } from '../../../config/partner-env';
import { createRuntimeAccessTokenProvider } from '../../../config/local-runtime';
import { ApiPartnerDataSource, PartnerHttpRequest } from '../../../data/api-partner-data-source';
import { MockPartnerDataSource } from '../../../data/mock-partner-data-source';
import { PARTNER_STUDENTS_FIXTURE } from '../../../mock/fixtures/partner.fixture';
import { PartnerService } from '../../../services/partner.service';
import type { PartnerStudentQuery } from '../../../types/partner';
import { createPartnerLessonService } from './partner-lesson-runtime';

export interface PartnerStudentSubjectQuery extends PartnerStudentQuery {
  subjectId?: string;
}

const mockStudentSubjects: Readonly<Record<string, readonly string[]>> = {
  'partner-student-1': ['00000000-0000-4000-8000-000000000001'],
  'partner-student-2': ['UNCLASSIFIED'],
};

class SubjectMockStudentSource extends MockPartnerDataSource {
  override async listStudents(query: PartnerStudentSubjectQuery) {
    if (!query.subjectId) return super.listStudents(query);
    const result = await super.listStudents({
      ...query, page: 1, pageSize: PARTNER_STUDENTS_FIXTURE.length,
    });
    const students = result.data.filter((student) =>
      mockStudentSubjects[student.id]?.includes(query.subjectId!));
    return {
      data: students.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      meta: {
        page: query.page, pageSize: query.pageSize, total: students.length,
        totalPages: Math.ceil(students.length / query.pageSize),
      },
    };
  }
}

export function createPartnerStudentsService(
  env: PartnerRuntimeEnv = createPartnerRuntimeEnv(),
  request?: PartnerHttpRequest,
) {
  if (env.dataDriver === 'api' && !env.apiBaseUrl.trim()) {
    throw new Error('合作方端 API 地址不能为空');
  }
  const source = env.dataDriver === 'api'
    ? new ApiPartnerDataSource({
      baseUrl: env.apiBaseUrl,
      accessToken: createRuntimeAccessTokenProvider(env.accessToken),
      request,
    })
    : new SubjectMockStudentSource({ scenario: env.mockScenario });
  const service = new PartnerService(source);
  return {
    loadStudents: (query: PartnerStudentSubjectQuery) => service.loadStudents(query),
    loadStudent: (id: string) => service.loadStudent(id),
    loadSubjects: createPartnerLessonService(env, request).loadSubjects,
  };
}
