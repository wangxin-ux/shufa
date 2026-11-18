import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TeacherPortalController } from './teacher-portal.controller';

import { TeacherRankingService } from './teacher-ranking.service';

@Module({
  imports: [AuthModule, SchedulingModule],
  controllers: [TeacherPortalController],
  providers: [TeacherRankingService],
})
export class TeacherPortalModule {}
