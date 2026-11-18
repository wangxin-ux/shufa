import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../src/common/auth/authenticated-user';
import { CurrentUser } from '../../src/common/auth/current-user.decorator';
import { OperatorScopeService } from '../../src/common/auth/operator-scope.service';
import { PermissionsGuard } from '../../src/common/auth/permissions.guard';
import { configureApplication } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AccessTokenGuard } from '../../src/modules/auth/access-token.guard';
import { AuthService } from '../../src/modules/auth/auth.service';
import { StaffBindTokenService } from '../../src/modules/auth/staff-bind-token.service';
import { OperatorAccountController } from '../../src/modules/operator/operator-account.controller';
import { OperatorAccountService } from '../../src/modules/operator/operator-account.service';
import { OperatorEarningController } from '../../src/modules/operator/operator-earning.controller';
import { OperatorEarningService } from '../../src/modules/operator/operator-earning.service';
import type { AccountSessionRegistry } from './operator-pdf-test-account-support';
import type { MainObservation } from './operator-account-main-observation';

export const MAIN_READ_ROUTES = [
  '/me',
  '/operators/me/lesson-account',
  '/operators/me/subjects',
  '/operators/me/earnings/summary',
  '/operators/me/earnings',
];
@Controller()
class MainIdentityController {
  constructor(private readonly auth: AuthService) {}
  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() actor: AuthenticatedUser) {
    return this.auth.getMe(actor.userId);
  }
}
export async function compileMainReadHost(
  client: object,
  settings: Record<string, string>,
  registry: AccountSessionRegistry,
  observation?: MainObservation,
) {
  const jwt = new JwtService();
  const sign = jwt.signAsync.bind(jwt);
  jwt.signAsync = async (
    payload: object | string | Buffer,
    options?: Parameters<typeof sign>[1],
  ) => {
    const token = await sign(payload as object, options);
    const actor = payload as { sub?: string; kind?: string };
    if (
      typeof actor.sub !== 'string' ||
      (actor.kind !== 'access' && actor.kind !== 'refresh') ||
      !registry.attemptedActors.has(actor.sub)
    )
      throw new Error('Unowned signing attempt');
    if (
      !registry.issued.some(
        (item) =>
          item.token === token &&
          item.kind === actor.kind &&
          item.userId === actor.sub,
      )
    )
      registry.issued.push({ userId: actor.sub, kind: actor.kind, token });
    return token;
  };
  const module = await Test.createTestingModule({
    controllers: [
      OperatorAccountController,
      OperatorEarningController,
      MainIdentityController,
    ],
    providers: [
      OperatorAccountService,
      OperatorEarningService,
      OperatorScopeService,
      AccessTokenGuard,
      PermissionsGuard,
      AuthService,
      { provide: PrismaService, useValue: client },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService(settings) },
      {
        provide: StaffBindTokenService,
        useValue: {
          consume: () =>
            Promise.reject(
              new Error('No bind or write route in account main host'),
            ),
        },
      },
    ],
  }).compile();
  observation?.decorateGuard(module.get(AccessTokenGuard));
  return {
    routes: [...MAIN_READ_ROUTES],
    controllers: [
      module.get(OperatorAccountController),
      module.get(OperatorEarningController),
      module.get(MainIdentityController),
    ],
    auth: module.get(AuthService),
    createApp() {
      const app = module.createNestApplication({ logger: false });
      configureApplication(app);
      return app;
    },
    close: () => module.close(),
  };
}
