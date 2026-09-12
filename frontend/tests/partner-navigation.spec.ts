import {
  navigatePartnerBack,
  resolvePartnerBackAction,
} from '../utils/partner-navigation';

describe('partner navigation', () => {
  it('uses history and partner home as the direct-open fallback', () => {
    expect(resolvePartnerBackAction(2)).toEqual({ kind: 'back', delta: 1 });
    expect(resolvePartnerBackAction(1)).toEqual({
      kind: 'home', url: '/pages/partner/home/index',
    });
  });

  it('falls back to partner home when navigateBack fails', () => {
    const reLaunch = jest.fn();
    navigatePartnerBack(
      { navigateBack: ({ fail }) => fail(), reLaunch },
      2,
    );
    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/partner/home/index' });
  });

  it('opens a URL-safe partner student detail route', () => {
    expect(resolvePartnerStudentDetailRoute('student / 1')).toBe(
      '/pages/partner/student-detail/index?id=student%20%2F%201',
    );
  });
});

import { resolvePartnerStudentDetailRoute } from '../services/partner-students.presenter';
