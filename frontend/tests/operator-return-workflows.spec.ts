import { capture, flush, fixture } from './operator-page-host';

const metadata = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
function natives(h: ReturnType<typeof capture>) {
  const uploads: any[] = [], actionSheets: any[] = [], selections: any[] = [], documents: any[] = [];
  Object.assign(h.platform, {
    uploadFile: jest.fn((options) => uploads.push(options)),
    chooseMessageFile: jest.fn((options) => selections.push(options)),
    showActionSheet: jest.fn((options) => actionSheets.push(options)),
    openDocument: jest.fn((options) => documents.push(options)),
    showLoading: jest.fn(), hideLoading: jest.fn(),
  });
  return { uploads, actionSheets, selections, documents };
}

it('does not submit from an old import confirmation after hiding and returning', async () => {
  const h = capture(['teachers']);
  const n = natives(h);
  try {
    const page = h.instantiate();
    page.onLoad(); page.onShow(); await flush();
    h.reply(0, { data: [], meta: metadata }); await flush();
    const operation = page.onRosterImport(); await flush();
    n.actionSheets[0].success({ tapIndex: 1 }); await flush();
    n.selections[0].success({ tempFiles: [{ path: 'synthetic.xlsx', size: 10 }] }); await flush();
    n.uploads[0].success({ statusCode: 200, data: JSON.stringify({
      data: { totalRows: 1, validCount: 1, duplicateCount: 0, errorCount: 0 },
    }) }); await flush();
    expect(h.platform.showModal).toHaveBeenCalledTimes(1);
    const confirmation = h.platform.showModal.mock.calls[0][0];
    page.onHide(); page.onShow(); await flush();
    h.reply(1, { data: [], meta: metadata }); await flush();
    confirmation.success({ confirm: true });
    await flush();
    expect(n.uploads).toHaveLength(1);
    await operation;
    expect(page.data.rosterBusy).toBe(false);
  } finally { h.close(); }
});

it('does not open a workbook whose download belongs to a previous display cycle', async () => {
  const h = capture(['teachers']);
  const n = natives(h);
  try {
    const page = h.instantiate();
    page.onLoad(); page.onShow(); await flush();
    h.reply(0, { data: [], meta: metadata }); await flush();
    const operation = page.onRosterExport(); await flush();
    h.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(h.downloads).toHaveLength(1);
    page.onHide(); page.onShow(); await flush();
    h.downloads[0].success({ statusCode: 200, tempFilePath: 'synthetic-old.xlsx' });
    await flush();
    expect(n.documents).toHaveLength(0);
    await operation;
  } finally { h.close(); }
});

it.each(['students', 'teachers'] as const)('releases %s quick-entry busy state on return after a background response', async (route) => {
  const h = capture([route]);
  try {
    const page = h.instantiate();
    page.onLoad(); page.onShow(); await flush();
    h.reply(0, { data: [], meta: metadata }); await flush();
    page.setData({ quickTeacherName: '测试教师', quickPhone: '13800000000',
      quickStudentName: '测试学员', quickParentPhone: '13800000000' });
    const operation = page.onQuickSubmit(); await flush();
    page.onHide();
    h.reply(1, { data: { status: 'CREATED', reason: '已录入' } }); await operation;
    page.onShow(); await flush();
    h.reply(2, { data: [], meta: metadata }); await flush();
    expect(page.data.rosterBusy).toBe(false);
  } finally { h.close(); }
});

it('settles a background successful student creation on return instead of retaining submitting forever', async () => {
  const h = capture(['student-form']);
  Object.assign(h.platform, { redirectTo: jest.fn() });
  try {
    const page = h.instantiate();
    page.onLoad(); page.onShow(); await flush();
    h.reply(0, { data: fixture.schedulingOptions }); await flush();
    page.setData({ displayName: '测试新学员' });
    const operation = page.onSubmit(); await flush();
    page.onHide();
    h.reply(1, { data: { ...fixture.students[0], id: 'synthetic-new', displayName: '测试新学员' } });
    await operation; await flush();
    page.onShow(); await flush();
    expect(page.data.submitting).toBe(false);
    expect(h.platform.redirectTo).toHaveBeenCalledWith({ url: '/pages/operator/students/index' });
  } finally { h.close(); }
});

it('keeps the current settings version when an older save returns after a newer return read', async () => {
  const h = capture(['campus-settings']);
  try {
    const page = h.instantiate();
    page.onLoad(); page.onShow(); await flush();
    h.reply(0, { data: { ...fixture.campusSettings, version: 1 } }); await flush();
    const operation = page.onSubmit(); await flush();
    page.onHide(); page.onShow(); await flush();
    h.reply(2, { data: { ...fixture.campusSettings, version: 3, name: '较新校区' } }); await flush();
    h.reply(1, { data: { ...fixture.campusSettings, version: 2, name: '旧保存校区' } });
    await operation;
    expect(page.data).toMatchObject({ version: 3, name: '较新校区' });
  } finally { h.close(); }
});

it('does not show an import confirmation after a parallel read revokes access', async () => {
  const h = capture(['teachers']);
  const n = natives(h);
  try {
    const page = h.instantiate(); page.onLoad(); page.onShow(); await flush();
    h.reply(0, { data: [], meta: metadata }); await flush();
    const operation = page.onRosterImport(); await flush();
    n.actionSheets[0].success({ tapIndex: 1 }); await flush();
    n.selections[0].success({ tempFiles: [{ path: 'synthetic.xlsx', size: 10 }] }); await flush();
    const refresh = page.loadTeachers(true); await flush();
    n.uploads[0].success({ statusCode: 200, data: JSON.stringify({
      data: { totalRows: 1, validCount: 1, duplicateCount: 0, errorCount: 0 },
    }) });
    h.reply(1, {}, 403);
    await flush();
    h.platform.showModal.mock.calls[0]?.[0].success({ confirm: false });
    await Promise.all([operation, refresh]); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(h.platform.showModal).not.toHaveBeenCalled();
  } finally { h.close(); }
});
