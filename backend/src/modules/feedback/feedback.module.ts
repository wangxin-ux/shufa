import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FileModule } from '../file/file.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackMediaController } from './feedback-media.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [AuthModule, FileModule],
  controllers: [FeedbackController, FeedbackMediaController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
