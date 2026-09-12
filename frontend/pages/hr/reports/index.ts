Page({
  onLoad(options: Record<string, string | undefined>) {
    const path =
      options.mode === "earnings"
        ? "/pages/hr/earnings/index"
        : "/pages/hr/teaching/index";
    const params = ["teacherId", "teacherName"]
      .filter((key) => options[key])
      .map((key) => `${key}=${encodeURIComponent(options[key]!)}`);
    wx.redirectTo({
      url: `${path}${params.length ? `?${params.join("&")}` : ""}`,
    });
  },
});
