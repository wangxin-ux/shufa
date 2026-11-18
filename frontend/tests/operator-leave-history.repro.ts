import { mergeOperatorLeaveHistory } from '../pages/operator/runtime/services/operator-leave.presenter';
import { interleavedHistory, openHistory } from './operator-leave-history.fixture';

it('global history page one contains at most the requested 20 rows', async () => {
  const { env, page } = await openHistory();
  try {
    expect(page.data.viewState).toBe('ready');
    expect(page.data.total).toBe(45);
    expect(page.data.items).toHaveLength(20);
  } finally { env.close(); }
});

it('global page one includes the most recently reviewed old application', async () => {
  const { env, page } = await openHistory();
  try {
    expect(page.data.items[0].id).toBe(interleavedHistory[1].id);
    expect(page.data.items.some((item: { id: string }) => item.id === interleavedHistory[1].id)).toBe(true);
  } finally { env.close(); }
});

it('appending server-ordered history does not reorder it by creation time', () => {
  const first = interleavedHistory[1];
  const second = interleavedHistory[0];
  const laterPage = interleavedHistory[3];
  expect(mergeOperatorLeaveHistory([first, second], [laterPage]).map((record) => record.id))
    .toEqual([first.id, second.id, laterPage.id]);
});
