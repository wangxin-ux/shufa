import { Module } from '@nestjs/common';
import { LessonLedgerService } from './lesson-ledger.service';

@Module({
  providers: [LessonLedgerService],
  exports: [LessonLedgerService],
})
export class LessonLedgerModule {}
