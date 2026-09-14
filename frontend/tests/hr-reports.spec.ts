interface LegacyReportPage {
  onLoad(options: Record<string, string | undefined>): void;
}

describe("legacy HR report route", () => {
  const oldPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");
  const redirectTo = jest.fn();
  let page: LegacyReportPage;

  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: { redirectTo },
    });
    Object.defineProperty(globalThis, "Page", {
      configurable: true,
      value: (definition: LegacyReportPage) => {
        page = definition;
      },
    });
    jest.isolateModules(() => require("../pages/hr/reports/index"));
  });

  afterAll(() => {
    if (oldPage) Object.defineProperty(globalThis, "Page", oldPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  it.each([
    [{}, "/pages/hr/teaching/index"],
    [
      { mode: "earnings", teacherId: "teacher/1", teacherName: "林 老师" },
      "/pages/hr/earnings/index?teacherId=teacher%2F1&teacherName=%E6%9E%97%20%E8%80%81%E5%B8%88",
    ],
  ])(
    "redirects the old combined route to one independent module",
    (options, url) => {
      page.onLoad(options);
      expect(redirectTo).toHaveBeenCalledWith({ url });
    },
  );
});
