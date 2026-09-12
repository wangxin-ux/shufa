import * as fs from 'fs';
import * as path from 'path';
import {
  buildParentProfilePageModel,
  formatUnreadMessageBadge,
  resolveParentProfileAction,
} from '../services/parent-profile.presenter';

const profilePresenter = jest.requireActual(
  '../services/parent-profile.presenter',
) as {
  normalizeParentProfileDraft(input: {
    ageInput: string;
    homeAddressInput: string;
  }): { age: number; homeAddress: string };
};

describe('parent profile page model', () => {
  it('uses dynamic student data without substituting design examples', () => {
    const model = buildParentProfilePageModel({
      student: {
        id: 'student-1',
        name: '林小禾同学',
        age: 9,
        homeAddress: '长沙市岳麓区启明路 18 号',
        profileVersion: 3,
      },
      unreadMessageCount: 3,
    } as unknown as Parameters<typeof buildParentProfilePageModel>[0]);

    expect(model).toMatchObject({
      isEmpty: false,
      studentName: '林小禾同学',
      studentAgeLabel: '9 岁',
      studentAgeInput: '9',
      homeAddress: '长沙市岳麓区启明路 18 号',
      homeAddressLabel: '长沙市岳麓区启明路 18 号',
      profileVersion: 3,
      unreadMessageCount: 3,
    });
  });

  it('returns an explicit empty model when no student is bound', () => {
    const model = buildParentProfilePageModel({ student: null, unreadMessageCount: 0 });

    expect(model).toEqual({
      isEmpty: true,
      studentName: '',
      studentAgeLabel: '',
      studentAgeInput: '',
      homeAddress: '',
      homeAddressLabel: '',
      profileVersion: 0,
      unreadMessageCount: 0,
      emptyMessage: '暂未绑定学员',
    });
  });

  it('navigates to hours and classroom updates', () => {
    expect(resolveParentProfileAction('hours')).toEqual({
      kind: 'navigate',
      url: '/pages/parent/hours/index',
    });

    expect(resolveParentProfileAction('messages')).toEqual({
      kind: 'navigate',
      url: '/pages/parent/updates/index',
    });
    expect(resolveParentProfileAction('student')).toEqual({
      kind: 'navigate',
      url: '/pages/parent/student-profile/index',
    });
  });

  it('registers an editable learner profile page backed by the parent profile API', () => {
    const root = path.resolve(__dirname, '..');
    const app = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string; pages: string[] }> };
    const parentPages = app.subPackages.find(({ root: packageRoot }) =>
      packageRoot === 'pages/parent'
    )?.pages ?? [];
    const logic = fs.readFileSync(
      path.join(root, 'pages/parent/student-profile/index.ts'),
      'utf8',
    );
    const markup = fs.readFileSync(
      path.join(root, 'pages/parent/student-profile/index.wxml'),
      'utf8',
    );

    expect(parentPages).toContain('student-profile/index');
    expect(logic).toContain('parentService.loadProfile()');
    expect(logic).toContain('parentService.updateProfile(');
    expect(logic).toContain('onEdit');
    expect(logic).toContain('onSave');
    expect(markup).toContain('当前绑定学员');
    expect(markup).toContain('资料概览');
    expect(markup).toContain('年龄');
    expect(markup).toContain('家庭住址');
    expect(markup).toContain('bindinput="onAgeInput"');
    expect(markup).toContain('bindinput="onAddressInput"');
    expect(markup).toContain('保存资料');
    expect(markup).toContain('已绑定');
    expect(markup).toContain('view-state');
  });

  it('normalizes editable fields and rejects invalid ages', () => {
    expect(
      profilePresenter.normalizeParentProfileDraft({
        ageInput: ' 10 ',
        homeAddressInput: '  长沙市岳麓区启明路 20 号  ',
      }),
    ).toEqual({ age: 10, homeAddress: '长沙市岳麓区启明路 20 号' });
    expect(() =>
      profilePresenter.normalizeParentProfileDraft({
        ageInput: '121',
        homeAddressInput: '',
      }),
    ).toThrow('年龄需填写 0 至 120 的整数');
  });

  it('uses the shared logout control without a second account-switch command', () => {
    const root = path.resolve(__dirname, '..');
    const logic = fs.readFileSync(
      path.join(root, 'pages/parent/profile/index.ts'),
      'utf8',
    );
    const markup = fs.readFileSync(
      path.join(root, 'pages/parent/profile/index.wxml'),
      'utf8',
    );

    expect(logic).not.toContain('sessionService');
    expect(logic).not.toContain('switchTestAccount');
    expect(logic).not.toContain('wx.reLaunch');
    expect(markup).toContain('<session-logout');
    expect(`${logic}\n${markup}`).not.toMatch(/切换(?:本地)?测试账号|切换使用身份/);
    expect(markup).toContain('{{item.label}}');
  });

  it('keeps unread badges compact', () => {
    expect(formatUnreadMessageBadge(0)).toBe('');
    expect(formatUnreadMessageBadge(3)).toBe('3');
    expect(formatUnreadMessageBadge(120)).toBe('99+');
  });
});
