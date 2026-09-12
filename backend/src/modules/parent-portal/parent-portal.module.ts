import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { ParentPortalController } from './parent-portal.controller';
import { ParentPortalService } from './parent-portal.service';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [ParentPortalController],
  providers: [ParentPortalService],
})
export class ParentPortalModule {}
