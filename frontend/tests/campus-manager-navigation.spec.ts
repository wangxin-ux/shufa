import {
  navigateCampusManagerBack,
  resolveCampusManagerBackAction,
} from '../utils/campus-manager-navigation';

describe('campus manager navigation', () => {
  it('uses history when available and the manager home as direct-open fallback', () => {
    expect(resolveCampusManagerBackAction(2)).toEqual({ kind: 'back', delta: 1 });
    expect(resolveCampusManagerBackAction(1)).toEqual({
      kind: 'home',
      url: '/pages/campus-manager/home/index',
    });
  });

  it('falls back to manager home when navigateBack fails', () => {
    const reLaunch = jest.fn();
    navigateCampusManagerBack(
      {
        navigateBack: ({ fail }) => fail(),
        reLaunch,
      },
      2,
    );
    expect(reLaunch).toHaveBeenCalledWith({
      url: '/pages/campus-manager/home/index',
    });
  });
});
