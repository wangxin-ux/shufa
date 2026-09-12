import {
  CampusManagerCreateStudentDraft,
  CampusManagerCreateStudentInput,
  CampusManagerStudent,
} from '../types/campus-manager';
import { RequestState } from '../utils/request-state';

interface CampusManagerStudentWorkflowService {
  createStudent(
    input: CampusManagerCreateStudentInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerStudent>>;
}

export type CampusManagerStudentWorkflowOutcome =
  | {
      status: 'success';
      data: CampusManagerStudent;
      draft: CampusManagerCreateStudentDraft;
    }
  | {
      status: 'validation' | 'error' | 'forbidden' | 'conflict';
      message: string;
      code?: string;
      draft: CampusManagerCreateStudentDraft;
    };

export interface CampusManagerStudentWorkflowOptions {
  createIdempotencyKey?: () => string;
}

let idempotencySequence = 0;

function defaultIdempotencyKey(): string {
  idempotencySequence += 1;
  return `campus-student-${Date.now()}-${idempotencySequence}`;
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateCampusManagerStudentDraft(
  draft: CampusManagerCreateStudentDraft,
): string | null {
  const displayName = draft.displayName.trim();
  if (!displayName) {
    return '请填写学员姓名';
  }
  if (displayName.length > 100) {
    return '学员姓名不能超过 100 字';
  }
  const birthDate = draft.birthDate?.trim();
  if (birthDate && !isValidDate(birthDate)) {
    return '请选择有效的出生日期';
  }
  return null;
}

export function normalizeCampusManagerStudentDraft(
  draft: CampusManagerCreateStudentDraft,
): CampusManagerCreateStudentInput {
  return {
    displayName: draft.displayName.trim(),
    birthDate: draft.birthDate?.trim() || null,
    classGroupId: draft.classGroupId?.trim() || null,
  };
}

export class CampusManagerStudentWorkflow {
  private readonly createIdempotencyKey: () => string;
  private readonly keys = new Map<string, string>();
  private readonly inFlight = new Map<
    string,
    Promise<CampusManagerStudentWorkflowOutcome>
  >();

  constructor(
    private readonly service: CampusManagerStudentWorkflowService,
    options: CampusManagerStudentWorkflowOptions = {},
  ) {
    this.createIdempotencyKey =
      options.createIdempotencyKey ?? defaultIdempotencyKey;
  }

  submit(
    draft: CampusManagerCreateStudentDraft,
  ): Promise<CampusManagerStudentWorkflowOutcome> {
    const preservedDraft = { ...draft };
    const validation = validateCampusManagerStudentDraft(preservedDraft);
    if (validation) {
      return Promise.resolve({
        status: 'validation',
        message: validation,
        draft: preservedDraft,
      });
    }
    const input = normalizeCampusManagerStudentDraft(preservedDraft);
    const signature = JSON.stringify(input);
    const existing = this.inFlight.get(signature);
    if (existing) {
      return existing;
    }
    const key = this.keys.get(signature) ?? this.createIdempotencyKey();
    this.keys.set(signature, key);
    const promise = this.execute(signature, preservedDraft, input, key);
    this.inFlight.set(signature, promise);
    void promise.finally(() => {
      if (this.inFlight.get(signature) === promise) {
        this.inFlight.delete(signature);
      }
    });
    return promise;
  }

  private async execute(
    signature: string,
    draft: CampusManagerCreateStudentDraft,
    input: CampusManagerCreateStudentInput,
    key: string,
  ): Promise<CampusManagerStudentWorkflowOutcome> {
    const state = await this.service.createStudent(input, key);
    if (state.status === 'success') {
      this.keys.delete(signature);
      return { status: 'success', data: state.data, draft };
    }
    if (state.status !== 'error') {
      return { status: 'error', message: '新增未完成，请重试', draft };
    }
    if (state.statusCode === 403) {
      return {
        status: 'forbidden',
        message: state.message,
        code: state.code,
        draft,
      };
    }
    if (state.statusCode === 409) {
      return {
        status: 'conflict',
        message: state.message,
        code: state.code,
        draft,
      };
    }
    return {
      status: 'error',
      message: state.message,
      code: state.code,
      draft,
    };
  }
}
