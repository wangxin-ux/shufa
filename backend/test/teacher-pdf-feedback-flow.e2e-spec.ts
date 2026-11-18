import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { FeedbackService } from '../src/modules/feedback/feedback.service';
import { DomainError } from '../src/common/errors/domain-error';
import { TeacherReadService } from '../src/modules/scheduling/teacher-read.service';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertTeacherPdfTestTarget } from './support/teacher-pdf-test-database';
import { createTeacherPdfTestApp } from './support/teacher-pdf-test-app';
import { createTeacherFixtureUser } from './support/teacher-feedback-integration-app';
import type { TeacherHttpRequest } from '../../frontend/data/api-teacher-data-source';

assertTeacherPdfTestTarget(process.env);
jest.setTimeout(60_000);

interface ImageView {
  id: string;
  accessUrl: string;
}
interface FeedbackStudent {
  id: string;
  feedback: string;
  feedbackDraft: string;
  feedbackVersion: number;
  teacherRatingsDraft: {
    classroomPerformance: number | null;
    workCompletion: number | null;
    communication: number | null;
    overall: number | null;
  };
  performanceRating: number | null;
  feedbackImages: ImageView[];
  readOnly: boolean;
}
type StudentEvent = {
  currentTarget: {
    dataset: { id: string; field?: string; url?: string; imageId?: string };
  };
  detail: { value: string };
};
interface FeedbackPage {
  data: {
    viewState: string;
    students: FeedbackStudent[];
    mutationMessage: string;
    refreshError: string;
    imageError: string;
    draftImageUrls: Record<string, string>;
  };
  onLoad(options: { id: string }): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onFeedbackInput(event: StudentEvent): void;
  onPerformanceChange(event: StudentEvent): void;
  onTeacherRatingChange(event: StudentEvent): void;
  onPreviewImages(event: StudentEvent): void;
  onFeedbackImageError(event: StudentEvent): void;
  onRetryImages(): void;
  onChooseImages(event: StudentEvent): Promise<void>;
  onSaveFeedback(event: StudentEvent): Promise<void>;
}
interface StudentDetailPage {
  data: {
    viewState: string;
    detail: { displayName: string; latestFeedbackContent: string };
  };
  onLoad(options: { id: string }): void;
  onShow(): void;
  onUnload(): void;
  onFeedback(): void;
}
interface FeedbackListPage {
  data: {
    viewState: string;
    items: Array<{ lessonSessionId: string }>;
  };
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onFeedbackTap(event: { currentTarget: { dataset: { id: string } } }): void;
}
interface UploadOptions {
  url: string;
  header: Record<string, string>;
  filePath: string;
  name: string;
  success(result: { statusCode: number; data: string }): void;
  fail(error: unknown): void;
}
interface HttpHost {
  capture(route: string): unknown;
  idle(): Promise<void>;
  close(): Promise<void>;
  wx: {
    request: TeacherHttpRequest;
    navigateTo: jest.Mock;
    showToast: jest.Mock;
    chooseMedia?: (options: {
      success(result: {
        tempFiles: Array<{ tempFilePath: string; size: number }>;
      }): void;
    }) => void;
    uploadFile?: (options: UploadOptions) => void;
    previewImage?: jest.Mock;
  };
  transport: { calls: Array<{ url: string; key?: string; body?: object }> };
}
interface ParentUpdates {
  data: {
    records: Array<{
      lessonSessionId: string;
      feedback: string;
      performanceRating: number | null;
      lessonStatus: string;
      feedbackImages: ImageView[];
      teacherRatings: FeedbackStudent['teacherRatingsDraft'];
    }>;
  };
}

function waitForFeedbackHttpResponse(
  response: Promise<number>,
  write: Promise<void>,
): Promise<number> {
  return Promise.race([
    response,
    write.then(() => {
      throw new Error('Feedback write ended without a captured HTTP response');
    }),
  ]);
}

it('ends the feedback response wait when a write completes without a response', async () => {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    const result = await Promise.race([
      waitForFeedbackHttpResponse(
        new Promise<number>(() => {}),
        Promise.resolve(),
      ).then(
        () => 'response',
        () => 'write-ended',
      ),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('still-waiting'), 100);
      }),
    ]);
    expect(result).toBe('write-ended');
  } finally {
    clearTimeout(timer);
  }
});

it('retains a captured feedback HTTP status even when the write already completed', async () => {
  await expect(
    waitForFeedbackHttpResponse(Promise.resolve(403), Promise.resolve()),
  ).resolves.toBe(403);
});

