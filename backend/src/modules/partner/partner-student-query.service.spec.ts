import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PartnerStudentQueryDto } from './dto/partner-query.dto';
import { PartnerStudentQueryService } from './partner-student-query.service';
import { readPartnerEnrollmentSummary } from './partner-enrollment-summary';

jest.mock('./partner-enrollment-summary', () => ({
  readPartnerEnrollmentSummary: jest.fn(),
}));

describe('partner student query contract and bounded hydration', () => {
  const firstId = '10000000-0000-4000-8000-000000000001';
  const secondId = '10000000-0000-4000-8000-000000000002';
  const campusId = '20000000-0000-4000-8000-000000000001';
  const now = new Date('2026-10-08T00:00:00Z');
  const raw = jest.fn<
    Promise<Array<{ id: string | null; total: number }>>,
    [Prisma.Sql]
  >();
  const findMany = jest.fn<
    Promise<Array<{ id: string }>>,
    [Prisma.StudentFindManyArgs]
  >();
  const memberships = jest.fn().mockResolvedValue([]);
  const attendance = jest.fn().mockResolvedValue([]);
  const enrollment = jest.mocked(readPartnerEnrollmentSummary);
  const tx = {
    $queryRaw: raw,
    student: { findMany },
    classMember: { findMany: memberships },
    attendanceRecord: { groupBy: attendance },
  };
  const transaction = jest.fn<
    Promise<unknown>,
    [
      (tx: {
        $queryRaw: typeof raw;
        student: { findMany: typeof findMany };
        classMember: { findMany: typeof memberships };
        attendanceRecord: { groupBy: typeof attendance };
      }) => Promise<unknown>,
      { isolationLevel: Prisma.TransactionIsolationLevel },
    ]
  >();
  let service: PartnerStudentQueryService;

  beforeEach(() => {
    raw.mockReset();
    findMany.mockReset();
    memberships.mockClear();
    attendance.mockClear();
    enrollment.mockReset().mockResolvedValue({
      receivedAmountFen: 10000,
      refundedAmountFen: 0,
      initialMainUnits: 0,
      initialGiftUnits: 0,
      pendingIssuanceCount: 1,
    });
    transaction.mockReset().mockImplementation((read) => read(tx));
    service = new PartnerStudentQueryService({
      $transaction: transaction,
    } as unknown as PrismaService);
  });

  it.each(['ALL', 'ZERO', 'LTE_FIVE', 'GT_FIVE'])(
    'validates balance band %s',
    (balanceBand) => {
      const dto = plainToInstance(PartnerStudentQueryDto, {
        page: '2',
        pageSize: '10',
        balanceBand,
      });
      expect(validateSync(dto)).toEqual([]);
      expect(dto).toMatchObject({ page: 2, pageSize: 10, balanceBand });
    },
  );

  it.each(['invalid', ['ZERO'], 500])(
    'rejects invalid filter %j',
    (balanceBand) => {
      expect(
        validateSync(plainToInstance(PartnerStudentQueryDto, { balanceBand }))
          .length,
      ).toBeGreaterThan(0);
    },
  );

  it.each([firstId, 'UNCLASSIFIED'])(
    'accepts the optional subject filter %s',
    (subjectId) => {
      const dto = plainToInstance(PartnerStudentQueryDto, { subjectId });
      expect(
        validateSync(dto, {
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      ).toEqual([]);
    },
  );

  it.each(['bad-id', '', firstId + "' OR TRUE", [firstId], 12])(
    'rejects the malformed subject filter %j',
    (subjectId) => {
      expect(
        validateSync(
          plainToInstance(PartnerStudentQueryDto, {
            subjectId,
          }),
        ).length,
      ).toBeGreaterThan(0);
    },
  );

  it('binds a subject existence condition without filtering the hydrated balances', async () => {
    raw.mockResolvedValue([{ id: firstId, total: 1 }]);
    findMany.mockResolvedValue([{ id: firstId }]);
    await service.list(
      campusId,
      {
        page: 1,
        pageSize: 20,
        balanceBand: 'GT_FIVE',
        ...{ subjectId: secondId },
      },
      now,
    );
    const sql = raw.mock.calls[0][0];
    expect(sql.values).toContain(secondId);
    expect(sql.text).toContain('EXISTS');
    expect(sql.text).toContain('"subjectId"');
    expect(sql.text).not.toContain(secondId);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      select: {
        coursePackages: {
          where: {
            campusId,
            isActive: true,
            validFrom: { lte: now },
          },
        },
      },
    });
    expect(findMany.mock.calls[0][0].select?.coursePackages).not.toHaveProperty(
      'where.subjectId',
    );
  });

  it('keeps only page IDs in hydration, preserves SQL order and uses one snapshot', async () => {
    raw.mockResolvedValue([
      { id: secondId, total: 300 },
      { id: firstId, total: 300 },
    ]);
    findMany.mockResolvedValue([{ id: firstId }, { id: secondId }]);
    const result = await service.list(
      campusId,
      {
        page: 2,
        pageSize: 2,
        balanceBand: 'LTE_FIVE',
      },
      now,
    );
    expect(result).toEqual({
      students: [{ id: secondId }, { id: firstId }],
      total: 300,
    });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      campusId,
      isActive: true,
      id: { in: [secondId, firstId] },
    });
    expect(findMany.mock.calls[0][0]).toMatchObject({
      select: { coursePackages: { where: { validFrom: { lte: now } } } },
    });
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('returns an out-of-range count without any hydration request', async () => {
    raw.mockResolvedValue([{ id: null, total: 37 }]);
    await expect(
      service.list(
        campusId,
        {
          page: 99,
          pageSize: 20,
          balanceBand: 'ALL',
        },
        now,
      ),
    ).resolves.toEqual({ students: [], total: 37 });
    expect(findMany).not.toHaveBeenCalled();
    expect(raw.mock.calls[0][0].text).not.toContain('"CoursePackage"');
  });

  it('binds literal name input and campus scope instead of interpolating SQL', async () => {
    raw.mockResolvedValue([{ id: null, total: 0 }]);
    const keyword = "%' OR TRUE; --_";
    await service.list(
      campusId,
      { page: 1, pageSize: 20, query: keyword, balanceBand: 'ZERO' },
      now,
    );
    const sql = raw.mock.calls[0][0];
    expect(sql.text).not.toContain(keyword);
    expect(sql.values).toContain(keyword);
    expect(sql.values.filter((value) => value === campusId)).toHaveLength(2);
    expect(sql.text).toContain('available = 0');
  });

  it('uses the campus warning threshold and a one-student page for a highlight', async () => {
    raw.mockResolvedValue([{ id: firstId, total: 3 }]);
    findMany.mockResolvedValue([{ id: firstId }]);
    await service.warnings(campusId, 800, { page: 1, pageSize: 1 }, now);
    const sql = raw.mock.calls[0][0];
    expect(sql.values).toContain(800);
    expect(sql.text).toContain('available ASC');
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: [firstId] } },
    });
    expect(enrollment).not.toHaveBeenCalled();
  });

  it('only enriches the selected highlight, never the whole warning population', async () => {
    raw.mockResolvedValue([{ id: firstId, total: 100 }]);
    findMany.mockResolvedValue([{ id: firstId }]);
    const result = await service.highlight(campusId, 800, now);
    expect(enrollment).toHaveBeenCalledTimes(1);
    expect(enrollment.mock.calls[0]).toEqual([tx, campusId, firstId]);
    expect(result.enrollmentSummary).toMatchObject({
      receivedAmountFen: 10000,
      pendingIssuanceCount: 1,
    });
    expect(memberships).toHaveBeenCalledTimes(1);
    expect(memberships.mock.calls[0]).toEqual([
      expect.objectContaining({
        where: expect.objectContaining({
          campusId,
          studentId: firstId,
          leftAt: null,
          classGroup: { campusId, status: 'ACTIVE', teacher: { campusId } },
        }) as unknown,
      }),
    ]);
    expect(attendance).toHaveBeenCalledTimes(1);
    expect(attendance.mock.calls[0]).toEqual([
      expect.objectContaining({
        where: expect.objectContaining({
          campusId,
          studentId: firstId,
        }) as unknown,
      }),
    ]);
  });

  it('does not enrich an empty highlight or a normal list', async () => {
    raw.mockResolvedValue([{ id: null, total: 0 }]);
    await service.highlight(campusId, 800, now);
    raw.mockResolvedValue([{ id: firstId, total: 100 }]);
    findMany.mockResolvedValue([{ id: firstId }]);
    await service.list(
      campusId,
      { page: 1, pageSize: 1, balanceBand: 'ALL' },
      now,
    );
    expect(memberships).not.toHaveBeenCalled();
    expect(attendance).not.toHaveBeenCalled();
    expect(enrollment).not.toHaveBeenCalled();
  });
});
