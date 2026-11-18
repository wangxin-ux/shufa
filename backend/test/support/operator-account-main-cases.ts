import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import type { MainRuntimeContext } from './operator-account-main-runtime';
import type { MainFixture } from './operator-account-main-fixture';
import {
  openMainPage,
  readMainHttp,
  type MainPageName,
} from './operator-account-main-pages';
import { createMainReadValidator } from './operator-account-main-contract';
import {
  recoverAccountFixture,
  type AccountAdapterClient,
} from './operator-pdf-test-account-fixture-applicator';
import {
  accountFixtureId,
  accountJson,
} from './operator-pdf-test-account-adapter-schema';
import { presentOperatorAccountSummary } from '../../../frontend/pages/operator/runtime/services/operator-account.presenter';
import { presentEarningSummary } from '../../../frontend/pages/operator/runtime/services/operator-earning.presenter';
import { OPERATOR_ACCOUNT_CATEGORIES } from '../../../frontend/pages/operator/runtime/types/operator-account';
import type { OperatorAccount } from '../../../frontend/pages/operator/runtime/types/operator-account';
import { MAIN_READ_ROUTES } from './operator-account-main-host';

const account = '/operators/me/lesson-account',
  subjects = '/operators/me/subjects';
const earning = '/operators/me/earnings',
  summary = earning + '/summary';
type Session = ReturnType<typeof openMainPage>;
const same = (actual: unknown, expected: unknown) =>
  assert.deepEqual(
    JSON.parse(accountJson(actual)) as unknown,
    JSON.parse(accountJson(expected)) as unknown,
  );
