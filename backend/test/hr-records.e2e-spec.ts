import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { RoleCode } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('HR record tests require a local *_test database');
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
});

type RecordInput = {
  kind: 'QUALIFICATION' | 'TRAINING' | 'GROWTH';
  title: string;
  organization?: string | null;
  occurredOn: string;
  expiresOn?: string | null;
  note?: string;
  attachmentFileId?: string | null;
};
type AttachmentView = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};
type RecordView = Required<RecordInput> & {
  id: string;
  teacherId: string;
  attachment: AttachmentView | null;
  version: number;
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: string | null;
  createdByName: string;
};
type RecordPage = {
  items: RecordView[];
  total: number;
  page: number;
  pageSize: number;
};

function responseData<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

describe('headquarters HR teacher records HTTP', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let auth: AuthService;
  let teacherId: string;
  let campusId: string;
  let hr: { id: string; token: string };
  let secondHr: { id: string; token: string };
  const users: string[] = [];
  const runId = randomUUID();
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const pdf = Buffer.from('%PDF-1.7\nlocal hr record test\n', 'ascii');

  beforeAll(async () => {
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    campusId = (
      await prisma.campus.create({
        data: {
          code: `HR-RECORD-${runId}`,
          name: `人力记录验收校区-${runId}`,
        },
      })
    ).id;
    const teacher = await account([{ roleCode: 'TEACHER', campusId }]);
    teacherId = (
      await prisma.teacherProfile.create({
        data: {
          userId: teacher.id,
          campusId,
          employeeCode: `HRR-${runId}`,
          specialties: ['素质教育'],
        },
      })
    ).id;
    hr = await account([{ roleCode: 'HR', campusId: null }]);
    secondHr = await account([{ roleCode: 'HR', campusId: null }]);
  }, 60_000);

  afterAll(async () => {
    if (prisma && users.length) {
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { status: 'DISABLED' },
      });
    }
    await app?.close();
  });

  async function account(
    roles: Array<{ roleCode: RoleCode; campusId: string | null }>,
  ) {
    const user = await prisma.user.create({
      data: {
        displayName: `人力记录测试-${roles.map((role) => role.roleCode).join('-')}-${randomUUID()}`,
        roles: { create: roles },
      },
    });
    users.push(user.id);
    return {
      id: user.id,
      token: (await auth.issueSessionForUser(user.id)).accessToken,
    };
  }

  async function upload(
    token: string,
    options: {
      bytes?: Buffer;
      filename?: string;
      contentType?: string;
      status?: number;
    } = {},
  ) {
    const response = await request(server)
      .post('/hr/teacher-record-attachments')
      .auth(token, { type: 'bearer' })
      .attach('file', options.bytes ?? png, {
        filename: options.filename ?? 'qualification.png',
        contentType: options.contentType ?? 'image/png',
      })
      .expect(options.status ?? 201);
    return responseData<AttachmentView>(response);
  }

  async function createRecord(
    input: RecordInput,
    key = randomUUID(),
    token = hr.token,
    id = teacherId,
    status = 201,
  ) {
    const response = await request(server)
      .post(`/hr/teachers/${id}/records`)
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(input)
      .expect(status);
    return { response, key };
  }

  it('creates a record once, replays it and audits only the committed mutation', async () => {
    const attachment = await upload(hr.token, {
      bytes: pdf,
      filename: 'teacher-certificate.pdf',
      contentType: 'application/pdf',
    });
    expect(attachment).toMatchObject({
      originalName: 'teacher-certificate.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
    });
    expect(attachment).not.toHaveProperty('storageKey');
    expect(attachment).not.toHaveProperty('sha256');

    const input: RecordInput = {
      kind: 'QUALIFICATION',
      title: '高级家庭教育指导师',
      organization: '本地验收机构',
      occurredOn: '2026-08-01',
      expiresOn: '2028-08-01',
      note: '仅为测试记录',
      attachmentFileId: attachment.id,
    };
    const created = await createRecord(input);
    const replay = await createRecord(input, created.key);
    const createdData = responseData<RecordView>(created.response);
    expect(responseData<RecordView>(replay.response)).toEqual(createdData);
    expect(createdData).toMatchObject({
      teacherId,
      ...input,
      version: 1,
      status: 'ACTIVE',
      archivedAt: null,
      attachment,
    });
    expect(createdData.createdByName).toContain('人力记录测试-HR');
    expect(
      await prisma.hrTeacherRecord.count({
        where: { id: createdData.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'HR_TEACHER_RECORD_CREATE',
          resourceId: createdData.id,
          actorUserId: hr.id,
        },
      }),
    ).toBe(1);
  });

  it('lists stable pages and keeps archived history explicitly queryable', async () => {
    const first = await createRecord({
      kind: 'TRAINING',
      title: '儿童沟通培训',
      occurredOn: '2026-06-01',
    });
    await createRecord({
      kind: 'GROWTH',
      title: '晋级为高级教师',
      occurredOn: '2026-07-01',
      note: '',
    });
    const record = responseData<RecordView>(first.response);
    const archived = await request(server)
      .post(`/hr/teacher-records/${record.id}/archive`)
      .auth(hr.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: record.version, reason: '证书历史归档' })
      .expect(200);
    const archivedData = responseData<RecordView>(archived);
    expect(archivedData).toMatchObject({
      id: record.id,
      version: 2,
      status: 'ARCHIVED',
    });
    expect(archivedData.archivedAt).toEqual(expect.any(String));

    const active = await request(server)
      .get(`/hr/teachers/${teacherId}/records`)
      .auth(hr.token, { type: 'bearer' })
      .query({ kind: 'GROWTH', page: 1, pageSize: 1 })
      .expect(200);
    expect(responseData<RecordPage>(active)).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      items: [expect.objectContaining({ kind: 'GROWTH', status: 'ACTIVE' })],
    });
    const history = await request(server)
      .get(`/hr/teachers/${teacherId}/records`)
      .auth(hr.token, { type: 'bearer' })
      .query({ status: 'ARCHIVED', page: 1, pageSize: 20 })
      .expect(200);
    expect(responseData<RecordPage>(history).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: record.id, status: 'ARCHIVED' }),
      ]),
    );
    const all = await request(server)
      .get(`/hr/teachers/${teacherId}/records`)
      .auth(hr.token, { type: 'bearer' })
      .query({ status: 'ALL', page: 1, pageSize: 2 })
      .expect(200);
    const allData = responseData<RecordPage>(all);
    expect(allData.items).toHaveLength(2);
    expect(allData.items[0].occurredOn >= allData.items[1].occurredOn).toBe(
      true,
    );
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'HR_TEACHER_RECORD_ARCHIVE',
          resourceId: record.id,
          actorUserId: hr.id,
        },
      }),
    ).toBe(1);
  });

  it('updates an active record with version checks and rejects invalid dates', async () => {
    const previousAttachment = await upload(hr.token, {
      bytes: pdf,
      filename: 'previous.pdf',
      contentType: 'application/pdf',
    });
    const replacementAttachment = await upload(hr.token, {
      bytes: pdf,
      filename: 'replacement.pdf',
      contentType: 'application/pdf',
    });
    const created = await createRecord({
      kind: 'GROWTH',
      title: '初始成长记录',
      occurredOn: '2026-05-01',
      attachmentFileId: previousAttachment.id,
    });
    const record = responseData<RecordView>(created.response);
    const updatedInput = {
      kind: 'TRAINING',
      title: '复训完成',
      organization: null,
      occurredOn: '2026-05-02',
      expiresOn: null,
      note: '',
      attachmentFileId: replacementAttachment.id,
      expectedVersion: record.version,
    };
    const key = randomUUID();
    const updated = await request(server)
      .patch(`/hr/teacher-records/${record.id}`)
      .auth(hr.token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(updatedInput)
      .expect(200);
    const updatedData = responseData<RecordView>(updated);
    expect(updatedData).toMatchObject({
      kind: updatedInput.kind,
      title: updatedInput.title,
      organization: updatedInput.organization,
      occurredOn: updatedInput.occurredOn,
      expiresOn: updatedInput.expiresOn,
      note: updatedInput.note,
      attachmentFileId: updatedInput.attachmentFileId,
      version: 2,
      status: 'ACTIVE',
    });
    expect(updatedData).not.toHaveProperty('expectedVersion');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: 'HR_TEACHER_RECORD_UPDATE',
        resourceId: record.id,
        actorUserId: hr.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.details).toMatchObject({
      teacherId,
      before: {
        kind: 'GROWTH',
        title: '初始成长记录',
        organization: null,
        occurredOn: '2026-05-01',
        expiresOn: null,
        note: '',
        attachmentFileId: previousAttachment.id,
        version: 1,
        status: 'ACTIVE',
      },
      after: {
        kind: 'TRAINING',
        title: '复训完成',
        organization: null,
        occurredOn: '2026-05-02',
        expiresOn: null,
        note: '',
        attachmentFileId: replacementAttachment.id,
        version: 2,
        status: 'ACTIVE',
      },
    });
    await request(server)
      .patch(`/hr/teacher-records/${record.id}`)
      .auth(hr.token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(updatedInput)
      .expect(200);
    await request(server)
      .patch(`/hr/teacher-records/${record.id}`)
      .auth(hr.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(updatedInput)
      .expect(409);
    await createRecord(
      {
        kind: 'QUALIFICATION',
        title: '不得复用被替换附件',
        occurredOn: '2026-05-03',
        attachmentFileId: previousAttachment.id,
      },
      randomUUID(),
      hr.token,
      teacherId,
      409,
    );
    await createRecord(
      {
        kind: 'QUALIFICATION',
        title: '无效日期证书',
        occurredOn: '2026-09-01',
        expiresOn: '2026-08-31',
      },
      randomUUID(),
      hr.token,
      teacherId,
      400,
    );
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'HR_TEACHER_RECORD_UPDATE',
          resourceId: record.id,
          actorUserId: hr.id,
        },
      }),
    ).toBe(1);
  });

  it('validates attachment signature, ownership and one-record linkage', async () => {
    await upload(hr.token, {
      bytes: Buffer.from('not a png', 'utf8'),
      filename: 'fake.png',
      contentType: 'image/png',
      status: 400,
    });
    const foreign = await upload(secondHr.token);
    await createRecord(
      {
        kind: 'QUALIFICATION',
        title: '不属于当前上传者',
        occurredOn: '2026-03-01',
        attachmentFileId: foreign.id,
      },
      randomUUID(),
      hr.token,
      teacherId,
      400,
    );
    const owned = await upload(hr.token);
    await createRecord({
      kind: 'QUALIFICATION',
      title: '已关联文件',
      occurredOn: '2026-03-02',
      attachmentFileId: owned.id,
    });
    await createRecord(
      {
        kind: 'TRAINING',
        title: '重复关联文件',
        occurredOn: '2026-03-03',
        attachmentFileId: owned.id,
      },
      randomUUID(),
      hr.token,
      teacherId,
      409,
    );
  });

  it('reads attachment bytes only through an authorized record and forbids caching', async () => {
    const attachment = await upload(hr.token);
    const created = await createRecord({
      kind: 'QUALIFICATION',
      title: '附件读取记录',
      occurredOn: '2026-02-01',
      attachmentFileId: attachment.id,
    });
    const recordId = responseData<RecordView>(created.response).id;
    const file = await request(server)
      .get(`/hr/teacher-records/${recordId}/attachment`)
      .auth(hr.token, { type: 'bearer' })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
        response.on('error', callback);
      })
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    expect(file.body).toEqual(png);

    const teacher = await account([{ roleCode: 'TEACHER', campusId }]);
    await request(server)
      .get(`/hr/teacher-records/${recordId}/attachment`)
      .auth(teacher.token, { type: 'bearer' })
      .expect(403);
    await request(server)
      .get(`/hr/teacher-records/${randomUUID()}/attachment`)
      .auth(hr.token, { type: 'bearer' })
      .expect(404);
  });

  it('rejects non-HR, mixed-role and campus-bound HR identities', async () => {
    const teacher = await account([{ roleCode: 'TEACHER', campusId }]);
    const mixed = await account([
      { roleCode: 'HR', campusId: null },
      { roleCode: 'FINANCE', campusId: null },
    ]);
    const scopedHr = await account([{ roleCode: 'HR', campusId }]);
    for (const actor of [teacher, mixed, scopedHr]) {
      await request(server)
        .get(`/hr/teachers/${teacherId}/records`)
        .auth(actor.token, { type: 'bearer' })
        .expect(403);
      await request(server)
        .post(`/hr/teachers/${teacherId}/records`)
        .auth(actor.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          kind: 'GROWTH',
          title: '越权记录',
          occurredOn: '2026-01-01',
        })
        .expect(403);
    }
  });
});
