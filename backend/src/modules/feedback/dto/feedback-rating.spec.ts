import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FeedbackUpsertDto } from './feedback.dto';

describe('teacher classroom performance input', () => {
  const check = (performanceRating: unknown) => validate(
    plainToInstance(FeedbackUpsertDto, { content: '课堂认真', imageFileIds: [], performanceRating }),
    { whitelist: true, forbidNonWhitelisted: true },
  );

  it.each([null, undefined, 1, 9, 10])('accepts optional half-star units %s', async (value) => {
    expect(await check(value)).toEqual([]);
  });

  it.each([0, 11, 1.5, '9', true])('rejects invalid performance rating %s', async (value) => {
    expect((await check(value)).map(({ property }) => property)).toContain('performanceRating');
  });
});