function accountTotals(value: OperatorAccount) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name]) => !['items', 'meta', 'serverTime', 'timezone'].includes(name),
    ),
  );
}
function latest(session: Session, path: string) {
  const call = session.calls.findLast((call) => call.path === path);
  assert.ok(call, `Missing HTTP response for ${path}`);
  return call;
}
async function withPage(
  ctx: MainRuntimeContext,
  plan: MainFixture,
  page: MainPageName,
  actor: string,
  operation: (session: Session) => Promise<void> | void,
) {
  ctx.checkpoint();
  const session = openMainPage(
    page,
    ctx.origin,
    ctx.token(plan, actor),
    ctx.checkpoint,
  );
  ctx.pages.add(session);
  try {
    session.page.onLoad();
    session.page.onShow();
    await session.settle();
    await operation(session);
  } finally {
    ctx.record(`${plan.mainGraph}-${page}-${actor}-page`, {
      data: session.page.data,
      calls: session.calls,
    });
    await session.close();
    ctx.pages.delete(session);
  }
}
function expectedTotals(plan: MainFixture) {
  return {
    ...plan.expected.balances,
    enrollmentSummary: plan.expected.enrollmentSummary,
    lessonActivityTotals: plan.expected.lessonActivityTotals,
  };
}
function privateEmpty(session: Session) {
  assert.equal(session.page.data.viewState, 'forbidden');
  assert.equal(session.page.data.summary, null);
  assert.deepEqual(session.page.data.rows, []);
  assert.equal(session.page.data.total, 0);
}
async function owned<T>(
  ctx: MainRuntimeContext,
  plan: MainFixture,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  ctx.checkpoint();
  return ctx.writer.$transaction(
    async (tx) => {
      assert.equal(
        (
          await recoverAccountFixture(
            tx as unknown as AccountAdapterClient,
            plan,
          )
        ).state,
        'OWNED',
      );
      return operation(tx);
    },
    { isolationLevel: 'Serializable', timeout: 30000 },
  );
}
const row = (plan: MainFixture, key: string) => {
  const value = plan.records.find((record) => record.key === key);
  assert.ok(value, `Missing manifested row ${key}`);
  return value.data;
};
async function histories(ctx: MainRuntimeContext) {
  const validator = createMainReadValidator(ctx.root);
  for (const plan of ctx.plans) {
    await withPage(ctx, plan, 'lesson-account', 'owner', (session) => {
      const response = latest(session, account);
      assert.equal(response.status, 200);
      const value = validator.account(response.responseBody);
      same(accountTotals(value), expectedTotals(plan));
      same(session.page.data.summary, presentOperatorAccountSummary(value));
      assert.ok(
        session.calls.some(
          (call) =>
            call.path === subjects &&
            call.query.page === '2' &&
            call.status === 200,
        ),
      );
      assert.equal(session.page.data.subjectOptions.length, 103);
    });
    await withPage(ctx, plan, 'earnings', 'owner', async (session) => {
      const value = validator.earningSummary(
        latest(session, summary).responseBody,
      );
      assert.equal(value.estimatedTotalFen, plan.earnings.estimatedTotalFen);
      assert.equal(value.pendingReviewFen, plan.earnings.pendingReviewFen);
      same(session.page.data.summary, presentEarningSummary(value));
      const first = validator.earningEntries(
        latest(session, earning).responseBody,
      );
      assert.equal(first.meta.total, 25);
      assert.ok(
        first.data.some(
          (row) => row.entryType === 'REVERSAL' && row.amountFen === -1000,
        ),
      );
      assert.ok(
        first.data.some(
          (row) => row.status === 'REJECTED' && row.amountFen === 1900,
        ),
      );
      session.page.onLoadMore();
      await session.settle();
      assert.equal(session.page.data.rows.length, 25);
      assert.equal(
        validator.earningEntries(latest(session, earning).responseBody).data
          .length,
        5,
      );
    });
  }
}
async function filtersAndRetries(ctx: MainRuntimeContext, plan: MainFixture) {
  const validator = createMainReadValidator(ctx.root);
  await withPage(ctx, plan, 'lesson-account', 'owner', async (session) => {
    const original = structuredClone(session.page.data.summary);
    const archived = session.page.data.subjectOptions.findIndex(
      (option) => option.value === plan.ids.archivedSubject,
    );
    assert.ok(archived > 0);
    session.page.onSubjectChange({ detail: { value: String(archived) } });
    await session.settle();
    assert.equal(
      latest(session, account).query.subjectId,
      plan.ids.archivedSubject,
    );
    const subject = session.page.data.subjectOptions.findIndex(
      (option) => option.value === plan.ids.filterSubject,
    );
    session.page.onSubjectChange({ detail: { value: String(subject) } });
    await session.settle();
    const category = OPERATOR_ACCOUNT_CATEGORIES.findIndex(
      (option) => option.value === 'CONSUME',
    );
    session.page.onCategoryChange({ detail: { value: String(category) } });
    await session.settle();
    const firstRows = structuredClone(session.page.data.rows);
    assert.equal(firstRows.length, 20);
    ctx.fault(account, 2);
    session.page.onLoadMore();
    await session.settle();
    const failed = { ...latest(session, account).query };
    assert.equal(latest(session, account).status, 503);
    assert.ok(session.page.data.detailError);
    same(session.page.data.rows, firstRows);
    session.page.onRetryDetail();
    await session.settle();
    same(latest(session, account).query, failed);
    assert.equal(latest(session, account).status, 200);
    assert.equal(session.page.data.rows.length, 24);
    assert.equal(
      validator.account(latest(session, account).responseBody).items.length,
      4,
    );
    same(session.page.data.summary, original);
  });
  await withPage(ctx, plan, 'earnings', 'owner', async (session) => {
    const original = structuredClone(session.page.data.summary);
    const firstRows = structuredClone(session.page.data.rows);
    ctx.fault(earning, 2);
    session.page.onLoadMore();
    await session.settle();
    assert.equal(latest(session, earning).status, 503);
    assert.ok(session.page.data.detailError);
    same(session.page.data.rows, firstRows);
    const failed = { ...latest(session, earning).query };
    session.page.onRetryDetail();
    await session.settle();
    same(latest(session, earning).query, failed);
    assert.equal(latest(session, earning).status, 200);
    assert.equal(session.page.data.rows.length, 25);
    session.page.onStatusChange({ detail: { value: '1' } });
    await session.settle();
    session.page.onTypeChange({ detail: { value: '1' } });
    await session.settle();
    assert.equal(latest(session, earning).query.status, 'PENDING_REVIEW');
    assert.equal(latest(session, earning).query.entryType, 'ACCRUAL');
    assert.equal(session.page.data.total, 21);
    session.page.onLoadMore();
    await session.settle();
    assert.equal(session.page.data.rows.length, 21);
    same(session.page.data.summary, original);
  });
}
async function scopes(ctx: MainRuntimeContext, plan: MainFixture) {
  for (const actor of ['mixed', 'unscoped', 'teacher', 'parent']) {
    const check = async () => {
      for (const path of MAIN_READ_ROUTES.filter((path) => path !== '/me')) {
        const result = await readMainHttp(
          ctx.origin,
          ctx.token(plan, actor),
          path,
          {},
          ctx.checkpoint,
        );
        ctx.record(`scope-${actor}-${path.split('/').at(-1)}`, result);
        assert.equal(result.status, 403);
      }
    };
    if (actor === 'mixed') await ctx.withMixedIdentity(plan, check);
    else await check();
  }
  for (const path of MAIN_READ_ROUTES.filter(
    (path) => path !== '/me' && path !== summary,
  )) {
    const result = await readMainHttp(
      ctx.origin,
      ctx.token(plan, 'owner'),
      path,
      { campusId: plan.ids.campusB },
      ctx.checkpoint,
    );
    assert.equal(result.status, 400);
  }
  await summaryCallerScope(ctx, plan);
  assert.equal(
    (
      await readMainHttp(
        ctx.origin,
        ctx.token(plan, 'owner'),
        account,
        { subjectId: plan.ids.foreignSubject },
        ctx.checkpoint,
      )
    ).status,
    404,
  );
  for (const page of ['lesson-account', 'earnings'] as const)
    await withPage(ctx, plan, page, 'owner', async (session) => {
      const token = ctx.token(plan, 'other-campus');
      session.changeRuntime({ accessToken: token });
      session.page.onShow();
      await session.settle();
      privateEmpty(session);
    });
}
async function summaryCallerScope(
  ctx: MainRuntimeContext,
  plan: MainFixture,
) {
  const RealDate = Date;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Date')!;
  const now = RealDate.now();
  // Hold only business Date across these reads; the lease uses captured real time.
  Object.defineProperty(globalThis, 'Date', {
    configurable: true,
    writable: true,
    value: new Proxy(RealDate, {
      construct(target, args) {
        return Reflect.construct(target, args.length ? args : [now]);
      },
      apply() {
        return new RealDate(now).toString();
      },
      get(target, key) {
        return key === 'now' ? () => now : Reflect.get(target, key);
      },
    }),
  });
  try {
    const validator = createMainReadValidator(ctx.root);
    for (const [actor, foreignCampus, expectedTotal, expectedPending] of [
      ['owner', plan.ids.campusB, 22000, 21000],
      ['other-campus', plan.ids.campusA, 0, 0],
    ] as const) {
      const original = await readMainHttp(
        ctx.origin, ctx.token(plan, actor), summary, {}, ctx.checkpoint,
      );
      const supplied = await readMainHttp(
        ctx.origin, ctx.token(plan, actor), summary,
        { campusId: foreignCampus }, ctx.checkpoint,
      );
      assert.equal(original.status, 200);
      assert.equal(supplied.status, 200);
      const own = validator.earningSummary(original.body);
      const withForeignParameter = validator.earningSummary(supplied.body);
      same(own, {
        estimatedTotalFen: expectedTotal,
        pendingReviewFen: expectedPending,
        currency: 'CNY',
        serverTime: new RealDate(now).toISOString(),
        timezone: 'Asia/Shanghai',
      });
      same(withForeignParameter, own);
      ctx.record(`summary-own-scope-${actor}`, {
        own, withForeignParameter, suppliedCampusId: foreignCampus,
        provenance: supplied.provenance,
      });
    }
  } finally {
    Object.defineProperty(globalThis, 'Date', descriptor);
  }
}
async function lostAccess(ctx: MainRuntimeContext, plan: MainFixture) {
  for (const [page, path] of [
    ['lesson-account', account],
    ['lesson-account', subjects],
    ['earnings', summary],
    ['earnings', earning],
  ] as const)
    for (const status of [401, 403] as const) {
      const key = status === 401 ? 'user-revoke-status' : 'user-revoke-role';
      const user = row(plan, key),
        role = row(plan, 'role-revoke-role-OPERATOR');
      const actor = status === 401 ? 'revoke-status' : 'revoke-role';
      try {
        await withPage(ctx, plan, page, actor, async (session) => {
          const hold = session.holdSuccess(path);
          session.page.onRefresh();
          if (page === 'lesson-account') session.page.onRetrySubjects();
          await session.settle();
          assert.ok(
            hold.received(),
            'A new real successful HTTP response must be held',
          );
          await hold.entered;
          await owned(ctx, plan, async (tx) => {
            if (status === 401) {
              const changed = await tx.user.updateMany({
                where: { id: String(user.id), status: 'ACTIVE' },
                data: { status: 'DISABLED', updatedAt: user.updatedAt as Date },
              });
              assert.equal(changed.count, 1);
            } else {
              const changed = await tx.userRole.updateMany({
                where: { id: String(role.id), roleCode: 'OPERATOR' },
                data: { roleCode: 'TEACHER' },
              });
              assert.equal(changed.count, 1);
            }
          });
          const denial = await readMainHttp(
            ctx.origin,
            ctx.token(plan, actor),
            path,
            {},
            ctx.checkpoint,
          );
          assert.equal(denial.status, status);
          session.page.onRefresh();
          if (page === 'lesson-account') session.page.onRetrySubjects();
          await session.settle();
          privateEmpty(session);
          hold.release();
          await session.settle();
          privateEmpty(session);
        });
      } finally {
        // Only the exact dedicated fixture row, with a compare-and-set state.
        ctx.cleanupCheckpoint();
        if (status === 401)
          await ctx.writer.user.updateMany({
            where: { id: String(user.id), status: 'DISABLED' },
            data: { status: 'ACTIVE', updatedAt: user.updatedAt as Date },
          });
        else
          await ctx.writer.userRole.updateMany({
            where: {
              id: String(role.id),
              userId: String(user.id),
              roleCode: 'TEACHER',
            },
            data: { roleCode: 'OPERATOR' },
          });
        assert.equal(
          (
            await recoverAccountFixture(
              ctx.writer as unknown as AccountAdapterClient,
              plan,
            )
          ).state,
          'OWNED',
        );
      }
    }
}
async function beforeReturn(ctx: MainRuntimeContext, plan: MainFixture) {
  for (const kind of ['status', 'role', 'campus'] as const)
    for (const path of [account, subjects, summary, earning]) {
      const user = row(plan, `user-revoke-${kind}`);
      const role =
        kind === 'status'
          ? undefined
          : row(plan, `role-revoke-${kind}-OPERATOR`);
      const hold = ctx.pause.hold(String(user.id));
      const response = readMainHttp(
        ctx.origin,
        ctx.token(plan, `revoke-${kind}`),
        path,
        {},
        ctx.checkpoint,
      );
      void response.catch(() => undefined);
      try {
        await Promise.race([
          hold.entered,
          response.then(() => {
            throw new Error(
              'Read returned without entering the real RepeatableRead boundary',
            );
          }),
        ]);
        await owned(ctx, plan, async (tx) => {
          if (kind === 'status')
            await tx.user.update({
              where: { id: String(user.id) },
              data: { status: 'DISABLED', updatedAt: user.updatedAt as Date },
            });
          else
            await tx.userRole.update({
              where: { id: String(role!.id) },
              data:
                kind === 'role'
                  ? { roleCode: 'TEACHER' }
                  : { campusId: plan.ids.campusB },
            });
        });
        hold.release();
        const denied = await response;
        ctx.record(`fresh-return-${kind}-${path.split('/').at(-1)}`, denied);
        assert.equal(denied.status, kind === 'status' ? 401 : 403);
      } finally {
        hold.release();
        ctx.pause.release();
        await Promise.allSettled([response]);
        ctx.cleanupCheckpoint();
        if (kind === 'status')
          await ctx.writer.user.updateMany({
            where: { id: String(user.id), status: 'DISABLED' },
            data: { status: 'ACTIVE', updatedAt: user.updatedAt as Date },
          });
        else
          await ctx.writer.userRole.updateMany({
            where: {
              id: String(role!.id),
              userId: String(user.id),
              ...(kind === 'role'
                ? { roleCode: 'TEACHER' }
                : { campusId: plan.ids.campusB }),
            },
            data: { roleCode: 'OPERATOR', campusId: plan.ids.campusA },
          });
      }
    }
  await transfers(ctx, plan);
}
async function transfers(ctx: MainRuntimeContext, plan: MainFixture) {
  // Current teacher/class location must not rewrite historical earning scope.
  const teacher = row(plan, 'teacher-profile'),
    group = row(plan, 'class');
  try {
    await owned(ctx, plan, async (tx) => {
      await tx.teacherProfile.update({
        where: { id: String(teacher.id) },
        data: {
          campusId: plan.ids.campusB,
          updatedAt: teacher.updatedAt as Date,
        },
      });
      await tx.classGroup.update({
        where: { id: String(group.id) },
        data: {
          campusId: plan.ids.campusB,
          subjectId: plan.ids.foreignSubject,
          updatedAt: group.updatedAt as Date,
        },
      });
    });
    const validator = createMainReadValidator(ctx.root);
    const summaryResponse = await readMainHttp(
      ctx.origin, ctx.token(plan, 'owner'), summary, {}, ctx.checkpoint,
    );
    assert.equal(summaryResponse.status, 200);
    const historical = validator.earningSummary(summaryResponse.body);
    assert.equal(historical.estimatedTotalFen, 22000);
    assert.equal(historical.pendingReviewFen, 21000);
    const entriesResponse = await readMainHttp(
      ctx.origin, ctx.token(plan, 'owner'), earning, {}, ctx.checkpoint,
    );
    assert.equal(entriesResponse.status, 200);
    assert.equal(
      validator.earningEntries(entriesResponse.body).meta.total,
      25,
    );
    ctx.record('historical-transfer-read', {
      summary: summaryResponse, entries: entriesResponse,
      campusId: plan.ids.campusB, subjectId: plan.ids.foreignSubject,
    });
  } finally {
    ctx.cleanupCheckpoint();
    await ctx.writer.$transaction(async (tx) => {
      await tx.teacherProfile.updateMany({
        where: { id: String(teacher.id), campusId: plan.ids.campusB },
        data: {
          campusId: plan.ids.campusA,
          updatedAt: teacher.updatedAt as Date,
        },
      });
      await tx.classGroup.updateMany({
        where: {
          id: String(group.id),
          campusId: plan.ids.campusB,
          subjectId: plan.ids.foreignSubject,
        },
        data: {
          campusId: plan.ids.campusA,
          subjectId: group.subjectId as string | null,
          updatedAt: group.updatedAt as Date,
        },
      });
    });
  }
  assert.equal(
    (await recoverAccountFixture(
      ctx.writer as unknown as AccountAdapterClient, plan,
    )).state,
    'OWNED',
  );
  ctx.record('historical-transfer-restored', {
    ownership: 'OWNED', campusId: group.campusId, subjectId: group.subjectId,
  });
  const hold = ctx.pause.hold(plan.actors['student-move'].userId);
  const response = readMainHttp(
    ctx.origin,
    ctx.token(plan, 'student-move'),
    account,
    {},
    ctx.checkpoint,
  );
  void response.catch(() => undefined);
  try {
    await Promise.race([
      hold.entered,
      response.then(() => {
        throw new Error(
          'Student read returned without entering RepeatableRead',
        );
      }),
    ]);
    await owned(ctx, plan, async (tx) => {
      const student = row(plan, 'student-a');
      const change = await tx.student.updateMany({
        where: { id: plan.ids.studentA, campusId: plan.ids.campusA },
        data: {
          campusId: plan.ids.campusB,
          updatedAt: student.updatedAt as Date,
        },
      });
      assert.equal(change.count, 1);
      const facts = await tx.partnerRankingStudentFact.findMany({
        where: {
          studentId: plan.ids.studentA,
          campusId: plan.ids.campusB,
          isActive: true,
        },
      });
      assert.equal(facts.length, 1);
      await tx.auditLog.create({
        data: {
          id: accountFixtureId(plan.windowId, plan.executionId, 'student-move'),
          action: 'E01_FIXTURE_STUDENT_MOVE',
          actorUserId: plan.actors['student-move'].userId,
          resourceType: 'E01_FIXTURE',
          outcome: 'SUCCESS',
          campusId: null,
          resourceId: plan.executionId,
          createdAt: plan.syntheticNow,
          details: JSON.parse(
            accountJson({
              windowId: plan.windowId,
              executionId: plan.executionId,
              studentId: plan.ids.studentA,
              campusId: plan.ids.campusB,
              triggerFact: facts[0],
            }),
          ) as Prisma.InputJsonObject,
        },
      });
    });
    hold.release();
    const returned = await response;
    assert.equal(returned.status, 404);
    assert.equal(
      (
        await recoverAccountFixture(
          ctx.writer as unknown as AccountAdapterClient,
          plan,
        )
      ).state,
      'OWNED',
    );
    ctx.record('student-transfer-return', {
      response: returned, ownership: 'OWNED', studentId: plan.ids.studentA,
    });
  } finally {
    hold.release();
    ctx.pause.release();
    await Promise.allSettled([response]);
  }
}
export async function exerciseMainAccount(ctx: MainRuntimeContext) {
  const plan = ctx.plans[0];
  await histories(ctx);
  await filtersAndRetries(ctx, plan);
  await scopes(ctx, plan);
  await lostAccess(ctx, plan);
  await beforeReturn(ctx, plan);
}

export async function exerciseMainAccountBoundaries(ctx: MainRuntimeContext) {
  const plan = ctx.plans[0];
  await scopes(ctx, plan);
  await lostAccess(ctx, plan);
  await beforeReturn(ctx, plan);
}

export async function exerciseMainAccountTransfers(ctx: MainRuntimeContext) {
  await transfers(ctx, ctx.plans[0]);
}
