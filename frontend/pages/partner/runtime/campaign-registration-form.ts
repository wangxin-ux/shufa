import { SessionServiceError } from '../../../services/session.service';

export const QUESTION_KINDS = [
  { value: 'TEXT', label: '文本' }, { value: 'NUMBER', label: '数字' },
  { value: 'SINGLE_CHOICE', label: '单选' }, { value: 'MULTI_CHOICE', label: '多选' },
  { value: 'AGE', label: '年龄' }, { value: 'DATE', label: '日期' }, { value: 'MOBILE', label: '手机号' },
] as const;
export type RegistrationQuestion = {
  id: string; kind: typeof QUESTION_KINDS[number]['value']; label: string;
  hint: string; required: boolean; options: string[];
};
const fail = (response: boolean): never => {
  throw new SessionServiceError(response ? 502 : 400, response ? 'INVALID_RESPONSE' : 'BAD_REQUEST',
    response ? '报名表单响应格式无效，请重试' : '请核对题目、备注和选项，选择题至少两项且不可重复');
};
export function normalizeRegistrationForm(value: unknown, response = false): RegistrationQuestion[] {
  if (!Array.isArray(value) || value.length > 20) return fail(response);
  const ids = new Set<string>();
  const text = (raw: unknown, min: number, max: number): string => {
    if (typeof raw !== 'string') return fail(response);
    const result = raw.trim();
    if (Array.from(result).length < min || Array.from(result).length > max ||
      result.includes('\u0000') || /[\ud800-\udfff]/u.test(result) || (response && raw !== result)) return fail(response);
    return result;
  };
  return value.map(raw => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) ||
      Object.keys(raw).length !== 6 ||
      !['id', 'kind', 'label', 'hint', 'required', 'options'].every(key => Object.prototype.hasOwnProperty.call(raw, key)) ||
      typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id) || ids.has(raw.id) ||
      !QUESTION_KINDS.some(kind => kind.value === raw.kind) || typeof raw.required !== 'boolean' ||
      !Array.isArray(raw.options) || raw.options.length > 20) return fail(response);
    ids.add(raw.id);
    const options = raw.options.map((option: unknown) => text(option, 1, 80));
    const choice = raw.kind === 'SINGLE_CHOICE' || raw.kind === 'MULTI_CHOICE';
    if ((choice ? options.length < 2 : options.length !== 0) || new Set(options).size !== options.length) return fail(response);
    return { id: raw.id, kind: raw.kind as RegistrationQuestion['kind'], label: text(raw.label, 1, 80),
      hint: text(raw.hint, 0, 200), required: raw.required, options };
  });
}
export function defaultRegistrationForm(): RegistrationQuestion[] {
  return [
    { id: 'name', kind: 'TEXT', label: '姓名', hint: '', required: true, options: [] },
    { id: 'phone', kind: 'MOBILE', label: '电话', hint: '', required: true, options: [] },
  ];
}
