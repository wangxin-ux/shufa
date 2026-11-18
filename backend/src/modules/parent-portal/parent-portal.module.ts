import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { ParentPortalController } from './parent-portal.controller';
import { ParentPortalService } from './parent-portal.service';
import { ParentGrowthController } from './parent-growth.controller';
import { ParentGrowthService } from './parent-growth.service';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [ParentPortalController, ParentGrowthController],
  providers: [ParentPortalService, ParentGrowthService],
})
export class ParentPortalModule {}
