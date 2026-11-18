import { buildTeacherStudentFeedbackModels } from '../services/teacher-students.presenter';
import { teacherRatingStarSlots } from '../utils/teacher-ratings';
import { TeacherStudentFeedbackHistory } from '../types/teacher';

const feedback = (patch: Partial<TeacherStudentFeedbackHistory> = {}): TeacherStudentFeedbackHistory => ({
  id: 'feedback-1',
  lessonSessionId: 'session-1',
  courseName: '创意美术',
  className: '创意班',
  startsAt: '2026-09-24T14:00:00+08:00',
  updatedAt: '2026-09-24T15:10:00+08:00',
  lessonStatus: 'COMPLETED',
  content: '本节课表现稳定。',
  performanceRating: null,
  feedbackAuthorName: '赵老师',
  images: [],
  ...patch,
});

it('maps raw half-star scores onto five slots without inventing scores', () => {
  expect(teacherRatingStarSlots(null)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  expect(teacherRatingStarSlots(undefined)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  expect(teacherRatingStarSlots(0)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  expect(teacherRatingStarSlots(1)).toEqual(['half', 'empty', 'empty', 'empty', 'empty']);
  expect(teacherRatingStarSlots(7)).toEqual(['full', 'full', 'full', 'half', 'empty']);
  expect(teacherRatingStarSlots(9)).toEqual(['full', 'full', 'full', 'full', 'half']);
  expect(teacherRatingStarSlots(10)).toEqual(['full', 'full', 'full', 'full', 'full']);
  expect(teacherRatingStarSlots(12)).toEqual(['full', 'full', 'full', 'full', 'full']);
  expect(teacherRatingStarSlots(-3)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
});

it('builds the three-line meta and card stars from the latest feedback record', () => {
  const [model] = buildTeacherStudentFeedbackModels([feedback({
    teacherRatings: {
      classroomPerformance: 9, workCompletion: 8, communication: null, overall: 7,
    },
  })]);
  expect(model.metaLines).toEqual(['创意班', '创意美术', '9月24日 赵老师']);
  expect(model.stars).toEqual(['full', 'full', 'full', 'half', 'empty']);
  expect(model.ratingStarRows).toEqual([
    expect.objectContaining({ field: 'classroomPerformance', stars: ['full', 'full', 'full', 'full', 'half'] }),
    expect.objectContaining({ field: 'workCompletion', stars: ['full', 'full', 'full', 'full', 'empty'] }),
    expect.objectContaining({ field: 'communication', stars: ['empty', 'empty', 'empty', 'empty', 'empty'] }),
    expect.objectContaining({ field: 'overall', stars: ['full', 'full', 'full', 'half', 'empty'] }),
  ]);
});

it('falls back to the legacy single score and omits the author when the record has none', () => {
  const [model] = buildTeacherStudentFeedbackModels([feedback({
    performanceRating: 8, feedbackAuthorName: null,
  })]);
  expect(model.metaLines).toEqual(['创意班', '创意美术', '9月24日']);
  expect(model.stars).toEqual(['full', 'full', 'full', 'full', 'empty']);
  expect(model.ratingStarRows).toEqual([]);
});

it('splits the first image into the card thumbnail and keeps the rest as extras', () => {
  const images = [
    { id: 'image-1', accessUrl: 'https://example.test/1.jpg' },
    { id: 'image-2', accessUrl: 'https://example.test/2.jpg' },
  ] as TeacherStudentFeedbackHistory['images'];
  const [withImages] = buildTeacherStudentFeedbackModels([feedback({ images })]);
  expect(withImages.mediaImage?.id).toBe('image-1');
  expect(withImages.extraImages.map((image) => image.id)).toEqual(['image-2']);

  const [withoutImages] = buildTeacherStudentFeedbackModels([feedback()]);
  expect(withoutImages.mediaImage).toBeNull();
  expect(withoutImages.extraImages).toEqual([]);
});
