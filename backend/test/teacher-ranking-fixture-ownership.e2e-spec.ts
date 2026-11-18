type Additions = Record<string, Array<{ id: string }>>;
const { assertRankingForeignKeys } = jest.requireActual<{
  assertRankingForeignKeys: (
    client: { query: jest.Mock },
    additions: Additions,
  ) => Promise<void>;
}>('./support/teacher-ranking-fixture-ownership.cjs');

it('checks a nullable composite subject relation as one tuple', async () => {
  const query = jest
    .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
    .mockResolvedValueOnce({
      rows: [
        {
          constraint_id: '123',
          source: 'ClassGroup',
          target: 'CampusSubject',
          source_columns: ['subjectId', 'campusId'],
          target_columns: ['id', 'campusId'],
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ count: 0 }] });
  await assertRankingForeignKeys(
    { query },
    { ClassGroup: [{ id: 'new-class' }] },
  );
  const sql = query.mock.calls[1][0];
  expect(sql).toContain('"subjectId" IS NOT NULL AND "campusId" IS NOT NULL');
  expect(sql).toContain('NOT ("subjectId"::text = ANY($2::text[]))');
  expect(query.mock.calls[1][1]).toEqual([['new-class'], []]);
});

it('supports bigint source IDs while retaining the new referenced student gate', async () => {
  const query = jest
    .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
    .mockResolvedValueOnce({
      rows: [
        {
          constraint_id: '124',
          source: 'PartnerRankingStudentFact',
          target: 'Student',
          source_columns: ['studentId'],
          target_columns: ['id'],
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ count: 0 }] });
  await assertRankingForeignKeys(
    { query },
    {
      PartnerRankingStudentFact: [{ id: '9223372036854775800' }],
      Student: [{ id: 'new-student' }],
    },
  );
  expect(query.mock.calls[1][0]).toContain('id::text = ANY($1::text[])');
  expect(query.mock.calls[1][1]).toEqual([
    ['9223372036854775800'],
    ['new-student'],
  ]);
});

it('rejects an otherwise valid foreign key referencing an older execution', async () => {
  const query = jest
    .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
    .mockResolvedValueOnce({
      rows: [
        {
          constraint_id: '125',
          source: 'AttendanceRecord',
          target: 'Student',
          source_columns: ['studentId'],
          target_columns: ['id'],
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ count: 1 }] });
  await expect(
    assertRankingForeignKeys(
      { query },
      {
        AttendanceRecord: [{ id: 'new-attendance' }],
        Student: [{ id: 'new-student' }],
      },
    ),
  ).rejects.toThrow('older execution');
});
