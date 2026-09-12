import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TeacherPortalController } from './teacher-portal.controller';

@Module({
  imports: [AuthModule, SchedulingModule],
  controllers: [TeacherPortalController],
})
export class TeacherPortalModule {}
