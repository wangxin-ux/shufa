export interface Generation {
  startedAt: string;
  pid: number;
  restartCount: number;
}
export interface ResourceOperations {
  assertLock(): void | Promise<void>;
  generation(): Generation | Promise<Generation>;
  freshAuditConnection(): Promise<void>;
  clearStatisticsSnapshot(): Promise<void>;
  unknownClients(): Promise<number[]>;
  closeAuditConnection(): Promise<void>;
  stop(): void | Promise<void>;
  assertStopped(): Promise<void>;
  releaseLock(): void | Promise<void>;
}
export interface ResourceCloseout {
  stopped: boolean;
  lockReleased: boolean;
  retained: boolean;
  reason?: string;
}
// Adapted from the teacher's read-only delivered resource guard; no shared imports.
export async function closeOwnedResource(
  started: Generation,
  operations: ResourceOperations,
): Promise<ResourceCloseout> {
  let reason: string | undefined;
  let auditClosed = false,
    stopped = false,
    released = false;
  const matches = (actual: Generation) =>
    Number.isFinite(Date.parse(started.startedAt)) &&
    Number.isInteger(started.pid) &&
    started.pid > 0 &&
    Number.isInteger(started.restartCount) &&
    started.restartCount >= 0 &&
    actual.startedAt === started.startedAt &&
    actual.pid === started.pid &&
    actual.restartCount === started.restartCount;
  try {
    await operations.assertLock();
    if (!matches(await operations.generation())) reason = 'generation-changed';
    if (!reason) {
      await operations.freshAuditConnection();
      await operations.clearStatisticsSnapshot();
      if ((await operations.unknownClients()).length)
        reason = 'unknown-clients';
    }
    if (!reason) {
      await operations.clearStatisticsSnapshot();
      if ((await operations.unknownClients()).length)
        reason = 'late-unknown-clients';
    }
    if (!reason) {
      await operations.assertLock();
      if (!matches(await operations.generation()))
        reason = 'generation-changed';
      else {
        // Keep the independent audit client connected through the final scan and stop.
        await operations.stop();
        await operations.closeAuditConnection();
        auditClosed = true;
        await operations.assertStopped();
        stopped = true;
        await operations.releaseLock();
        released = true;
      }
    }
  } catch {
    reason ??= 'resource-ownership-or-close-failed';
  } finally {
    if (!auditClosed) {
      try {
        await operations.closeAuditConnection();
      } catch {
        reason ??= 'audit-close-failed';
      }
    }
  }
  return {
    stopped,
    lockReleased: released,
    retained: !released,
    ...(reason ? { reason } : {}),
  };
}
