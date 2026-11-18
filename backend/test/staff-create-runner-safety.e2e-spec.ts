import path from 'node:path';

const policy = jest.requireActual<{
  evidencePath(input: string, exists: (file: string) => boolean): string;
  databaseReady(
    client: { connect: jest.Mock; query: jest.Mock; end: jest.Mock },
    expectedDatabase: string,
  ): Promise<boolean>;
  safeDiagnostics(text: string): boolean;
}>('./support/staff-create-runner-policy.cjs');
const root = path.resolve(__dirname, '../..');
const target = path.join(
  root,
  'docs/verification/staff-create-tcp-2026-10-15-database-v2.log',
);
const client = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue({ rows: [{ database: 'isolated' }] }),
  end: jest.fn().mockResolvedValue(undefined),
});

describe('staff creation runner gates without network or file writes', () => {
  it('accepts only a new evidence log inside the verification directory', () => {
    expect(policy.evidencePath(target, () => false)).toBe(target);
    expect(() => policy.evidencePath(target, () => true)).toThrow();
  });
  it.each([
    '',
    'docs/verification/../staff-create-tcp-2026-10-15-escape.log',
    'docs/verification/nested/staff-create-tcp-2026-10-15-wrong.log',
    'docs/verification/staff-create-tcp-2026-10-15-wrong.txt',
    'docs/verification/unrelated.log',
  ])('rejects an out-of-scope evidence path (%#)', (input) => {
    expect(() =>
      policy.evidencePath(path.resolve(root, input), () => false),
    ).toThrow('A new staff creation verification log is required');
  });
  it('reads the actual database name and closes the client before authorizing fixtures', async () => {
    const connection = client();
    expect(await policy.databaseReady(connection, 'isolated')).toBe(true);
    expect(connection.query).toHaveBeenCalledWith(
      'SELECT current_database() AS database',
    );
    expect(connection.end).toHaveBeenCalledTimes(1);
  });
  it('rejects a connected but different database', async () => {
    const connection = client();
    expect(await policy.databaseReady(connection, 'another')).toBe(false);
    expect(connection.end).toHaveBeenCalledTimes(1);
  });
  it.each(['connect', 'query'] as const)(
    'closes a failed %s without exposing connection diagnostics',
    async (operation) => {
      const connection = client();
      connection[operation].mockRejectedValue(new Error('synthetic secret'));
      expect(await policy.databaseReady(connection, 'isolated')).toBe(false);
      expect(connection.end).toHaveBeenCalledTimes(1);
      if (operation === 'connect')
        expect(connection.query).not.toHaveBeenCalled();
    },
  );
  it.each([
    'Bearer synthetic-token',
    'eyJsynthetic.payload.signature',
    'postgresql://synthetic:synthetic@127.0.0.1/test',
  ])('withholds credential-like test diagnostics (%#)', (text) => {
    expect(policy.safeDiagnostics(text)).toBe(false);
  });
  it('accepts diagnostics containing only database names, statuses and fixture IDs', () => {
    expect(
      policy.safeDiagnostics(
        'STAFF_CREATE_PREFLIGHT {"database":"isolated","ready":false}',
      ),
    ).toBe(true);
  });
});
