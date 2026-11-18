import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma, RoleCode } from '@prisma/client';

export interface AccountFixtureData {
  Campus: Prisma.CampusUncheckedCreateInput;
  User: Prisma.UserUncheckedCreateInput;
  UserRole: Prisma.UserRoleUncheckedCreateInput;
  Student: Prisma.StudentUncheckedCreateInput;
  CampusSubject: Prisma.CampusSubjectUncheckedCreateInput;
  StoredFile: Prisma.StoredFileUncheckedCreateInput;
  CourseProduct: Prisma.CourseProductUncheckedCreateInput;
  EnrollmentOrder: Prisma.EnrollmentOrderUncheckedCreateInput;
  GroupCampaign: Prisma.GroupCampaignUncheckedCreateInput;
  GroupTeam: Prisma.GroupTeamUncheckedCreateInput;
  GroupMember: Prisma.GroupMemberUncheckedCreateInput;
  PaymentTransaction: Prisma.PaymentTransactionUncheckedCreateInput;
  CoursePackage: Prisma.CoursePackageUncheckedCreateInput;
  FinanceReceipt: Prisma.FinanceReceiptUncheckedCreateInput;
  FinancePackageIssuance: Prisma.FinancePackageIssuanceUncheckedCreateInput;
  FinanceRefundRequest: Prisma.FinanceRefundRequestUncheckedCreateInput;
  FinanceRefundPayment: Prisma.FinanceRefundPaymentUncheckedCreateInput;
  FinanceReceiptCorrection: Prisma.FinanceReceiptCorrectionUncheckedCreateInput;
  TeacherProfile: Prisma.TeacherProfileUncheckedCreateInput;
  ClassGroup: Prisma.ClassGroupUncheckedCreateInput;
  LessonSession: Prisma.LessonSessionUncheckedCreateInput;
  LessonLedgerEntry: Prisma.LessonLedgerEntryUncheckedCreateInput;
}
type Table = keyof AccountFixtureData;
export type AccountFixtureRecord = {
  [M in Table]: { table: M; key: string; data: AccountFixtureData[M] };
}[Table];
export type AccountFixtureScenario =
  | 'baseline'
  | 'uncovered-package'
  | 'receipt-amount-mismatch'
  | 'ledger-student-mismatch'
  | 'order-member-mismatch';
