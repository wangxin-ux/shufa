export function navigateSuperAdminBack(
  api: {
    navigateBack(options: { delta: number }): void;
    reLaunch(options: { url: string }): void;
  },
  pageCount: number,
  fallbackUrl = '/pages/super-admin/home/index',
): void {
  if (pageCount > 1) {
    api.navigateBack({ delta: 1 });
    return;
  }
  api.reLaunch({ url: fallbackUrl });
}
