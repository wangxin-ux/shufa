export type OperatorBackAction =
  | { kind: 'back'; delta: 1 }
  | { kind: 'home'; url: '/pages/operator/home/index' };

type OperatorNavigator = {
  navigateBack(options: { delta: 1; fail: () => void }): unknown;
  reLaunch(options: { url: '/pages/operator/home/index' }): unknown;
};

export function resolveOperatorBackAction(
  pageStackDepth: number,
): OperatorBackAction {
  return pageStackDepth > 1
    ? { kind: 'back', delta: 1 }
    : { kind: 'home', url: '/pages/operator/home/index' };
}

export function navigateOperatorBack(
  navigator: OperatorNavigator,
  pageStackDepth: number,
): void {
  const action = resolveOperatorBackAction(pageStackDepth);
  const returnHome = () => {
    navigator.reLaunch({ url: '/pages/operator/home/index' });
  };
  if (action.kind === 'back') {
    navigator.navigateBack({ delta: action.delta, fail: returnHome });
    return;
  }
  returnHome();
}
