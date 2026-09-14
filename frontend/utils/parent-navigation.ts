export type ParentBackAction =
  | { kind: 'back'; delta: 1 }
  | { kind: 'home'; url: '/pages/parent/home/index' };

type ParentNavigator = {
  navigateBack(options: { delta: 1; fail: () => void }): unknown;
  reLaunch(options: { url: '/pages/parent/home/index' }): unknown;
};

export function resolveParentBackAction(pageStackDepth: number): ParentBackAction {
  if (pageStackDepth > 1) {
    return { kind: 'back', delta: 1 };
  }
  return { kind: 'home', url: '/pages/parent/home/index' };
}

export function navigateParentBack(
  navigator: ParentNavigator,
  pageStackDepth: number,
): void {
  const action = resolveParentBackAction(pageStackDepth);
  const returnHome = () => {
    navigator.reLaunch({ url: '/pages/parent/home/index' });
  };

  if (action.kind === 'back') {
    navigator.navigateBack({ delta: action.delta, fail: returnHome });
    return;
  }
  returnHome();
}
