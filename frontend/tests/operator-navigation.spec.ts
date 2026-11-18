import {
  navigateOperatorBack,
  resolveOperatorBackAction,
} from '../pages/operator/runtime/utils/operator-navigation';

describe('campus manager navigation', () => {
  it('uses history when available and the manager home as direct-open fallback', () => {
    expect(resolveOperatorBackAction(2)).toEqual({ kind: 'back', delta: 1 });
    expect(resolveOperatorBackAction(1)).toEqual({
      kind: 'home',
      url: '/pages/operator/home/index',
    });
  });

  it('falls back to manager home when navigateBack fails', () => {
    const reLaunch = jest.fn();
    navigateOperatorBack(
      {
        navigateBack: ({ fail }) => fail(),
        reLaunch,
      },
      2,
    );
    expect(reLaunch).toHaveBeenCalledWith({
      url: '/pages/operator/home/index',
    });
  });
});
