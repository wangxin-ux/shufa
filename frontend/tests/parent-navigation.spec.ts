import { navigateParentBack, resolveParentBackAction } from '../utils/parent-navigation';
import { resolveParentHomeAction } from '../services/parent-home.presenter';
import { resolveParentProfileAction } from '../services/parent-profile.presenter';

describe('parent custom navigation', () => {
  it('returns to the previous page when the mini-program stack has a parent page', () => {
    expect(resolveParentBackAction(2)).toEqual({ kind: 'back', delta: 1 });
  });

  it('falls back to the parent home when a subpage is opened directly', () => {
    expect(resolveParentBackAction(1)).toEqual({
      kind: 'home',
      url: '/pages/parent/home/index',
    });
    expect(resolveParentBackAction(0)).toEqual({
      kind: 'home',
      url: '/pages/parent/home/index',
    });
  });

  it('falls back to the parent home when native navigateBack fails', () => {
    let failBack: (() => void) | undefined;
    const navigator = {
      navigateBack: jest.fn((options: { delta: number; fail: () => void }) => {
        failBack = options.fail;
      }),
      reLaunch: jest.fn(),
    };

    navigateParentBack(navigator, 2);
    expect(navigator.navigateBack).toHaveBeenCalledWith({
      delta: 1,
      fail: expect.any(Function),
    });
    expect(navigator.reLaunch).not.toHaveBeenCalled();

    failBack?.();
    expect(navigator.reLaunch).toHaveBeenCalledWith({
      url: '/pages/parent/home/index',
    });
  });

  it('opens group campaigns from home and personal group orders from profile', () => {
    expect(resolveParentHomeAction('group')).toEqual({
      type: 'navigate',
      url: '/pages/parent/group-campaigns/index',
    });
    expect(resolveParentProfileAction('groups')).toEqual({
      kind: 'navigate',
      url: '/pages/parent/group-orders/index',
    });
    expect(resolveParentHomeAction('campuses')).toEqual({
      type: 'navigate',
      url: '/pages/parent/campuses/index',
    });
  });
});
