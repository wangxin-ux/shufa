import {
  createTeacherRuntimeEnv,
  TeacherRuntimeEnv,
} from '../config/teacher-env';
import { createRuntimeAccessTokenProvider } from '../config/local-runtime';
import {
  ApiTeacherDataSource,
  TeacherHttpRequest,
} from '../data/api-teacher-data-source';
import { MockTeacherDataSource } from '../data/mock-teacher-data-source';
import { TeacherService } from './teacher.service';

export function createTeacherService(
  env: TeacherRuntimeEnv = createTeacherRuntimeEnv(),
  request?: TeacherHttpRequest,
): TeacherService {
  if (env.dataDriver === 'api') {
    if (!env.apiBaseUrl.trim()) {
      throw new Error('教师端 API 地址不能为空');
    }
    return new TeacherService(
      new ApiTeacherDataSource({
        baseUrl: env.apiBaseUrl,
        accessToken: createRuntimeAccessTokenProvider(env.accessToken),
        request,
      }),
    );
  }

  return new TeacherService(
    new MockTeacherDataSource({ scenario: env.mockScenario }),
  );
}

export const teacherService = createTeacherService();
