import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  CampusSubjectController,
  PartnerSubjectController,
} from './campus-subject.controller';
import { CampusSubjectService } from './campus-subject.service';

@Module({
  imports: [AuthModule],
  controllers: [CampusSubjectController, PartnerSubjectController],
  providers: [CampusSubjectService],
})
export class CampusSubjectModule {}
