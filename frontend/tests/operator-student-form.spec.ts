import * as fs from 'fs';
import * as path from 'path';
import {
  ApiOperatorDataSource,
  OperatorHttpRequest,
} from '../pages/operator/runtime/data/api-operator-data-source';
import {
  OperatorStudentWorkflow,
  normalizeOperatorStudentDraft,
  validateOperatorStudentDraft,
} from '../pages/operator/runtime/services/operator-student.workflow';
import {
  OperatorCreateStudentDraft,
  OperatorStudent,
} from '../pages/operator/runtime/types/operator';
import { RequestState } from '../utils/request-state';

const validDraft: OperatorCreateStudentDraft = {
  displayName: ' 陈小满 ',
  birthDate: '2018-05-16',
  classGroupId: 'class-east',
};

const created: OperatorStudent = {
  id: 'student-created',
  campusId: 'campus-east',
  displayName: '陈小满',
  ageYears: 8,
  classNames: ['创意基础A班'],
};

interface WorkflowService {
  createStudent(
    input: ReturnType<typeof normalizeOperatorStudentDraft>,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorStudent>>;
}

describe('campus manager student form', () => {
  it('normalizes only the three allowed fields and validates dates strictly', () => {
    expect(normalizeOperatorStudentDraft(validDraft)).toEqual({
      displayName: '陈小满',
      birthDate: '2018-05-16',
      classGroupId: 'class-east',
    });
    expect(
      normalizeOperatorStudentDraft({
        displayName: ' 安然 ',
        birthDate: '',
        classGroupId: '',
      }),
    ).toEqual({ displayName: '安然', birthDate: null, classGroupId: null });
    expect(validateOperatorStudentDraft({ displayName: '   ' })).toBe(
      '请填写学员姓名',
    );
    expect(
      validateOperatorStudentDraft({ displayName: '学'.repeat(101) }),
    ).toBe('学员姓名不能超过 100 字');
    expect(
      validateOperatorStudentDraft({
        displayName: '陈小满',
        birthDate: '2018-02-30',
      }),
    ).toBe('请选择有效的出生日期');
    expect(validateOperatorStudentDraft(validDraft)).toBeNull();
  });

  it('locks a double tap and reuses the key when the same draft retries', async () => {
    let release: (
      value: RequestState<OperatorStudent>,
    ) => void = () => undefined;
    const createStudent = jest.fn() as jest.MockedFunction<
      WorkflowService['createStudent']
    >;
    createStudent
      .mockImplementationOnce(
        () =>
          new Promise<RequestState<OperatorStudent>>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: 'error', message: '网络不可用' })
      .mockResolvedValueOnce({ status: 'success', data: created });
    const createIdempotencyKey = jest
      .fn()
      .mockReturnValueOnce('student-key-1')
      .mockReturnValueOnce('student-key-2');
    const workflow = new OperatorStudentWorkflow(
      { createStudent } as WorkflowService,
      { createIdempotencyKey },
    );

    const first = workflow.submit(validDraft);
    expect(workflow.submit(validDraft)).toBe(first);
    expect(createStudent).toHaveBeenCalledTimes(1);
    release({ status: 'error', message: '网络不可用' });
    await expect(first).resolves.toMatchObject({
      status: 'error',
      draft: validDraft,
    });

    await expect(workflow.submit(validDraft)).resolves.toMatchObject({
      status: 'error',
      draft: validDraft,
    });
    await expect(workflow.submit(validDraft)).resolves.toMatchObject({
      status: 'success',
      data: created,
    });
    expect(createStudent.mock.calls.map((call) => call[1])).toEqual([
      'student-key-1',
      'student-key-1',
      'student-key-1',
    ]);
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('uses a new key after the user changes the failed draft', async () => {
    const createStudent: jest.MockedFunction<
      WorkflowService['createStudent']
    > = jest.fn(async (_input, _idempotencyKey) => ({
      status: 'error' as const,
      message: '网络不可用',
    }));
    const createIdempotencyKey = jest
      .fn()
      .mockReturnValueOnce('student-key-a')
      .mockReturnValueOnce('student-key-b');
    const workflow = new OperatorStudentWorkflow(
      { createStudent } as WorkflowService,
      { createIdempotencyKey },
    );

    await workflow.submit(validDraft);
    await workflow.submit({ ...validDraft, displayName: '安然' });

    expect(createStudent.mock.calls.map((call) => call[1])).toEqual([
      'student-key-a',
      'student-key-b',
    ]);
  });

  it('loads class options and sends the idempotent create contract', async () => {
    const requests: Parameters<OperatorHttpRequest>[0][] = [];
    const request: OperatorHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data:
          options.method === 'GET'
            ? { data: { classes: [] }, requestId: 'options-1' }
            : { data: created, requestId: 'student-created' },
      });
    };
    const source = new ApiOperatorDataSource({
      baseUrl: 'https://example.test',
      accessToken: 'manager-token',
      request,
    });

    await source.getSchedulingOptions();
    await source.createStudent(
      {
        displayName: '陈小满',
        birthDate: '2018-05-16',
        classGroupId: 'class-east',
      },
      'student-create-key-1',
    );

    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://example.test/operators/me/scheduling-options',
    });
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/operators/me/students',
      header: {
        Authorization: 'Bearer manager-token',
        'Idempotency-Key': 'student-create-key-1',
      },
      data: {
        displayName: '陈小满',
        birthDate: '2018-05-16',
        classGroupId: 'class-east',
      },
    });
  });

  it('renders only the approved fields and centered submission controls', () => {
    const root = path.resolve(__dirname, '..');
    const pageDir = path.join(root, 'pages/operator/student-form');
    const markup = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
    const logic = fs.readFileSync(path.join(pageDir, 'index.ts'), 'utf8');
    const styles = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8');
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const pages =
      app.subPackages.find((item) => item.root === 'pages/operator')
        ?.pages ?? [];
    const source = `${markup}\n${logic}`;

    expect(markup).toContain('学员姓名');
    expect(markup).toContain('出生日期（选填）');
    expect(markup).toContain('班级（选填）');
    expect(markup).toContain('确认新增');
    expect(source).toContain('submitting');
    expect(source).toContain('onRetryOptions');
    expect(source).not.toMatch(/家长|课包|订单|收费|支付|转校|删除/);
    expect(styles).toMatch(/\.student-form__submit[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/);
    expect(styles).toContain('var(--operator-touch-min)');
    expect(pages).toContain('student-form/index');
  });
});
