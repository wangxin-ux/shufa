import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PartnerPeriodQueryDto } from './partner-query.dto';
import {
  PartnerEarningPeriodQueryDto,
  PartnerEarningsQueryDto,
} from '../../partner-earning/dto/partner-earning.dto';

describe.each([
  PartnerPeriodQueryDto,
  PartnerEarningPeriodQueryDto,
  PartnerEarningsQueryDto,
])('%s calendar date query', (Dto) => {
  it.each([undefined, '2026-10-08', '2024-02-29'])(
    'accepts an optional valid calendar date %s',
    async (anchorDate) => {
      const dto = plainToInstance(Dto, { anchorDate });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-10-08T00:00:00Z',
    '2026-10-08T08:00:00+08:00',
    '20261008',
    '2026-281',
    '2026-W41-4',
    '',
  ])('rejects non-calendar date %s', async (anchorDate) => {
    const dto = plainToInstance(Dto, { anchorDate });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'anchorDate')).toBe(true);
  });
});