describe('teacher feedback Page and bound parent through isolated real HTTP', () => {
  const runTag = `tfeedback-${process.env.TEACHER_PDF_TEST_RUN_ID}-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  let app: INestApplication<Server>, prisma: PrismaService;
  let campusId: string,
    studentId: string,
    otherStudentId: string,
    lessonId: string;
  let teacher: { id: string; teacherId: string; token: string };
  let otherTeacher: typeof teacher,
    parentToken: string,
    otherParentToken: string;
  let port: number, origin: string, png: Buffer;
  let host: HttpHost | undefined, page: FeedbackPage;
  const http = () => request(app.getHttpServer());
  const base = () => `/teachers/me/lesson-sessions/${lessonId}`;
  const feedback = (id = studentId) => `${base()}/students/${id}/feedback`;
  const event = (value = ''): StudentEvent => ({
    currentTarget: { dataset: { id: studentId } },
    detail: { value },
  });
  const updates = async () =>
    (
      await http()
        .get('/parents/me/updates')
        .auth(parentToken, { type: 'bearer' })
        .query({ studentId })
        .expect(200)
    ).body as ParentUpdates;
  const stored = () =>
    prisma.studentFeedback.findUniqueOrThrow({
      where: {
        lessonSessionId_studentId: { lessonSessionId: lessonId, studentId },
      },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
  const feedbackFacts = async () => ({
    feedback: await stored(),
    revisions: await prisma.studentFeedbackRevision.findMany({
      where: { feedback: { lessonSessionId: lessonId } },
      orderBy: { id: 'asc' },
    }),
    audits: await prisma.auditLog.findMany({
      where: { campusId, action: 'TEACHER_FEEDBACK_UPSERT' },
      orderBy: { id: 'asc' },
    }),
  });
  const teachingFacts = async () => ({
    lesson: await prisma.lessonSession.findUniqueOrThrow({
      where: { id: lessonId },
    }),
    attendance: await prisma.attendanceRecord.findMany({
      where: { lessonSessionId: lessonId },
      orderBy: { id: 'asc' },
    }),
    ledger: await prisma.lessonLedgerEntry.findMany({
      where: { campusId },
      orderBy: { id: 'asc' },
    }),
    packages: await prisma.coursePackage.findMany({
      where: { campusId },
      orderBy: { id: 'asc' },
    }),
    earnings: await prisma.teacherEarningEntry.findMany({
      where: { campusId },
      orderBy: { id: 'asc' },
    }),
    earningBases: await prisma.teacherEarningBasis.findMany({
      where: { campusId },
      orderBy: { id: 'asc' },
    }),
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTeacherPdfTestApp());
    campusId = (
      await prisma.campus.create({ data: { code: runTag, name: runTag } })
    ).id;
    const actor = async (suffix: string, roleCode: 'TEACHER' | 'PARENT') => {
      const user = await createTeacherFixtureUser(prisma, {
        displayName: `${runTag}-${suffix}`,
        roles: { create: { roleCode, campusId } },
        ...(roleCode === 'TEACHER'
          ? {
              teacherProfile: {
                create: {
                  campusId,
                  employeeCode: `${runTag}-${suffix}`,
                },
              },
            }
          : {}),
      });
      users.push(user.id);
      return {
        id: user.id,
        teacherId: user.teacherProfile?.id ?? '',
        token: (await app.get(AuthService).issueSessionForUser(user.id))
          .accessToken,
      };
    };
    teacher = await actor('teacher', 'TEACHER');
    otherTeacher = await actor('otherteacher', 'TEACHER');
    const parent = await actor('parent', 'PARENT');
    const otherParent = await actor('otherparent', 'PARENT');
    parentToken = parent.token;
    otherParentToken = otherParent.token;
    studentId = (
      await prisma.student.create({
        data: {
          campusId,
          displayName: `${runTag}-student`,
          parentBindings: {
            create: { campusId, parentUserId: parent.id, isPrimary: true },
          },
        },
      })
    ).id;
    otherStudentId = (
      await prisma.student.create({
        data: {
          campusId,
          displayName: `${runTag}-otherstudent`,
          parentBindings: {
            create: { campusId, parentUserId: otherParent.id, isPrimary: true },
          },
        },
      })
    ).id;
    const group = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId: teacher.teacherId,
        name: runTag,
        courseName: '合成教学',
        members: { create: { campusId, studentId } },
      },
    });
    const lesson = await prisma.lessonSession.create({
      data: {
        campusId,
        teacherId: teacher.teacherId,
        classGroupId: group.id,
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() - 1_000),
      },
    });
    lessonId = lesson.id;
    await prisma.coursePackage.create({
      data: {
        campusId,
        studentId,
        name: runTag,
        mainBalanceUnits: 500,
      },
    });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    origin = `http://127.0.0.1:${port}`;
    await http()
      .post(`${base()}/complete`)
      .auth(teacher.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({
        lessonVersion: 1,
        attendance: [{ studentId, status: 'PRESENT' }],
      })
      .expect(200);
    // A small synthetic PNG is uploaded through the real multipart endpoint.
    png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCZkAAAAASUVORK5CYII=',
      'base64',
    );
  });

  afterAll(async () => {
    try {
      await host?.close();
      if (prisma && users.length) {
        expect(
          (
            await prisma.user.updateMany({
              where: {
                id: { in: users },
                displayName: { startsWith: `${runTag}-` },
              },
              data: { status: 'DISABLED' },
            })
          ).count,
        ).toBe(users.length);
        expect(
          await prisma.user.count({
            where: { id: { in: users }, status: 'DISABLED' },
          }),
        ).toBe(users.length);
        console.log(
          'TEACHER_FEEDBACK_FIXTURES',
          JSON.stringify({
            runTag,
            userIds: users,
            campusId,
            lessonId,
            studentId,
            otherStudentId,
            port,
            storedFiles: await prisma.storedFile.count({
              where: { createdByUserId: teacher.id },
            }),
            disposition:
              'accounts disabled; records and uploaded evidence retained',
          }),
        );
      }
    } finally {
      await app?.close();
    }
  });

  it('uploads an image, saves text and a single rating from the Page, and reads the same facts as the parent', async () => {
    const { createTeacherHttpPageHost } = jest.requireActual<{
      createTeacherHttpPageHost: (options: {
        origin: string;
        accessToken: string;
        routes: Array<{ method: 'GET' | 'PUT'; path: string }>;
      }) => HttpHost;
    }>('../../frontend/tests/teacher-http-page-test-support');
    host = createTeacherHttpPageHost({
      origin,
      accessToken: teacher.token,
      routes: [
        { method: 'GET', path: base() },
        { method: 'PUT', path: feedback() },
        { method: 'GET', path: `/teachers/me/students/${studentId}` },
        { method: 'GET', path: '/teachers/me/teaching-records' },
      ],
    });
    const uploadPath = `${feedback()}-images`;
    host.wx.chooseMedia = (options) =>
      options.success({
        tempFiles: [
          { tempFilePath: 'synthetic-feedback.png', size: png.length },
        ],
      });
    host.wx.uploadFile = (options) => {
      expect(options.url === `${origin}${uploadPath}`).toBe(true);
      expect(options.header.Authorization === `Bearer ${teacher.token}`).toBe(
        true,
      );
      expect(options.filePath).toBe('synthetic-feedback.png');
      void request(origin)
        .post(uploadPath)
        .auth(teacher.token, { type: 'bearer' })
        .attach('file', png, {
          filename: 'synthetic-feedback.png',
          contentType: 'image/png',
        })
        .then((response) =>
          options.success({
            statusCode: response.status,
            data: JSON.stringify(response.body),
          }),
        )
        .catch((error: unknown) => options.fail(error));
    };
    page = host.capture('feedback-detail') as FeedbackPage;
    page.onLoad({ id: lessonId });
    page.onShow();
    await host.idle();
    expect(page.data.viewState).toBe('ready');
    page.onFeedbackInput(event('合成课堂反馈：构图和色彩练习完成'));
    page.onPerformanceChange(event('9'));
    await page.onChooseImages(event());
    expect(page.data.students[0].feedbackImages).toHaveLength(1);
    await page.onSaveFeedback(event());
    await host.idle();
    expect(page.data.students[0].feedback).toBe(
      '合成课堂反馈：构图和色彩练习完成',
    );
    expect(page.data.students[0].performanceRating).toBe(9);
    const saved = await stored();
    expect(saved.content).toBe(page.data.students[0].feedback);
    expect(saved.images.map((image) => image.storedFileId)).toEqual(
      page.data.students[0].feedbackImages.map((image) => image.id),
    );
    const parent = (await updates()).data.records.find(
      (record) => record.lessonSessionId === lessonId,
    )!;
    expect(parent.feedback).toBe(saved.content);
    expect(parent.performanceRating).toBe(9);
    expect(parent.feedbackImages.map((image) => image.id)).toEqual(
      saved.images.map((image) => image.storedFileId),
    );
    const media = await http()
      .get(parent.feedbackImages[0].accessUrl)
      .expect(200);
    expect(media.headers['content-type']).toMatch(/^image\/png/);
    expect(Buffer.compare(media.body as Buffer, png)).toBe(0);
    await http()
      .get(parent.feedbackImages[0].accessUrl.split('?')[0])
      .expect(404);
    const wire = host.transport.calls.find((call) => call.url === feedback())!;
    await http()
      .put(feedback())
      .auth(teacher.token, { type: 'bearer' })
      .set('Idempotency-Key', wire.key!)
      .send(wire.body)
      .expect(200);
    expect(
      await prisma.studentFeedbackImage.count({
        where: { feedbackId: saved.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          campusId,
          action: 'TEACHER_FEEDBACK_UPSERT',
          resourceId: `${lessonId}:${studentId}`,
        },
      }),
    ).toBe(1);
    const detailPage = host.capture('student-detail') as StudentDetailPage;
    detailPage.onLoad({ id: studentId });
    detailPage.onShow();
    await host.idle();
    expect(detailPage.data).toMatchObject({
      viewState: 'ready',
      detail: {
        displayName: `${runTag}-student`,
        latestFeedbackContent: saved.content,
      },
    });
    detailPage.onFeedback();
    expect(host.wx.navigateTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: '/pages/teacher/feedback/index' }),
    );
    detailPage.onUnload();
    const listPage = host.capture('feedback') as FeedbackListPage;
    listPage.onLoad();
    listPage.onShow();
    await host.idle();
    expect(listPage.data.viewState).toBe('ready');
    expect(listPage.data.items.map((item) => item.lessonSessionId)).toContain(
      lessonId,
    );
    listPage.onFeedbackTap({
      currentTarget: { dataset: { id: lessonId } },
    });
    expect(host.wx.navigateTo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: `/pages/teacher/feedback-detail/index?id=${lessonId}`,
      }),
    );
    listPage.onUnload();
  });

  it('rejects other teachers, other parents, foreign students and invalid ratings without changing feedback', async () => {
    const before = await stored();
    await http()
      .get(base())
      .auth(otherTeacher.token, { type: 'bearer' })
      .expect(403);
    await http()
      .put(feedback())
      .auth(otherTeacher.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ content: '越权', imageFileIds: [] })
      .expect(403);
    await http()
      .put(feedback(otherStudentId))
      .auth(teacher.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ content: '越权', imageFileIds: [] })
      .expect(403);
    await http()
      .get('/parents/me/updates')
      .auth(otherParentToken, { type: 'bearer' })
      .query({ studentId })
      .expect(403);
    for (const rating of [0, 11, 1.5]) {
      await http()
        .put(feedback())
        .auth(teacher.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          content: '非法评分',
          imageFileIds: [],
          performanceRating: rating,
        })
        .expect(400);
    }
    await http()
      .put(feedback())
      .auth(teacher.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({
        content: '无效图片',
        imageFileIds: [randomUUID()],
        expectedVersion: before.version,
      })
      .expect(400);
    expect(await stored()).toEqual(before);
  });

  it('keeps media-return drafts through a failed read, refreshes expired signed images, and saves the same facts for the parent', async () => {
    const mediaPath = (url: string) => {
      const target = new URL(url, origin);
      expect(target.origin).toBe(origin);
      return target.pathname + target.search;
    };
    const before = await feedbackFacts();
    const teachingBefore = await teachingFacts();
    expect(teachingBefore.ledger.length).toBeGreaterThan(0);
    const original = page.data.students[0];
    expect(original.feedbackImages).toHaveLength(1);
    const originalUrl = original.feedbackImages[0].accessUrl;
    const content = '预览返场保留的构图与色彩练习反馈';
    const scores = {
      classroomPerformance: 0,
      workCompletion: 7,
      communication: null,
      overall: 10,
    };
    page.onFeedbackInput(event(content));
    for (const [field, value] of Object.entries(scores)) {
      page.onTeacherRatingChange({
        currentTarget: { dataset: { id: studentId, field } },
        detail: { value: String(value === null ? 0 : value + 1) },
      });
    }
    await page.onChooseImages(event());
    const draft = structuredClone(page.data.students);
    const localUrl = page.data.draftImageUrls[draft[0].feedbackImages[1].id];
    expect(localUrl).toBe('synthetic-feedback.png');
    host!.wx.previewImage = jest.fn();
    page.onPreviewImages({
      currentTarget: { dataset: { id: studentId, url: originalUrl } },
      detail: { value: '' },
    });
    expect(host!.wx.previewImage).toHaveBeenCalledWith(
      expect.objectContaining({
        current: originalUrl,
        urls: [originalUrl, localUrl],
      }),
    );
    page.onHide();
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 16 * 60_000);
    const reads = jest.spyOn(app.get(TeacherReadService), 'getLessonSession');
    try {
      await http().get(mediaPath(originalUrl)).expect(404);
      reads.mockRejectedValueOnce(
        new DomainError('INTERNAL_SERVER_ERROR', '合成预览返场读取失败', 503),
      );
      const callsBefore = host!.transport.calls.length;
      page.onShow();
      await host!.idle();
      expect(host!.transport.calls.slice(callsBefore)).toEqual([
        expect.objectContaining({ url: base() }),
      ]);
      expect(page.data).toMatchObject({
        viewState: 'ready',
        refreshError: '反馈刷新失败，请重试',
        students: draft,
      });
      expect(await feedbackFacts()).toEqual(before);
      page.onFeedbackImageError({
        currentTarget: {
          dataset: {
            id: studentId,
            imageId: original.feedbackImages[0].id,
            url: originalUrl,
          },
        },
        detail: { value: '' },
      });
      expect(page.data.imageError).toContain('图片');
      page.onRetryImages();
      await host!.idle();
      const refreshed = page.data.students[0];
      expect(page.data).toMatchObject({
        viewState: 'ready',
        refreshError: '',
        imageError: '',
      });
      expect(refreshed).toMatchObject({
        feedback: original.feedback,
        feedbackDraft: content,
        feedbackVersion: original.feedbackVersion,
        teacherRatingsDraft: scores,
      });
      expect(refreshed.feedbackImages.map(({ id }) => id)).toEqual(
        draft[0].feedbackImages.map(({ id }) => id),
      );
      expect(refreshed.feedbackImages[0].accessUrl).not.toBe(originalUrl);
      const image = await http()
        .get(mediaPath(refreshed.feedbackImages[0].accessUrl))
        .expect(200);
      expect(Buffer.compare(image.body as Buffer, png)).toBe(0);
      await http()
        .get(mediaPath(refreshed.feedbackImages[1].accessUrl))
        .expect(404);
      page.onPreviewImages({
        currentTarget: { dataset: { id: studentId, url: localUrl } },
        detail: { value: '' },
      });
      expect(host!.wx.previewImage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          current: localUrl,
          urls: [refreshed.feedbackImages[0].accessUrl, localUrl],
        }),
      );
      expect(await feedbackFacts()).toEqual(before);
      expect(await teachingFacts()).toEqual(teachingBefore);
      const callsBeforeSave = host!.transport.calls.length;
      const previewCalls = host!.wx.previewImage.mock.calls.length;
      const saving = page.onSaveFeedback(event());
      page.onPreviewImages({
        currentTarget: { dataset: { id: studentId, url: localUrl } },
        detail: { value: '' },
      });
      expect(host!.wx.previewImage).toHaveBeenCalledTimes(previewCalls);
      await saving;
      await host!.idle();
      const writes = host!.transport.calls.slice(callsBeforeSave);
      expect(writes).toEqual([
        expect.objectContaining({
          url: feedback(),
          body: expect.objectContaining({
            content,
            teacherRatings: scores,
            expectedVersion: original.feedbackVersion,
            imageFileIds: draft[0].feedbackImages.map(({ id }) => id),
          }) as unknown,
        }),
      ]);
      const after = await feedbackFacts();
      expect(after.feedback).toMatchObject({
        content,
        teacherRatings: scores,
        version: before.feedback.version + 1,
      });
      expect(after.revisions).toHaveLength(before.revisions.length + 1);
      expect(after.audits).toHaveLength(before.audits.length + 1);
      expect(
        after.feedback.images.map(({ storedFileId }) => storedFileId),
      ).toEqual(draft[0].feedbackImages.map(({ id }) => id));
      expect(page.data.draftImageUrls).toEqual({});
      expect(JSON.stringify(writes)).not.toContain(localUrl);
      const parent = (await updates()).data.records.find(
        (record) => record.lessonSessionId === lessonId,
      )!;
      expect(parent).toMatchObject({
        feedback: content,
        teacherRatings: scores,
      });
      expect(parent.feedbackImages.map(({ id }) => id)).toEqual(
        draft[0].feedbackImages.map(({ id }) => id),
      );
      for (const item of parent.feedbackImages) {
        const parentImage = await http()
          .get(mediaPath(item.accessUrl))
          .expect(200);
        expect(Buffer.compare(parentImage.body as Buffer, png)).toBe(0);
      }
      expect(await teachingFacts()).toEqual(teachingBefore);
      console.log(
        'TEACHER_FEEDBACK_MEDIA_RETURN',
        JSON.stringify({
          runTag,
          lessonId,
          studentId,
          previewLifecycle: 'Page host callbacks; not native',
          expiredImageRejected: true,
          failedReturnPreservedDrafts: true,
          refreshedImageBytesMatch: true,
          expiredUnsavedImageUsesChosenLocalFile: true,
          localPathNotSubmitted: true,
          previewBlockedDuringSave: true,
          version: after.feedback.version,
          independentRatings: scores,
          parentReadbackMatches: true,
          teachingFactsUnchanged: true,
        }),
      );
    } finally {
      reads.mockRestore();
      clock.mockRestore();
    }
  });

  it('continues saving after a committed background receipt before or after returning, even when the return read fails', async () => {
    const teachingBefore = await teachingFacts();
    expect(teachingBefore.ledger.length).toBeGreaterThan(0);
    const service = app.get(FeedbackService);
    const upsert = service.upsert.bind(service);
    const outcomes: Array<{
      timing: string;
      confirmedVersion: number;
      nextVersion: number;
    }> = [];
    for (const timing of ['before-return', 'after-return']) {
      const before = await feedbackFacts();
      const content = `后台回执${timing}的合成反馈`;
      const scores = {
        classroomPerformance: 0,
        workCompletion: 7,
        communication: null,
        overall: 10,
      };
      page.onFeedbackInput(event(content));
      for (const [field, value] of Object.entries(scores)) {
        page.onTeacherRatingChange({
          currentTarget: { dataset: { id: studentId, field } },
          detail: { value: String(value === null ? 0 : value + 1) },
        });
      }
      let release!: () => void, committed!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const commit = new Promise<void>((resolve) => {
        committed = resolve;
      });
      const saves = jest
        .spyOn(service, 'upsert')
        .mockImplementationOnce(async (...args) => {
          const result = await upsert(...args);
          committed();
          await held;
          return result;
        });
      const reads = jest.spyOn(app.get(TeacherReadService), 'getLessonSession');
      const toastCount = host!.wx.showToast.mock.calls.length;
      const callCount = host!.transport.calls.length;
      try {
        const pending = page.onSaveFeedback(event());
        page.onHide();
        await commit;
        expect((await stored()).version).toBe(before.feedback.version + 1);
        reads.mockRejectedValueOnce(
          new DomainError('INTERNAL_SERVER_ERROR', '合成后台返场读取失败', 503),
        );
        if (timing === 'after-return') page.onShow();
        release();
        await pending;
        await host!.idle();
        if (timing === 'before-return') {
          expect(page.data.students[0].feedbackVersion).toBe(
            before.feedback.version,
          );
          page.onShow();
          await host!.idle();
        }
        expect(host!.wx.showToast).toHaveBeenCalledTimes(toastCount);
        expect(page.data).toMatchObject({
          viewState: 'ready',
          refreshError: '反馈刷新失败，请重试',
        });
        expect(page.data.students[0]).toMatchObject({
          feedback: content,
          feedbackDraft: content,
          feedbackVersion: before.feedback.version + 1,
          teacherRatingsDraft: scores,
        });
        page.onFeedbackInput(event(`${content}继续编辑`));
        await page.onSaveFeedback(event());
        await host!.idle();
        const wires = host!.transport.calls.slice(callCount);
        expect(wires.map(({ url }) => url)).toEqual([
          feedback(),
          base(),
          feedback(),
        ]);
        const first: unknown = wires[0].body;
        const next: unknown = wires[2].body;
        expect(first).toMatchObject({
          content,
          expectedVersion: before.feedback.version,
        });
        expect(next).toMatchObject({
          content: `${content}继续编辑`,
          expectedVersion: before.feedback.version + 1,
          imageFileIds: before.feedback.images.map(
            ({ storedFileId }) => storedFileId,
          ),
          teacherRatings: scores,
        });
        expect(wires[2].key).not.toBe(wires[0].key);
        const after = await feedbackFacts();
        expect(after.feedback).toMatchObject({
          content: `${content}继续编辑`,
          version: before.feedback.version + 2,
          teacherRatings: scores,
        });
        expect(after.revisions).toHaveLength(before.revisions.length + 2);
        expect(
          after.revisions.filter(({ id }) =>
            before.revisions.some((old) => old.id === id),
          ),
        ).toEqual(before.revisions);
        expect(after.audits).toHaveLength(before.audits.length + 2);
        const parent = (await updates()).data.records.find(
          (record) => record.lessonSessionId === lessonId,
        )!;
        expect(parent).toMatchObject({
          feedback: after.feedback.content,
          teacherRatings: scores,
        });
        expect(parent.feedbackImages.map(({ id }) => id)).toEqual(
          before.feedback.images.map(({ storedFileId }) => storedFileId),
        );
        await http()
          .put(feedback())
          .auth(teacher.token, { type: 'bearer' })
          .set('Idempotency-Key', wires[0].key!)
          .send(wires[0].body)
          .expect(200);
        expect(await feedbackFacts()).toEqual(after);
        expect(await teachingFacts()).toEqual(teachingBefore);
        outcomes.push({
          timing,
          confirmedVersion: before.feedback.version + 1,
          nextVersion: after.feedback.version,
        });
      } finally {
        release();
        saves.mockRestore();
        reads.mockRestore();
      }
    }
    console.log(
      'TEACHER_FEEDBACK_BACKGROUND_SAVE',
      JSON.stringify({
        runTag,
        lessonId,
        studentId,
        outcomes,
        lifecycle: 'Page host; commit then hold real HTTP reply; not native',
        failedReturnReadRetainsConfirmedVersion: true,
        parentReadbackMatches: true,
        originalReplayCreatesNoRevision: true,
        teachingFactsUnchanged: true,
      }),
    );
  });

  it('clears private feedback on delayed real save and upload denials without relying on a return read', async () => {
    const feedbackBefore = await feedbackFacts();
    const teachingBefore = await teachingFacts();
    const files = () =>
      prisma.storedFile.findMany({
        where: { createdByUserId: teacher.id },
        orderBy: { id: 'asc' },
      });
    const commands = () =>
      prisma.idempotencyRecord.findMany({
        where: { campusId },
        orderBy: { id: 'asc' },
      });
    const filesBefore = await files(),
      commandsBefore = await commands();
    expect(teachingBefore.ledger.length).toBeGreaterThan(0);
    expect(filesBefore).toHaveLength(2);
    const outcomes: Array<{
      operation: string;
      timing: string;
      status: number;
    }> = [];
    const failedDeliveries: Array<{ operation: string; status: number }> = [];
    const originalRequest = host!.wx.request,
      originalUpload = host!.wx.uploadFile!;
    const setAccess = async (status: number, enabled: boolean) => {
      if (status === 401) {
        expect(
          (
            await prisma.user.updateMany({
              where: { id: teacher.id, displayName: `${runTag}-teacher` },
              data: { status: enabled ? 'ACTIVE' : 'DISABLED' },
            })
          ).count,
        ).toBe(1);
      } else {
        expect(
          (
            await prisma.teacherProfile.updateMany({
              where: { id: teacher.teacherId, userId: teacher.id, campusId },
              data: { isActive: enabled },
            })
          ).count,
        ).toBe(1);
      }
    };
    for (const operation of ['save', 'upload']) {
      for (const status of [401, 403]) {
        for (const timing of [
          'before-return',
          'after-return',
          'failed-delivery',
        ]) {
          let release!: () => void, received!: (value: number) => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          const responseReceived = new Promise<number>((resolve) => {
            received = resolve;
          });
          const reads = jest.spyOn(
            app.get(TeacherReadService),
            'getLessonSession',
          );
          let rejectedWireStatus: number | undefined;
          let pending: Promise<void> | undefined;
          try {
            page.onFeedbackInput(event(`权限收回前的${operation}私有草稿`));
            const toastCount = host!.wx.showToast.mock.calls.length;
            const callCount = host!.transport.calls.length;
            host!.wx.request = (options) =>
              originalRequest({
                ...options,
                success: (response) => {
                  if (
                    options.method === 'PUT' &&
                    new URL(options.url).pathname === feedback()
                  ) {
                    rejectedWireStatus = response.statusCode;
                    if (timing === 'failed-delivery') {
                      options.fail(
                        new Error(
                          'Synthetic feedback response delivery failure',
                        ),
                      );
                      return;
                    }
                    received(response.statusCode);
                    void held.then(() => options.success(response));
                  } else options.success(response);
                },
              });
            host!.wx.uploadFile = (options) =>
              originalUpload({
                ...options,
                success: (response) => {
                  rejectedWireStatus = response.statusCode;
                  if (timing === 'failed-delivery') {
                    options.fail(
                      new Error(
                        'Synthetic feedback image response delivery failure',
                      ),
                    );
                    return;
                  }
                  received(response.statusCode);
                  void held.then(() => options.success(response));
                },
              });
            await setAccess(status, false);
            pending =
              operation === 'save'
                ? page.onSaveFeedback(event())
                : page.onChooseImages(event());
            // Let selection reach the actual multipart request before backgrounding.
            await new Promise<void>((resolve) => setImmediate(resolve));
            page.onHide();
            if (timing === 'failed-delivery') {
              await expect(
                waitForFeedbackHttpResponse(responseReceived, pending),
              ).rejects.toThrow(
                'Feedback write ended without a captured HTTP response',
              );
              expect(rejectedWireStatus).toBe(status);
              failedDeliveries.push({ operation, status });
              continue;
            }
            expect(
              await waitForFeedbackHttpResponse(responseReceived, pending),
            ).toBe(status);
            reads.mockRejectedValueOnce(
              new DomainError(
                'INTERNAL_SERVER_ERROR',
                '合成失权后读取不可用',
                503,
              ),
            );
            if (timing === 'after-return') page.onShow();
            release();
            await pending;
            await host!.idle();
            if (timing === 'before-return') {
              expect(page.data.viewState).toBe('ready');
              page.onShow();
              await host!.idle();
            }
            expect(page.data).toMatchObject({
              viewState: 'forbidden',
              students: [],
              detail: null,
              draftImageUrls: {},
              feedbackSubmittingId: '',
              feedbackUploadingId: '',
            });
            // The known denial wins without issuing the deliberately unavailable GET.
            expect(reads).not.toHaveBeenCalled();
            expect(host!.wx.showToast).toHaveBeenCalledTimes(toastCount);
            const writes = host!.transport.calls.slice(callCount);
            expect(writes.map(({ url }) => url)).toEqual(
              operation === 'save' ? [feedback()] : [],
            );
            await page.onSaveFeedback(event());
            await page.onChooseImages(event());
            page.onRetryImages();
            page.onPreviewImages({
              ...event(),
              currentTarget: {
                dataset: { id: studentId, url: 'synthetic-feedback.png' },
              },
            });
            expect(host!.transport.calls).toHaveLength(
              callCount + writes.length,
            );
            expect(await feedbackFacts()).toEqual(feedbackBefore);
            expect(await teachingFacts()).toEqual(teachingBefore);
            expect(await files()).toEqual(filesBefore);
            expect(await commands()).toEqual(commandsBefore);
            outcomes.push({ operation, timing, status });
          } finally {
            release();
            try {
              await pending;
            } finally {
              host!.wx.request = originalRequest;
              host!.wx.uploadFile = originalUpload;
              reads.mockRestore();
              await setAccess(status, true);
              page.onUnload();
              page = host!.capture('feedback-detail') as FeedbackPage;
              page.onLoad({ id: lessonId });
              page.onShow();
              await host!.idle();
              expect(page.data.viewState).toBe('ready');
            }
          }
          expect(page.data.viewState).toBe('ready');
        }
      }
    }
    const parent = (await updates()).data.records.find(
      (record) => record.lessonSessionId === lessonId,
    )!;
    expect(parent).toMatchObject({
      feedback: feedbackBefore.feedback.content,
      teacherRatings: feedbackBefore.feedback.teacherRatings,
    });
    expect(parent.feedbackImages.map(({ id }) => id)).toEqual(
      feedbackBefore.feedback.images.map(({ storedFileId }) => storedFileId),
    );
    console.log(
      'TEACHER_FEEDBACK_BACKGROUND_DENIAL',
      JSON.stringify({
        runTag,
        lessonId,
        studentId,
        outcomes,
        failedDeliveries,
        lifecycle:
          'Page host; real database revocation and HTTP; delayed callback delivery; not native',
        rejectedBeforeBusinessMutation: true,
        returnReadNotNeeded: true,
        feedbackFilesCommandsAndTeachingFactsUnchanged: true,
        parentReadbackMatches: true,
      }),
    );
  });

  it('clears the optional rating from the Page and makes reversed feedback read-only', async () => {
    page.onPerformanceChange(event('0'));
    page.onFeedbackInput(event('合成课堂反馈已更新'));
    await page.onSaveFeedback(event());
    await host!.idle();
    expect((await stored()).performanceRating).toBeNull();
    expect((await updates()).data.records[0].feedback).toBe(
      '合成课堂反馈已更新',
    );
    await http()
      .post(`${base()}/reverse`)
      .auth(teacher.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ lessonVersion: 2, reason: '合成反馈撤销核对' })
      .expect(200);
    page.onShow();
    await host!.idle();
    expect(page.data.students[0].readOnly).toBe(true);
    const count = host!.transport.calls.length;
    page.onFeedbackInput(event('撤销后不可写'));
    await page.onSaveFeedback(event());
    expect(host!.transport.calls).toHaveLength(count);
    await http()
      .put(feedback())
      .auth(teacher.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ content: '撤销后不可写', imageFileIds: [] })
      .expect(409);
    expect((await stored()).content).toBe('合成课堂反馈已更新');
    expect((await updates()).data.records[0].lessonStatus).toBe('REVERSED');
  });
});
