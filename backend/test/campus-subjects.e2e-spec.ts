import { randomUUID } from 'node:crypto';
import { createConnection, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { captureCampaignPage } from './support/partner-campaign-page-harness';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
type Subject = { id: string; name: string; isActive: boolean; version: number };
type Link = {
  id: string;
  subjectId: string | null;
  subjectName: string | null;
  version: number;
};
type SubjectEvent = {
  currentTarget: { dataset: Record<string, unknown> };
  detail: { value: string | number | boolean };
};
interface SubjectComponent {
  data: {
    campusId: string;
    blocked: boolean;
    subjects: { rows: Subject[]; error: string; loaded: boolean };
    classes: { rows: Link[]; error: string; loaded: boolean };
    packages: { rows: Link[]; error: string; loaded: boolean };
    subjectOptions: Array<{ id: string | null; name: string }>;
    optionsLoaded: boolean;
    mutationState: string;
    forbidden: boolean;
    editor: unknown;
  };
  setData(patch: object): void;
  triggerEvent: jest.Mock;
  onCreate(): void;
  onNameInput(event: SubjectEvent): void;
  onEdit(event: SubjectEvent): void;
  onActiveChange(event: SubjectEvent): void;
  onSaveSubject(): Promise<void>;
  onRetryMutation(): Promise<void>;
  onBind(event: SubjectEvent): void;
  onSubjectPick(event: SubjectEvent): void;
  onClearSubject(): void;
  onReasonInput(event: SubjectEvent): void;
  onSaveBinding(): Promise<void>;
  onSearchInput(event: SubjectEvent): void;
  onSearch(event: SubjectEvent): void;
}
interface SubjectDefinition {
  data: SubjectComponent['data'];
  methods: Omit<SubjectComponent, 'data' | 'setData' | 'triggerEvent'>;
  lifetimes: {
    attached(this: SubjectComponent): void;
    detached(this: SubjectComponent): void;
  };
  pageLifetimes: { show(this: SubjectComponent): void };
}
interface SubjectWireOptions {
  url: string;
  method: 'GET' | 'POST' | 'PATCH';
  header: Record<string, string>;
  data?: object;
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: { errMsg: string }): void;
}
interface SubjectWireCall {
  method: string;
  path: string;
  body?: object;
  key?: string;
  status?: number;
  lost: boolean;
}
interface SubjectAccountPage {
  data: {
    viewState: string;
    subjectOptions: Array<{ value: string; label: string }>;
    entryTypeOptions: Array<{ value: string }>;
    items: Array<{ id: string; subjectLabel: string }>;
    summary: { totalBalanceLabel: string } | null;
    total: number;
  };
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onSubjectChange(event: { detail: { value: string } }): void;
  onEntryTypeChange(event: { detail: { value: string } }): void;
}
const data = <T>(response: { body: unknown }): T =>
  (response.body as { data: T }).data;

