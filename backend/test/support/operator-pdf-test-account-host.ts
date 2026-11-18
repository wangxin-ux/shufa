import { Controller, Get, UseGuards, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { resolve } from 'node:path';
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
import { createAccountSetup } from './operator-pdf-test-account-support';
import { accountLiveAdmission } from './operator-pdf-test-account-window';

export interface AccountHostClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRawUnsafe<T>(sql: string): Promise<T>;
}
interface AccountApplication {
  init(): Promise<unknown>;
  close(): Promise<void>;
}
export interface AccountModuleOwner {
  compile(): Promise<void>;
  createApp(): AccountApplication;
  get<T>(token: Type<T>): T;
  close(): Promise<void>;
}
export interface AccountHostProviders {
  createClient(): AccountHostClient;
  createModule(
    client: AccountHostClient,
    settings: Record<string, string>,
  ): AccountModuleOwner;
}

// This test-only /me delegates to the real AuthService and real access guard.
// Login/bind/financial write routes are deliberately absent from this module.
@Controller()
class AccountHostIdentityController {
  constructor(private readonly auth: AuthService) {}
  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() actor: AuthenticatedUser) {
    return this.auth.getMe(actor.userId);
  }
}

export function createAccountNestModule(
  client: AccountHostClient,
  settings: Record<string, string>,
): AccountModuleOwner {
  let moduleRef: TestingModule | undefined;
  let compilationStarted = false;
  return {
    async compile() {
      if (compilationStarted)
        throw new Error('E01 Nest module compilation already started');
      compilationStarted = true;
      moduleRef = await Test.createTestingModule({
        imports: [JwtModule.register({})],
        controllers: [OperatorAccountController, AccountHostIdentityController],
        providers: [
          OperatorAccountService,
          OperatorScopeService,
          AccessTokenGuard,
          PermissionsGuard,
          AuthService,
          { provide: PrismaService, useValue: client },
          { provide: ConfigService, useValue: new ConfigService(settings) },
          {
            provide: StaffBindTokenService,
            useValue: {
              consume: () =>
                Promise.reject(
                  new Error('E01 account host has no binding route'),
                ),
            },
          },
        ],
      }).compile();
    },
    createApp() {
      if (!moduleRef) throw new Error('E01 module not compiled');
      const app = moduleRef.createNestApplication({ logger: false });
      configureApplication(app);
      return app;
    },
    get<T>(token: Type<T>): T {
      if (!moduleRef) throw new Error('E01 module not compiled');
      return moduleRef.get<T>(token);
    },
    async close() {
      await moduleRef?.close();
    },
  };
}
function flatten(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? (error.errors as unknown[]).flatMap(flatten)
    : [error];
}

export function startAccountNestHost(options: {
  mode: 'offline' | 'live';
  settings: Record<string, string>;
  providers: AccountHostProviders;
  checkpoint?: () => void;
}) {
  if (options.mode === 'live')
    accountLiveAdmission(process.env, resolve(__dirname, '../../..'));
  const setup = createAccountSetup();
  let client: AccountHostClient | undefined;
  let module: AccountModuleOwner | undefined;
  let app: AccountApplication | undefined;
  let initialized = false;
  let accepting = true;
  let closing: Promise<void> | undefined;
  const work = new Set<Promise<unknown>>();
  const workErrors: unknown[] = [];
  const slots = [
    {
      label: 'prisma',
      closed: false,
      close: async () => {
        await client?.$disconnect();
      },
    },
    {
      label: 'module',
      closed: false,
      close: async () => {
        await module?.close();
      },
    },
    {
      label: 'app',
      closed: false,
      close: async () => {
        await app?.close();
      },
    },
  ];
  const closeErrors: unknown[] = [];
  let resourceClose: Promise<void> | undefined;
  const closeResources = () => {
    resourceClose ??= (async () => {
      for (const slot of [...slots].reverse()) {
        try {
          await slot.close();
          slot.closed = true;
        } catch (error) {
          closeErrors.push(...flatten(error));
        }
      }
      if (closeErrors.length)
        throw new AggregateError(closeErrors, 'E01 host resource close failed');
    })();
    return resourceClose;
  };
  const checkpoint = () => {
    setup.check();
    options.checkpoint?.();
  };
  const ready = setup
    .start(async () => {
      try {
        checkpoint();
        client = options.providers.createClient();
        checkpoint();
        await client.$connect();
        checkpoint();
        const [settings] = await client.$queryRawUnsafe<
          Array<{ replicationRole: string; searchPath: string }>
        >(`
        SELECT current_setting('session_replication_role') AS "replicationRole",
               current_setting('search_path') AS "searchPath"
      `);
        checkpoint();
        if (
          settings?.replicationRole !== 'origin' ||
          settings.searchPath !== 'public'
        )
          throw new Error('E01 host requires effective origin/public');
        module = options.providers.createModule(client, options.settings);
        checkpoint();
        await module.compile();
        checkpoint();
        app = module.createApp();
        checkpoint();
        await app.init();
        checkpoint();
        initialized = true;
      } catch (primary) {
        accepting = false;
        try {
          await closeResources();
        } catch (cleanup) {
          throw new AggregateError(
            [...flatten(primary), ...flatten(cleanup)],
            'E01 host initialization and close failed',
          );
        }
        throw primary;
      }
    })
    .then(() => ({ client: client!, module: module!, app: app! }));
  // The caller owns ready; draining also retains its failure if cancellation wins first.
  void ready.catch(() => undefined);
  return {
    ready,
    cancel(reason?: Error) {
      accepting = false;
      setup.cancel(reason);
    },
    listen(): Promise<void> {
      return Promise.resolve().then(() =>
        accountLiveAdmission(process.env, resolve(__dirname, '../../..')),
      );
    },
    run<T>(operation: () => Promise<T>): Promise<T> {
      if (!accepting || !initialized)
        return Promise.reject(new Error('E01 host work admission closed'));
      const task = Promise.resolve()
        .then(operation)
        .catch((error: unknown) => {
          workErrors.push(...flatten(error));
          throw error;
        });
      work.add(task);
      void task
        .finally(() => {
          work.delete(task);
        })
        .catch(() => undefined);
      return task;
    },
    closeAndDrain() {
      if (closing) return closing;
      accepting = false;
      setup.cancel();
      closing = (async () => {
        await setup.cancelAndDrain();
        await Promise.allSettled([...work]);
        await closeResources().catch(() => undefined);
        const errors = [
          ...new Set([
            ...setup.state().failures.flatMap(flatten),
            ...workErrors,
            ...closeErrors,
          ]),
        ];
        if (errors.length)
          throw new AggregateError(errors, 'E01 host setup/drain/close failed');
      })();
      return closing;
    },
    state: () => ({
      initialized,
      accepting,
      inFlight: work.size,
      registered: slots.map((slot) => slot.label),
      outstanding: slots
        .filter((slot) => !slot.closed)
        .map((slot) => slot.label),
      closed: slots.every((slot) => slot.closed),
      setup: setup.state(),
    }),
  };
}
