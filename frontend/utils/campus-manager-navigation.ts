export type CampusManagerBackAction =
  | { kind: 'back'; delta: 1 }
  | { kind: 'home'; url: '/pages/campus-manager/home/index' };

type CampusManagerNavigator = {
  navigateBack(options: { delta: 1; fail: () => void }): unknown;
  reLaunch(options: { url: '/pages/campus-manager/home/index' }): unknown;
};

export function resolveCampusManagerBackAction(
  pageStackDepth: number,
): CampusManagerBackAction {
  return pageStackDepth > 1
    ? { kind: 'back', delta: 1 }
    : { kind: 'home', url: '/pages/campus-manager/home/index' };
}

export function navigateCampusManagerBack(
  navigator: CampusManagerNavigator,
  pageStackDepth: number,
): void {
  const action = resolveCampusManagerBackAction(pageStackDepth);
  const returnHome = () => {
    navigator.reLaunch({ url: '/pages/campus-manager/home/index' });
  };
  if (action.kind === 'back') {
    navigator.navigateBack({ delta: action.delta, fail: returnHome });
    return;
  }
  returnHome();
}
