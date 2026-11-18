import { superAdminService } from '../../../services/super-admin-runtime';
import type { CourseProductMutationInput, ManagementCourseProductView } from '../../../types/group-buying';
import type { SuperAdminCampus } from '../../../types/super-admin';
import { createMutationKey, formatMoneyFen, formatLessonUnits } from '../../../utils/super-admin-format';

function parseHundredths(value: string): number {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim())) throw new Error('请输入最多两位小数的非负数');
  const [whole, fraction = ''] = value.trim().split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (result > 2147483647) throw new Error('数值超出允许范围');
  return result;
}

const present = (product: ManagementCourseProductView) => ({
  ...product, priceLabel: formatMoneyFen(product.priceFen),
  unitsLabel: `${formatLessonUnits(product.mainUnits)} + 赠${formatLessonUnits(product.giftUnits)}节`,
  statusLabel: { DRAFT: '草稿', ACTIVE: '已上架', RETIRED: '已下架' }[product.status],
});

Page({
  data: {
    viewState: 'loading', errorMessage: '', submitting: false, formOpen: false,
    campuses: [] as SuperAdminCampus[], campusIndex: 0,
    products: [] as Array<ReturnType<typeof present>>,
    name: '', courseName: '', classType: '常规班', summary: '',
    priceYuan: '', mainLessons: '', giftLessons: '0', validityDays: '365',
    editId: '', editVersion: 0,
  },
  mutationFingerprint: '',
  mutationKey: '',
  onLoad() { void this.load(); },

  async load() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const [campuses, first] = await Promise.all([
      superAdminService.loadCampuses({ page: 1, pageSize: 100 }),
      superAdminService.loadCourseProducts({ page: 1, pageSize: 100 }),
    ]);
    if ((campuses.status !== 'success' && campuses.status !== 'empty') ||
        (first.status !== 'success' && first.status !== 'empty')) {
      const failed = first.status === 'error' ? first : campuses;
      this.setData({ viewState: failed.status === 'error' && failed.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: failed.status === 'error' ? failed.message : '课程产品加载失败' });
      return;
    }
    const products = [...first.data.data];
    for (let page = 2; page <= first.data.meta.totalPages; page += 1) {
      const next = await superAdminService.loadCourseProducts({ page, pageSize: 100 });
      if (next.status !== 'success' && next.status !== 'empty') {
        this.setData({ viewState: 'error', errorMessage: next.status === 'error' ? next.message : '课程产品加载失败' });
        return;
      }
      products.push(...next.data.data);
    }
    const allCampuses = [...campuses.data.data];
    for (let page = 2; page <= campuses.data.meta.totalPages; page += 1) {
      const next = await superAdminService.loadCampuses({ page, pageSize: 100 });
      if (next.status !== 'success' && next.status !== 'empty') {
        this.setData({ viewState: 'error', errorMessage: next.status === 'error' ? next.message : '校区加载失败' });
        return;
      }
      allCampuses.push(...next.data.data);
    }
    this.setData({ products: products.map(present), campuses: allCampuses, viewState: products.length ? 'ready' : 'empty' });
  },
  onCreate() {
    if (this.data.submitting) return;
    this.setData({ formOpen: true, editId: '', editVersion: 0, name: '', courseName: '',
      classType: '常规班', summary: '', priceYuan: '', mainLessons: '', giftLessons: '0', validityDays: '365' });
  },
  onEdit(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return;
    const product = this.data.products.find((item) => item.id === String(event.currentTarget.dataset.id ?? ''));
    if (!product || product.status !== 'DRAFT') return;
    this.setData({
      formOpen: true, editId: product.id, editVersion: product.version,
      campusIndex: Math.max(0, this.data.campuses.findIndex((item) => item.id === product.campusId)),
      name: product.name, courseName: product.courseName ?? product.name, classType: product.classType ?? '常规班',
      summary: product.summary, priceYuan: String(product.priceFen / 100),
      mainLessons: String(product.mainUnits / 100), giftLessons: String(product.giftUnits / 100),
      validityDays: String(product.validityDays),
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },
  onInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field ?? '');
    if (['name', 'courseName', 'classType', 'summary', 'priceYuan', 'mainLessons', 'giftLessons', 'validityDays'].includes(field)) {
      this.setData({ [field]: event.detail.value });
    }
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) { this.setData({ campusIndex: Number(event.detail.value) }); },
  onCancelEdit() { if (!this.data.submitting) this.setData({ formOpen: false }); },
  keyFor(fingerprint: string): string {
    if (this.mutationFingerprint !== fingerprint) {
      this.mutationFingerprint = fingerprint;
      this.mutationKey = createMutationKey('course-product');
    }
    return this.mutationKey;
  },
  async onSubmit() {
    if (this.data.submitting) return;
    let input: CourseProductMutationInput;
    try {
      const campus = this.data.campuses[this.data.campusIndex];
      if (!campus || !this.data.name.trim() || !this.data.courseName.trim() ||
        !this.data.classType.trim() || !this.data.summary.trim()) throw new Error('请完整填写课程产品信息');
      if (!/^\d+$/.test(this.data.validityDays)) throw new Error('有效天数必须为整数');
      const validityDays = Number(this.data.validityDays);
      if (validityDays < 1 || validityDays > 3650) throw new Error('有效天数须为 1–3650');
      input = {
        campusId: campus.id, name: this.data.name.trim(), courseName: this.data.courseName.trim(),
        classType: this.data.classType.trim(), summary: this.data.summary.trim(),
        priceFen: parseHundredths(this.data.priceYuan), mainUnits: parseHundredths(this.data.mainLessons),
        giftUnits: parseHundredths(this.data.giftLessons), validityDays,
      };
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '请核对输入', icon: 'none' });
      return;
    }
    const key = this.keyFor(JSON.stringify({ id: this.data.editId, version: this.data.editVersion, input }));
    this.setData({ submitting: true });
    const result = this.data.editId
      ? await superAdminService.updateCourseProduct(this.data.editId, input, this.data.editVersion, key)
      : await superAdminService.createCourseProduct(input, key);
    this.setData({ submitting: false });
    if (result.status === 'success') {
      this.mutationFingerprint = '';
      this.setData({ formOpen: false });
      wx.showToast({ title: '草稿已保存', icon: 'success' });
      void this.load();
    } else if (result.status === 'error') wx.showToast({ title: result.message, icon: 'none' });
  },
  onTransition(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return;
    const id = String(event.currentTarget.dataset.id ?? '');
    const action = String(event.currentTarget.dataset.action ?? '') as 'activate' | 'retire';
    const product = this.data.products.find((item) => item.id === id);
    if (!product || !['activate', 'retire'].includes(action)) return;
    wx.showModal({
      title: action === 'activate' ? '上架课程产品' : '下架课程产品',
      content: `${product.name}，${product.priceLabel}。${action === 'activate' ? '公开校区的产品将显示在家长课程目录。' : '不影响已有订单和课包。'}`,
      success: ({ confirm }) => { if (confirm) void this.transition(id, action, product.version); },
    });
  },
  async transition(id: string, action: 'activate' | 'retire', version: number) {
    if (this.data.submitting) return;
    const key = this.keyFor(JSON.stringify({ id, action, version }));
    this.setData({ submitting: true });
    const result = await superAdminService.transitionCourseProduct(id, action, version, key);
    this.setData({ submitting: false });
    if (result.status === 'success') {
      this.mutationFingerprint = '';
      wx.showToast({ title: action === 'activate' ? '已上架' : '已下架', icon: 'success' });
      void this.load();
    } else if (result.status === 'error') wx.showToast({ title: result.message, icon: 'none' });
  },
  onRetry() { void this.load(); },
});
