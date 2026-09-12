import { MockParentDataSource } from '../data/mock-parent-data-source';
import { ParentDataSource } from '../data/parent-data-source';
import {
  getLeaveStatusLabel,
  ParentLeaveWorkflow,
  validateLeaveDraft,
} from '../services/parent-leave.workflow';
import { buildParentLeavePageModel } from '../services/parent-leave.presenter';
import { ParentService } from '../services/parent.service';
import { LeaveDraft, LeavePageView, LeaveRecord } from '../types/parent';

const leavePage: LeavePageView = {
  students: [{ id: 'student-1', name: '林小禾' }],
  lessons: [
    { id: 'lesson-1', title: '创意书写', startsAt: '2026-08-29T06:00:00.000Z' },
  ],
  records: [],
  cutoffHours: 2,
};

const validDraft: LeaveDraft = {
  studentId: 'student-1',
  lessonId: 'lesson-1',
  reason: '家庭临时有事',
};

const submittedRecord: LeaveRecord = {
  id: 'leave-new-1',
  courseName: '创意书写',
  lessonTimeLabel: '2026-08-29 14:00',
  reason: validDraft.reason,
  status: 'pending',
};

function createSource(
  submitLeave: ParentDataSource['submitLeave'],
  getLeavePage: ParentDataSource['getLeavePage'] = async () => leavePage,
): ParentDataSource {
  return {
    listCampuses: async () => {
      throw new Error('not used');
    },
    getHomeSummary: async () => {
      throw new Error('not used');
    },
    getHoursView: async () => {
      throw new Error('not used');
    },
    getLeavePage,
    submitLeave,
    getProfile: async () => {
      throw new Error('not used');
    },
    updateProfile: async () => {
      throw new Error('not used');
    },
    getUpdates: async () => {
      throw new Error('not used');
    },
    listGroupCampaigns: async () => {
      throw new Error('not used');
    },
    getGroupCampaign: async () => {
      throw new Error('not used');
    },
    listGroupOrders: async () => {
      throw new Error('not used');
    },
    createGroupTeam: async () => {
      throw new Error('not used');
    },
    joinGroupTeam: async () => {
      throw new Error('not used');
    },
    retryGroupPrepay: async () => {
      throw new Error('not used');
    },
    confirmMockGroupPayment: async () => {
      throw new Error('not used');
    },
  };
}

