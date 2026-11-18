const calls = {
  loadProfile: jest.fn(),
  loadOperationsSummary: jest.fn(),
  loadTeachers: jest.fn(),
  loadWarnings: jest.fn(),
  loadAttendance: jest.fn(),
};
jest.mock("../services/partner-runtime", () => ({
  createPartnerService: () => ({
    loadProfile: () => calls.loadProfile(),
    loadOperationsSummary: () => calls.loadOperationsSummary(),
    loadTeachers: () => calls.loadTeachers(),
    loadWarnings: () => calls.loadWarnings(),
    loadAttendance: () => calls.loadAttendance(),
  }),
  partnerService: {
    loadProfile: () => calls.loadProfile(),
    loadOperationsSummary: () => calls.loadOperationsSummary(),
    loadTeachers: () => calls.loadTeachers(),
    loadWarnings: () => calls.loadWarnings(),
    loadAttendance: () => calls.loadAttendance(),
  },
}));
jest.mock("../services/session.service", () => ({
  sessionService: { logout: jest.fn() },
}));

describe.each(["profile", "operations", "teachers", "warnings", "attendance"])(
  "partner %s immediate exit",
  (route) => {
    beforeEach(() => {
      (global as any).wx = {
        getWindowInfo: () => ({ windowWidth: 430, windowHeight: 932, statusBarHeight: 54 }),
        getMenuButtonBoundingClientRect: () => ({ top: 58, height: 32 }),
      };
      Object.values(calls).forEach((mock) => mock.mockReset().mockResolvedValue({
        status: "error", message: "不应发起此请求", statusCode: 500,
      }));
    });
    afterEach(() => {
      delete (global as any).Page;
      delete (global as any).wx;
    });
    it.each(["onHide", "onUnload"])("does not start queued work after %s", async (lifecycle) => {
      let page: any;
      (global as any).Page = (definition: any) => {
        page = { ...definition, data: { ...definition.data } };
        page.setData = (values: object) => Object.assign(page.data, values);
      };
      jest.isolateModules(() => require(`../pages/partner/${route}/index`));
      page.onLoad();
      page[lifecycle]();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      Object.values(calls).forEach((mock) => expect(mock).not.toHaveBeenCalled());
    });
  },
);
