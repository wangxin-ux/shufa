export const formatLessonUnits = (units: number): string => {
  const value = units / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '');
};

export const formatMoneyFen = (fen: number): string => `¥${(fen / 100).toFixed(2)}`;

export const formatLocalDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const createMutationKey = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const PERMISSION_LABELS: Record<string, string> = {
  PARENT_PROFILE_READ: '查看家长资料', PARENT_HOME_READ: '查看家长首页', PARENT_HOURS_READ: '查看课时',
  PARENT_LEAVE_READ: '查看请假', PARENT_LEAVE_WRITE: '提交请假', PARENT_UPDATES_READ: '查看课堂动态',
  TEACHER_PROFILE_READ: '查看教师资料', TEACHER_SCHEDULE_READ: '查看教师课表', TEACHER_STUDENT_READ: '查看负责学员',
  ATTENDANCE_WRITE: '登记出勤', LESSON_COMPLETE: '确认完成课程', LESSON_REVERSE_OWN_WINDOW: '限时撤销本人课程',
  FEEDBACK_WRITE: '填写课堂反馈', TEACHING_RECORD_READ: '查看授课记录', LESSON_LEDGER_READ_OWN: '查看本人课时流水',
  TEACHER_EARNING_READ_OWN: '查看本人预计收益', TEACHER_WITHDRAWAL_READ_OWN: '查看本人提现', TEACHER_WITHDRAWAL_CREATE: '发起提现', TEACHER_WITHDRAWAL_CANCEL_OWN: '取消本人提现',
  CAMPUS_DASHBOARD_READ: '查看本校区看板', CAMPUS_STUDENT_READ: '查看本校区学员', CAMPUS_STUDENT_CREATE: '新增本校区学员',
  CAMPUS_SCHEDULE_READ: '查看本校区排课', CAMPUS_SCHEDULE_CREATE: '创建本校区排课', CAMPUS_SCHEDULE_UPDATE: '修改本校区排课',
  CAMPUS_LEAVE_REVIEW: '审批本校区请假', CAMPUS_WARNING_READ: '查看本校区预警', CAMPUS_SETTINGS_READ: '查看校区设置', CAMPUS_SETTINGS_UPDATE: '修改受限校区设置',
  EARNING_RULE_MANAGE: '管理课时费规则', TEACHER_EARNING_REVIEW: '审核教师预计收益', WITHDRAWAL_REVIEW: '审核提现申请', WITHDRAWAL_MARK_PAID: '登记人工打款',
  GLOBAL_DASHBOARD_READ: '查看全局看板', GLOBAL_CAMPUS_READ: '查看全部校区', GLOBAL_CAMPUS_MAP_MANAGE: '配置家长端门店地图', GLOBAL_STUDENT_READ: '查看全局学员与课包', GLOBAL_LEDGER_READ: '查看全局课时账本', LESSON_LEDGER_ADJUST: '后台调整课时',
  PARENT_CAMPUS_DIRECTORY_READ: '查看公开门店地图',
  GLOBAL_SETTINGS_READ: '查看全局设置', ROLE_PERMISSION_READ: '查看角色权限', AUDIT_LOG_READ: '查看操作日志',
};

export const permissionLabel = (code: string): string => PERMISSION_LABELS[code] ?? '受控业务权限';

const AUDIT_ACTION_LABELS: Record<string, string> = {
  LESSON_LEDGER_ADJUST: '后台课时调整', TEACHER_EARNING_APPROVE: '教师收益审核通过', TEACHER_EARNING_REJECT: '教师收益驳回',
  TEACHER_WITHDRAWAL_APPROVE: '提现审核通过', TEACHER_WITHDRAWAL_REJECT: '提现驳回', TEACHER_WITHDRAWAL_MARK_PAYING: '提现进入打款中',
  TEACHER_WITHDRAWAL_MARK_PAID: '提现登记完成', TEACHER_WITHDRAWAL_MARK_FAILED: '提现打款失败',
};

export const auditActionLabel = (action: string): string => AUDIT_ACTION_LABELS[action] ?? '业务操作';
