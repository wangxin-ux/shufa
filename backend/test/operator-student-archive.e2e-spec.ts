import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { load as loadYaml } from 'js-yaml';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  StoredFileService,
  STUDENT_FEEDBACK_IMAGE_OPTIONS,
  STUDENT_PROFILE_PHOTO_OPTIONS,
} from '../src/modules/file/stored-file.service';
import { assertCampusArchiveTestTarget } from './support/campus-archive-test-database';

assertCampusArchiveTestTarget(process.env);
jest.setTimeout(60_000);

interface Media {
  id: string;
  accessUrl: string;
}
interface Archive {
  id: string;
  displayName: string;
  ageYears: number | null;
  photo: Media | null;
  availableTotalUnits: number;
  attendance: { recordedCount: number; presentCount: number };
}
interface GrowthRecord {
  lessonSessionId: string;
  lessonStatus: string;
  feedbackValid: boolean;
  feedbackImages: Media[];
  review: { valid: boolean } | null;
}
const data = <T>(response: { body: unknown }): T =>
  (response.body as { data: T }).data;
const contract = loadYaml(
  readFileSync(
    resolve(__dirname, '../../contracts/operator-student-archive.openapi.yaml'),
    'utf8',
  ),
) as { schemas: Record<string, { required: string[] }> };
const expectContractFields = (value: object, schema: string) =>
  expect(Object.keys(value).sort()).toEqual(
    [...contract.schemas[schema].required].sort(),
  );
