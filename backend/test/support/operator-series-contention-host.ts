import { Controller, Get, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import type { AuthenticatedUser } from "../../src/common/auth/authenticated-user";
import { CurrentUser } from "../../src/common/auth/current-user.decorator";
import { OperatorScopeService } from "../../src/common/auth/operator-scope.service";
import { TeacherScopeService } from "../../src/common/auth/teacher-scope.service";
import { ParentScopeService } from "../../src/common/auth/parent-scope.service";
import { PermissionsGuard } from "../../src/common/auth/permissions.guard";
import { IdempotencyService } from "../../src/common/idempotency/idempotency.service";
import { configureApplication } from "../../src/common/bootstrap/configure-app";
import { RequestIdMiddleware } from "../../src/common/request-id/request-id.middleware";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { AccessTokenGuard } from "../../src/modules/auth/access-token.guard";
import { AuthService } from "../../src/modules/auth/auth.service";
import { StaffBindTokenService } from "../../src/modules/auth/staff-bind-token.service";
import { OperatorController } from "../../src/modules/operator/operator.controller";
import { OperatorReadService } from "../../src/modules/operator/operator-read.service";
import { OperatorLeaveService } from "../../src/modules/operator/operator-leave.service";
import { OperatorStudentService } from "../../src/modules/operator/operator-student.service";
import { OperatorSettingsService } from "../../src/modules/operator/operator-settings.service";
import { OperatorSchedulingService } from "../../src/modules/operator/operator-scheduling.service";
import { OperatorLessonSeriesService } from "../../src/modules/operator/operator-lesson-series.service";
import { OperatorLessonSeriesController } from "../../src/modules/operator/operator-lesson-series.controller";
import { TeacherPortalController } from "../../src/modules/teacher-portal/teacher-portal.controller";
import { TeacherReadService } from "../../src/modules/scheduling/teacher-read.service";
import { TeacherRankingService } from "../../src/modules/teacher-portal/teacher-ranking.service";
import { ParentPortalController } from "../../src/modules/parent-portal/parent-portal.controller";
import { ParentPortalService } from "../../src/modules/parent-portal/parent-portal.service";
import { StoredFileService } from "../../src/modules/file/stored-file.service";
import { AttendanceController } from "../../src/modules/attendance/attendance.controller";
import { AttendanceService } from "../../src/modules/attendance/attendance.service";
import { LessonLedgerService } from "../../src/modules/lesson-ledger/lesson-ledger.service";
import { EarningRuleService } from "../../src/modules/earning/earning-rule.service";
import { EarningRecordingService } from "../../src/modules/earning/earning-recording.service";
import { PartnerEarningRuleService } from "../../src/modules/partner-earning/partner-earning-rule.service";
import { PartnerEarningRecordingService } from "../../src/modules/partner-earning/partner-earning-recording.service";
import { OperatorLessonMembersController } from "../../src/modules/operator/operator-lesson-members.controller";
import { OperatorLessonMembersService } from "../../src/modules/operator/operator-lesson-members.service";
import { admitTaggedRequest } from "./operator-contention-witness";
import { requireSeries } from "./operator-series-admission";

export const HOST_ROUTES = [
  "/me",
  "/operators/me/scheduling-options",
  "/operators/me/lesson-sessions",
  "/operators/me/lesson-series/preview",
  "/operators/me/lesson-series",
  "/teachers/me/lesson-sessions",
  "/parents/me/leave",
];
export interface Credential {
  userId: string;
  kind: "access" | "refresh";
  token: string;
}
export interface Registry {
  attempted: Set<string>;
  issued: Credential[];
  pending: Promise<unknown>[];
}
export function createAdmissionTracker() {
  let accepting = true,
    uncertain = false;
  const active = new Set<symbol>();
  return {
    enter(identityProbe: boolean) {
      if (!accepting && !identityProbe) return undefined;
      const id = Symbol("admitted-request");
      active.add(id);
      let finished = false;
      return {
        finish() {
          finished = true;
          active.delete(id);
        },
        close() {
          if (!finished) uncertain = true;
        },
      };
    },
    async quiesce() {
      accepting = false;
      const deadline = Date.now() + 45000;
      while (!uncertain && active.size > 0 && Date.now() < deadline)
        await new Promise<void>((done) => setTimeout(done, 25));
      requireSeries(
        !uncertain && active.size === 0,
        "HTTP admission/guard/handler drain unconfirmed",
      );
    },
  };
}
@Controller()
class IdentityController {
  constructor(private readonly auth: AuthService) {}
  @Get("me")
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getMe(user.userId);
  }
}
export async function compileSeriesHost(
  prisma: object,
  settings: Record<string, string>,
  registry: Registry,
) {
  const jwt = new JwtService(),
    sign = jwt.signAsync.bind(jwt);
  jwt.signAsync = (
    payload: object | string | Buffer,
    options?: Parameters<typeof sign>[1],
  ) => {
    const actor = payload as { sub?: string; kind?: "access" | "refresh" };
    requireSeries(
      actor.sub &&
        registry.attempted.has(actor.sub) &&
        (actor.kind === "access" || actor.kind === "refresh"),
      "unowned signing attempt",
    );
    const userId = actor.sub,
      kind = actor.kind;
    const issued = sign(payload as object, options).then((token) => {
      registry.issued.push({ userId, kind, token });
      return token;
    });
    registry.pending.push(issued);
    return issued;
  };
  const module = await Test.createTestingModule({
    controllers: [
      IdentityController,
      AttendanceController,
      OperatorLessonMembersController,
      OperatorController,
      OperatorLessonSeriesController,
      TeacherPortalController,
      ParentPortalController,
    ],
    providers: [
      OperatorScopeService,
      TeacherScopeService,
      ParentScopeService,
      PermissionsGuard,
      AccessTokenGuard,
      IdempotencyService,
      AttendanceService,
      LessonLedgerService,
      EarningRuleService,
      EarningRecordingService,
      PartnerEarningRuleService,
      PartnerEarningRecordingService,
      OperatorLessonMembersService,
      AuthService,
      OperatorReadService,
      OperatorLeaveService,
      OperatorStudentService,
      OperatorSettingsService,
      OperatorSchedulingService,
      OperatorLessonSeriesService,
      TeacherReadService,
      TeacherRankingService,
      ParentPortalService,
      StoredFileService,
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService(settings) },
      {
        provide: StaffBindTokenService,
        useValue: {
          consume: () => {
            throw Error("staff binding not allocated");
          },
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  const requestId = new RequestIdMiddleware();
  app.use(requestId.use.bind(requestId));
  const tracker = createAdmissionTracker();
  app.use(
    (
      req: {
        method: string;
        path: string;
        headers?: Record<string, string | undefined>;
      },
      res: {
        status(n: number): { end(): void };
        once(event: string, listener: () => void): unknown;
      },
      next: () => void,
    ) => {
      const allowed =
        (req.method === "GET" && HOST_ROUTES.includes(req.path)) ||
        (req.method === "POST" &&
          /^\/operators\/me\/lesson-series(?:\/preview)?$/.test(req.path)) ||
        (req.method === "POST" &&
          req.path === "/operators/me/lesson-sessions") ||
        (req.method === "POST" &&
          /^\/operators\/me\/lesson-sessions\/[0-9a-f-]+\/(?:cancellation-preview|cancel-selection|cancel)$/.test(
            req.path,
          )) ||
        (req.method === "PATCH" &&
          /^\/operators\/me\/lesson-sessions\/[0-9a-f-]+$/.test(req.path));
      const contentionAllowed =
        (req.method === "PUT" &&
          /^\/teachers\/me\/lesson-sessions\/[0-9a-f-]+\/attendance$/.test(
            req.path,
          )) ||
        (req.method === "POST" && req.path === "/parents/me/leave-requests") ||
        (req.method === "GET" &&
          /^\/operators\/me\/lesson-sessions\/[0-9a-f-]+\/members$/.test(
            req.path,
          )) ||
        (req.method === "POST" &&
          /^\/operators\/me\/lesson-sessions\/[0-9a-f-]+\/members(?:\/[0-9a-f-]+\/remove)?$/.test(
            req.path,
          ));
      if (!allowed && !contentionAllowed) {
        res.status(403).end();
        return;
      }
      const lease = tracker.enter(req.method === "GET" && req.path === "/me");
      if (!lease) {
        res.status(503).end();
        return;
      }
      res.once("finish", lease.finish);
      res.once("close", lease.close);
      admitTaggedRequest(req.headers?.["x-f02-contention"], next);
    },
  );
  return {
    app,
    auth: module.get(AuthService),
    registry,
    quiesce: tracker.quiesce,
    realControllers: [
      AttendanceController,
      OperatorLessonMembersController,
      OperatorController,
      OperatorLessonSeriesController,
      TeacherPortalController,
      ParentPortalController,
    ],
  };
}
