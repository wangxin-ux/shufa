import { MockParentDataSource } from '../data/mock-parent-data-source';
import { ParentPageLoader } from '../services/parent-page-loader';
import { ParentService } from '../services/parent.service';
import { ParentHomeSummary } from '../types/parent';
import { RequestState } from '../utils/request-state';

describe('parent page states', () => {
  it.each([
    ['home', (service: ParentService) => service.loadHomeSummary()],
    ['hours', (service: ParentService) => service.loadHoursView()],
    ['leave', (service: ParentService) => service.loadLeavePage()],
    ['profile', (service: ParentService) => service.loadProfile()],
  ])('covers normal, empty and error scenarios for %s', async (_name, load) => {
    const normal = await load(new ParentService(new MockParentDataSource({ scenario: 'normal' })));
    const empty = await load(new ParentService(new MockParentDataSource({ scenario: 'empty' })));
    const error = await load(new ParentService(new MockParentDataSource({ scenario: 'error' })));

    expect(normal.status).toBe('success');
    expect(empty.status).toBe('empty');
    expect(error).toEqual({ status: 'error', message: '家长端 Mock 请求失败' });
  });

  it('maps success to ready and coalesces repeated retries', async () => {
    let release: (state: RequestState<ParentHomeSummary>) => void = () => undefined;
    const load = jest.fn(
      () => new Promise<RequestState<ParentHomeSummary>>((resolve) => {
        release = resolve;
      }),
    );
    const loader = new ParentPageLoader(load);

    const first = loader.load();
    const repeated = loader.retry();

    expect(repeated).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(loader.snapshot).toEqual({ status: 'loading' });

    release({
      status: 'success',
      data: {
        student: { id: 'student-1', name: '林小禾', age: 9 },
        nextLesson: null,
        remainingHoursLabel: '0',
        attendanceRateLabel: '--',
      },
    });

    await expect(first).resolves.toMatchObject({ status: 'ready' });
    expect(loader.snapshot.status).toBe('ready');
  });

  it('allows a new request after an error finishes', async () => {
    const load = jest
      .fn<Promise<RequestState<number>>, []>()
      .mockResolvedValueOnce({ status: 'error', message: '网络不可用' })
      .mockResolvedValueOnce({ status: 'success', data: 1 });
    const loader = new ParentPageLoader(load);

    await expect(loader.load()).resolves.toEqual({ status: 'error', message: '网络不可用' });
    await expect(loader.retry()).resolves.toEqual({ status: 'ready', data: 1 });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