describe('campus subjects with preserved ledger history', () => {
  const runTag = `subject-${randomUUID().slice(0, 8)}`;
  const users: string[] = [],
    campuses: string[] = [],
    packages: string[] = [],
    students: string[] = [];
  const host = globalThis as unknown as Record<string, unknown>;
  const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
  const pending = new Set<Promise<void>>();
  const componentSubjects = new Set<string>();
  const componentCalls: SubjectWireCall[] = [];
  const components: Array<{
    instance: SubjectComponent;
    definition: SubjectDefinition;
  }> = [];
  const accountPages: SubjectAccountPage[] = [];
  let runtime: { dataDriver: string; apiBaseUrl: string; accessToken: string };
  let loseNextWrite = false;
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    port: number;
  let admin: string,
    partner: string,
    other: string,
    teacher: string,
    groupId: string;
  const root = (index = 0) =>
    `/management/campuses/${campuses[index]}/subjects`;
  const create = async (
    name: string,
    campus = 0,
    key = `${runTag}-${randomUUID()}`,
  ) => {
    const response = await request(server)
      .post(root(campus))
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(200);
    return data<Subject>(response);
  };
  const bind = (
    subjectId: string | null,
    expectedVersion: number,
    kind = 'PACKAGE',
    id = packages[0],
    campus = 0,
  ) =>
    request(server)
      .patch(`${root(campus)}/links/${kind}/${id}`)
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', `${runTag}-${randomUUID()}`)
      .send({ subjectId, expectedVersion, reason: '合成科目关联' });
  const ledger = (
    entryType: 'ADJUSTMENT' | 'CONSUME' | 'REVERSAL' = 'ADJUSTMENT',
    reversalOfId?: string,
  ) =>
    prisma.lessonLedgerEntry.create({
      data: {
        campusId: campuses[0],
        studentId: students[0],
        coursePackageId: packages[0],
        actorUserId: users[0],
        entryType,
        bucket: 'MAIN',
        deltaUnits: entryType === 'CONSUME' ? -100 : 100,
        balanceBeforeUnits: 1000,
        balanceAfterUnits: entryType === 'CONSUME' ? 900 : 1100,
        idempotencyKey: `${runTag}-${randomUUID()}`,
        reversalOfId,
      },
    });
  const frozen = async (id: string) =>
    (
      await prisma.$queryRaw<
        Array<{
          subjectId: string | null;
          subjectName: string | null;
        }>
      >`SELECT "subjectId", "subjectName" FROM "LessonLedgerEntry" WHERE "id" = ${id}::uuid`
    )[0];
  const read = (query: object = {}, token = partner) =>
    request(server)
      .get('/partners/me/lesson-account')
      .auth(token, { type: 'bearer' })
      .query(query);
  const event = (
    dataset: Record<string, unknown> = {},
    value: SubjectEvent['detail']['value'] = '',
  ): SubjectEvent => ({ currentTarget: { dataset }, detail: { value } });
  const idle = async () => {
    for (let round = 0; round < 30; round++) {
      await Promise.all([...pending]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!pending.size) return;
    }
    throw new Error('Subject component transport did not become idle');
  };
  const wire = (options: SubjectWireOptions) => {
    const target = new URL(options.url);
    const token = options.header.Authorization?.replace(/^Bearer /, '');
    const subjectPath = [...componentSubjects].some(
      (id) => target.pathname === `${root()}/${id}`,
    );
    const linkPath = [
      `${root()}/links/CLASS/${groupId}`,
      `${root()}/links/PACKAGE/${packages[0]}`,
    ].includes(target.pathname);
    const readAllowed =
      options.method === 'GET' &&
      [
        root(),
        `${root()}/links`,
        '/partners/me/profile',
        '/partners/me/subjects',
        '/partners/me/lesson-account',
        '/partners/me/earnings',
        '/partners/me/earnings/summary',
      ].includes(target.pathname);
    const writeAllowed =
      !target.search &&
      Boolean(options.header['Idempotency-Key']) &&
      ((options.method === 'POST' && target.pathname === root()) ||
        (options.method === 'PATCH' && (subjectPath || linkPath)));
    if (
      target.origin !== `http://127.0.0.1:${port}` ||
      target.username ||
      target.password ||
      target.hash ||
      ![admin, teacher, partner].includes(token ?? '') ||
      (!readAllowed && !writeAllowed)
    )
      throw new Error('Subject component request is outside owned scope');
    const call: SubjectWireCall = {
      method: options.method,
      path: target.pathname,
      body: options.data,
      key: options.header['Idempotency-Key'],
      lost: writeAllowed && loseNextWrite,
    };
    if (writeAllowed) loseNextWrite = false;
    componentCalls.push(call);
    const client = request(target.origin);
    const outgoing =
      options.method === 'GET'
        ? client.get(target.pathname + target.search)
        : options.method === 'POST'
          ? client.post(target.pathname)
          : client.patch(target.pathname);
    const task = outgoing
      .set(options.header)
      .send(options.data)
      .timeout({ response: 10_000, deadline: 15_000 })
      .then(
        (response) => {
          call.status = response.status;
          if (options.method === 'POST' && response.status === 200)
            componentSubjects.add(data<Subject>(response).id);
          if (call.lost)
            options.fail({ errMsg: 'synthetic committed response lost' });
          else
            options.success({
              statusCode: response.status,
              data: response.body as unknown,
            });
        },
        () => options.fail({ errMsg: 'synthetic local transport failure' }),
      )
      .finally(() => pending.delete(task));
    pending.add(task);
    return outgoing;
  };
  const openComponent = async (token: string) => {
    for (const name of ['wx', 'Component', 'Page'])
      if (!savedGlobals.has(name))
        savedGlobals.set(name, Object.getOwnPropertyDescriptor(host, name));
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: `http://127.0.0.1:${port}`,
      accessToken: token,
    };
    host.wx = {
      getStorageSync: () => runtime,
      request: wire,
      loadFontFace: (input: { success?: () => void }) => input.success?.(),
    };
    let mounted: (typeof components)[number] | undefined;
    host.Component = (definition: SubjectDefinition) => {
      const instance: SubjectComponent = {
        ...definition.methods,
        data: {
          ...structuredClone(definition.data),
          campusId: campuses[0],
          blocked: false,
        },
        triggerEvent: jest.fn(),
        setData(this: SubjectComponent, patch: object) {
          Object.assign(this.data, patch);
        },
      };
      mounted = { instance, definition };
      components.push(mounted);
    };
    jest.isolateModules(() =>
      jest.requireActual(
        '../../frontend/pages/super-admin/components/campus-subjects/index.ts',
      ),
    );
    if (!mounted) throw new Error('Subject component did not register');
    const { instance, definition } = mounted;
    definition.lifetimes.attached.call(instance);
    definition.pageLifetimes.show.call(instance);
    await idle();
    return instance;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    port = (server.address() as AddressInfo).port;
    const addUser = async (
      roleCode: 'SUPER_ADMIN' | 'PARTNER' | 'TEACHER',
      campusId: string | null,
    ) => {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${roleCode}-${users.length}`,
          roles: { create: { roleCode, campusId } },
        },
      });
      users.push(user.id);
      return (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken;
    };
    admin = await addUser('SUPER_ADMIN', null);
    for (let i = 0; i < 2; i++) {
      const campus = await prisma.campus.create({
        data: { code: `${runTag}-${i}`, name: `${runTag}合成校区${i}` },
      });
      campuses.push(campus.id);
      const token = await addUser('PARTNER', campus.id);
      if (i === 0) partner = token;
      else other = token;
      const student = await prisma.student.create({
        data: { campusId: campus.id, displayName: `${runTag}合成学员${i}` },
      });
      students.push(student.id);
      const pack = await prisma.coursePackage.create({
        data: {
          campusId: campus.id,
          studentId: student.id,
          name: `${runTag}合成课包`,
          validFrom: new Date('2020-01-01T00:00:00Z'),
          mainBalanceUnits: 1000,
          giftBalanceUnits: 200,
        },
      });
      packages.push(pack.id);
    }
    teacher = await addUser('TEACHER', campuses[0]);
    const profile = await prisma.teacherProfile.create({
      data: { userId: users[3], campusId: campuses[0], employeeCode: runTag },
    });
    groupId = (
      await prisma.classGroup.create({
        data: {
          campusId: campuses[0],
          teacherId: profile.id,
          name: runTag,
          courseName: '合成硬笔',
        },
      })
    ).id;
  });
  afterEach(async () => {
    try {
      for (const page of accountPages.splice(0)) page.onUnload();
      for (const { instance, definition } of components.splice(0))
        definition.lifetimes.detached.call(instance);
      await idle();
    } finally {
      for (const [name, descriptor] of savedGlobals) {
        if (descriptor) Object.defineProperty(host, name, descriptor);
        else Reflect.deleteProperty(host, name);
      }
      savedGlobals.clear();
      loseNextWrite = false;
    }
  });
  afterAll(async () => {
    try {
      if (prisma && users.length) {
        assertPartnerPdfTestTarget(process.env);
        const result = await prisma.user.updateMany({
          where: { id: { in: users }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        expect(result.count).toBe(users.length);
        expect(
          await prisma.user.count({
            where: { id: { in: users }, status: 'ACTIVE' },
          }),
        ).toBe(0);
        for (const id of packages)
          expect(
            await prisma.coursePackage.findUnique({
              where: { id },
              select: { mainBalanceUnits: true, giftBalanceUnits: true },
            }),
          ).toEqual({ mainBalanceUnits: 1000, giftBalanceUnits: 200 });
        process.stdout.write(
          `CAMPUS_SUBJECTS_OWNERSHIP ${JSON.stringify({
            runTag,
            users,
            campuses,
            packages,
            disabled: result.count,
            balancesUnchanged: true,
            componentSubjects: [...componentSubjects],
            componentWriteCalls: componentCalls.filter(
              (call) => call.method !== 'GET',
            ),
            disposition: 'synthetic records retained; no deletion',
          })}\n`,
        );
      }
    } finally {
      if (app) await app.close();
      if (port) {
        const refused = await new Promise<boolean>((resolve) => {
          const socket = createConnection({ host: '127.0.0.1', port });
          socket.once('connect', () => {
            socket.destroy();
            resolve(false);
          });
          socket.once('error', () => resolve(true));
          socket.setTimeout(1500, () => {
            socket.destroy();
            resolve(false);
          });
        });
        expect(refused).toBe(true);
        process.stdout.write(
          `CAMPUS_SUBJECTS_CLOSED ${JSON.stringify({ runTag, port, refused })}\n`,
        );
      }
    }
  });

  it('restricts maintenance to headquarters, replays creates, and scopes the partner catalog', async () => {
    const key = `${runTag}-create`;
    const subject = await create('  合成硬笔  ', 0, key);
    const replay = data<Subject>(
      await request(server)
        .post(root())
        .auth(admin, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send({ name: '合成硬笔' })
        .expect(200),
    );
    expect(replay).toEqual(subject);
    expect(subject.name).toBe('合成硬笔');
    await create('合成硬笔', 1);
    for (const token of [partner, other, teacher])
      await request(server)
        .post(root())
        .auth(token, { type: 'bearer' })
        .set('Idempotency-Key', `${runTag}-${randomUUID()}`)
        .send({ name: '禁止新增' })
        .expect(403);
    const catalog = (
      await request(server)
        .get('/partners/me/subjects')
        .auth(partner, { type: 'bearer' })
        .expect(200)
    ).body as { data: Subject[] };
    expect(catalog.data).toEqual([subject]);
    await request(server)
      .get('/partners/me/subjects')
      .auth(partner, { type: 'bearer' })
      .query({ campusId: campuses[1] })
      .expect(400);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: subject.id, action: 'SUBJECT_CREATE' },
      }),
    ).toBe(1);
  });

  it('rejects stale concurrent edits and rolls back conflicting creation including its idempotency claim', async () => {
    const subject = await create('并发科目');
    const edits = await Promise.all(
      ['并发甲', '并发乙'].map((name) =>
        request(server)
          .patch(`${root()}/${subject.id}`)
          .auth(admin, { type: 'bearer' })
          .set('Idempotency-Key', `${runTag}-${randomUUID()}`)
          .send({ name, isActive: true, expectedVersion: 1 }),
      ),
    );
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    const key = `${runTag}-duplicate`;
    await request(server)
      .post(root())
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({ name: '合成硬笔' })
      .expect(409);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
  });

  it('freezes new package assignments, preserves legacy null and copies reversal history after renaming', async () => {
    const legacy = await ledger();
    const subject = await create('冻结科目');
    await bind(subject.id, 1).expect(200);
    expect(await frozen(legacy.id)).toEqual({
      subjectId: null,
      subjectName: null,
    });
    const consumed = await ledger('CONSUME');
    expect(await frozen(consumed.id)).toEqual({
      subjectId: subject.id,
      subjectName: '冻结科目',
    });
    await request(server)
      .patch(`${root()}/${subject.id}`)
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', `${runTag}-${randomUUID()}`)
      .send({ name: '改名科目', isActive: true, expectedVersion: 1 })
      .expect(200);
    await bind(null, 2).expect(200);
    const reversed = await ledger('REVERSAL', consumed.id);
    const oldReverse = await ledger('REVERSAL', legacy.id);
    expect(await frozen(consumed.id)).toEqual({
      subjectId: subject.id,
      subjectName: '冻结科目',
    });
    expect(await frozen(reversed.id)).toEqual(await frozen(consumed.id));
    expect(await frozen(oldReverse.id)).toEqual({
      subjectId: null,
      subjectName: null,
    });
  });

  it('isolates bindings, checks versions, and preserves class and package history on competing updates', async () => {
    const own = await create('本校关联'),
      foreign = await create('外校关联', 1);
    await bind(foreign.id, 3).expect(404);
    await bind(own.id, 1, 'PACKAGE', packages[1]).expect(404);
    const concurrent = await Promise.all(
      [own.id, null].map((id) => bind(id, 3)),
    );
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    await bind(own.id, 1, 'CLASS', groupId).expect(200);
    await bind(own.id, 1, 'CLASS', groupId).expect(409);
    const links = (
      await request(server)
        .get(`${root()}/links`)
        .auth(admin, { type: 'bearer' })
        .query({ kind: 'CLASS' })
        .expect(200)
    ).body as {
      data: Array<{ id: string; subjectId: string | null }>;
    };
    expect(links.data).toEqual([
      expect.objectContaining({ id: groupId, subjectId: own.id }),
    ]);
  });

  it('combines subject and category before pagination while leaving all campus balances unchanged', async () => {
    const subject = await create('筛选科目');
    await bind(subject.id, 4).expect(200);
    const first = await ledger('CONSUME'),
      second = await ledger('CONSUME');
    await ledger();
    const filtered = data<{
      totalBalanceUnits: number;
      items: Array<{ id: string; subject: unknown }>;
      meta: { total: number };
    }>(
      await read({
        subjectId: subject.id,
        entryType: 'CONSUME',
        pageSize: 1,
      }).expect(200),
    );
    expect(filtered.totalBalanceUnits).toBe(1200);
    expect(filtered.meta.total).toBe(2);
    expect(filtered.items).toHaveLength(1);
    expect([first.id, second.id]).toContain(filtered.items[0].id);
    expect(filtered.items[0].subject).toEqual({
      id: subject.id,
      name: subject.name,
    });
    const unclassified = data<{
      items: Array<{ subject: unknown }>;
      meta: { total: number };
    }>(await read({ subjectId: 'UNCLASSIFIED' }).expect(200));
    expect(unclassified.meta.total).toBeGreaterThan(0);
    expect(unclassified.items.every((item) => item.subject === null)).toBe(
      true,
    );
    const outsider = await create('不可见筛选', 1);
    await read({ subjectId: outsider.id }).expect(404);
    await read({ subjectId: 'bad' }).expect(400);
    await read({}, teacher).expect(403);
  });

  it('rolls back a transaction containing a new classified ledger and refuses snapshot rewrites', async () => {
    const count = await prisma.lessonLedgerEntry.count({
      where: { campusId: campuses[0] },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.lessonLedgerEntry.create({
          data: {
            campusId: campuses[0],
            studentId: students[0],
            coursePackageId: packages[0],
            actorUserId: users[0],
            entryType: 'ADJUSTMENT',
            bucket: 'MAIN',
            deltaUnits: 1,
            balanceBeforeUnits: 1000,
            balanceAfterUnits: 1001,
            idempotencyKey: `${runTag}-${randomUUID()}`,
          },
        });
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { campusId: campuses[0] },
      }),
    ).toBe(count);
    const row = await ledger();
    const failure: unknown = await prisma.$executeRaw`
      UPDATE "LessonLedgerEntry" SET "subjectName" = 'tampered' WHERE "id" = ${row.id}::uuid`.catch(
      (error: unknown) => error,
    );
    expect(JSON.stringify(failure)).toContain(
      'Ledger subject snapshot is immutable',
    );
  });

  it('archives and restores stable IDs, blocks new bindings and retains prior attribution', async () => {
    const subject = await create('归档科目');
    const pack = await prisma.coursePackage.findUniqueOrThrow({
      where: { id: packages[0] },
    });
    await bind(subject.id, pack.subjectVersion).expect(200);
    const original = await ledger('CONSUME');
    const edit = (isActive: boolean, expectedVersion: number) =>
      request(server)
        .patch(`${root()}/${subject.id}`)
        .auth(admin, { type: 'bearer' })
        .set('Idempotency-Key', `${runTag}-${randomUUID()}`)
        .send({ name: subject.name, isActive, expectedVersion });
    await edit(false, 1).expect(200);
    await bind(subject.id, 2, 'CLASS', groupId).expect(404);
    const afterArchive = await ledger('CONSUME');
    expect(await frozen(afterArchive.id)).toEqual(await frozen(original.id));
    const catalog = (
      await request(server)
        .get('/partners/me/subjects')
        .auth(partner, { type: 'bearer' })
        .query({ query: subject.name })
        .expect(200)
    ).body as { data: Subject[] };
    expect(catalog.data).toEqual([{ ...subject, isActive: false, version: 2 }]);
    expect(
      data<{ meta: { total: number } }>(
        await read({ subjectId: subject.id }).expect(200),
      ).meta.total,
    ).toBe(2);
    await edit(true, 2).expect(200);
    await bind(subject.id, 2, 'CLASS', groupId).expect(200);
    expect(await frozen(original.id)).toEqual({
      subjectId: subject.id,
      subjectName: subject.name,
    });
  });

  it('paginates the complete catalog and freezes committed attribution during a competing rebind', async () => {
    const prefix = `${runTag}分页`;
    await prisma.campusSubject.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        campusId: campuses[0],
        name: `${prefix}${String(index).padStart(3, '0')}`,
        isActive: index !== 100,
      })),
    });
    const first = (
      await request(server)
        .get('/partners/me/subjects')
        .auth(partner, { type: 'bearer' })
        .query({ query: prefix, pageSize: 100 })
        .expect(200)
    ).body as { data: Subject[]; meta: { total: number } };
    const second = (
      await request(server)
        .get('/partners/me/subjects')
        .auth(partner, { type: 'bearer' })
        .query({ query: prefix, pageSize: 100, page: 2 })
        .expect(200)
    ).body as { data: Subject[] };
    expect(first.data).toHaveLength(100);
    expect(first.meta.total).toBe(101);
    expect(second.data).toHaveLength(1);
    expect(second.data[0].isActive).toBe(false);
    const pack = await prisma.coursePackage.findUniqueOrThrow({
      where: { id: packages[0] },
    });
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const lock = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CoursePackage" WHERE "id" = ${pack.id}::uuid FOR NO KEY UPDATE`;
      locked();
      await gate;
    });
    let pending: Promise<request.Response> | undefined;
    try {
      await ready;
      pending = bind(second.data[0].id, pack.subjectVersion).then(
        (response) => response,
      );
      // Archived choice is rejected after the target lock; an overlapping ledger still sees the committed assignment.
      const row = await ledger();
      expect((await frozen(row.id)).subjectId).toBe(pack.subjectId);
    } finally {
      release();
      await lock;
    }
    expect((await pending).status).toBe(404);
    await bind(first.data[0].id, pack.subjectVersion).expect(200);
    expect((await frozen((await ledger()).id)).subjectId).toBe(
      first.data[0].id,
    );
  });

  it('runs actual headquarters component writes through TCP, replays lost replies and reads frozen subjects on the partner Page', async () => {
    const oldHistory = await prisma.lessonLedgerEntry.findMany({
      where: { campusId: campuses[0] },
      orderBy: { id: 'asc' },
    });
    const component = await openComponent(admin);
    expect(component.data.subjects.loaded).toBe(true);
    expect(component.data.classes.rows).toHaveLength(1);
    expect(component.data.packages.rows).toHaveLength(1);
    expect(component.data.optionsLoaded).toBe(true);
    expect(component.data.subjectOptions.length).toBeGreaterThan(100);

    const originalName = `${runTag}页面科目`;
    component.onCreate();
    component.onNameInput(event({}, `  ${originalName}  `));
    loseNextWrite = true;
    await component.onSaveSubject();
    expect(component.data.mutationState).toBe('unknown');
    const created = await prisma.campusSubject.findUniqueOrThrow({
      where: { campusId_name: { campusId: campuses[0], name: originalName } },
    });
    component.onNameInput(event({}, '不应替换原请求'));
    await component.onRetryMutation();
    await idle();
    const creates = componentCalls.filter((call) => call.method === 'POST');
    expect(creates).toHaveLength(2);
    expect(creates[0]).toMatchObject({ status: 200, lost: true });
    expect(creates[1]).toMatchObject({
      status: 200,
      key: creates[0].key,
      body: creates[0].body,
      lost: false,
    });
    expect(
      await prisma.auditLog.count({
        where: { resourceId: created.id, action: 'SUBJECT_CREATE' },
      }),
    ).toBe(1);
    expect(component.data.subjectOptions).toContainEqual({
      id: created.id,
      name: originalName,
    });
    component.onSearchInput(event({ lane: 'subjects' }, originalName));
    component.onSearch(event({ lane: 'subjects' }));
    await idle();
    expect(component.data.subjects.rows).toEqual([
      { id: created.id, name: originalName, isActive: true, version: 1 },
    ]);
    const bindInComponent = async (
      lane: 'classes' | 'packages',
      id: string,
      clear = false,
    ) => {
      component.onBind(event({ lane, id }));
      if (clear) component.onClearSubject();
      else
        component.onSubjectPick(
          event(
            {},
            component.data.subjectOptions.findIndex(
              (item) => item.id === created.id,
            ),
          ),
        );
      component.onReasonInput(event({}, `${runTag}明确调整关联`));
      await component.onSaveBinding();
      await idle();
      expect(component.data.mutationState).toBe('');
      expect(component.data[lane].rows[0].subjectId).toBe(
        clear ? null : created.id,
      );
    };
    await bindInComponent('classes', groupId);
    const packageAuditsBefore = await prisma.auditLog.count({
      where: {
        resourceId: packages[0],
        action: 'SUBJECT_LINK_UPDATE',
      },
    });
    loseNextWrite = true;
    component.onBind(event({ lane: 'packages', id: packages[0] }));
    component.onSubjectPick(
      event(
        {},
        component.data.subjectOptions.findIndex(
          (item) => item.id === created.id,
        ),
      ),
    );
    component.onReasonInput(event({}, `${runTag}课包归属`));
    await component.onSaveBinding();
    expect(component.data.mutationState).toBe('unknown');
    await component.onRetryMutation();
    await idle();
    const packageWrites = componentCalls.filter(
      (call) => call.path === `${root()}/links/PACKAGE/${packages[0]}`,
    );
    expect(packageWrites).toHaveLength(2);
    expect(packageWrites[1]).toMatchObject({
      status: 200,
      key: packageWrites[0].key,
      body: packageWrites[0].body,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: packages[0],
          action: 'SUBJECT_LINK_UPDATE',
        },
      }),
    ).toBe(packageAuditsBefore + 1);
    expect(
      await prisma.idempotencyRecord.count({
        where: { key: packageWrites[0].key },
      }),
    ).toBe(1);

    const consumed = await ledger('CONSUME');
    expect(await frozen(consumed.id)).toEqual({
      subjectId: created.id,
      subjectName: originalName,
    });
    const renamed = `${originalName}新名`;
    component.onEdit(event({ id: created.id }));
    component.onNameInput(event({}, renamed));
    component.onActiveChange(event({}, false));
    await component.onSaveSubject();
    await idle();
    expect(
      component.data.subjectOptions.some((row) => row.id === created.id),
    ).toBe(false);
    expect(component.data.packages.rows[0]).toMatchObject({
      subjectId: created.id,
      subjectName: renamed,
    });
    await bindInComponent('packages', packages[0], true);
    await bindInComponent('classes', groupId, true);
    const unclassified = await ledger();
    const reversed = await ledger('REVERSAL', consumed.id);
    expect(await frozen(reversed.id)).toEqual(await frozen(consumed.id));
    expect(await frozen(unclassified.id)).toEqual({
      subjectId: null,
      subjectName: null,
    });
    expect(
      await prisma.lessonLedgerEntry.findMany({
        where: { id: { in: oldHistory.map((row) => row.id) } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(oldHistory);

    for (const { instance, definition } of components.splice(0))
      definition.lifetimes.detached.call(instance);
    runtime = { ...runtime, accessToken: partner };
    const account = captureCampaignPage<SubjectAccountPage>('lesson-account');
    accountPages.push(account);
    account.onLoad();
    account.onShow();
    await idle();
    expect(account.data.viewState).toBe('ready');
    const option = account.data.subjectOptions.findIndex(
      (row) => row.value === created.id,
    );
    expect(option).toBeGreaterThan(1);
    expect(account.data.subjectOptions[option].label).toContain(renamed);
    const balance = account.data.summary?.totalBalanceLabel;
    expect(balance).toBe('12');
    account.onSubjectChange({ detail: { value: String(option) } });
    await idle();
    expect(account.data.total).toBe(2);
    expect(account.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: consumed.id,
          subjectLabel: originalName,
        }),
        expect.objectContaining({
          id: reversed.id,
          subjectLabel: originalName,
        }),
      ]),
    );
    const category = account.data.entryTypeOptions.findIndex(
      (row) => row.value === 'CONSUME',
    );
    expect(category).toBeGreaterThan(0);
    account.onEntryTypeChange({ detail: { value: String(category) } });
    await idle();
    expect(account.data.total).toBe(1);
    expect(account.data.items).toEqual([
      expect.objectContaining({ id: consumed.id, subjectLabel: originalName }),
    ]);
    expect(account.data.summary?.totalBalanceLabel).toBe(balance);
  });

  it('clears the actual component on a real teacher 403 without issuing a maintenance write', async () => {
    const before = componentCalls.length;
    const component = await openComponent(teacher);
    expect(component.data.forbidden).toBe(true);
    expect(component.data.subjects.rows).toEqual([]);
    expect(component.data.classes.rows).toEqual([]);
    expect(component.data.packages.rows).toEqual([]);
    expect(component.data.editor).toBeNull();
    component.onCreate();
    component.onNameInput(event({}, `${runTag}禁止写入`));
    await component.onSaveSubject();
    await idle();
    const calls = componentCalls.slice(before);
    expect(calls.length).toBeGreaterThan(0);
    expect(
      calls.every((call) => call.method === 'GET' && call.status === 403),
    ).toBe(true);
    expect(component.triggerEvent).toHaveBeenCalledTimes(1);
    const [name, detail] = component.triggerEvent.mock.calls[0] as [
      string,
      { message: string },
    ];
    expect(name).toBe('forbidden');
    expect(detail.message).toMatch(/[\u4e00-\u9fff]/);
  });
});
