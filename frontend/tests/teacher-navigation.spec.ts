import {
  navigateTeacherBack,
  resolveTeacherBackAction,
} from '../utils/teacher-navigation';
import { resolveTeacherProfileAction } from '../services/teacher-profile.presenter';

describe('teacher custom navigation', () => {
  it('uses native back for a stacked teacher page', () => {
    expect(resolveTeacherBackAction(2)).toEqual({ kind: 'back', delta: 1 });
  });

  it('falls back to teacher home when a page is opened directly', () => {
    expect(resolveTeacherBackAction(1)).toEqual({
      kind: 'home',
      url: '/pages/teacher/home/index',
    });
    expect(resolveTeacherBackAction(0)).toEqual({
      kind: 'home',
      url: '/pages/teacher/home/index',
    });
  });

  it('relaunches teacher home when native back fails', () => {
    let fail: (() => void) | undefined;
    const navigator = {
      navigateBack: jest.fn((options: { delta: 1; fail: () => void }) => {
        fail = options.fail;
      }),
      reLaunch: jest.fn(),
    };

    navigateTeacherBack(navigator, 3);
    fail?.();
    expect(navigator.reLaunch).toHaveBeenCalledWith({
      url: '/pages/teacher/home/index',
    });
  });

  it('opens teacher earnings from the profile without changing roles', () => {
    expect(resolveTeacherProfileAction('earnings')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/earnings/index',
    });
  });

  it('opens the independent feedback module from the profile', () => {
    expect(resolveTeacherProfileAction('feedback')).toEqual({
      kind: 'navigate',
      url: '/pages/teacher/feedback/index',
    });
  });
});
