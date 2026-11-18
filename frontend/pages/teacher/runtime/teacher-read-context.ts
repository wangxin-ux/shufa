import { createTeacherRuntimeEnv, TeacherRuntimeEnv } from '../../../config/teacher-env';
import { ApiTeacherDataSource, TeacherHttpRequest } from '../../../data/api-teacher-data-source';
import { createTeacherService, readTeacherMockAccount } from '../../../services/teacher-runtime';
import { TeacherService } from '../../../services/teacher.service';

export interface TeacherReadContext {
  env: TeacherRuntimeEnv;
  loggedOut: boolean;
  selectedAccount: string;
}

export function readTeacherReadContext(): TeacherReadContext {
  let loggedOut = false;
  let selectedAccount = '';
  try {
    loggedOut = typeof wx !== 'undefined' &&
      wx.getStorageSync('education.session.logged-out') === true;
    selectedAccount = readTeacherMockAccount();
  } catch {
    loggedOut = true;
  }
  const env = createTeacherRuntimeEnv();
  return {
    env: { ...env, apiBaseUrl: env.apiBaseUrl.trim().replace(/\/+$/, '') },
    loggedOut,
    selectedAccount,
  };
}

export function isCurrentTeacherReadContext(context: TeacherReadContext): boolean {
  const current = readTeacherReadContext();
  return !current.loggedOut && !context.loggedOut &&
    context.selectedAccount === current.selectedAccount &&
    (Object.keys(context.env) as Array<keyof TeacherRuntimeEnv>)
      .every((key) => context.env[key] === current.env[key]);
}

export function createTeacherPageService(context: TeacherReadContext): TeacherService {
  if (context.env.dataDriver === 'mock') {
    return createTeacherService(context.env);
  }
  const request: TeacherHttpRequest = (options) => {
    if (!isCurrentTeacherReadContext(context)) {
      throw Object.assign(new Error('登录已更新，请重新登录'), { statusCode: 401 });
    }
    return wx.request({
      url: options.url, method: options.method, header: options.header,
      data: options.data as WechatMiniprogram.IAnyObject | undefined,
      success: (response) => options.success({
        statusCode: response.statusCode, data: response.data,
      }),
      fail: options.fail,
    });
  };
  if (!context.env.apiBaseUrl) throw new Error('教师端 API 地址不能为空');
  return new TeacherService(new ApiTeacherDataSource({
    baseUrl: context.env.apiBaseUrl, accessToken: context.env.accessToken, request,
  }));
}
