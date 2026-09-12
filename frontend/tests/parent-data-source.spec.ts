import {
  DEFAULT_PARENT_FEATURE_FLAGS,
  ParentFeatureFlags,
} from '../config/parent-feature-flags';
import { ParentDataSource } from '../data/parent-data-source';
import { MockParentDataSource } from '../data/mock-parent-data-source';
import { ParentService } from '../services/parent.service';

describe('parent data boundary', () => {
  it('returns deterministic normal data without leaking fixture mutations', async () => {
    const source = new MockParentDataSource({ scenario: 'normal' });
    const first = await source.getHomeSummary();
    const originalCourseName = first.nextLesson?.courseName;

    if (first.nextLesson) {
      first.nextLesson.courseName = '被调用方修改';
    }

    const second = await source.getHomeSummary();
    expect(second.nextLesson?.courseName).toBe(originalCourseName);
    expect(second.student.name).toBe('林小禾');
  });

  it('represents empty and failed scenarios through request states', async () => {
    const emptyService = new ParentService(new MockParentDataSource({ scenario: 'empty' }));
    const failedService = new ParentService(new MockParentDataSource({ scenario: 'error' }));

    const emptyHome = await emptyService.loadHomeSummary();
    const failedHome = await failedService.loadHomeSummary();

    expect(emptyHome.status).toBe('empty');
    if (emptyHome.status === 'empty') {
      expect(emptyHome.data.nextLesson).toBeNull();
    }
    expect(failedHome).toEqual({ status: 'error', message: '家长端 Mock 请求失败' });
  });

  it('provides a filled three-row ledger in the normal visual scenario', async () => {
    const source = new MockParentDataSource({ scenario: 'normal' });

    const hours = await source.getHoursView();

    expect(hours.entries).toHaveLength(3);
    expect(hours.entries.map((entry) => Math.sign(entry.delta))).toEqual([-1, 1, -1]);
  });

  it('shows gift hours to parents by default after the display rule is confirmed', () => {
    expect(DEFAULT_PARENT_FEATURE_FLAGS.showGiftHours).toBe(true);
  });

  it('can still hide gift hours explicitly without recalculating the backend total', async () => {
    const source: ParentDataSource = {
      listCampuses: jest.fn(),
      getHomeSummary: jest.fn(),
      getHoursView: jest.fn().mockResolvedValue({
        remainingTotal: 99,
        paidHours: 10,
        giftHours: 8,
        paidAmountFen: 480000,
        validUntil: '2027-08-23',
        entries: [
          {
            id: 'entry-1',
            title: '创意书写',
            occurredAtLabel: '2026-08-27 14:00',
            detailLabel: '林老师',
            delta: -1,
          },
        ],
      }),
      getLeavePage: jest.fn(),
      submitLeave: jest.fn(),
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      getUpdates: jest.fn(),
      listGroupCampaigns: jest.fn(),
      getGroupCampaign: jest.fn(),
      listGroupOrders: jest.fn(),
      createGroupTeam: jest.fn(),
      joinGroupTeam: jest.fn(),
      retryGroupPrepay: jest.fn(),
      confirmMockGroupPayment: jest.fn(),
    };
    const hiddenFlags: ParentFeatureFlags = { showGiftHours: false };
    const service = new ParentService(source, hiddenFlags);

    const state = await service.loadHoursView();

    expect(state.status).toBe('success');
    if (state.status === 'success') {
      expect(state.data.remainingTotal).toBe(99);
      expect(state.data.giftHours).toBeNull();
    }
  });
});
