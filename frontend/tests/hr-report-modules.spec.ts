import * as fs from "fs";
import * as path from "path";

const mockApi = {
  campuses: jest.fn(),
  teachers: jest.fn(),
  teaching: jest.fn(),
  earnings: jest.fn(),
  exportReport: jest.fn(),
};
const mockSession = { load: jest.fn() };

jest.mock("../services/hr.service", () => ({ createHrApi: () => mockApi }));
jest.mock("../services/session.service", () => ({
  createSessionService: () => mockSession,
}));

interface TestPage {
  data: Record<string, any>;
  setData(patch: Record<string, unknown>): void;
  initialize(): Promise<void>;
  load(append?: boolean): Promise<void>;
  onExport(): Promise<void>;
}

const campusPage = {
  items: [{ id: "campus-1", name: "东校区" }],
  total: 1,
  page: 1,
  pageSize: 50,
};
const teacherPage = {
  items: [
    {
      id: "teacher-1",
      name: "林老师",
      campusId: "campus-1",
      campusName: "东校区",
      employeeCode: "T001",
      active: true,
      specialties: ["美术"],
      activeClassCount: 2,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
};
const teachingReport = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  summary: {
    completedCount: 2,
    attendeeCount: 5,
    lessonUnits: 200,
    consumedUnits: 350,
  },
};
const earningReport = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  summary: {
    netFen: 12345,
    pendingFen: 345,
    approvedFen: 12000,
    paidFen: 10000,
    processingFen: 2000,
  },
};

function installPage(modulePath: string) {
  let page: TestPage | undefined;
  let loadError: unknown;
  Object.defineProperty(globalThis, "Page", {
    configurable: true,
    value: (definition: TestPage) => {
      page = definition;
      page.setData = (patch) => Object.assign(page!.data, patch);
    },
  });
  try {
    jest.isolateModules(() => require(modulePath));
  } catch (error) {
    loadError = error;
  }
  expect(loadError).toBeUndefined();
  expect(page).toBeDefined();
  return page!;
}

describe("independent HR report modules", () => {
  const oldPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
  const oldWx = Object.getOwnPropertyDescriptor(globalThis, "wx");

  beforeEach(() => {
    jest.resetAllMocks();
    mockSession.load.mockResolvedValue({
      roles: [{ code: "HR", campusId: null }],
    });
    mockApi.campuses.mockResolvedValue(campusPage);
    mockApi.teachers.mockResolvedValue(teacherPage);
    mockApi.teaching.mockResolvedValue(teachingReport);
    mockApi.earnings.mockResolvedValue(earningReport);
    Object.defineProperty(globalThis, "wx", {
      configurable: true,
      value: {
        getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375 }),
        getMenuButtonBoundingClientRect: () => ({ top: 28, left: 281 }),
        navigateBack: jest.fn(),
        reLaunch: jest.fn(),
      },
    });
  });

  afterAll(() => {
    if (oldPage) Object.defineProperty(globalThis, "Page", oldPage);
    else Reflect.deleteProperty(globalThis, "Page");
    if (oldWx) Object.defineProperty(globalThis, "wx", oldWx);
    else Reflect.deleteProperty(globalThis, "wx");
  });

  it("loads lesson consumption statistics without requesting lesson fees", async () => {
    const page = installPage("../pages/hr/teaching/index");

    await page.initialize();

    expect(mockApi.teaching).toHaveBeenCalledTimes(1);
    expect(mockApi.earnings).not.toHaveBeenCalled();
    expect(page.data.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "学员课耗", value: "3.5" }),
      ]),
    );
    expect(page.data.teachers).toEqual([
      expect.objectContaining({ id: "", name: "全部教师" }),
      expect.objectContaining({ id: "teacher-1", name: "林老师 · 东校区" }),
    ]);
  });

  it("preserves a selected teacher when opening a report from the archive", async () => {
    const page = installPage("../pages/hr/teaching/index");
    Object.assign(page, { requestedTeacherId: "teacher-1" });

    await page.initialize();

    expect(page.data.teacherIndex).toBe(1);
    expect(mockApi.teaching).toHaveBeenCalledWith({
      teacherId: "teacher-1",
      page: 1,
      pageSize: 20,
    });
  });

  it("preserves a selected teacher when opening lesson-fee settlement", async () => {
    const page = installPage("../pages/hr/earnings/index");
    Object.assign(page, { requestedTeacherId: "teacher-1" });

    await page.initialize();

    expect(page.data.teacherIndex).toBe(1);
    expect(mockApi.earnings).toHaveBeenCalledWith({
      teacherId: "teacher-1",
      page: 1,
      pageSize: 20,
    });
  });

  it("applies period, campus and teacher filters to consumption and its export", async () => {
    const page = installPage("../pages/hr/teaching/index");
    await page.initialize();
    page.setData({
      from: "2026-09-01",
      to: "2026-09-07",
      campusIndex: 1,
      teacherIndex: 1,
    });

    await page.load();
    await page.onExport();

    const expected = {
      from: "2026-09-01",
      to: "2026-09-07",
      campusId: "campus-1",
      teacherId: "teacher-1",
    };
    expect(mockApi.teaching).toHaveBeenLastCalledWith({
      ...expected,
      page: 1,
      pageSize: 20,
    });
    expect(mockApi.exportReport).toHaveBeenCalledWith("teaching", expected);
  });

  it("loads lesson-fee settlement without requesting consumption statistics", async () => {
    const page = installPage("../pages/hr/earnings/index");

    await page.initialize();

    expect(mockApi.earnings).toHaveBeenCalledTimes(1);
    expect(mockApi.teaching).not.toHaveBeenCalled();
    expect(page.data.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "课时费净额", value: "123.45" }),
        expect.objectContaining({ label: "当前已付", value: "100.00" }),
      ]),
    );
  });

  it("applies period, campus and teacher filters to settlement and its export", async () => {
    const page = installPage("../pages/hr/earnings/index");
    await page.initialize();
    page.setData({
      from: "2026-09-01",
      to: "2026-09-07",
      campusIndex: 1,
      teacherIndex: 1,
    });

    await page.load();
    await page.onExport();

    const expected = {
      from: "2026-09-01",
      to: "2026-09-07",
      campusId: "campus-1",
      teacherId: "teacher-1",
    };
    expect(mockApi.earnings).toHaveBeenLastCalledWith({
      ...expected,
      page: 1,
      pageSize: 20,
    });
    expect(mockApi.exportReport).toHaveBeenCalledWith("earnings", expected);
  });

  it("keeps the two modules visually separate and omits parent-review and payroll scope", () => {
    const teachingRoot = path.resolve(__dirname, "../pages/hr/teaching");
    const earningsRoot = path.resolve(__dirname, "../pages/hr/earnings");
    const teaching = ["index.ts", "index.wxml", "index.wxss"]
      .map((name) => fs.readFileSync(path.join(teachingRoot, name), "utf8"))
      .join("\n");
    const earnings = ["index.ts", "index.wxml", "index.wxss"]
      .map((name) => fs.readFileSync(path.join(earningsRoot, name), "utf8"))
      .join("\n");

    expect(teaching).toContain("课耗统计");
    expect(teaching).not.toMatch(/课时费净额|结算报表|家长评价/);
    expect(earnings).toContain("课时费与结算");
    expect(earnings).not.toMatch(/学员课耗|家长评价|底薪|社保|个税|绩效工资/);
    expect(teaching).toContain("finance-refunds.wxss");
    expect(earnings).toContain("finance-refunds.wxss");
  });
});
