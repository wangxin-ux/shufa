import * as fs from 'fs';
import * as path from 'path';
import { ParentMockScenario } from '../config/env';
import { MockParentDataSource } from '../data/mock-parent-data-source';
import { PARENT_DISPLAY_FONT_CHARACTERS } from '../assets/fonts/parent-display-font';
import { createParentRuntimeEnv } from '../config/env';
import { createParentDataSource } from '../services/parent-runtime';
import { ApiParentDataSource } from '../data/api-parent-data-source';

const root = path.resolve(__dirname, '..');
const visualSource = () => new MockParentDataSource({ scenario: 'visual' as ParentMockScenario });

describe('local parent visual samples', () => {
  it('never replaces an API data source with visual samples', () => {
    expect(createParentDataSource(createParentRuntimeEnv({
      dataDriver: 'api', apiBaseUrl: 'http://localhost:3100', mockScenario: 'visual',
    }))).toBeInstanceOf(ApiParentDataSource);
  });

  it('fills the six reference views through the existing mock data contract', async () => {
    const source = visualSource();
    const home = await source.getHomeSummary();
    const profile = await source.getProfile();
    const hours = await source.getHoursView();
    const leave = await source.getLeavePage();
    const updates = await source.getUpdates();
    const courses = await source.listCourseCatalog({ page: 1, pageSize: 20 });
    expect(home.student.id).toBe('visual-student');
    expect(profile.student?.id).toBe(home.student.id);
    expect(updates.student?.id).toBe(home.student.id);
    expect(home.nextLesson).not.toBeNull();
    expect(home.remainingHoursLabel).toBe(String(hours.remainingTotal));
    expect(hours.grantedPaidHours).toBe(48);
    expect(hours.grantedGiftHours).toBe(12);
    expect(hours.entries).toHaveLength(3);
    expect(leave.students[0].id).toBe(home.student.id);
    expect(leave.lessons.length).toBeGreaterThan(0);
    expect(leave.records.length).toBeGreaterThanOrEqual(2);
    expect(courses.data).toHaveLength(5);
    expect(updates.records).toHaveLength(2);
    expect(updates.records.map((record) => record.canReview)).toEqual([true, false]);
    expect(updates.records[1].review?.valid).toBe(true);
    expect(updates.records.every((record) => record.feedback && record.performanceRating)).toBe(true);
  });

  it('uses only marked synthetic package images for the visual photos', async () => {
    const updates = await visualSource().getUpdates();
    const photos = [updates.student?.photo, ...updates.records.flatMap((record) => record.feedbackImages)];
    expect(photos.every(Boolean)).toBe(true);
    for (const photo of photos) {
      expect(photo?.accessUrl).toMatch(/^\/pages\/parent\/assets\/visual-(student|classroom)\.png$/);
      expect(fs.existsSync(path.join(root, photo!.accessUrl))).toBe(true);
      expect(photo?.mimeType).toBe('image/png');
    }
  });

  it('does not change the normal fixture or retain caller edits between instances', async () => {
    const source = visualSource();
    const before = await source.getHoursView();
    before.remainingTotal = 9999;
    expect((await source.getHoursView()).remainingTotal).toBe(37);
    const normal = await new MockParentDataSource().getUpdates();
    expect(normal.student?.id).toBe('student-lin-xiao-he');
    expect(normal.student?.photo).toBeNull();
    expect(normal.records).toHaveLength(1);
    const another = await visualSource().getUpdates();
    another.records[0].feedback = 'caller edit';
    expect((await visualSource().getUpdates()).records[0].feedback).not.toBe('caller edit');
  });

  it('covers the visual sample Chinese with the approved display font', async () => {
    const source = visualSource();
    const content = JSON.stringify(await Promise.all([
      source.getHomeSummary(), source.getHoursView(), source.getLeavePage(),
      source.getProfile(), source.getUpdates(),
    ]));
    const missing = [...new Set(Array.from(content).filter((character) =>
      /[\u3400-\u9fff]/.test(character) && !PARENT_DISPLAY_FONT_CHARACTERS.includes(character),
    ))];
    expect(missing).toEqual([]);
  });
});
