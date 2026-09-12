import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

const PARENT_PAGES = [
  'pages/parent/home/index',
  'pages/parent/hours/index',
  'pages/parent/leave/index',
  'pages/parent/profile/index',
  'pages/parent/student-profile/index',
  'pages/parent/updates/index',
  'pages/parent/group-campaigns/index',
  'pages/parent/group-detail/index',
  'pages/parent/group-orders/index',
  'pages/parent/campuses/index',
];

const TEACHER_PAGES = [
  'pages/teacher/home/index',
  'pages/teacher/schedule/index',
  'pages/teacher/students/index',
  'pages/teacher/student-detail/index',
  'pages/teacher/lesson/index',
  'pages/teacher/feedback/index',
  'pages/teacher/feedback-detail/index',
  'pages/teacher/records/index',
  'pages/teacher/ledger/index',
  'pages/teacher/profile/index',
  'pages/teacher/settings/index',
  'pages/teacher/earnings/index',
  'pages/teacher/group-campaigns/index',
  'pages/teacher/group-detail/index',
];

const TEACHER_COMPONENTS = [
  'teacher-page-shell',
  'teacher-page-mark',
  'teacher-stat-strip',
  'teacher-action-row',
  'teacher-workspace-banner',
];

describe('teacher mini program structure', () => {
  it('registers bootstrap before the parent and teacher routes', () => {
    const app = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'),
    ) as {
      pages: string[];
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    expect(app.pages).toEqual(['pages/bootstrap/index']);
    const fullPages = (root: string) =>
      app.subPackages
        .find((item) => item.root === root)
        ?.pages.map((page) => `${root}/${page}`);
    expect(fullPages('pages/parent')).toEqual(PARENT_PAGES);
    expect(fullPages('pages/teacher')).toEqual(TEACHER_PAGES);
  });

  it.each(TEACHER_PAGES)('%s has a complete native page file set', (page) => {
    for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
      expect(fs.existsSync(path.join(ROOT, `${page}.${extension}`))).toBe(true);
    }
  });

  it.each(TEACHER_COMPONENTS)('%s has a complete component file set', (name) => {
    for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
      expect(
        fs.existsSync(
          path.join(ROOT, 'components', name, `${name}.${extension}`),
        ),
      ).toBe(true);
    }
  });

  it('keeps prohibited brand marks and text out of all teacher WXML', () => {
    const files = [
      ...TEACHER_PAGES.map((page) => path.join(ROOT, `${page}.wxml`)),
      ...TEACHER_COMPONENTS.map((name) =>
        path.join(ROOT, 'components', name, `${name}.wxml`),
      ),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(
        /凯曼|KAIMAN|EDUCATION|brand-dog-head|brand-logo/i,
      );
    }
  });

  it('adds teacher-only design tokens without renaming parent tokens', () => {
    const tokens = fs.readFileSync(path.join(ROOT, 'styles/tokens.wxss'), 'utf8');
    expect(tokens).toContain('--parent-yellow');
    expect(tokens).toContain('--teacher-yellow');
    expect(tokens).toContain('--teacher-orange');
    expect(tokens).toContain('--teacher-ink');
    expect(tokens).toContain('--teacher-touch-min');
  });
});
