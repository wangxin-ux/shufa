import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsUUID,
  Matches,
} from 'class-validator';
import type { OperatorLessonKind } from './operator-scheduling.dto';

export class OperatorSeriesPatternDto {
  @IsUUID('4')
  classGroupId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string;

  @IsInt()
  @IsIn([1, 2])
  intervalWeeks!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsIn([1, 2, 3, 4, 5, 6, 7], { each: true })
  weekdays!: number[];

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime!: string;

  @IsIn(['REGULAR', 'MAKEUP', 'TRIAL'])
  kind!: OperatorLessonKind;
}

export class OperatorCreateSeriesDto extends OperatorSeriesPatternDto {
  @Matches(/^[0-9a-f]{64}$/)
  previewHash!: string;
}

export class OperatorCancellationPreviewDto {
  @IsIn(['THIS', 'FOLLOWING'])
  mode!: 'THIS' | 'FOLLOWING';
}

export class OperatorCancelSelectionDto extends OperatorCancellationPreviewDto {
  @Matches(/^[0-9a-f]{64}$/)
  previewHash!: string;
}