describe('parent leave submission', () => {
  it('creates only one record for repeated idempotency keys', async () => {
    const source = new MockParentDataSource({ scenario: 'normal' });
    const before = await source.getLeavePage();
    const draft = {
      studentId: before.students[0].id,
      lessonId: before.lessons[0].id,
      reason: '家庭临时有事',
    };

    const first = await source.submitLeave(draft, 'leave-request-001');
    const repeated = await source.submitLeave(
      { ...draft, reason: '重复请求不应覆盖原记录' },
      'leave-request-001',
    );
    const after = await source.getLeavePage();

    expect(repeated).toEqual(first);
    expect(after.records).toHaveLength(before.records.length + 1);
    expect(after.records.filter((record) => record.id === first.id)).toHaveLength(1);
  });

  it('uses a different record for a different idempotency key', async () => {
    const source = new MockParentDataSource({ scenario: 'normal' });
    const page = await source.getLeavePage();
    const draft = {
      studentId: page.students[0].id,
      lessonId: page.lessons[0].id,
      reason: '行程冲突',
    };

    const first = await source.submitLeave(draft, 'leave-request-001');
    const second = await source.submitLeave(draft, 'leave-request-002');

    expect(second.id).not.toBe(first.id);
  });

  it('rejects missing idempotency keys', async () => {
    const source = new MockParentDataSource({ scenario: 'normal' });

    await expect(
      source.submitLeave({ studentId: 'student-1', lessonId: 'lesson-1', reason: '请假' }, '  '),
    ).rejects.toThrow('幂等标识不能为空');
  });

  it.each([
    [{ ...validDraft, studentId: '' }, '请选择孩子'],
    [{ ...validDraft, lessonId: '' }, '请选择请假课程'],
    [{ ...validDraft, reason: '   ' }, '请填写请假原因'],
    [{ ...validDraft, reason: '原'.repeat(201) }, '请假原因不能超过 200 字'],
  ])('validates incomplete or oversized drafts', (draft, message) => {
    expect(
      validateLeaveDraft(draft, leavePage, new Date('2026-08-29T03:00:00.000Z')),
    ).toBe(message);
  });

  it('rejects submissions after the configured cutoff', () => {
    expect(
      validateLeaveDraft(validDraft, leavePage, new Date('2026-08-29T04:00:00.000Z')),
    ).toBe('该课程已超过请假截止时间');
  });

  it('reuses one in-flight submission for repeated clicks', async () => {
    let release: (record: LeaveRecord) => void = () => undefined;
    const submitLeave = jest.fn(
      () => new Promise<LeaveRecord>((resolve) => {
        release = resolve;
      }),
    );
    const workflow = new ParentLeaveWorkflow(
      new ParentService(createSource(submitLeave)),
      { now: () => new Date('2026-08-29T03:00:00.000Z'), createIdempotencyKey: () => 'key-1' },
    );

    const first = workflow.submit(validDraft, leavePage);
    const repeated = workflow.submit(validDraft, leavePage);

    expect(repeated).toBe(first);
    expect(submitLeave).toHaveBeenCalledTimes(1);
    expect(workflow.status).toBe('submitting');
    release(submittedRecord);
    const [firstResult, repeatedResult] = await Promise.all([first, repeated]);
    expect(repeatedResult).toEqual(firstResult);
    expect(workflow.status).toBe('success');
  });

  it('preserves the draft after failure and allows a new retry', async () => {
    const submitLeave = jest
      .fn<ReturnType<ParentDataSource['submitLeave']>, Parameters<ParentDataSource['submitLeave']>>()
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce(submittedRecord);
    const getLeavePage = jest.fn(async () => leavePage);
    const createIdempotencyKey = jest
      .fn<string, []>()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2');
    const workflow = new ParentLeaveWorkflow(
      new ParentService(createSource(submitLeave, getLeavePage)),
      { now: () => new Date('2026-08-29T03:00:00.000Z'), createIdempotencyKey },
    );

    const failed = await workflow.submit(validDraft, leavePage);
    const retried = await workflow.submit(validDraft, leavePage);

    expect(failed).toMatchObject({ status: 'error', message: '网络不可用', nextDraft: validDraft });
    expect(retried).toMatchObject({
      status: 'success',
      nextDraft: { studentId: '', lessonId: '', reason: '' },
    });
    expect(createIdempotencyKey).toHaveBeenCalledTimes(2);
    expect(getLeavePage).toHaveBeenCalledTimes(1);
  });

  it('maps review statuses without naming an approver role', () => {
    expect(getLeaveStatusLabel('pending')).toBe('待审核');
    expect(getLeaveStatusLabel('approved')).toBe('已批准');
    expect(getLeaveStatusLabel('rejected')).toBe('已驳回');
  });

  it('builds picker labels and review styles from page data', () => {
    const model = buildParentLeavePageModel({
      ...leavePage,
      records: [
        submittedRecord,
        { ...submittedRecord, id: 'approved', status: 'approved' },
        { ...submittedRecord, id: 'rejected', status: 'rejected' },
      ],
    });

    expect(model.lessons[0].label).toBe('2026-08-29 14:00 · 创意书写');
    expect(model.cutoffText).toBe('须提前 2 小时提交');
    expect(model.records.map((record) => [record.statusLabel, record.tagTone])).toEqual([
      ['待审核', 'orange'],
      ['已批准', 'green'],
      ['已驳回', 'red'],
    ]);
  });

  it('shows the manager review reason in the parent leave history', () => {
    const model = buildParentLeavePageModel({
      ...leavePage,
      records: [
        {
          ...submittedRecord,
          status: 'rejected',
          reviewerName: '周园长',
          reviewedAt: '2026-08-30T01:00:00.000Z',
          reviewReason: '超过可审批时段',
        },
      ],
    });

    expect(model.records[0].subtitle).toContain('驳回说明：超过可审批时段');
  });
});
