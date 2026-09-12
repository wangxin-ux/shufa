export type TeacherBackAction =
  | { kind: 'back'; delta: 1 }
  | { kind: 'home'; url: '/pages/teacher/home/index' };

type TeacherNavigator = {
  navigateBack(options: { delta: 1; fail: () => void }): unknown;
  reLaunch(options: { url: '/pages/teacher/home/index' }): unknown;
};

export function resolveTeacherBackAction(
  pageStackDepth: number,
): TeacherBackAction {
  return pageStackDepth > 1
    ? { kind: 'back', delta: 1 }
    : { kind: 'home', url: '/pages/teacher/home/index' };
}

export function navigateTeacherBack(
  navigator: TeacherNavigator,
  pageStackDepth: number,
): void {
  const action = resolveTeacherBackAction(pageStackDepth);
  const returnHome = () => {
    navigator.reLaunch({ url: '/pages/teacher/home/index' });
  };
  if (action.kind === 'back') {
    navigator.navigateBack({ delta: action.delta, fail: returnHome });
    return;
  }
  returnHome();
}
