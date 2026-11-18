import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

const KINDS = [
  'TEXT',
  'NUMBER',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'AGE',
  'DATE',
  'MOBILE',
];
const fail = (): never => {
  throw new DomainError(
    ErrorCode.VALIDATION_FAILED,
    '报名表单格式或长度不符合要求',
    400,
  );
};

export function normalizeRegistrationForm(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return fail();
  const ids = new Set<string>();
  const text = (raw: unknown, min: number, max: number): string => {
    if (typeof raw !== 'string') return fail();
    const result = raw.trim();
    if (
      Array.from(result).length < min ||
      Array.from(result).length > max ||
      result.includes('\u0000') ||
      /[\ud800-\udfff]/u.test(result)
    )
      return fail();
    return result;
  };
  return value.map((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return fail();
    const row = raw as Record<string, unknown>;
    if (
      Object.keys(row).length !== 6 ||
      !['id', 'kind', 'label', 'hint', 'required', 'options'].every((key) =>
        Object.prototype.hasOwnProperty.call(row, key),
      ) ||
      typeof row.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,40}$/.test(row.id) ||
      ids.has(row.id) ||
      typeof row.kind !== 'string' ||
      !KINDS.includes(row.kind) ||
      typeof row.required !== 'boolean' ||
      !Array.isArray(row.options) ||
      row.options.length > 20
    )
      return fail();
    ids.add(row.id);
    const options = row.options.map((option) => text(option, 1, 80));
    const choice = row.kind === 'SINGLE_CHOICE' || row.kind === 'MULTI_CHOICE';
    if (
      (choice ? options.length < 2 : options.length !== 0) ||
      new Set(options).size !== options.length
    )
      return fail();
    return {
      id: row.id,
      kind: row.kind,
      label: text(row.label, 1, 80),
      hint: text(row.hint, 0, 200),
      required: row.required,
      options,
    };
  });
}