export interface AccountFixtureInput {
  windowId: string;
  executionId: string;
  syntheticNow: Date;
  scenario?: AccountFixtureScenario;
}
interface ForeignKey {
  table: Table;
  rowId: string;
  relation: string;
  fields: string[];
  values: unknown[];
  targetTable: string;
  targetFields: string[];
  targetId: string | null;
}
interface TriggerFact {
  table: 'PartnerRankingStudentFact';
  event: 'insert' | 'move';
  studentId: string;
  campusId: string;
  isActive: boolean;
  captureGeneratedId: true;
}
export interface AccountFixturePlan {
  mode: 'pure-construction-only';
  liveReady: false;
  windowId: string;
  executionId: string;
  syntheticNow: Date;
  scenario: AccountFixtureScenario;
  ids: Record<string, string>;
  records: AccountFixtureRecord[];
  accounts: Array<{
    label: string;
    userId: string;
    roles: Array<{ roleCode: RoleCode; campusId: string | null }>;
    cleanup: 'DISABLED';
  }>;
  actors: Record<
    string,
    { userId: string; purpose: string; independentScenarioRequired: boolean }
  >;
  packageCases: Array<{ kind: string; packageId: string; current: boolean }>;
  races: Array<{
    kind: string;
    table: 'User' | 'UserRole' | 'Student';
    id: string;
    field: string;
    before: string | boolean;
    after: string | boolean;
    expectedStatus: number;
    expectedTriggerFact?: TriggerFact;
  }>;
  manifest: {
    ownedRows: Array<{ table: Table; key: string; id: string }>;
    foreignKeys: ForeignKey[];
    triggerFacts: TriggerFact[];
  };
  expected: {
    status: 'proposed-oracle-not-executed';
    balances: {
      mainBalanceUnits: number;
      giftBalanceUnits: number;
      mainReservedUnits: number;
      giftReservedUnits: number;
      mainAvailableUnits: number;
      giftAvailableUnits: number;
      totalBalanceUnits: number;
      reservedTotalUnits: number;
      availableTotalUnits: number;
    };
    enrollmentSummary: {
      receivedAmountFen: number | null;
      refundedAmountFen: number | null;
      initialMainUnits: number | null;
      initialGiftUnits: number | null;
      pendingIssuanceCount: number;
    };
    lessonActivityTotals: Array<{
      entryType: string;
      mainDeltaUnits: number | null;
      giftDeltaUnits: number | null;
      totalDeltaUnits: number | null;
    }>;
    filteredDetailCount: number;
    assertions: string[];
    invalidSources: Array<{ key: string; rule: string; effect: string }>;
  };
  remaining: string[];
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const types = [
  'GRANT',
  'CONSUME',
  'REVERSAL',
  'ADJUSTMENT',
  'REFUND',
  'CORRECTION',
] as const;
const invalidSources = {
  baseline: [],
  'uncovered-package': [
    {
      key: 'pack-unclassified',
      rule: 'package-source',
      effect: 'all enrollment numeric fields null',
    },
  ],
  'receipt-amount-mismatch': [
    {
      key: 'issuance-valid',
      rule: 'issuance-amount',
      effect: 'initial MAIN/GIFT null; receipts remain independently readable',
    },
  ],
  'ledger-student-mismatch': [
    {
      key: 'adjust-main',
      rule: 'ledger-owner',
      effect: 'ADJUSTMENT MAIN/total null; unfiltered detail 500',
    },
  ],
  'order-member-mismatch': [
    {
      key: 'member-online',
      rule: 'member-order',
      effect: 'all enrollment numeric fields null; online payment context null',
    },
  ],
} satisfies Record<
  AccountFixtureScenario,
  AccountFixturePlan['expected']['invalidSources']
>;

export function accountFixtureRows<M extends Table>(
  plan: Pick<AccountFixturePlan, 'records'>,
  table: M,
): Array<{ table: M; key: string; data: AccountFixtureData[M] }> {
  return plan.records.filter((row) => row.table === table) as Array<{
    table: M;
    key: string;
    data: AccountFixtureData[M];
  }>;
}

function assertFullDmmf(dmmf: Prisma.DMMF.Datamodel) {
  if (
    !dmmf.models.length ||
    dmmf.models.some((model) =>
      model.fields.some(
        (field) =>
          typeof field.isRequired !== 'boolean' ||
          typeof field.isList !== 'boolean' ||
          (field.kind === 'object' && !Array.isArray(field.relationFromFields)),
      ),
    )
  )
    throw new Error(
      'E01 requires full runtime Prisma DMMF; lite DMMF rejected',
    );
}

function foreignKeys(
  records: AccountFixtureRecord[],
  dmmf: Prisma.DMMF.Datamodel,
) {
  assertFullDmmf(dmmf);
  const edges: ForeignKey[] = [];
  const seen = new Set<string>();
  for (const row of records) {
    const model = dmmf.models.find((item) => item.name === row.table);
    if (!model) throw new Error(`Unknown fixture table ${row.table}`);
    const data = row.data as Record<string, unknown>;
    if (typeof data.id !== 'string' || !uuid.test(data.id))
      throw new Error(`Explicit UUID required: ${row.key}`);
    const identity = `${row.table}:${data.id}`;
    if (seen.has(identity))
      throw new Error(`Duplicate fixture row ${identity}`);
    seen.add(identity);
    for (const name of Object.keys(data))
      if (
        !model.fields.some(
          (field) => field.name === name && field.kind !== 'object',
        )
      )
        throw new Error(`Unknown or nested fixture field ${row.table}.${name}`);
    for (const field of model.fields.filter((item) => item.kind !== 'object')) {
      const value = data[field.name];
      if (value === undefined) {
        if (field.isRequired && !field.hasDefaultValue && !field.isUpdatedAt)
          throw new Error(`Missing required field ${row.table}.${field.name}`);
        continue;
      }
      if (value === null) {
        if (field.isRequired)
          throw new Error(`Null required field ${row.table}.${field.name}`);
        continue;
      }
      const values = field.isList ? value : [value];
      if (!Array.isArray(values)) throw new Error(`Invalid list ${field.name}`);
      for (const item of values) {
        const valid =
          field.kind === 'enum'
            ? dmmf.enums
                .find((entry) => entry.name === field.type)!
                .values.some((entry) => entry.name === item)
            : field.type === 'Int'
              ? typeof item === 'number' &&
                Number.isInteger(item) &&
                item >= -2147483648 &&
                item <= 2147483647
              : field.type === 'String'
                ? typeof item === 'string'
                : field.type === 'Boolean'
                  ? typeof item === 'boolean'
                  : field.type === 'DateTime'
                    ? item instanceof Date && Number.isFinite(item.getTime())
                    : field.type === 'Json';
        if (!valid)
          throw new Error(`Invalid scalar ${row.table}.${field.name}`);
      }
    }
    for (const relation of model.fields.filter(
      (field) => field.kind === 'object' && field.relationFromFields?.length,
    )) {
      const fields = [...relation.relationFromFields!];
      for (const field of fields)
        if (!Object.hasOwn(data, field) || data[field] === undefined)
          throw new Error(
            `Explicit nullable/non-null FK required ${row.key}.${field}`,
          );
      const values = fields.map((field) => data[field]);
      const nullable = values.some((value) => value === null);
      const targetFields = [...relation.relationToFields!];
      const target = nullable
        ? undefined
        : records.find(
            (item) =>
              item.table === relation.type &&
              targetFields.every(
                (field, index) =>
                  (item.data as Record<string, unknown>)[field] ===
                  values[index],
              ),
          );
      if (
        (nullable &&
          (relation.isRequired ||
            fields.some(
              (field) =>
                data[field] === null &&
                model.fields.find((entry) => entry.name === field)!.isRequired,
            ))) ||
        (!nullable && !target)
      )
        throw new Error(
          `Foreign key outside manifest ${row.key}.${relation.name}`,
        );
      edges.push({
        table: row.table,
        rowId: data.id,
        relation: relation.name,
        fields,
        values,
        targetTable: relation.type,
        targetFields,
        targetId: target ? String(target.data.id) : null,
      });
    }
  }
  for (const model of dmmf.models) {
    const own = records.filter((row) => row.table === model.name);
    const unique = [
      ...model.fields
        .filter((field) => field.isUnique || field.isId)
        .map((field) => [field.name]),
      ...model.uniqueFields.map((fields) => [...fields]),
    ];
    for (const fields of unique) {
      const keys = new Set<string>();
      for (const row of own) {
        const values = fields.map(
          (field) => (row.data as Record<string, unknown>)[field],
        );
        if (values.some((value) => value === null || value === undefined))
          continue;
        const key = JSON.stringify(values);
        if (keys.has(key))
          throw new Error(`Duplicate unique ${model.name}.${fields.join(',')}`);
        keys.add(key);
      }
    }
  }
  return edges;
}

function expectedTriggerFacts(records: AccountFixtureRecord[]): TriggerFact[] {
  return accountFixtureRows({ records }, 'Student').map(({ data }) => ({
    table: 'PartnerRankingStudentFact',
    event: 'insert',
    studentId: String(data.id),
    campusId: data.campusId,
    isActive: data.isActive!,
    captureGeneratedId: true,
  }));
}

/** Pure construction; full DMMF must come from the caller's checked schema. */
export function buildAccountFixture(
  input: AccountFixtureInput,
  dmmf: Prisma.DMMF.Datamodel,
): AccountFixturePlan {
  assertFullDmmf(dmmf);
  if (
    !uuid.test(input.windowId) ||
    !uuid.test(input.executionId) ||
    input.windowId === input.executionId ||
    !(input.syntheticNow instanceof Date) ||
    !Number.isFinite(input.syntheticNow.getTime())
  )
    throw new Error(
      'New distinct UUIDv4 window/execution and syntheticNow required',
    );
  const scenario = input.scenario ?? 'baseline';
  if (!Object.hasOwn(invalidSources, scenario))
    throw new Error('Unknown E01 fixture scenario');
  const now = new Date(input.syntheticNow);
  const time = (days: number, seconds = 0) =>
    new Date(now.getTime() + days * 86400000 + seconds * 1000);
  const id = (key: string) => {
    const bytes = createHash('sha256')
      .update(
        JSON.stringify([input.windowId, input.executionId, scenario, key]),
      )
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const records: AccountFixtureRecord[] = [];
  const stamp = { createdAt: time(-60), updatedAt: time(-1) };
  const add = <M extends Table>(
    table: M,
    key: string,
    data: AccountFixtureData[M],
  ) => {
    records.push({ table, key, data } as AccountFixtureRecord);
    return id(key);
  };
  const campusA = id('campus-a'),
    campusB = id('campus-b');
  for (const key of ['campus-a', 'campus-b'])
    add('Campus', key, {
      id: id(key),
      code: `e01-${id(key)}`,
      name: `Synthetic ${key}`,
      timezone: 'Asia/Shanghai',
      customerServiceQrFileId: null,
      ...stamp,
    });
  const accounts: AccountFixturePlan['accounts'] = [];
  const roles: Array<[string, RoleCode[], string | null]> = [
    ['operator-a', ['OPERATOR'], campusA],
    ['operator-b', ['OPERATOR'], campusB],
    ['mixed', ['OPERATOR'], campusA],
    ['unscoped', ['OPERATOR'], null],
    ['teacher', ['TEACHER'], campusA],
    ['parent', ['PARENT'], campusA],
    ['finance-requester', ['FINANCE'], null],
    ['finance-reviewer', ['FINANCE'], null],
    ['revoke-status', ['OPERATOR'], campusA],
    ['revoke-role', ['OPERATOR'], campusA],
    ['revoke-campus', ['OPERATOR'], campusA],
    ['move-reader', ['OPERATOR'], campusA],
  ];
  // All User rows precede roles; each attempted actor can be disabled independently.
  for (const [label] of roles)
    add('User', `user-${label}`, {
      id: id(`user-${label}`),
      displayName: `Synthetic ${label}`,
      status: 'ACTIVE',
      staffPhone: null,
      parentPhone: null,
      accountVersion: 1,
      ...stamp,
    });
  for (const [label, codes, campusId] of roles) {
    for (const roleCode of codes)
      add('UserRole', `role-${label}-${roleCode}`, {
        id: id(`role-${label}-${roleCode}`),
        userId: id(`user-${label}`),
        roleCode,
        campusId,
        createdAt: time(-60),
      });
    accounts.push({
      label,
      userId: id(`user-${label}`),
      roles: codes.map((roleCode) => ({ roleCode, campusId })),
      cleanup: 'DISABLED',
    });
  }
  const aliases: Array<[string, string, boolean]> = [
    ['owner', 'operator-a', false],
    ['other-campus', 'operator-b', false],
    ['unscoped', 'unscoped', false],
    ['mixed', 'mixed', false],
    ['teacher', 'teacher', false],
    ['parent', 'parent', false],
    ['denial-account-401', 'revoke-status', true],
    ['denial-account-403', 'revoke-role', true],
    ['denial-subjects-401', 'revoke-status', true],
    ['denial-subjects-403', 'revoke-role', true],
    ['return-revocation', 'revoke-status', true],
    ['student-move', 'move-reader', true],
  ];
  const actors = Object.fromEntries(
    aliases.map(([purpose, label, independentScenarioRequired]) => [
      purpose,
      { userId: id(`user-${label}`), purpose, independentScenarioRequired },
    ]),
  );
  for (const [key, campusId, isActive] of [
    ['student-a', campusA, true],
    ['student-inactive', campusA, false],
    ['student-departed', campusB, true],
    ['student-b', campusB, true],
  ] as const)
    add('Student', key, {
      id: id(key),
      campusId,
      displayName: `Synthetic ${key}`,
      profilePhotoFileId: null,
      isActive,
      ...stamp,
    });
  for (let index = 0; index < 102; index++) {
    const key = index === 101 ? 'subject-b' : `subject-${index}`;
    add('CampusSubject', key, {
      id: id(key),
      campusId: index === 101 ? campusB : campusA,
      name: `Subject ${String(index).padStart(3, '0')}`,
      isActive: index !== 100,
      version: 1,
      ...stamp,
    });
  }
  const requester = id('user-finance-requester'),
    reviewer = id('user-finance-reviewer');
  const studentA = id('student-a');
  const subject = id('subject-0');
  add('TeacherProfile', 'teacher-profile', {
    id: id('teacher-profile'),
    userId: id('user-teacher'),
    campusId: campusA,
    employeeCode: `e01-${id('teacher-profile')}`,
    specialties: [],
    isActive: true,
    ...stamp,
  });
  add('ClassGroup', 'class', {
    id: id('class'),
    campusId: campusA,
    teacherId: id('teacher-profile'),
    subjectId: subject,
    name: 'Synthetic class',
    courseName: 'Synthetic course',
    defaultLessonUnits: 100,
    status: 'ACTIVE',
    ...stamp,
  });
  // Saved historical metadata only; no claim of teaching-write coverage.
  for (let index = 0; index < 23; index++)
    add('LessonSession', `lesson-${index}`, {
      id: id(`lesson-${index}`),
      seriesId: null,
      campusId: campusA,
      classGroupId: id('class'),
      teacherId: id('teacher-profile'),
      startsAt: time(-32 + index),
      endsAt: time(-32 + index, 3600),
      lessonUnits: index === 0 ? 200 : 100,
      status: index === 0 ? 'REVERSED' : 'COMPLETED',
      completedAt: time(-32 + index, 3600),
      reversedAt: index === 0 ? time(-9) : null,
      reversalReason: index === 0 ? 'Synthetic reversal' : null,
      ...stamp,
    });
  const file = (
    key: string,
    purpose: 'FINANCE_RECEIPT_PROOF' | 'FINANCE_REFUND_PROOF',
  ) =>
    add('StoredFile', key, {
      id: id(key),
      purpose,
      storageKey: `synthetic/e01/${input.windowId}/${id(key)}`,
      originalName: 'synthetic-proof.png',
      mimeType: 'image/png',
      sizeBytes: 1,
      sha256: createHash('sha256').update(key).digest('hex'),
      createdByUserId: requester,
      photoTargetStudentId: null,
      createdAt: time(-50),
    });
  const receipt = (kind: string, studentId: string, amountFen: number) => {
    const key = `receipt-${kind}`;
    const proofFileId = file(`proof-${kind}`, 'FINANCE_RECEIPT_PROOF');
    return add('FinanceReceipt', key, {
      id: id(key),
      campusId: campusA,
      studentId,
      amountFen,
      receivedOn: new Date(time(-50).toISOString().slice(0, 10)),
      channel: 'OTHER',
      proofFileId,
      note: 'Synthetic only',
      createdByUserId: requester,
      createdAt: time(-50),
    });
  };
  // Online source graph is complete for one settled, paid, non-refunded order.
  add('CourseProduct', 'product', {
    id: id('product'),
    campusId: campusA,
    name: 'Synthetic online product',
    summary: 'Synthetic only',
    coverFileId: null,
    priceFen: 60000,
    mainUnits: 6000,
    giftUnits: 600,
    validityDays: 365,
    status: 'ACTIVE',
    createdByUserId: requester,
    ...stamp,
  });
  add('EnrollmentOrder', 'order-online', {
    id: id('order-online'),
    orderNo: `e01-${id('order-online')}`,
    parentUserId: id('user-parent'),
    studentId: studentA,
    campusId: campusA,
    courseProductId: id('product'),
    productNameSnapshot: 'Synthetic online product',
    priceFenSnapshot: 60000,
    mainUnitsSnapshot: 6000,
    giftUnitsSnapshot: 600,
    validityDaysSnapshot: 365,
    status: 'EFFECTIVE',
    reviewedByUserId: null,
    ...stamp,
  });
  add('GroupCampaign', 'campaign', {
    id: id('campaign'),
    code: `e01-${id('campaign')}`,
    campusId: campusA,
    courseProductId: id('product'),
    title: 'Synthetic campaign',
    description: 'Synthetic only',
    priceFen: 60000,
    maxPaidMembers: 3,
    startsAt: time(-55),
    endsAt: time(-40),
    status: 'CLOSED',
    createdByUserId: requester,
    ...stamp,
  });
  add('GroupTeam', 'team', {
    id: id('team'),
    campaignId: id('campaign'),
    leaderUserId: id('user-parent'),
    status: 'SETTLED',
    paidMemberCount: 1,
    finalTier: 1,
    settledAt: time(-49),
    ...stamp,
  });
  add('GroupMember', 'member-online', {
    id: id('member-online'),
    campaignId: id('campaign'),
    teamId: id('team'),
    parentUserId:
      scenario === 'order-member-mismatch'
        ? id('user-teacher')
        : id('user-parent'),
    studentId: studentA,
    enrollmentOrderId: id('order-online'),
    status: 'SETTLED',
    reservationExpiresAt: time(-50, 3600),
    paidAt: time(-50),
    settledAt: time(-49),
    grantedMainUnits: 6000,
    grantedGiftUnits: 600,
    ...stamp,
  });
  add('PaymentTransaction', 'payment-online', {
    id: id('payment-online'),
    groupMemberId: id('member-online'),
    enrollmentOrderId: id('order-online'),
    type: 'PAYMENT',
    provider: 'MOCK',
    outTradeNo: `e01-${id('payment-online')}`,
    providerTradeNo: null,
    amountFen: 60000,
    status: 'SUCCEEDED',
    succeededAt: time(-50),
    failedAt: null,
    ...stamp,
  });
  const packageCases: AccountFixturePlan['packageCases'] = [];
  const packageSeeds = [
    {
      kind: 'valid',
      main: 10000,
      gift: 2000,
      amount: 100000,
      studentId: studentA,
      subjectId: subject,
    },
    {
      kind: 'expired',
      main: 1000,
      gift: 100,
      amount: 10000,
      studentId: studentA,
      subjectId: id('subject-1'),
    },
    {
      kind: 'inactive',
      main: 2000,
      gift: 200,
      amount: 20000,
      studentId: id('student-inactive'),
      subjectId: id('subject-100'),
    },
    {
      kind: 'departed',
      main: 3000,
      gift: 300,
      amount: 30000,
      studentId: id('student-departed'),
      subjectId: id('subject-2'),
    },
    {
      kind: 'future',
      main: 4000,
      gift: 400,
      amount: 40000,
      studentId: studentA,
      subjectId: subject,
    },
    {
      kind: 'unclassified',
      main: 500,
      gift: 50,
      amount: 5000,
      studentId: studentA,
      subjectId: null,
    },
    {
      kind: 'online',
      main: 6000,
      gift: 600,
      amount: 60000,
      studentId: studentA,
      subjectId: subject,
    },
    {
      kind: 'voided',
      main: 1000,
      gift: 100,
      amount: 10000,
      studentId: studentA,
      subjectId: subject,
    },
  ];
  const ledger = (
    key: string,
    kind: string,
    entryType: (typeof types)[number],
    bucket: 'MAIN' | 'GIFT',
    deltaUnits: number,
    before: number,
    extra: Partial<Prisma.LessonLedgerEntryUncheckedCreateInput> = {},
  ) => {
    const pack = packageSeeds.find((seed) => seed.kind === kind)!;
    const subjectName = pack.subjectId
      ? accountFixtureRows({ records }, 'CampusSubject').find(
          (row) => row.data.id === pack.subjectId,
        )!.data.name
      : null;
    return add('LessonLedgerEntry', key, {
      id: id(key),
      campusId: campusA,
      studentId: pack.studentId,
      coursePackageId: id(`pack-${kind}`),
      entryType,
      bucket,
      deltaUnits,
      balanceBeforeUnits: before,
      balanceAfterUnits: before + deltaUnits,
      subjectId: pack.subjectId,
      subjectName,
      lessonSessionId: null,
      reversalOfId: null,
      financeCorrectionId: null,
      financeRefundId: null,
      actorUserId: requester,
      reason: 'Synthetic only',
      idempotencyKey: id(key),
      createdAt: time(-49, records.length),
      ...extra,
    });
  };
  for (const seed of packageSeeds) {
    const { kind, studentId, subjectId, main, gift, amount } = seed;
    const current = ['valid', 'unclassified', 'online'].includes(kind);
    const validFrom = kind === 'future' ? time(1) : time(-49);
    const expiresAt = kind === 'expired' ? time(-1) : time(365);
    add('CoursePackage', `pack-${kind}`, {
      id: id(`pack-${kind}`),
      campusId: campusA,
      studentId,
      name: `Synthetic ${kind}`,
      subjectId,
      mainBalanceUnits: kind === 'valid' ? 7650 : kind === 'voided' ? 0 : main,
      giftBalanceUnits: kind === 'valid' ? 1850 : kind === 'voided' ? 0 : gift,
      mainReservedUnits: kind === 'valid' ? 300 : 0,
      giftReservedUnits: kind === 'valid' ? 100 : 0,
      paidAmountFen: amount,
      validFrom,
      expiresAt,
      isActive: !['inactive', 'voided'].includes(kind),
      sourceOrderId: kind === 'online' ? id('order-online') : null,
      ...stamp,
    });
    packageCases.push({ kind, packageId: id(`pack-${kind}`), current });
    if (
      kind !== 'online' &&
      !(scenario === 'uncovered-package' && kind === 'unclassified')
    ) {
      const receiptId = receipt(kind, studentId, amount);
      add('FinancePackageIssuance', `issuance-${kind}`, {
        id: id(`issuance-${kind}`),
        receiptId,
        coursePackageId: id(`pack-${kind}`),
        originalAmountFen:
          scenario === 'receipt-amount-mismatch' && kind === 'valid'
            ? amount + 1
            : amount,
        initialMainUnits: main,
        initialGiftUnits: gift,
        name: `Synthetic ${kind}`,
        validFrom,
        expiresAt,
        issuedByUserId: requester,
        createdAt: time(-49),
      });
    }
  }
  receipt('pending', studentA, 7000);
  for (const paid of [true, false]) {
    const key = paid ? 'refund-paid' : 'refund-reserved';
    add('FinanceRefundRequest', key, {
      id: id(key),
      issuanceId: id('issuance-valid'),
      mainUnits: paid ? 200 : 300,
      giftUnits: 100,
      referenceAmountFen: paid ? 2000 : 3000,
      amountFen: paid ? 2000 : 3000,
      reason: 'Synthetic only',
      status: paid ? 'PAID' : 'SUBMITTED',
      requestedByUserId: requester,
      reviewedByUserId: paid ? reviewer : null,
      reviewedAt: paid ? time(-5) : null,
      paymentStartedAt: paid ? time(-4) : null,
      ...stamp,
    });
  }
  const refundProof = file('proof-refund', 'FINANCE_REFUND_PROOF');
  add('FinanceRefundPayment', 'refund-payment', {
    id: id('refund-payment'),
    refundId: id('refund-paid'),
    amountFen: 2000,
    paidAt: time(-3),
    proofFileId: refundProof,
    externalReference: `e01-${id('refund-payment')}`,
    recordedByUserId: reviewer,
    recordedAt: time(-3),
  });
  add('FinanceReceiptCorrection', 'correction-void', {
    id: id('correction-void'),
    originalIssuanceId: id('issuance-voided'),
    type: 'VOID',
    status: 'APPLIED',
    reason: 'Synthetic only',
    originalAmountFen: 10000,
    sourcePackageVersion: 1,
    proposedProofFileId: null,
    replacementReceiptId: null,
    requestedByUserId: requester,
    reviewedByUserId: reviewer,
    reviewedAt: time(-2),
    appliedByUserId: requester,
    appliedAt: time(-1),
    ...stamp,
  });
  for (const seed of packageSeeds)
    for (const bucket of ['MAIN', 'GIFT'] as const)
      ledger(
        `grant-${seed.kind}-${bucket}`,
        seed.kind,
        'GRANT',
        bucket,
        bucket === 'MAIN' ? seed.main : seed.gift,
        0,
      );
  for (let index = 0; index < 23; index++)
    ledger(
      `consume-main-${index}`,
      'valid',
      'CONSUME',
      'MAIN',
      -100,
      10000 - index * 100,
      {
        lessonSessionId: id(`lesson-${index}`),
        createdAt: time(-32 + index, 3600),
      },
    );
  ledger('consume-gift', 'valid', 'CONSUME', 'GIFT', -100, 2000, {
    lessonSessionId: id('lesson-0'),
    createdAt: time(-32, 3601),
  });
  ledger('reverse-main', 'valid', 'REVERSAL', 'MAIN', 100, 7700, {
    reversalOfId: id('consume-main-0'),
    lessonSessionId: id('lesson-0'),
    createdAt: time(-9),
  });
  ledger('reverse-gift', 'valid', 'REVERSAL', 'GIFT', 100, 1900, {
    reversalOfId: id('consume-gift'),
    lessonSessionId: id('lesson-0'),
    createdAt: time(-9),
  });
  ledger(
    'adjust-main',
    'valid',
    'ADJUSTMENT',
    'MAIN',
    50,
    7800,
    scenario === 'ledger-student-mismatch'
      ? {
          studentId: id('student-inactive'),
          subjectId: null,
          subjectName: null,
          createdAt: time(-8),
        }
      : { createdAt: time(-8) },
  );
  ledger('adjust-gift', 'valid', 'ADJUSTMENT', 'GIFT', -50, 2000, {
    createdAt: time(-8),
  });
  ledger('refund-main', 'valid', 'REFUND', 'MAIN', -200, 7850, {
    financeRefundId: id('refund-paid'),
    createdAt: time(-3),
  });
  ledger('refund-gift', 'valid', 'REFUND', 'GIFT', -100, 1950, {
    financeRefundId: id('refund-paid'),
    createdAt: time(-3),
  });
  for (const bucket of ['MAIN', 'GIFT'] as const)
    ledger(
      `correct-${bucket}`,
      'voided',
      'CORRECTION',
      bucket,
      bucket === 'MAIN' ? -1000 : -100,
      bucket === 'MAIN' ? 1000 : 100,
      {
        financeCorrectionId: id('correction-void'),
        reversalOfId: id(`grant-voided-${bucket}`),
        createdAt: time(-1),
      },
    );
  const lessonActivityTotals = types.map((entryType) => {
    const sum = (bucket: 'MAIN' | 'GIFT') =>
      accountFixtureRows({ records }, 'LessonLedgerEntry')
        .filter(
          (row) =>
            row.data.entryType === entryType && row.data.bucket === bucket,
        )
        .reduce((total, row) => total + row.data.deltaUnits, 0);
    const mainDeltaUnits =
      scenario === 'ledger-student-mismatch' && entryType === 'ADJUSTMENT'
        ? null
        : sum('MAIN');
    const giftDeltaUnits = sum('GIFT');
    return {
      entryType,
      mainDeltaUnits,
      giftDeltaUnits,
      totalDeltaUnits:
        mainDeltaUnits === null ? null : mainDeltaUnits + giftDeltaUnits,
    };
  });
  const plan: AccountFixturePlan = {
    mode: 'pure-construction-only',
    liveReady: false,
    windowId: input.windowId,
    executionId: input.executionId,
    syntheticNow: now,
    scenario,
    ids: {
      campusA,
      campusB,
      studentA,
      studentB: id('student-b'),
      filterSubject: subject,
      archivedSubject: id('subject-100'),
      foreignSubject: id('subject-b'),
    },
    records,
    accounts,
    actors,
    packageCases,
    races: [
      {
        kind: 'mixed-role-identity',
        table: 'UserRole',
        id: id('role-teacher-TEACHER'),
        field: 'userId',
        before: id('user-teacher'),
        after: id('user-mixed'),
        expectedStatus: 401,
      },
      {
        kind: 'status-revocation',
        table: 'User',
        id: id('user-revoke-status'),
        field: 'status',
        before: 'ACTIVE',
        after: 'DISABLED',
        expectedStatus: 401,
      },
      {
        kind: 'role-revocation',
        table: 'UserRole',
        id: id('role-revoke-role-OPERATOR'),
        field: 'roleCode',
        before: 'OPERATOR',
        after: 'TEACHER',
        expectedStatus: 403,
      },
      {
        kind: 'campus-revocation',
        table: 'UserRole',
        id: id('role-revoke-campus-OPERATOR'),
        field: 'campusId',
        before: campusA,
        after: campusB,
        expectedStatus: 403,
      },
      {
        kind: 'student-move',
        table: 'Student',
        id: studentA,
        field: 'campusId',
        before: campusA,
        after: campusB,
        expectedStatus: 404,
        expectedTriggerFact: {
          table: 'PartnerRankingStudentFact',
          event: 'move',
          studentId: studentA,
          campusId: campusB,
          isActive: true,
          captureGeneratedId: true,
        },
      },
    ],
    manifest: {
      ownedRows: records.map((row) => ({
        table: row.table,
        key: row.key,
        id: String(row.data.id),
      })),
      foreignKeys: foreignKeys(records, dmmf),
      triggerFacts: expectedTriggerFacts(records),
    },
    expected: {
      status: 'proposed-oracle-not-executed',
      balances: {
        mainBalanceUnits: 14150,
        giftBalanceUnits: 2500,
        mainReservedUnits: 300,
        giftReservedUnits: 100,
        mainAvailableUnits: 13850,
        giftAvailableUnits: 2400,
        totalBalanceUnits: 16650,
        reservedTotalUnits: 400,
        availableTotalUnits: 16250,
      },
      enrollmentSummary: {
        receivedAmountFen: 272000,
        refundedAmountFen: 2000,
        initialMainUnits: 26500,
        initialGiftUnits: 3650,
        pendingIssuanceCount: 1,
      },
      lessonActivityTotals,
      filteredDetailCount: 24,
      assertions: [
        'nine-current-balances',
        'full-history-enrollment',
        'six-signed-activity-totals',
        'subjects-101-including-archived',
        'subject-and-entry-type-filter-details-only',
        '24-filtered-rows-page-20-plus-4',
      ],
      invalidSources: invalidSources[scenario].map((item) => ({ ...item })),
    },
    remaining: [
      'actual-sql-and-trigger-results',
      'http-access-and-refresh-401-cleanup',
      'transaction-return-race-hooks',
      'replacement-correction-cross-campus-chain',
      'invalid-values-rejected-by-db-checks',
      'online-refund-and-pending-order-graphs',
      'finance-lifecycle-events-and-audit-registration',
      'real-new-window-and-fixture-applicator',
      'synthetic-file-metadata-no-blob-objects',
    ],
  };
  if (['uncovered-package', 'order-member-mismatch'].includes(scenario))
    Object.assign(plan.expected.enrollmentSummary, {
      receivedAmountFen: null,
      refundedAmountFen: null,
      initialMainUnits: null,
      initialGiftUnits: null,
    });
  if (scenario === 'receipt-amount-mismatch')
    Object.assign(plan.expected.enrollmentSummary, {
      initialMainUnits: null,
      initialGiftUnits: null,
    });
  validateAccountFixture(plan, dmmf);
  return plan;
}

export function validateAccountFixture(
  plan: AccountFixturePlan,
  dmmf: Prisma.DMMF.Datamodel,
) {
  const edges = foreignKeys(plan.records, dmmf);
  const all = <M extends Table>(table: M) => accountFixtureRows(plan, table);
  const find = <M extends Table>(table: M, id: string) =>
    all(table).find((row) => row.data.id === id)!.data;
  const violations: Array<{ key: string; rule: string }> = [];
  const check = (key: string, rule: string, condition: boolean) => {
    if (!condition) violations.push({ key, rule });
  };
  for (const { key, data: pack } of all('CoursePackage')) {
    const student = find('Student', pack.studentId);
    check(
      key,
      'package-student-campus',
      student.campusId === pack.campusId ||
        (key === 'pack-departed' &&
          student.id ===
            all('Student').find((row) => row.key === 'student-departed')!.data
              .id),
    );
    const issuance = all('FinancePackageIssuance').filter(
      (row) => row.data.coursePackageId === pack.id,
    );
    check(
      key,
      'package-source',
      Number(Boolean(pack.sourceOrderId)) + issuance.length === 1,
    );
    if (pack.sourceOrderId) {
      const order = find('EnrollmentOrder', pack.sourceOrderId);
      check(
        key,
        'package-order',
        order.campusId === pack.campusId && order.studentId === pack.studentId,
      );
    }
    check(
      key,
      'package-balances',
      pack.mainBalanceUnits! >= pack.mainReservedUnits! &&
        pack.giftBalanceUnits! >= pack.giftReservedUnits! &&
        pack.mainReservedUnits! >= 0 &&
        pack.giftReservedUnits! >= 0,
    );
  }
  for (const { key, data } of all('FinancePackageIssuance')) {
    const receipt = find('FinanceReceipt', data.receiptId);
    const pack = find('CoursePackage', data.coursePackageId);
    check(
      key,
      'issuance-owner',
      receipt.campusId === pack.campusId &&
        receipt.studentId === pack.studentId,
    );
    check(key, 'issuance-amount', receipt.amountFen === data.originalAmountFen);
  }
  for (const { key, data } of all('GroupMember')) {
    const order = find('EnrollmentOrder', data.enrollmentOrderId);
    const campaign = find('GroupCampaign', data.campaignId);
    const team = find('GroupTeam', data.teamId);
    check(
      key,
      'member-order',
      order.parentUserId === data.parentUserId &&
        order.studentId === data.studentId &&
        order.campusId === campaign.campusId &&
        team.campaignId === data.campaignId,
    );
  }
  for (const { key, data } of all('PaymentTransaction')) {
    const member = find('GroupMember', data.groupMemberId);
    check(
      key,
      'payment-order',
      data.enrollmentOrderId === member.enrollmentOrderId,
    );
  }
  for (const { key, data } of all('FinanceRefundRequest'))
    check(
      key,
      'refund-review',
      data.requestedByUserId !== data.reviewedByUserId,
    );
  for (const { key, data } of all('FinanceRefundPayment')) {
    const refund = find('FinanceRefundRequest', data.refundId);
    check(
      key,
      'refund-payment',
      data.amountFen === refund.amountFen && refund.status === 'PAID',
    );
  }
  for (const { key, data } of all('FinanceReceiptCorrection'))
    check(
      key,
      'correction-review',
      data.requestedByUserId !== data.reviewedByUserId &&
        data.status === 'APPLIED' &&
        data.type === 'VOID' &&
        data.replacementReceiptId === null &&
        data.proposedProofFileId === null &&
        Boolean(data.appliedByUserId && data.appliedAt && data.reviewedAt),
    );
  for (const { key, data } of all('LessonLedgerEntry')) {
    const pack = find('CoursePackage', data.coursePackageId);
    check(
      key,
      'ledger-owner',
      pack.campusId === data.campusId && pack.studentId === data.studentId,
    );
    check(
      key,
      'ledger-arithmetic',
      data.balanceBeforeUnits >= 0 &&
        data.balanceAfterUnits >= 0 &&
        data.deltaUnits !== 0 &&
        data.balanceBeforeUnits + data.deltaUnits === data.balanceAfterUnits,
    );
    check(
      key,
      'ledger-direction',
      data.entryType === 'ADJUSTMENT' ||
        (['GRANT', 'REVERSAL'].includes(data.entryType)
          ? data.deltaUnits > 0
          : data.deltaUnits < 0),
    );
    if (data.reversalOfId) {
      const original = find('LessonLedgerEntry', data.reversalOfId);
      check(
        key,
        'ledger-reversal',
        original.coursePackageId === data.coursePackageId &&
          original.studentId === data.studentId &&
          original.bucket === data.bucket &&
          original.deltaUnits === -data.deltaUnits &&
          original.entryType ===
            (data.entryType === 'CORRECTION' ? 'GRANT' : 'CONSUME'),
      );
    }
    if (data.financeRefundId) {
      const refund = find('FinanceRefundRequest', data.financeRefundId);
      const issuance = find('FinancePackageIssuance', refund.issuanceId);
      check(
        key,
        'ledger-refund',
        data.entryType === 'REFUND' &&
          issuance.coursePackageId === pack.id &&
          data.deltaUnits ===
            -(data.bucket === 'MAIN' ? refund.mainUnits : refund.giftUnits),
      );
    }
    if (data.financeCorrectionId) {
      const correction = find(
        'FinanceReceiptCorrection',
        data.financeCorrectionId,
      );
      check(
        key,
        'ledger-correction',
        data.entryType === 'CORRECTION' &&
          find('FinancePackageIssuance', correction.originalIssuanceId)
            .coursePackageId === pack.id,
      );
    }
    const subject = data.subjectId
      ? find('CampusSubject', data.subjectId)
      : null;
    check(
      key,
      'ledger-frozen-subject',
      (data.subjectId === null && data.subjectName === null) ||
        Boolean(
          subject &&
          data.subjectName === subject.name &&
          subject.campusId === data.campusId,
        ),
    );
  }
  const allowed = invalidSources[plan.scenario]?.map(({ key, rule }) => ({
    key,
    rule,
  }));
  if (!allowed || !isDeepStrictEqual(violations, allowed))
    throw new Error(
      `Fixture semantic ownership violation: ${JSON.stringify(violations)}`,
    );
  const ownedRows = plan.records.map((row) => ({
    table: row.table,
    key: row.key,
    id: String(row.data.id),
  }));
  if (
    !isDeepStrictEqual(
      plan.manifest.triggerFacts,
      expectedTriggerFacts(plan.records),
    )
  )
    throw new Error('Fixture trigger semantic ownership mismatch');
  if (
    !isDeepStrictEqual(plan.manifest.ownedRows, ownedRows) ||
    !isDeepStrictEqual(plan.manifest.foreignKeys, edges)
  )
    throw new Error('Fixture ownership manifest mismatch');
  return {
    foreignKeys: edges,
    ownedRows,
    intentionalSemanticViolations: violations,
  };
}

/** Checks supplied observations only. IDs must be captured by a future applicator. */
export function validateAccountTriggerFacts(
  plan: AccountFixturePlan,
  dmmf: Prisma.DMMF.Datamodel,
  observations: readonly {
    id: bigint;
    studentId: string;
    campusId: string;
    isActive: boolean;
    recordedAt: Date;
  }[],
  phase: 'initial' | 'after-student-move' = 'initial',
) {
  validateAccountFixture(plan, dmmf);
  const expected = [...plan.manifest.triggerFacts];
  if (phase === 'after-student-move')
    expected.push(
      plan.races.find((race) => race.kind === 'student-move')!
        .expectedTriggerFact!,
    );
  if (observations.length !== expected.length)
    throw new Error('Trigger fact count differs from manifested events');
  const model = dmmf.models.find(
    (entry) => entry.name === 'PartnerRankingStudentFact',
  );
  if (!model) throw new Error('Trigger fact DMMF unavailable');
  const ids = new Set<bigint>();
  const remaining = [...expected];
  for (const fact of observations) {
    if (
      typeof fact.id !== 'bigint' ||
      fact.id <= 0n ||
      ids.has(fact.id) ||
      !(fact.recordedAt instanceof Date) ||
      !Number.isFinite(fact.recordedAt.getTime())
    )
      throw new Error('Captured trigger fact ID/time invalid or duplicate');
    ids.add(fact.id);
    for (const field of model.fields.filter(
      (entry) => entry.relationFromFields?.length,
    )) {
      const values = field.relationFromFields!.map(
        (name) => (fact as Record<string, unknown>)[name],
      );
      if (
        !plan.records.some(
          (row) =>
            row.table === field.type &&
            field.relationToFields!.every(
              (name, index) =>
                (row.data as Record<string, unknown>)[name] === values[index],
            ),
        )
      )
        throw new Error('Trigger fact foreign key outside manifest');
    }
    const index = remaining.findIndex(
      (entry) =>
        entry.studentId === fact.studentId &&
        entry.campusId === fact.campusId &&
        entry.isActive === fact.isActive,
    );
    if (
      index < 0 ||
      !accountFixtureRows(plan, 'Student').some(
        (row) => row.data.id === fact.studentId,
      )
    )
      throw new Error(
        'Trigger fact student/campus semantic ownership mismatch',
      );
    remaining.splice(index, 1);
  }
  return observations.map((fact) => ({
    id: String(fact.id),
    studentId: fact.studentId,
    campusId: fact.campusId,
  }));
}
