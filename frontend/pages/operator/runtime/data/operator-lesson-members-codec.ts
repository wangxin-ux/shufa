import { OperatorDataSourceError } from './operator-data-source';
import type { OperatorLessonRoster, OperatorLessonMember } from '../types/operator-lesson-members';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const operatorMemberId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const versionNumber = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 2147483647;

export function validateOperatorMemberWrite(id: string, version: number, key: string, studentId?: string) {
  if (!operatorMemberId(id) || !versionNumber(version) || !key.trim() ||
      (studentId !== undefined && !operatorMemberId(studentId)))
    throw new OperatorDataSourceError(400, 'BAD_REQUEST', '课次名单请求无效');
}

export function parseOperatorLessonRoster(value: unknown, lessonSessionId: string): OperatorLessonRoster {
  const invalid = () => new OperatorDataSourceError(
    0, 'INVALID_LESSON_MEMBERS_RESPONSE', '课次名单返回内容不一致，请重试',
  );
  const data = record(value) ? value.data : undefined;
  if (!record(data) || data.lessonSessionId !== lessonSessionId ||
      !operatorMemberId(data.lessonSessionId) || !versionNumber(data.lessonVersion) ||
      !['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'REVERSED', 'CANCELLED'].includes(String(data.status)) ||
      !timestamp(data.startsAt) || !timestamp(data.serverTime) ||
      typeof data.canChange !== 'boolean' || !Array.isArray(data.members) ||
      (data.canChange && (data.status !== 'SCHEDULED' || Date.parse(data.startsAt) <= Date.parse(data.serverTime))))
    throw invalid();
  const seen = new Set<string>();
  const members = data.members.map((member: unknown): OperatorLessonMember => {
    if (!record(member) || !operatorMemberId(member.studentId) ||
        typeof member.displayName !== 'string' || !member.displayName.trim() ||
        !['CLASS', 'TEMPORARY', 'HISTORICAL'].includes(String(member.source)) ||
        typeof member.canRemove !== 'boolean' || seen.has(member.studentId.toLowerCase()) ||
        (member.canRemove && (member.source !== 'TEMPORARY' || !data.canChange)) ||
        ((data.status === 'COMPLETED' || data.status === 'REVERSED') && member.source !== 'HISTORICAL'))
      throw invalid();
    seen.add(member.studentId.toLowerCase());
    return { studentId: member.studentId, displayName: member.displayName,
      source: member.source as OperatorLessonMember['source'], canRemove: member.canRemove };
  });
  return {
    lessonSessionId: data.lessonSessionId, lessonVersion: data.lessonVersion,
    status: data.status as OperatorLessonRoster['status'], startsAt: data.startsAt,
    canChange: data.canChange, members, serverTime: data.serverTime,
  };
}
