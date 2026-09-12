import * as fs from 'fs';
import * as path from 'path';

const SHARED_ASSET_DIR = path.resolve(__dirname, '../assets/teacher');
const PACKAGE_ASSET_DIR = path.resolve(__dirname, '../pages/teacher/assets');
const SHARED_ASSETS = new Set(['home-mascot.png', 'home-stat-glass.png']);
const EXPECTED_ASSETS = [
  'home-mascot.png',
  'home-stat-glass.png',
  'profile-card-mascot.png',
  'profile-footer-mascot.png',
  'icon-schedule.png',
  'icon-student-record.png',
  'icon-confirm.png',
  'icon-students.png',
];

function pngDimensions(file: string): { width: number; height: number } {
  const buffer = fs.readFileSync(file);
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe('teacher PSD assets', () => {
  it.each(EXPECTED_ASSETS)('%s is a non-empty PNG below 500 KB', (name) => {
    const file = path.join(
      SHARED_ASSETS.has(name) ? SHARED_ASSET_DIR : PACKAGE_ASSET_DIR,
      name,
    );
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(500 * 1024);
    const dimensions = pngDimensions(file);
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThan(0);
  });

  it('contains no prohibited brand filename', () => {
    expect(fs.existsSync(SHARED_ASSET_DIR)).toBe(true);
    expect(fs.existsSync(PACKAGE_ASSET_DIR)).toBe(true);
    const names = [
      ...fs.readdirSync(SHARED_ASSET_DIR),
      ...fs.readdirSync(PACKAGE_ASSET_DIR),
    ];
    expect(names).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/logo|brand|kaiman/i),
      ]),
    );
  });

  it('keeps the teacher home mascot as one complete full-body image', () => {
    const dimensions = pngDimensions(
      path.join(SHARED_ASSET_DIR, 'home-mascot.png'),
    );

    expect(dimensions.height / dimensions.width).toBeGreaterThan(1.45);
  });
});
