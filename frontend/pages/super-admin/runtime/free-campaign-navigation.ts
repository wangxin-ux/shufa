export function freeCampaignHeaderTopPx(): number {
  let top = 28;
  try {
    top = (wx.getWindowInfo().statusBarHeight ?? 20) + 8;
    const capsule = wx.getMenuButtonBoundingClientRect();
    if (capsule.height > 0) top = capsule.top;
  } catch {
    // Keep the same status-bar fallback as the shared page shell.
  }
  return top;
}
