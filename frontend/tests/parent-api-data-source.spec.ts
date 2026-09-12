import {
  ApiParentDataSource,
  ParentHttpRequest,
} from '../data/api-parent-data-source';

describe('parent API data source', () => {
  it('displays backend available lessons and retains gross and refund-reserved breakdown', async () => {
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test', accessToken: 'parent-token',
      request: (options) => options.success({ statusCode: 200, data: { data: {
        remainingTotalUnits: 1500, mainBalanceUnits: 1200, giftBalanceUnits: 300,
        availableTotalUnits: 1200, mainAvailableUnits: 1000, giftAvailableUnits: 200,
        mainReservedUnits: 200, giftReservedUnits: 100,
        paidAmountFen: 120000, validUntil: null, entries: [],
      } } }),
    });
    expect(await source.getHoursView()).toMatchObject({
      remainingTotal: 12, paidHours: 10, giftHours: 2,
      grossTotal: 15, reservedPaidHours: 2, reservedGiftHours: 1,
    });
  });
  it('updates age and home address with PUT, version, and an idempotency key', async () => {
    const requests: Parameters<ParentHttpRequest>[0][] = [];
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'parent-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: {
              student: {
                id: 'student-1',
                name: '林小禾',
                age: 10,
                homeAddress: '长沙市岳麓区启明路 20 号',
                profileVersion: 2,
              },
              unreadMessageCount: 2,
            },
            requestId: 'request-parent-profile-update',
          },
        });
      },
    });
    const updater = source as unknown as {
      updateProfile(
        input: { age: number; homeAddress: string; expectedVersion: number },
        idempotencyKey: string,
      ): Promise<unknown>;
    };

    await updater.updateProfile(
      { age: 10, homeAddress: '长沙市岳麓区启明路 20 号', expectedVersion: 1 },
      'parent-profile-update-0001',
    );

    expect(requests[0]).toMatchObject({
      method: 'PUT',
      url: 'https://example.test/parents/me/profile',
      header: {
        Authorization: 'Bearer parent-token',
        'Idempotency-Key': 'parent-profile-update-0001',
      },
      data: {
        age: 10,
        homeAddress: '长沙市岳麓区启明路 20 号',
        expectedVersion: 1,
      },
    });
  });

  it('loads public campuses and omits unavailable location parameters', async () => {
    const requests: Parameters<ParentHttpRequest>[0][] = [];
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'parent-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: [
              {
                id: 'campus-east',
                name: '启明东校区',
                address: '长沙市岳麓区启明路 18 号',
                contactPhone: '0731-88886666',
                latitude: 28.2282,
                longitude: 112.9388,
                distanceMeters: null,
              },
            ],
            meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
            requestId: 'parent-campuses-1',
          },
        });
      },
    });

    const page = await source.listCampuses({ page: 1, pageSize: 100 });

    expect(requests[0].url).toBe(
      'https://example.test/parents/me/campuses?page=1&pageSize=100',
    );
    expect(page.data[0]).toMatchObject({
      latitude: 28.2282,
      longitude: 112.9388,
      distanceMeters: null,
    });
  });
  it('maps backend units and raw lesson times to existing parent page views', async () => {
    const requests: Parameters<ParentHttpRequest>[0][] = [];
    const request: ParentHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: {
          data: {
            student: { id: 'student-1', name: '林小禾', age: 9 },
            nextLesson: {
              id: 'lesson-1',
              startsAt: '2026-09-01T01:00:00.000Z',
              endsAt: '2026-09-01T02:00:00.000Z',
              campusName: '启明成长中心',
              courseName: '创意书写',
              teacherName: '林老师',
            },
            remainingUnits: 3650,
            attendanceRatePercent: 98,
          },
          requestId: 'request-parent-home',
        },
      });
    };
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: () => 'parent-token',
      request,
    });

    const home = await source.getHomeSummary();

    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://example.test/api/parents/me/home',
      header: { Authorization: 'Bearer parent-token' },
    });
    expect(home).toEqual({
      student: { id: 'student-1', name: '林小禾', age: 9 },
      nextLesson: {
        id: 'lesson-1',
        dateLabel: '9月1日 周二',
        timeLabel: '09:00-10:00',
        campusName: '启明成长中心',
        courseName: '创意书写',
        teacherName: '林老师',
      },
      remainingHoursLabel: '36.5',
      attendanceRateLabel: '98%',
    });
  });

  it('maps immutable ledger rows without recalculating backend balances', async () => {
    const request: ParentHttpRequest = (options) => {
      options.success({
        statusCode: 200,
        data: {
          data: {
            remainingTotalUnits: 1100,
            mainBalanceUnits: 900,
            giftBalanceUnits: 200,
            paidAmountFen: 480000,
            validUntil: '2027-08-23',
            entries: [
              {
                id: 'ledger-1',
                lessonSessionId: 'lesson-1',
                courseName: '创意书写',
                teacherName: '林老师',
                attendanceStatus: 'PRESENT',
                entryType: 'CONSUME',
                deltaUnits: -100,
                occurredAt: '2026-08-28T02:00:00.000Z',
                reason: null,
              },
            ],
          },
          requestId: 'request-parent-hours',
        },
      });
    };
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'parent-token',
      request,
    });

    const hours = await source.getHoursView();

    expect(hours).toEqual({
      grossTotal: 11,
      reservedPaidHours: 0,
      reservedGiftHours: 0,
      remainingTotal: 11,
      paidHours: 9,
      giftHours: 2,
      paidAmountFen: 480000,
      validUntil: '2027-08-23',
      entries: [
        {
          id: 'ledger-1',
          title: '创意书写',
          occurredAtLabel: '2026-08-28 10:00',
          detailLabel: '林老师 · 正常上课',
          delta: -1,
        },
      ],
    });
  });

  it('sends an idempotency key for leave and preserves server errors', async () => {
    const requests: Parameters<ParentHttpRequest>[0][] = [];
    const request: ParentHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 403,
        data: {
          code: 'FORBIDDEN',
          message: 'Student is outside the parent scope',
          details: {},
          requestId: 'request-parent-error',
        },
      });
    };
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'parent-token',
      request,
    });

    await expect(
      source.submitLeave(
        {
          studentId: 'foreign-student',
          lessonId: 'lesson-1',
          reason: '行程冲突',
        },
        'parent-leave-key-0001',
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/parents/me/leave-requests',
      header: {
        Authorization: 'Bearer parent-token',
        'Idempotency-Key': 'parent-leave-key-0001',
      },
      data: {
        studentId: 'foreign-student',
        lessonSessionId: 'lesson-1',
        reason: '行程冲突',
      },
    });
  });

  it('never exposes the backend access-token message in English', async () => {
    const request: ParentHttpRequest = (options) => {
      options.success({
        statusCode: 401,
        data: {
          code: 'UNAUTHORIZED',
          message: 'The access token is missing or invalid',
          details: {},
          requestId: 'request-parent-unauthorized',
        },
      });
    };
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'expired-parent-token',
      request,
    });

    await expect(source.getHomeSummary()).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: '登录已失效，请重新登录',
    });
  });

  it('preserves leave review metadata returned by the shared backend fact', async () => {
    const request: ParentHttpRequest = (options) => {
      options.success({
        statusCode: 200,
        data: {
          data: {
            students: [{ id: 'student-1', name: '陈晨' }],
            lessons: [],
            records: [
              {
                id: 'leave-1',
                courseName: '创意基础',
                lessonStartsAt: '2026-09-01T06:00:00.000Z',
                reason: '参加学校活动',
                status: 'REJECTED',
                reviewerName: '周园长',
                reviewedAt: '2026-08-30T01:00:00.000Z',
                reviewReason: '超过可审批时段',
              },
            ],
            cutoffHours: 2,
          },
          requestId: 'request-parent-leave-review',
        },
      });
    };
    const source = new ApiParentDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'parent-token',
      request,
    });

    const page = await source.getLeavePage();

    expect(page.records[0]).toMatchObject({
      status: 'rejected',
      reviewerName: '周园长',
      reviewedAt: '2026-08-30T01:00:00.000Z',
      reviewReason: '超过可审批时段',
    });
  });
});
