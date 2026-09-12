import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './common/bootstrap/configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApplication(app);
  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
