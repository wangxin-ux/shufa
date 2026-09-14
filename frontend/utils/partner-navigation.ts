export type PartnerBackAction =
  | { kind: 'back'; delta: 1 }
  | { kind: 'home'; url: '/pages/partner/home/index' };

type PartnerNavigator = {
  navigateBack(options: { delta: 1; fail: () => void }): unknown;
  reLaunch(options: { url: '/pages/partner/home/index' }): unknown;
};

export function resolvePartnerBackAction(
  pageStackDepth: number,
): PartnerBackAction {
  return pageStackDepth > 1
    ? { kind: 'back', delta: 1 }
    : { kind: 'home', url: '/pages/partner/home/index' };
}

export function navigatePartnerBack(
  navigator: PartnerNavigator,
  pageStackDepth: number,
): void {
  const action = resolvePartnerBackAction(pageStackDepth);
  const returnHome = () => {
    navigator.reLaunch({ url: '/pages/partner/home/index' });
  };
  if (action.kind === 'back') {
    navigator.navigateBack({ delta: action.delta, fail: returnHome });
    return;
  }
  returnHome();
}