type Validate = ((value: unknown) => boolean) & { errors: unknown };
interface SchemaValidator {
  addSchema(schema: unknown, id: string): void;
  getSchema(ref: string): Validate | undefined;
}
// Reuse the JSON Schema 2020 validator already installed by the Nest build tools.
const buildDependencies = createRequire(
  createRequire(require.resolve('@nestjs/cli/package.json')).resolve(
    '@angular-devkit/core',
  ),
);
const { default: Ajv2020 } = buildDependencies('ajv/dist/2020') as {
  default: new (options: {
    strict: boolean;
    allErrors: boolean;
  }) => SchemaValidator;
};
const addFormats = buildDependencies('ajv-formats') as (
  validator: SchemaValidator,
) => void;
const validator = new Ajv2020({ strict: false, allErrors: true });
addFormats(validator);
const contractBase = 'https://education.invalid/contracts/';
validator.addSchema(
  loadYaml(
    readFileSync(resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8'),
  ),
  `${contractBase}openapi.yaml`,
);
validator.addSchema(
  contract,
  `${contractBase}operator-student-archive.openapi.yaml`,
);
function expectContractResponse(value: unknown, schema: string) {
  const validate = validator.getSchema(
    `${contractBase}operator-student-archive.openapi.yaml#/schemas/${schema}`,
  );
  if (!validate) throw new Error(`Missing contract schema ${schema}`);
  expect({ valid: validate(value), errors: validate.errors }).toEqual({
    valid: true,
    errors: null,
  });
}

describe('operator restricted student archive in its dedicated database', () => {
  const runTag = `carchive-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let files: StoredFileService;
  let server: Server;
  let managerId: string;
  let campusId: string;
  let otherCampusId: string;
  let studentId: string;
  let unknownStudentId: string;
  let emptyStudentId: string;
  let otherStudentId: string;
  let inactiveStudentId: string;
  let token: string;
  let otherToken: string;
  let wrongRoleToken: string;
  let photo: Media;
  let feedbackImage: Media;
  let unlinkedFileId: string;
  let completedId: string;
  let reversedId: string;
  let domainSnapshot: string;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const base = (id = studentId) => `/operators/me/students/${id}/archive`;
  const get = (path: string, bearer = token) =>
    request(server).get(path).auth(bearer, { type: 'bearer' });
  const imagePath = (fileId: string, id = studentId) =>
    `${base(id)}/media/${fileId}`;

  async function snapshot() {
    return JSON.stringify({
      packages: await prisma.coursePackage.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
      ledger: await prisma.lessonLedgerEntry.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
      attendance: await prisma.attendanceRecord.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
      teaching: await prisma.teachingRecord.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
      refunds: await prisma.financeRefundRequest.findMany({
        where: { issuance: { receipt: { campusId } } },
        orderBy: { id: 'asc' },
      }),
      feedback: await prisma.studentFeedback.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
      reviews: await prisma.parentLessonReview.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      }),
    });
  }

  beforeAll(async () => {
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    files = app.get(StoredFileService);
    server = app.getHttpServer() as Server;
    const campus = await prisma.campus.create({
      data: {
        code: `${runTag}-a`,
        name: `${runTag}本校区`,
        lessonWarningThresholdUnits: 1200,
      },
    });
    const other = await prisma.campus.create({
      data: { code: `${runTag}-b`, name: `${runTag}其他校区` },
    });
    campusId = campus.id;
    otherCampusId = other.id;
    async function account(
      roleCode: 'OPERATOR' | 'PARENT' | 'TEACHER',
      id: string,
    ) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${roleCode}`,
          roles: { create: { roleCode, campusId: id } },
        },
      });
      users.push(user.id);
      const session = await app.get(AuthService).issueSessionForUser(user.id);
      return { userId: user.id, token: session.accessToken };
    }
    const manager = await account('OPERATOR', campusId);
    managerId = manager.userId;
    token = manager.token;
    otherToken = (await account('OPERATOR', other.id)).token;
    const parent = await account('PARENT', campusId);
    wrongRoleToken = parent.token;
    const teacherUser = await account('TEACHER', campusId);
    const teacher = await prisma.teacherProfile.create({
      data: { campusId, userId: teacherUser.userId, employeeCode: runTag },
    });
    const group = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId: teacher.id,
        name: runTag,
        courseName: '合成美术',
      },
    });
    for (const kind of ['known', 'unknown', 'empty', 'inactive', 'other']) {
      const row = await prisma.student.create({
        data: {
          campusId: kind === 'other' ? other.id : campusId,
          displayName: `${runTag}-${kind}`,
          birthDate: kind === 'known' ? new Date('2020-01-01') : null,
          homeAddress: '不应披露的合成地址',
          profileAge: kind === 'empty' ? 99 : null,
          isActive: kind !== 'inactive',
        },
      });
      if (kind === 'known') studentId = row.id;
      else if (kind === 'unknown') unknownStudentId = row.id;
      else if (kind === 'empty') emptyStudentId = row.id;
      else if (kind === 'inactive') inactiveStudentId = row.id;
      else otherStudentId = row.id;
    }
    await prisma.classMember.create({
      data: { campusId, classGroupId: group.id, studentId },
    });
    await prisma.parentStudentBinding.create({
      data: { campusId, studentId, parentUserId: parent.userId },
    });
    const actor = {
      userId: parent.userId,
      roles: [{ code: 'PARENT' as const, campusId }],
    };
    const upload = (name: string) => ({
      originalname: name,
      mimetype: 'image/png',
      size: png.length,
      buffer: png,
    });
    const storedPhoto = await files.store(
      actor,
      upload('photo.png'),
      STUDENT_PROFILE_PHOTO_OPTIONS,
    );
    await prisma.storedFile.update({
      where: { id: storedPhoto.id },
      data: { photoTargetStudentId: studentId },
    });
    await prisma.student.update({
      where: { id: studentId },
      data: { profilePhotoFileId: storedPhoto.id },
    });
    photo = { id: storedPhoto.id, accessUrl: imagePath(storedPhoto.id) };
    const storedImage = await files.store(
      actor,
      upload('feedback.png'),
      STUDENT_FEEDBACK_IMAGE_OPTIONS,
    );
    feedbackImage = {
      id: storedImage.id,
      accessUrl: imagePath(storedImage.id),
    };
    unlinkedFileId = (
      await files.store(
        actor,
        upload('unlinked.png'),
        STUDENT_FEEDBACK_IMAGE_OPTIONS,
      )
    ).id;
    const proof = await prisma.storedFile.create({
      data: {
        purpose: 'PAYMENT_PROOF',
        storageKey: `${runTag}/receipt.png`,
        originalName: '不披露凭证.png',
        mimeType: 'image/png',
        sizeBytes: png.length,
        sha256: '0'.repeat(64),
        createdByUserId: managerId,
      },
    });
    const receipt = await prisma.financeReceipt.create({
      data: {
        campusId,
        studentId,
        amountFen: 100_000,
        receivedOn: new Date('2026-01-01'),
        channel: 'CASH',
        proofFileId: proof.id,
        createdByUserId: managerId,
      },
    });
    const pack = await prisma.coursePackage.create({
      data: {
        campusId,
        studentId,
        name: '可核对来源课包',
        validFrom: new Date('2020-01-01'),
        mainBalanceUnits: 900,
        giftBalanceUnits: 400,
        mainReservedUnits: 100,
        giftReservedUnits: 100,
      },
    });
    const issuance = await prisma.financePackageIssuance.create({
      data: {
        receiptId: receipt.id,
        coursePackageId: pack.id,
        originalAmountFen: 100_000,
        initialMainUnits: 1000,
        initialGiftUnits: 400,
        name: pack.name,
        validFrom: pack.validFrom,
        issuedByUserId: managerId,
      },
    });
    for (const [bucket, units] of [
      ['MAIN', 1000],
      ['GIFT', 400],
    ] as const) {
      await prisma.lessonLedgerEntry.create({
        data: {
          campusId,
          studentId,
          coursePackageId: pack.id,
          bucket,
          entryType: 'GRANT',
          deltaUnits: units,
          balanceBeforeUnits: 0,
          balanceAfterUnits: units,
          idempotencyKey: `${runTag}-grant`,
          actorUserId: managerId,
        },
      });
    }
    const refundProof = await prisma.storedFile.create({
      data: {
        purpose: 'PAYMENT_PROOF',
        storageKey: `${runTag}/refund.png`,
        originalName: '不披露退费凭证.png',
        mimeType: 'image/png',
        sizeBytes: png.length,
        sha256: '1'.repeat(64),
        createdByUserId: managerId,
      },
    });
    const refund = await prisma.financeRefundRequest.create({
      data: {
        issuanceId: issuance.id,
        mainUnits: 100,
        giftUnits: 0,
        referenceAmountFen: 10_000,
        amountFen: 10_000,
        reason: '合成实际退款',
        status: 'PAID',
        requestedByUserId: parent.userId,
        reviewedByUserId: managerId,
        payment: {
          create: {
            amountFen: 10_000,
            paidAt: new Date('2026-02-01'),
            proofFileId: refundProof.id,
            externalReference: `${runTag}-refund`,
            recordedByUserId: managerId,
          },
        },
      },
    });
    await prisma.lessonLedgerEntry.create({
      data: {
        campusId,
        studentId,
        coursePackageId: pack.id,
        bucket: 'MAIN',
        entryType: 'REFUND',
        deltaUnits: -100,
        balanceBeforeUnits: 1000,
        balanceAfterUnits: 900,
        financeRefundId: refund.id,
        idempotencyKey: `${runTag}-refund`,
        actorUserId: managerId,
      },
    });
    await prisma.financeRefundRequest.create({
      data: {
        issuanceId: issuance.id,
        mainUnits: 100,
        giftUnits: 100,
        referenceAmountFen: 10_000,
        amountFen: 10_000,
        reason: '仅预留，不能当实际退款',
        requestedByUserId: parent.userId,
      },
    });
    await prisma.coursePackage.create({
      data: {
        campusId,
        studentId: unknownStudentId,
        name: '缺源历史包',
        validFrom: new Date('2020-01-01'),
        mainBalanceUnits: 321,
      },
    });
    for (const validity of ['expired', 'future', 'inactive']) {
      await prisma.coursePackage.create({
        data: {
          campusId,
          studentId: unknownStudentId,
          name: `不计可用-${validity}`,
          mainBalanceUnits: 90_000,
          validFrom:
            validity === 'future'
              ? new Date(Date.now() + 86_400_000)
              : new Date('2020-01-01'),
          expiresAt:
            validity === 'expired' ? new Date(Date.now() - 86_400_000) : null,
          isActive: validity !== 'inactive',
        },
      });
    }
    for (const status of ['COMPLETED', 'REVERSED'] as const) {
      const completedAt = new Date(
        status === 'COMPLETED'
          ? '2026-02-01T02:00:00Z'
          : '2026-02-02T02:00:00Z',
      );
      const reversal =
        status === 'REVERSED'
          ? {
              reversedAt: new Date('2026-02-03T02:00:00Z'),
              reversalReason: '合成撤销',
            }
          : {};
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId,
          classGroupId: group.id,
          teacherId: teacher.id,
          status,
          completedAt,
          ...reversal,
          startsAt: new Date(
            status === 'COMPLETED'
              ? '2026-02-01T01:00:00Z'
              : '2026-02-02T01:00:00Z',
          ),
          endsAt: completedAt,
        },
      });
      if (status === 'COMPLETED') completedId = lesson.id;
      else reversedId = lesson.id;
      await prisma.teachingRecord.create({
        data: {
          campusId,
          lessonSessionId: lesson.id,
          teacherId: teacher.id,
          status,
          attendeeCount: 1,
          lessonUnits: 100,
          recordedByUserId: teacherUser.userId,
          completedAt: lesson.endsAt,
          ...reversal,
        },
      });
      await prisma.attendanceRecord.create({
        data: {
          campusId,
          lessonSessionId: lesson.id,
          studentId,
          status: 'PRESENT',
          recordedByUserId: teacherUser.userId,
        },
      });
      await prisma.studentFeedback.create({
        data: {
          campusId,
          lessonSessionId: lesson.id,
          studentId,
          teacherId: teacher.id,
          content: `${status}老师原文`,
          performanceRating: 6,
          version: 2,
          teacherRatings: {
            classroomPerformance: 7,
            workCompletion: null,
            communication: 0,
            overall: 10,
          },
          ...(status === 'COMPLETED'
            ? {
                images: {
                  create: { storedFileId: storedImage.id, sortOrder: 0 },
                },
              }
            : {}),
        },
      });
      await prisma.parentLessonReview.create({
        data: {
          campusId,
          lessonSessionId: lesson.id,
          studentId,
          parentUserId: parent.userId,
          teaching: 8,
          communication: 7,
          environment: 9,
          overall: 8,
          note: '合成家长原评',
        },
      });
    }
    domainSnapshot = await snapshot();
  });

  afterAll(async () => {
    try {
      if (prisma && users.length) {
        assertCampusArchiveTestTarget(process.env);
        const disabled = await prisma.user.updateMany({
          where: { id: { in: users }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        const activeUsers = await prisma.user.count({
          where: { id: { in: users }, status: 'ACTIVE' },
        });
        expect(disabled.count).toBe(users.length);
        expect(activeUsers).toBe(0);
        console.info(
          'ARCHIVE_ACCOUNT_CLEANUP',
          JSON.stringify({ runTag, disabled: disabled.count, activeUsers }),
        );
      }
    } finally {
      await app?.close();
    }
  });

  it('reads reliable original receipts and refunds, reserved units and effective attendance', async () => {
    const response = await get(base()).expect(200);
    expectContractResponse(response.body, 'ArchiveEnvelope');
    const archive = data<Archive>(response);
    expectContractFields(archive, 'Archive');
    expectContractFields(archive.photo!, 'Media');
    expect(archive).toMatchObject({
      id: studentId,
      photo,
      mainBalanceUnits: 900,
      giftBalanceUnits: 400,
      mainAvailableUnits: 800,
      giftAvailableUnits: 300,
      availableTotalUnits: 1100,
      reservedTotalUnits: 200,
      warningThresholdUnits: 1200,
      lowBalance: true,
      enrollmentSummary: {
        receivedAmountFen: 100_000,
        refundedAmountFen: 10_000,
        initialMainUnits: 1000,
        initialGiftUnits: 400,
        pendingIssuanceCount: 0,
      },
      attendance: {
        presentCount: 1,
        recordedCount: 1,
        attendanceRateBasisPoints: 10000,
      },
    });
    expect(archive.ageYears).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(response.body)).not.toMatch(
      /birthDate|homeAddress|profileAge|phone|proofFileId|storageKey|parentUserId/,
    );
  });

  it('distinguishes unknown sources and missing age/photo from known zero totals', async () => {
    expect(
      data<Archive>(await get(base(unknownStudentId)).expect(200)),
    ).toMatchObject({
      ageYears: null,
      photo: null,
      availableTotalUnits: 321,
      enrollmentSummary: {
        receivedAmountFen: null,
        refundedAmountFen: null,
        initialMainUnits: null,
        initialGiftUnits: null,
      },
    });
    expect(
      data<Archive>(await get(base(emptyStudentId)).expect(200)),
    ).toMatchObject({
      ageYears: null,
      photo: null,
      availableTotalUnits: 0,
      enrollmentSummary: {
        receivedAmountFen: 0,
        refundedAmountFen: 0,
        initialMainUnits: 0,
        initialGiftUnits: 0,
      },
      attendance: { recordedCount: 0, attendanceRateBasisPoints: null },
    });
  });

  it('paginates stable completed/reversed history without merging distinct authors or ratings', async () => {
    const first = await get(`${base()}/growth?page=1&pageSize=1`).expect(200);
    expectContractResponse(first.body, 'GrowthEnvelope');
    const reversed = data<{ items: GrowthRecord[] }>(first).items[0];
    expectContractFields(reversed, 'GrowthRecord');
    expect(reversed).toMatchObject({
      lessonSessionId: reversedId,
      lessonStatus: 'REVERSED',
      feedbackValid: false,
      feedbackVersion: 2,
      review: { valid: false },
      feedbackImages: [],
      teacherRatings: {
        classroomPerformance: 7,
        workCompletion: null,
        communication: 0,
        overall: 10,
      },
    });
    expect(first.body).toMatchObject({
      meta: { page: 1, pageSize: 1, total: 2, totalPages: 2 },
    });
    const second = data<{ items: GrowthRecord[] }>(
      await get(`${base()}/growth?page=2&pageSize=1`).expect(200),
    ).items[0];
    expect(second).toMatchObject({
      lessonSessionId: completedId,
      feedbackValid: true,
      review: { valid: true },
      feedbackImages: [feedbackImage],
    });
    expect(JSON.stringify(first.body)).not.toMatch(
      /parentUserId|teacherId|phone|storageKey|homeAddress/,
    );
    const beyond = await get(`${base()}/growth?page=99&pageSize=1`).expect(200);
    expectContractResponse(beyond.body, 'GrowthEnvelope');
    expect(beyond.body).toMatchObject({
      data: { items: [] },
      meta: { total: 2, totalPages: 2 },
    });
  });

  it('rejects invalid pagination and identifiers', async () => {
    for (const query of ['page=0', 'pageSize=101', 'page=1.5']) {
      await get(`${base()}/growth?${query}`).expect(400);
    }
    await get(base('not-a-uuid')).expect(400);
  });

  it('denies another role, campus and inactive student for all archive resources', async () => {
    for (const path of [base(), `${base()}/growth`, photo.accessUrl]) {
      await get(path, wrongRoleToken).expect(403);
      await get(path, otherToken).expect(404);
      await request(server).get(path).expect(401);
    }
    for (const id of [otherStudentId, inactiveStudentId]) {
      await get(base(id)).expect(404);
      await get(`${base(id)}/growth`).expect(404);
      await get(imagePath(photo.id, id)).expect(404);
    }
  });

  it('downloads only currently associated private image bytes with no-store', async () => {
    for (const path of [photo.accessUrl, feedbackImage.accessUrl]) {
      const result = await get(path).expect(200);
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.body).toEqual(png);
    }
    await get(imagePath(unlinkedFileId)).expect(404);
    await get(imagePath(photo.id, emptyStudentId)).expect(404);
  });

  it('immediately rejects old photo and feedback URLs after unlinking', async () => {
    await prisma.student.update({
      where: { id: studentId },
      data: { profilePhotoFileId: null },
    });
    try {
      await get(photo.accessUrl).expect(404);
    } finally {
      await prisma.student.update({
        where: { id: studentId },
        data: { profilePhotoFileId: photo.id },
      });
    }
    const link = await prisma.studentFeedbackImage.findUniqueOrThrow({
      where: { storedFileId: feedbackImage.id },
    });
    await prisma.studentFeedbackImage.update({
      where: { id: link.id },
      data: { storedFileId: unlinkedFileId },
    });
    try {
      await get(feedbackImage.accessUrl).expect(404);
    } finally {
      await prisma.studentFeedbackImage.update({
        where: { id: link.id },
        data: { storedFileId: feedbackImage.id },
      });
    }
  });

  it('rejects existing URLs after student deactivation and live account revocation', async () => {
    await prisma.student.update({
      where: { id: studentId },
      data: { isActive: false },
    });
    try {
      for (const path of [base(), `${base()}/growth`, photo.accessUrl])
        await get(path).expect(404);
    } finally {
      await prisma.student.update({
        where: { id: studentId },
        data: { isActive: true },
      });
    }
    await prisma.user.update({
      where: { id: managerId },
      data: { status: 'DISABLED' },
    });
    try {
      for (const path of [base(), `${base()}/growth`, photo.accessUrl])
        await get(path).expect(401);
    } finally {
      await prisma.user.update({
        where: { id: managerId },
        data: { status: 'ACTIVE' },
      });
    }
    const role = await prisma.userRole.findFirstOrThrow({
      where: { userId: managerId },
    });
    await prisma.userRole.update({
      where: { id: role.id },
      data: { campusId: otherCampusId },
    });
    try {
      for (const path of [base(), `${base()}/growth`, feedbackImage.accessUrl])
        await get(path).expect(404);
    } finally {
      await prisma.userRole.update({
        where: { id: role.id },
        data: { campusId },
      });
    }
    await prisma.userRole.update({
      where: { id: role.id },
      data: { roleCode: 'PARENT' },
    });
    try {
      for (const path of [base(), `${base()}/growth`, feedbackImage.accessUrl])
        await get(path).expect(403);
    } finally {
      await prisma.userRole.update({
        where: { id: role.id },
        data: { roleCode: 'OPERATOR' },
      });
    }
  });

  it('does not alter enrollment, units, attendance, teaching, feedback or review facts', async () => {
    await get(base()).expect(200);
    await get(`${base()}/growth`).expect(200);
    expect(await snapshot()).toBe(domainSnapshot);
  });
});
