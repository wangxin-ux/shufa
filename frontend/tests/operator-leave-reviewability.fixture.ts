export const id = (index: number) => `52000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export function request(index: number, canReview: unknown = true, status = 'PENDING'): any {
  return {
    id: id(index), studentId: '40000000-0000-4000-8000-000000000001',
    studentName: index === 3 ? '陈晨安然陈晨安然陈晨安然陈晨安然' : `同学${index}`,
    lessonSessionId: '70000000-0000-4000-8000-000000000002',
    courseName: '创意基础', startsAt: '2040-02-01T06:00:00Z',
    reason: '参加学校集体活动，请保留原申请记录。', status,
    ...(canReview === undefined ? {} : { canReview }),
    reviewerName: status === 'PENDING' ? null : '测试运营',
    reviewedAt: status === 'PENDING' ? null : '2039-01-01T08:00:00Z',
    reviewReason: null, version: 1, createdAt: '2039-01-01T00:00:00Z',
  };
}
export const missing = (index: number) => {
  const value = request(index);
  delete value.canReview;
  return value;
};
export const mixed = () => [request(1, false), missing(2), request(3)];
export const list = (data: any[], page = 1, total = data.length) => ({
  data, meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) },
});
