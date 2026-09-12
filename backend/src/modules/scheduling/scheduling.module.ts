import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { TeacherReadService } from './teacher-read.service';

@Module({
  imports: [AuthModule, FileModule],
  providers: [TeacherReadService],
  exports: [TeacherReadService],
})
export class SchedulingModule {}
